#!/usr/bin/env bash
set -euo pipefail

# Only used on an ephemeral GitHub-hosted CI runner. Never pass live URLs.
[[ "${GITHUB_ACTIONS:-}" == true && "${VANTA_CI_DISPOSABLE_REPLICATION:-}" == yes ]] || exit 2
network="vanta-repl-ci-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
primary="${network}-primary"
standby="${network}-standby"
volume="${network}-data"
cleanup() {
  docker rm -f "$standby" "$primary" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker network create "$network" >/dev/null
docker volume create "$volume" >/dev/null
docker run -d --name "$primary" --network "$network" --network-alias primary \
  -p 127.0.0.1:15432:5432 -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=replication_ci \
  postgres:16 -c wal_level=replica -c max_wal_senders=5 -c max_replication_slots=5 >/dev/null
wait_pg() {
  local name="$1"
  for i in $(seq 1 60); do
    if docker exec "$name" pg_isready -h 127.0.0.1 -U test -d replication_ci >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "Disposable PostgreSQL did not start" >&2
  return 1
}
wait_pg "$primary"
docker exec "$primary" bash -ec 'echo "host replication test 0.0.0.0/0 scram-sha-256" >> "$PGDATA/pg_hba.conf"; psql -U test -d replication_ci -c "SELECT pg_reload_conf()"'
docker run --rm --network "$network" -v "$volume:/var/lib/postgresql/data" \
  -e PGPASSWORD=test --entrypoint bash postgres:16 -ec \
  'chown postgres:postgres /var/lib/postgresql/data; chmod 700 /var/lib/postgresql/data; exec gosu postgres pg_basebackup -h primary -U test -D /var/lib/postgresql/data -X stream -R'
docker run -d --name "$standby" --network "$network" -p 127.0.0.1:15433:5432 \
  -v "$volume:/var/lib/postgresql/data" postgres:16 \
  -c "primary_conninfo=host=primary port=5432 user=test password=test application_name=ci_standby" >/dev/null
wait_pg "$standby"
for i in $(seq 1 30); do
  if [[ "$(docker exec "$standby" psql -U test -d replication_ci -Atc "SELECT EXISTS (SELECT 1 FROM pg_stat_wal_receiver WHERE status='streaming')")" == t ]]; then break; fi
  sleep 1
done
export VANTA_CI_REPLICATION_PRIMARY_URL=postgresql://test:test@127.0.0.1:15432/replication_ci
export VANTA_CI_REPLICATION_STANDBY_URL=postgresql://test:test@127.0.0.1:15433/replication_ci
npm --prefix backend run test -- --runInBand src/__tests__/database-streaming-replication.integration.test.ts

# Fence the old primary before promoting the disposable standby. No automated
# promotion is part of the application. Check replayed data and new writes.
docker stop "$primary" >/dev/null
docker exec "$standby" psql -U test -d replication_ci -v ON_ERROR_STOP=1 -c "SELECT pg_promote(true, 30)"
[[ "$(docker exec "$standby" psql -U test -d replication_ci -Atc 'SELECT pg_is_in_recovery()')" == f ]]
[[ "$(docker exec "$standby" psql -U test -d replication_ci -Atc 'SELECT count(*) FROM ci_replica_marker WHERE id = 1')" == 1 ]]
docker exec "$standby" psql -U test -d replication_ci -v ON_ERROR_STOP=1 -c 'INSERT INTO ci_replica_marker VALUES (2)'
[[ "$(docker exec "$standby" psql -U test -d replication_ci -Atc 'SELECT count(*) FROM ci_replica_marker')" == 2 ]]
echo 'Disposable standby promotion and write verification passed'
