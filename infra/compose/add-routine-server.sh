#!/bin/bash
# Adds a server that runs routines and overflow document runners for this stack
# (docs/self-host-routine-runner.md). Run from an operator machine with root SSH to both servers:
#
#   add-routine-server.sh --stack <stack public IP> --stack-key <key> \
#     --server <new server public IP> --server-key <key> --private 10.77.0.N [--overflow]
#
# Every step is safe to repeat. The stack gets a WireGuard peer, an NFS export, a guard entry and
# a push target; the new server gets WireGuard, the NFS mount, the forced-command push key, its
# firewall and the receive script. The first push copies the images (about 16 GB) in the
# background. --overflow also lists its runner in RAKAZO_TOOL_RUNNER_OVERFLOW_URLS and recreates
# the stack's api and worker, so do that when no replies are running.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
STACK_PRIVATE=10.77.0.1
WG_PORT=51820
overflow=0
while (($#)); do
  case "$1" in
    --stack) stack="$2"; shift 2 ;;
    --stack-key) stack_key="$2"; shift 2 ;;
    --server) server="$2"; shift 2 ;;
    --server-key) server_key="$2"; shift 2 ;;
    --private) private="$2"; shift 2 ;;
    --overflow) overflow=1; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
: "${stack:?--stack}" "${stack_key:?--stack-key}" "${server:?--server}" "${server_key:?--server-key}" "${private:?--private}"
[[ "$private" =~ ^10\.77\.0\.([0-9]+)$ ]] && ((BASH_REMATCH[1] >= 3 && BASH_REMATCH[1] <= 254)) ||
  { echo "--private must be 10.77.0.3-254" >&2; exit 2; }

on_stack() { ssh -i "$stack_key" -o BatchMode=yes -o IdentitiesOnly=yes "root@$stack" "$@"; }
on_server() { ssh -i "$server_key" -o BatchMode=yes -o IdentitiesOnly=yes "root@$server" "$@"; }

echo "== new server: packages, WireGuard key"
on_server bash -s <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
command -v wg >/dev/null && command -v mount.nfs4 >/dev/null || { apt-get update -q; apt-get install -yq wireguard nfs-common; }
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
[[ -f /etc/docker/daemon.json ]] || {
  printf '{\n  "live-restore": true,\n  "log-driver": "local",\n  "log-opts": { "max-file": "3", "max-size": "10m" },\n  "no-new-privileges": true,\n  "userland-proxy": false\n}\n' >/etc/docker/daemon.json
  systemctl restart docker
}
umask 077
[[ -f /etc/wireguard/wg0.key ]] || wg genkey >/etc/wireguard/wg0.key
REMOTE
server_pub="$(on_server 'wg pubkey </etc/wireguard/wg0.key')"
stack_pub="$(on_stack 'wg show wg0 public-key')"
push_pub="$(on_stack 'cat /root/.ssh/routine-runner.pub')"

echo "== new server: wg0 $private, NFS mount, push key, firewall"
scp -q -i "$server_key" -o BatchMode=yes -o IdentitiesOnly=yes \
  "$HERE/routine-receive.sh" "$HERE/runner-guard.sh" "$HERE/restrict-computer-egress.sh" "root@$server:/root/"
on_server bash -s -- "$private" "$stack" "$stack_pub" "$push_pub" "$STACK_PRIVATE" "$WG_PORT" <<'REMOTE'
set -euo pipefail
private="$1" stack="$2" stack_pub="$3" push_pub="$4" stack_private="$5" port="$6"
if [[ ! -f /etc/wireguard/wg0.conf ]]; then
  cat >/etc/wireguard/wg0.conf <<EOF
[Interface]
Address = $private/24
ListenPort = $port
PostUp = wg set %i private-key /etc/wireguard/wg0.key

[Peer]
# main stack: database, document runners and data for routines
PublicKey = $stack_pub
AllowedIPs = $stack_private/32
PersistentKeepalive = 25
EOF
  chmod 600 /etc/wireguard/wg0.conf
fi
systemctl enable --now wg-quick@wg0
if ufw status 2>/dev/null | grep -q '^Status: active'; then
  ufw allow from "$stack" to any port "$port" proto udp comment 'wireguard from main stack' >/dev/null
fi
install -m 0755 /root/routine-receive.sh /usr/local/sbin/rakazo-routine-receive
install -m 0755 /root/runner-guard.sh /usr/local/sbin/rakazo-runner-guard
cat >/etc/systemd/system/rakazo-runner-guard.service <<'EOF'
[Unit]
Description=Limit the overflow document runner to the main stack
After=docker.service wg-quick@wg0.service
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/rakazo-runner-guard
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now rakazo-runner-guard.service
bash /root/restrict-computer-egress.sh >/dev/null
mkdir -p /root/.ssh /opt/rakazo-routines/infra/compose /opt/rakazo-routines/runner-data /srv/rakazo-data
grep -q routine-runner-push /root/.ssh/authorized_keys 2>/dev/null ||
  echo "command=\"/usr/local/sbin/rakazo-routine-receive\",from=\"$stack_private\",restrict $push_pub" >>/root/.ssh/authorized_keys
grep -q ' /srv/rakazo-data ' /etc/fstab ||
  echo "$stack_private:/opt/rakazo/data /srv/rakazo-data nfs4 rw,hard,noatime,nofail,_netdev,x-systemd.after=wg-quick@wg0.service,x-systemd.requires=wg-quick@wg0.service 0 0" >>/etc/fstab
REMOTE

echo "== stack: WireGuard peer, NFS export, guard, push target"
on_stack bash -s -- "$private" "$server" "$server_pub" "$WG_PORT" <<'REMOTE'
set -euo pipefail
private="$1" server="$2" server_pub="$3" port="$4"
if ! grep -q "$server_pub" /etc/wireguard/wg0.conf; then
  printf '\n[Peer]\n# routine server %s\nPublicKey = %s\nEndpoint = %s:%s\nAllowedIPs = %s/32\nPersistentKeepalive = 25\n' \
    "$private" "$server_pub" "$server" "$port" "$private" >>/etc/wireguard/wg0.conf
fi
wg set wg0 peer "$server_pub" endpoint "$server:$port" allowed-ips "$private/32" persistent-keepalive 25
exports=/etc/exports.d/rakazo-routines.exports
grep -q "^/opt/rakazo/data $private(" "$exports" 2>/dev/null ||
  echo "/opt/rakazo/data $private(rw,sync,no_subtree_check,root_squash)" >>"$exports"
exportfs -ra
mkdir -p /etc/rakazo
grep -qx "$private" /etc/rakazo/routine-servers 2>/dev/null || echo "$private" >>/etc/rakazo/routine-servers
/usr/local/sbin/rakazo-routine-guard
for _ in $(seq 1 20); do ping -c1 -W1 "$private" >/dev/null 2>&1 && break; sleep 1; done
ping -c1 -W2 "$private" >/dev/null || { echo "WireGuard to $private is not up" >&2; exit 1; }
ssh-keygen -F "$private" >/dev/null || ssh-keyscan -q "$private" >>/root/.ssh/known_hosts
REMOTE

echo "== new server: mount the stack's data"
on_server 'mountpoint -q /srv/rakazo-data || mount /srv/rakazo-data; ls /srv/rakazo-data >/dev/null'

echo "== first push (images, env, compose) in the background"
on_stack 'systemctl start --no-block rakazo-routine-push.service'
echo "Follow it with: journalctl -fu rakazo-routine-push.service (on the stack)"

if ((overflow)); then
  echo "== listing its runner as overflow for chat documents"
  on_stack bash -s -- "$private" <<'REMOTE'
set -euo pipefail
url="http://$1:7091"
cd /opt/rakazo
current="$(grep -E '^RAKAZO_TOOL_RUNNER_OVERFLOW_URLS=' .env | cut -d= -f2- || true)"
case ",$current," in *",$url,"*) exit 0 ;; esac
next="${current:+$current,}$url"
if grep -q '^RAKAZO_TOOL_RUNNER_OVERFLOW_URLS=' .env; then
  sed -i "s|^RAKAZO_TOOL_RUNNER_OVERFLOW_URLS=.*|RAKAZO_TOOL_RUNNER_OVERFLOW_URLS=$next|" .env
else
  echo "RAKAZO_TOOL_RUNNER_OVERFLOW_URLS=$next" >>.env
fi
cd infra/compose
docker compose -p rakazo --env-file /opt/rakazo/.env up -d --no-deps --no-build api worker
REMOTE
  echo "Its runner takes chat documents once the first push has started it."
fi
