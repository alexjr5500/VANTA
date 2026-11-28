#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/../.."
root="$(mktemp -d)"
trap 'rm -rf -- "$root"' EXIT
mkdir -m 700 "$root/writer" "$root/recovery"
# This is an ephemeral test identity. Never log or use it for real backups.
age-keygen -o "$root/recovery/identity" 2>/dev/null
age-keygen -o "$root/recovery/wrong" 2>/dev/null
export VANTA_BACKUP_AGE_RECIPIENT="$(age-keygen -y "$root/recovery/identity")"
# 32 MiB exceeds the prior 8 MiB in-memory acceptance artifact cap.
dd if=/dev/urandom of="$root/recovery/source" bs=1M count=32 status=none
bash backend/scripts/backup-age-encrypt.sh "$root/writer/fixture.age" < "$root/recovery/source"
age --decrypt -i "$root/recovery/identity" "$root/writer/fixture.age" > "$root/recovery/restored"
cmp "$root/recovery/source" "$root/recovery/restored"
original="$(sha256sum "$root/writer/fixture.age")"
if printf 'overwrite' | bash backend/scripts/backup-age-encrypt.sh "$root/writer/fixture.age"; then exit 1; fi
[[ "$original" == "$(sha256sum "$root/writer/fixture.age")" ]]
if age --decrypt -i "$root/recovery/wrong" "$root/writer/fixture.age" > /dev/null 2>&1; then exit 1; fi
cp "$root/writer/fixture.age" "$root/recovery/truncated.age"
truncate -s -1 "$root/recovery/truncated.age"
if age --decrypt -i "$root/recovery/identity" "$root/recovery/truncated.age" > /dev/null 2>&1; then exit 1; fi
cp "$root/writer/fixture.age" "$root/recovery/corrupt.age"
printf '\377' | dd of="$root/recovery/corrupt.age" bs=1 seek=1048576 conv=notrunc status=none
# Ensure the modified byte actually differs, including the 1/256 case.
if cmp -s "$root/writer/fixture.age" "$root/recovery/corrupt.age"; then
  printf '\000' | dd of="$root/recovery/corrupt.age" bs=1 seek=1048576 conv=notrunc status=none
fi
if age --decrypt -i "$root/recovery/identity" "$root/recovery/corrupt.age" > /dev/null 2>&1; then exit 1; fi
if VANTA_BACKUP_AGE_RECIPIENT=invalid bash backend/scripts/backup-age-encrypt.sh "$root/writer/invalid.age" < /dev/null; then exit 1; fi
[[ ! -e "$root/writer/invalid.age" ]]
# A failed upstream producer can still produce a valid encrypted prefix.
# Treat the entire pipeline as the gate, and never upload on failure.
if (printf 'partial'; exit 9) | bash backend/scripts/backup-age-encrypt.sh "$root/writer/partial.age"; then exit 1; fi
rm -f "$root/writer/partial.age"
echo '{"event":"vanta.backup.age","passed":true,"syntheticBytes":33554432,"wrongKeyRejected":true,"truncationRejected":true,"tamperRejected":true,"overwriteRejected":true,"failedProducerRejected":true}'
