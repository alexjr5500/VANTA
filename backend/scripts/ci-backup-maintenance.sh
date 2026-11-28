#!/usr/bin/env bash
set -euo pipefail
volume="vanta-maintenance-ci-${GITHUB_RUN_ID:-local}-${RANDOM}"
docker volume create "$volume" >/dev/null
trap 'docker volume rm "$volume" >/dev/null' EXIT
# Synthetic volume only; no live database, network, credentials or source paths.
docker run --rm --network none -v "$volume:/data" --entrypoint bash vanta-maintenance-ci -ec 'umask 077; printf "synthetic-original\n" >/data/fixture; sha256sum /data/fixture >/data/fixture.sha'
# Maintenance process must refuse without explicit approval even with the mount.
if docker run --rm --network none -v "$volume:/data" vanta-maintenance-ci; then
  echo 'Unapproved maintenance unexpectedly succeeded' >&2
  exit 1
fi
# Roll back to the ordinary synthetic workload and check byte identity.
docker run --rm --network none -v "$volume:/data" --entrypoint bash vanta-maintenance-ci -ec 'sha256sum -c /data/fixture.sha; test ! -e /data/.vanta-backup-control'
# Independent monitor must also refuse absent activation/credentials.
if docker run --rm --network none vanta-maintenance-ci node backend/scripts/backup-monitor.mjs; then
  echo 'Unapproved monitor unexpectedly succeeded' >&2
  exit 1
fi
