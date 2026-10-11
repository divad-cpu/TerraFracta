#!/usr/bin/env bash
# Start only TerraFracta's local Supabase database with a loopback host binding.
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
project_id="terrafracta-local"
network_name="terrafracta-local-loopback"
database_container="supabase_db_${project_id}"
supabase_cli="${TERRAFRACTA_SUPABASE_CLI:-supabase}"
started_here=false
startup_log=""

on_exit() {
  local status=$?
  if (( status != 0 )) && [[ "$started_here" == true ]]; then
    (cd "$project_root" && SUPABASE_TELEMETRY_DISABLED=1 "$supabase_cli" stop --project-id "$project_id" >>"$startup_log" 2>&1) || true
  fi
}
trap on_exit EXIT

for tool in docker "$supabase_cli" python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Required command is unavailable: %s\n' "$tool" >&2
    exit 1
  fi
done

if docker network inspect "$network_name" >/dev/null 2>&1; then
  driver="$(docker network inspect "$network_name" --format '{{.Driver}}')"
  binding="$(docker network inspect "$network_name" \
    --format '{{index .Options "com.docker.network.bridge.host_binding_ipv4"}}')"
  if [[ "$driver" != bridge || "$binding" != "127.0.0.1" ]]; then
    printf 'Existing network %s has no verified loopback binding.\n' "$network_name" >&2
    exit 1
  fi
else
  docker network create --driver bridge \
    -o com.docker.network.bridge.host_binding_ipv4=127.0.0.1 \
    "$network_name" >/dev/null
fi

(cd "$project_root" && python3 -m scripts.check_local_db_target --before-start)

already_running=false
if docker container inspect "$database_container" >/dev/null 2>&1; then
  if [[ "$(docker inspect "$database_container" --format '{{.State.Running}}')" == true ]]; then
    already_running=true
  fi
fi

if [[ "$already_running" == false ]]; then
  # CLI startup output can contain local credentials. Retain it privately for
  # diagnosis; never forward its contents to terminal logs or this check.
  umask 077
  startup_log="$(mktemp "${TMPDIR:-/tmp}/terrafracta-db-start.XXXXXXXX.log")"
  started_here=true
  if ! (cd "$project_root" && SUPABASE_TELEMETRY_DISABLED=1 \
    "$supabase_cli" start --network-id "$network_name" >"$startup_log" 2>&1); then
    printf 'Local database startup failed. Private diagnostics retained at %s; do not share raw contents.\n' "$startup_log" >&2
    exit 1
  fi
  printf 'Private startup diagnostics retained at %s.\n' "$startup_log"
fi

actual_binding="$(docker inspect "$database_container" \
  --format '{{range (index .NetworkSettings.Ports "5432/tcp")}}{{.HostIp}}{{end}}')"
if [[ "$actual_binding" != "127.0.0.1" ]]; then
  printf 'TerraFracta database port is not bound to loopback; expected 127.0.0.1.\n' >&2
  exit 1
fi

(cd "$project_root" && python3 -m scripts.check_local_db_target)

printf 'TerraFracta local database is running with a verified loopback port.\n'
