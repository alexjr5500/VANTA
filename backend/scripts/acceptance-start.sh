#!/bin/sh
set -eu
printf '%s\n' '[ACCEPTANCE] startup.begin'
cd "$(dirname "$0")/.." || exit 30
node scripts/acceptance-preflight.mjs http || { code=$?; printf '[ACCEPTANCE] startup.preflight_failed exit=%s\n' "$code"; exit "$code"; }
printf '%s\n' '[ACCEPTANCE] startup.preflight_passed'
node scripts/acceptance-migrate.mjs || { code=$?; printf '[ACCEPTANCE] startup.migration_failed exit=%s\n' "$code"; exit "$code"; }
printf '%s\n' '[ACCEPTANCE] startup.migration_passed'
if [ ! -f dist/index.js ]; then
  printf '%s\n' '[ACCEPTANCE] startup.backend_artifact_missing'
  exit 30
fi
printf '%s\n' '[ACCEPTANCE] startup.backend_exec'
exec node dist/index.js
