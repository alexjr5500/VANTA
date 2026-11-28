#!/usr/bin/env bash
set -euo pipefail

# Isolated, fixed CI containers and local ports only. No caller-supplied URLs.
[[ "${GITHUB_ACTIONS:-}" == true && "${VANTA_CI_DISPOSABLE_RESTORE:-}" == yes ]] || exit 2
cd "$(dirname "$0")/../.."
prefix="vanta-restore-ci-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
source="${prefix}-source"
target="${prefix}-target"
tmp="$(mktemp -d)"
cleanup() {
  docker rm -f "$source" "$target" >/dev/null 2>&1 || true
  rm -rf -- "$tmp"
}
trap cleanup EXIT
umask 077
docker run -d --name "$source" -p 127.0.0.1:15434:5432 \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=recovery_ci postgres:16 >/dev/null
docker run -d --name "$target" --network none \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=recovery_ci postgres:16 >/dev/null
wait_pg() {
  for i in $(seq 1 60); do
    if docker exec "$1" pg_isready -h 127.0.0.1 -U test -d recovery_ci >/dev/null 2>&1; then return; fi
    sleep 1
  done
  echo 'Disposable database startup failed' >&2
  return 1
}
wait_pg "$source"
wait_pg "$target"
# Test the current application schema, not historical deployment migration order.
(cd backend && DATABASE_URL=postgresql://test:test@127.0.0.1:15434/recovery_ci \
  npx --no-install prisma db push --skip-generate --schema prisma/schema.prisma)
psql_ci() { docker exec -i "$1" psql -U test -d recovery_ci -X -v ON_ERROR_STOP=1 -At; }
psql_ci "$source" < backend/scripts/recovery-ci-fixtures.sql
psql_ci "$source" < backend/scripts/recovery-ci-manifest.sql > "$tmp/source.rows"
test -s "$tmp/source.rows"
mkdir "$tmp/uploads" "$tmp/restored"
printf 'synthetic media bytes\n' > "$tmp/uploads/fixture.txt"
test "$(wc -c < "$tmp/uploads/fixture.txt")" -eq 22
(cd "$tmp/uploads" && sha256sum fixture.txt) > "$tmp/media.sha256"
# Quiesced synthetic data: dump and file archive correspond to the same fixture.
backup_at=$(date +%s)
docker exec "$source" pg_dump -U test -d recovery_ci --format=custom --no-owner --no-acl > "$tmp/db.dump"
tar -C "$tmp/uploads" -cf "$tmp/media.tar" fixture.txt
(cd "$tmp" && sha256sum db.dump media.tar > backup.sha256 && sha256sum -c backup.sha256)
# Deliberately corrupt a copy; the original artifact stays intact.
cp "$tmp/db.dump" "$tmp/corrupted.dump"
printf 'corrupt' >> "$tmp/corrupted.dump"
if cmp -s "$tmp/db.dump" "$tmp/corrupted.dump"; then exit 1; fi
expected="$(sha256sum "$tmp/db.dump" | cut -d' ' -f1)"
actual="$(sha256sum "$tmp/corrupted.dump" | cut -d' ' -f1)"
[[ "$expected" != "$actual" ]]
# Fence source and restore into a different, empty, disconnected container.
docker stop "$source" >/dev/null
restore_started=$(date +%s)
docker exec -i "$target" pg_restore -U test -d recovery_ci --no-owner --no-acl --exit-on-error --single-transaction < "$tmp/db.dump"
tar -C "$tmp/restored" -xf "$tmp/media.tar"
(cd "$tmp/restored" && sha256sum -c "$tmp/media.sha256")
psql_ci "$target" < backend/scripts/recovery-ci-manifest.sql > "$tmp/target.rows"
cmp "$tmp/source.rows" "$tmp/target.rows"
psql_ci "$target" < backend/scripts/recovery-ci-validation.sql
[[ "$(psql_ci "$target" <<< 'SELECT size FROM "UploadedFile" WHERE id = '\''ci-upload'\'';')" -eq "$(wc -c < "$tmp/restored/fixture.txt")" ]]
restore_finished=$(date +%s)
printf '{"event":"vanta.ci.recovery","status":"passed","syntheticBackupAgeSeconds":%s,"restoreAndValidationSeconds":%s,"scope":"disposable-ci"}\n' \
  "$((restore_started - backup_at))" "$((restore_finished - restore_started))"
