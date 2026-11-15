#!/bin/sh
# Only the routine servers in /etc/rakazo/routine-servers may reach this stack's NFS share and the
# routine-link relay (database and document runners on the private address). Install as
# /usr/local/sbin/rakazo-routine-guard; rakazo-routine-guard.service runs it at boot and
# add-routine-server.sh after each change. The new list is built beside the old one and swapped in,
# so nothing is ever left open while it changes.
set -eu
SERVERS_FILE=/etc/rakazo/routine-servers
STACK=10.77.0.1
CHAIN=RAKAZO-ROUTINES
NEXT=RAKAZO-ROUTINES-NEXT

if [ -r "$SERVERS_FILE" ]; then
  servers="$(grep -vE '^[[:space:]]*(#|$)' "$SERVERS_FILE" | awk '{print $1}')"
else
  servers=10.77.0.3
fi

iptables -N DOCKER-USER 2>/dev/null || true
iptables -F "$NEXT" 2>/dev/null || iptables -N "$NEXT"
for server in $servers; do iptables -A "$NEXT" -s "$server" -j RETURN; done
iptables -A "$NEXT" -j DROP

swap() {
  table_chain="$1"
  shift
  iptables -I "$table_chain" 1 "$@" -j "$NEXT"
  while iptables -D "$table_chain" "$@" -j "$CHAIN" 2>/dev/null; do :; done
}
swap INPUT -p tcp --dport 2049
swap DOCKER-USER -m conntrack --ctstate NEW --ctorigdst "$STACK"
iptables -F "$CHAIN" 2>/dev/null && iptables -X "$CHAIN"
iptables -E "$NEXT" "$CHAIN"

# Rules from before there was a list.
while iptables -D INPUT -p tcp --dport 2049 ! -s 10.77.0.3 -j DROP 2>/dev/null; do :; done
while iptables -D DOCKER-USER -m conntrack --ctstate NEW --ctorigdst "$STACK" ! -s 10.77.0.3 -j DROP 2>/dev/null; do :; done
