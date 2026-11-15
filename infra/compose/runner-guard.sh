#!/bin/sh
# Only the main stack may open the overflow document runner published on this server's private
# address; the routine worker beside it reaches the runner on their own Compose network instead.
set -eu
bind="$(ip -4 -o addr show wg0 | awk '{print $4}' | cut -d/ -f1)"
[ -n "$bind" ] || { echo "wg0 has no address" >&2; exit 1; }
iptables -N DOCKER-USER 2>/dev/null || true
rule="-p tcp -m conntrack --ctstate NEW --ctorigdst $bind --ctorigdstport 7091 ! -s 10.77.0.1 -j DROP"
# shellcheck disable=SC2086
iptables -C DOCKER-USER $rule 2>/dev/null || iptables -I DOCKER-USER $rule
