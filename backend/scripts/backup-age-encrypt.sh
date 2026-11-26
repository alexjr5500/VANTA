#!/usr/bin/env bash
set -euo pipefail
umask 077
# Encrypt stdin to a new file, with no private key on the writer.
# Caller MUST check the entire producer pipeline with pipefail before upload.
[[ $# -eq 1 ]] || { echo 'Expected a new encrypted output path' >&2; exit 2; }
[[ "${VANTA_BACKUP_AGE_RECIPIENT:-}" =~ ^age1[0-9a-z]{58}$ ]] || { echo 'Native age public recipient required' >&2; exit 2; }
output="$1"
[[ "$output" == *.age && ! -e "$output" && ! -L "$output" ]] || { echo 'Output must be a new .age file' >&2; exit 2; }
parent="$(dirname -- "$output")"
[[ -d "$parent" && ! -L "$parent" ]] || exit 2
# The caller provides a private, trusted scratch directory. Do not point this at
# an upload directory, shared volume, or other user-writable path.
[[ "$(stat -c '%a' -- "$parent")" == 700 && "$(stat -c '%u' -- "$parent")" == "$(id -u)" ]] || { echo 'Private scratch directory required' >&2; exit 2; }
tmp="$(mktemp -- "$parent/.vanta-encrypt.XXXXXXXX")"
trap 'rm -f -- "$tmp"' EXIT
# Use a clean environment so the encryption subprocess receives no DB, R2 or
# application credentials. age streams authenticated chunks rather than
# buffering the archive in memory. No plaintext archive is written here.
env -i PATH="$PATH" age --encrypt --recipient "$VANTA_BACKUP_AGE_RECIPIENT" > "$tmp"
[[ -s "$tmp" ]] || exit 1
# Atomic no-clobber publication, even if the output appeared during encryption.
ln -T -- "$tmp" "$output"
