#!/usr/bin/env bash
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true ]] || exit 2
cd "$(dirname "$0")/../.."
prefix="vanta-db-online-ci-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
src="$prefix-source"
dst="$prefix-target"
net="$prefix-net"
scratch="$(mktemp -d)"
cleanup() {
  docker rm -f "$src" "$dst" "$prefix-capture" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
  sudo rm -rf -- "$scratch"
}
trap cleanup EXIT
umask 077
docker network create --internal "$net" >/dev/null
docker run -d --name "$src" --network "$net" --network-alias source \
  -e POSTGRES_USER=fixture_admin -e POSTGRES_PASSWORD=fixture_admin_password -e POSTGRES_DB=recovery_ci postgres:18-trixie >/dev/null
docker run -d --name "$dst" --network none \
  -e POSTGRES_USER=fixture_admin -e POSTGRES_PASSWORD=fixture_admin_password -e POSTGRES_DB=recovery_ci postgres:18-trixie >/dev/null
for name in "$src" "$dst"; do
  for i in $(seq 1 60); do
    if docker exec "$name" pg_isready -h 127.0.0.1 -U fixture_admin -d recovery_ci >/dev/null 2>&1; then break; fi
    sleep 1
  done
  docker exec "$name" pg_isready -h 127.0.0.1 -U fixture_admin -d recovery_ci >/dev/null
done
psql_fixture() { docker exec -i "$1" psql -U fixture_admin -d recovery_ci -X -v ON_ERROR_STOP=1 -At; }
psql_fixture "$src" <<'SQL'
CREATE TABLE fixture (id integer PRIMARY KEY, value text NOT NULL);
INSERT INTO fixture VALUES (1,'committed-before-dump');
CREATE ROLE vanta_backup_reader LOGIN PASSWORD 'fixture_reader_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT pg_read_all_data TO vanta_backup_reader;
ALTER ROLE vanta_backup_reader SET default_transaction_read_only=on;
SQL
# Reader is genuinely restricted, not merely configured with a read-only session.
if docker exec -e PGPASSWORD=fixture_reader_password "$src" psql -h 127.0.0.1 -U vanta_backup_reader -d recovery_ci -X -v ON_ERROR_STOP=1 -c "SET default_transaction_read_only=off; INSERT INTO fixture VALUES (99,'forbidden');" >/dev/null 2>&1; then
  echo 'Unexpected reader write permission' >&2; exit 1
fi
# Hold an ordinary writer transaction open while the capture runs.
docker exec -d "$src" psql -U fixture_admin -d recovery_ci -X -v ON_ERROR_STOP=1 -c "BEGIN; INSERT INTO fixture VALUES (2,'uncommitted'); SELECT pg_sleep(120); ROLLBACK;"
for i in $(seq 1 30); do
  [[ "$(psql_fixture "$src" <<< "SELECT count(*) FROM pg_stat_activity WHERE wait_event='PgSleep' AND query LIKE 'BEGIN; INSERT INTO fixture%';")" == 1 ]] && break
  sleep 1
done
[[ "$(psql_fixture "$src" <<< "SELECT count(*) FROM pg_stat_activity WHERE wait_event='PgSleep' AND query LIKE 'BEGIN; INSERT INTO fixture%';")" == 1 ]]
# Same runtime image, real encrypted dump helper, ephemeral identity and signer.
docker run --rm --name "$prefix-capture" --network "$net" -v "$scratch:/scratch" vanta-maintenance-ci bash -euc '
  umask 077
  # The host-created mount is owned by the CI runner, not the container UID.
  # Keep the real capture guard intact; give the disposable scratch to its writer.
  chown "$(id -u):$(id -g)" /scratch
  chmod 700 /scratch
  age-keygen -o /scratch/identity 2>/dev/null
  export RECIPIENT="$(age-keygen -y /scratch/identity)"
  node --input-type=module <<'"'"'JS'"'"'
import {captureEncryptedArtifact} from "./backend/scripts/backup-bounded-capture.mjs";
import {dailyRunId,signDatabaseMarker,verifyDatabaseMarker} from "./backend/scripts/backup-database-daily.mjs";
import {backupPrefix} from "./backend/scripts/backup-r2-multipart.mjs";
import {createHash,generateKeyPairSync} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
const output="/scratch/database.dump.age";
const result=await captureEncryptedArtifact({producer:"pg_dump",args:["--format=custom","--no-owner","--no-acl","--lock-wait-timeout=5s","--dbname","recovery_ci"],producerEnv:{PATH:process.env.PATH,HOME:"/scratch",PGHOST:"source",PGPORT:"5432",PGUSER:"vanta_backup_reader",PGPASSWORD:"fixture_reader_password",PGCONNECT_TIMEOUT:"5",PGOPTIONS:"-c default_transaction_read_only=on"},recipient:process.env.RECIPIENT,output,maxBytes:16*1024*1024,timeoutMs:30000});
const now=Date.now(),runId=dailyRunId(now),sha256=createHash("sha256").update(await readFile(output)).digest("hex");
const {privateKey,publicKey}=generateKeyPairSync("ed25519");
const fingerprint=createHash("sha256").update(publicKey.export({format:"der",type:"spki"})).digest("hex");
const bytes=signDatabaseMarker({artifact:{key:backupPrefix("production-db",runId)+"database.dump.age",bytes:result.bytes,sha256,verified:true},runId,capturedAtMs:now,privateKey:privateKey.export({format:"pem",type:"pkcs8"})});
const data=verifyDatabaseMarker({bytes,publicKey:publicKey.export({format:"pem",type:"spki"}),fingerprint,runId});
if(data.mediaIncluded!==false||data.database.sha256!==sha256)throw Error("marker mismatch");
await writeFile("/scratch/marker",bytes,{mode:0o600});
JS
  VANTA_BACKUP_AGE_RECIPIENT="$RECIPIENT" bash backend/scripts/backup-age-encrypt.sh /scratch/manifest.json.age < /scratch/marker
  age --decrypt -i /scratch/identity /scratch/manifest.json.age | cmp - /scratch/marker
  age --decrypt -i /scratch/identity /scratch/database.dump.age > /scratch/database.dump
'
# A separate target without a network restores the committed snapshot.
sudo cat "$scratch/database.dump" | docker exec -i "$dst" pg_restore -U fixture_admin -d recovery_ci --no-owner --no-acl --exit-on-error --single-transaction
[[ "$(psql_fixture "$dst" <<< 'SELECT id || chr(58) || value FROM fixture ORDER BY id;')" == '1:committed-before-dump' ]]
[[ "$(psql_fixture "$src" <<< "SELECT count(*) FROM pg_stat_activity WHERE wait_event='PgSleep' AND query LIKE 'BEGIN; INSERT INTO fixture%';")" == 1 ]]
echo '{"event":"vanta.ci.online_database_recovery","status":"passed","readerWriteRejected":true,"activeWriter":true,"committedSnapshotRestored":true,"mediaIncluded":false}'
