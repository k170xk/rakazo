#!/bin/bash
# Keeps every routine server on this stack's worker, overflow-runner and computer images, env and
# compose files (docs/self-host-routine-runner.md). Install as /usr/local/sbin/rakazo-routine-push,
# run by rakazo-routine-push.timer. Servers are listed one private address per line in
# /etc/rakazo/routine-servers (10.77.0.3 when the file is absent); each gets only what changed
# since its last push, and one server failing does not hold up the others.
set -uo pipefail
cd /opt/rakazo || exit 1

exec 9>/run/rakazo-routine-push.lock
flock -n 9 || exit 0

SERVERS_FILE=/etc/rakazo/routine-servers
STATE_DIR=/var/lib/rakazo
KEY=/root/.ssh/routine-runner
IMAGES=(rakazo-worker:latest rakazo-supervisor:latest rakazo/computer:local)
mkdir -p "$STATE_DIR"

runner_env() {
  grep -vE '^(INCUS_|SANDBOX_PROVIDER=|RAKAZO_ROUTINE_LINK_BIND=|RAKAZO_RUN_POOL=|DB_POOL_MAX=|# Routine runner relay)' .env
}
env_hash="$(runner_env | sha256sum | cut -c1-16)"
compose_hash="$(cat infra/compose/docker-compose.yml infra/compose/docker-compose.routine-runner.yml | sha256sum | cut -c1-16)"
declare -A image_id
for image in "${IMAGES[@]}"; do
  image_id[$image]="$(docker image inspect -f '{{.Id}}' "$image")" || exit 1
done

servers() {
  if [[ -r "$SERVERS_FILE" ]]; then
    grep -vE '^\s*(#|$)' "$SERVERS_FILE" | awk '{print $1}'
  else
    echo 10.77.0.3
  fi
}

# The first server keeps the state file it had before there was a list.
state_file() {
  [[ "$1" == 10.77.0.3 ]] && echo "$STATE_DIR/routine-runner.state" || echo "$STATE_DIR/routine-runner-$1.state"
}

push_one() {
  local host="$1" state
  state="$(state_file "$host")"
  local runner=(ssh -i "$KEY" -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=10 "root@$host")
  local previous_image="" previous_supervisor="" previous_computer="" previous_env="" previous_compose=""
  # shellcheck disable=SC1090
  [[ -r "$state" ]] && source "$state"
  local want_worker="${image_id[rakazo-worker:latest]}"
  local want_supervisor="${image_id[rakazo-supervisor:latest]}"
  local want_computer="${image_id[rakazo/computer:local]}"
  if [[ "$want_worker" == "$previous_image" && "$want_supervisor" == "$previous_supervisor" &&
    "$want_computer" == "$previous_computer" && "$env_hash" == "$previous_env" &&
    "$compose_hash" == "$previous_compose" ]]; then
    return 0
  fi
  echo "$host out of date; pushing"
  # Images first: the compose file may name an image this server has never had.
  local send=()
  [[ "$want_worker" == "$previous_image" ]] || send+=(rakazo-worker:latest)
  [[ "$want_supervisor" == "$previous_supervisor" ]] || send+=(rakazo-supervisor:latest)
  [[ "$want_computer" == "$previous_computer" ]] || send+=(rakazo/computer:local)
  if ((${#send[@]} > 0)); then
    docker save "${send[@]}" | gzip -1 | "${runner[@]}" image || return 1
  fi
  if [[ "$env_hash" != "$previous_env" ]]; then
    runner_env | "${runner[@]}" env || return 1
  fi
  if [[ "$compose_hash" != "$previous_compose" ]]; then
    tar -c infra/compose/docker-compose.yml infra/compose/docker-compose.routine-runner.yml |
      "${runner[@]}" compose || return 1
  fi
  "${runner[@]}" up || return 1
  printf 'previous_image=%s\nprevious_supervisor=%s\nprevious_computer=%s\nprevious_env=%s\nprevious_compose=%s\n' \
    "$want_worker" "$want_supervisor" "$want_computer" "$env_hash" "$compose_hash" >"$state"
  "${runner[@]}" status
}

failed=0
mapfile -t hosts < <(servers)
for host in "${hosts[@]}"; do
  push_one "$host" </dev/null || {
    echo "push to $host failed; retrying on the next run" >&2
    failed=1
  }
done
exit "$failed"
