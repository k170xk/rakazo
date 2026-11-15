#!/bin/bash
# Forced command for the main stack's push key (install as /usr/local/sbin/rakazo-routine-receive): receives the routine server's
# compose files, env and images (worker, overflow runner, computer), and restarts them.
set -euo pipefail
DIR=/opt/rakazo-routines
case "${SSH_ORIGINAL_COMMAND:-}" in
  compose)
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    tar -x -C "$tmp" infra/compose/docker-compose.yml infra/compose/docker-compose.routine-runner.yml
    cp "$tmp/infra/compose/docker-compose.yml" "$tmp/infra/compose/docker-compose.routine-runner.yml" "$DIR/infra/compose/"
    ;;
  env)
    umask 077
    bind="$(ip -4 -o addr show wg0 | awk '{print $4}' | cut -d/ -f1)"
    [[ -n "$bind" ]] || { echo "wg0 has no address" >&2; exit 1; }
    {
      cat
      printf '\n# Routine runner\nRAKAZO_STACK_HOST=10.77.0.1\nRAKAZO_STACK_DATA_DIR=/srv/rakazo-data\nDB_POOL_MAX=10\nRAKAZO_RUNNER_BIND=%s\n' "$bind"
    } > "$DIR/.env.new"
    mv "$DIR/.env.new" "$DIR/.env"
    ;;
  image)
    gunzip | docker load
    ;;
  up)
    mountpoint -q /srv/rakazo-data || mount /srv/rakazo-data
    mkdir -p "$DIR/runner-data"
    cd "$DIR"
    docker compose --env-file .env -f infra/compose/docker-compose.routine-runner.yml up -d --remove-orphans
    docker image prune -f >/dev/null
    ;;
  status)
    docker ps --filter name=rakazo-routines- --format '{{.Names}} {{.Image}} {{.Status}}'
    ;;
  *)
    echo "unknown command" >&2
    exit 2
    ;;
esac
