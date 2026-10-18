#!/usr/bin/env node
// ============================================================================
// VANTA — READ-ONLY production schema preflight check
// ----------------------------------------------------------------------------
// Purpose: establish, safely and without writing anything, exactly which
// Prisma migrations are recorded in `_prisma_migrations` and which schema
// objects actually exist in the live database. It answers the decisive
// question behind the P2022 `User.suspendedAt does not exist` outage:
// "is the migration merely RECORDED as applied, or is its SQL really there?"
//
// It is deliberately READ-ONLY. It never runs DDL, never mutates rows, never
// prints DATABASE_URL, passwords, tokens or user data.
//
// HOW TO RUN (must run from inside Railway's private network, because
// `postgres.railway.internal` only resolves there). The script is plain JS and
// is run directly by node (it is not compiled into dist/):
//   railway ssh --service carefree-luck   # then, in the backend working dir:
//     node scripts/preflight-schema-check.cjs
//   — or —
//   railway run --service carefree-luck node scripts/preflight-schema-check.cjs
//
// It reads DATABASE_URL from the environment (preferred) or from backend/.env.
// Exit code 0 = schema in sync; 2 = drift detected (missing objects).
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');

// ---- Resolve DATABASE_URL WITHOUT ever printing it ------------------------
function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return { url: process.env.DATABASE_URL, src: 'env' };
  try {
    const envPath = path.join(__dirname, '..', '.env');
    const line = fs.readFileSync(envPath, 'utf8').split('\n').find((l) => l.trim().startsWith('DATABASE_URL='));
    if (line) {
      const quoted = line.match(/^DATABASE_URL="(.*)"$/);
      const bare = line.match(/^DATABASE_URL=(.*)$/);
      if (quoted) return { url: quoted[1], src: '.env' };
      if (bare) return { url: bare[1].trim(), src: '.env' };
    }
  } catch {
    /* ignore */
  }
  return { url: null, src: null };
}

function maskUrl(url) {
  try {
    const u = new URL(url);
    u.password = '***';
    u.username = u.username ? '***' : '';
    return u.toString();
  } catch {
    return '(unparseable — not printing)';
  }
}

// ---- Expected objects added by each post-baseline migration ---------------
// (Kept in sync with backend/prisma/migrations/*. See MIGRATION_RUNBOOK.md.)
const EXPECTED = [
  { migration: '20261006000000_transfer_otp_challenges', tables: ['TransferOtpChallenge'], columns: [{ table: 'CoinTransfer', column: 'requestId' }] },
  { migration: '20261006000001_wallet_reconciliation', tables: ['WalletReconciliationLog'], columns: [] },
  { migration: '20261006000002_phone_otp_table', tables: ['PhoneOTP'], columns: [] },
  {
    migration: '20261008000000_add_push_notifications',
    tables: ['PushDevice', 'PushDelivery', 'CallSession'],
    // Column shape checks, not just table existence: the original file created
    // CallSession without `expiresAt` and PushDelivery without `type`.
    columns: [
      { table: 'CallSession', column: 'expiresAt' },
      { table: 'PushDelivery', column: 'type' },
    ],
  },
  { migration: '20261009000000_add_password_reset_tokens', tables: ['PasswordResetToken'], columns: [] },
  {
    migration: '20261014000000_account_moderation_appeals',
    tables: ['AccountAppeal'],
    columns: [
      { table: 'User', column: 'suspendedAt' },
      { table: 'User', column: 'suspendedReason' },
      { table: 'User', column: 'suspendedUntil' },
      { table: 'User', column: 'bannedAt' },
      { table: 'User', column: 'bannedReason' },
    ],
  },
];

/**
 * The idempotent reconciliation migration added for the 2026-10-18 P2022
 * outage. When history says a post-baseline migration was applied but its
 * objects are missing, deploying this release repairs the drift without
 * editing `_prisma_migrations`. See prisma/MIGRATION_RUNBOOK.md section 0.
 */
const RECONCILE_MIGRATION = '20261018000000_reconcile_post_baseline_drift';

async function main() {
  const { url, src } = resolveDatabaseUrl();
  if (!url) {
    console.log('RESULT=NO_DATABASE_URL (set DATABASE_URL or provide backend/.env)');
    process.exit(2);
  }
  console.log('DB_URL_SOURCE=' + src);
  console.log('DATABASE_URL_MASKED=' + maskUrl(url));

  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url, statement_timeout: 15000, query_timeout: 15000 });
  const conn = await pool.connect();
  const missing = [];
  try {
    // 1) Migration history table + recorded rows ---------------------------
    const hist = await conn.query(
      `SELECT migration_name, started_at, finished_at, rolled_back_at
       FROM _prisma_migrations ORDER BY started_at;`
    ).catch((e) => {
      console.log('HISTORY_QUERY_ERROR=' + String(e.message).split(']').pop().trim());
      return { rows: [] };
    });
    const applied = new Set(hist.rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name));
    const recorded = new Set(hist.rows.map((r) => r.migration_name));
    console.log('MIGRATION_HISTORY_ROWS=' + hist.rows.length);
    for (const r of hist.rows) {
      const state = r.rolled_back_at ? 'ROLLED_BACK' : r.finished_at ? 'APPLIED' : 'STARTED_NOT_FINISHED';
      console.log('  - ' + r.migration_name + ' [' + state + ']');
    }

    // 2) Does each expected object actually exist? -------------------------
    for (const group of EXPECTED) {
      for (const table of group.tables) {
        const res = await conn.query(`SELECT to_regclass($1) IS NOT NULL AS exists;`, ['public."'.concat(table, '"')]);
        if (!res.rows[0].exists) {
          missing.push(group.migration + ': table ' + table);
          console.log('MISSING_TABLE ' + table + '  (from ' + group.migration + ')');
        }
      }
      for (const col of group.columns) {
        const res = await conn.query(
          `SELECT COUNT(*) AS n FROM information_schema.columns
           WHERE table_schema='public' AND table_name=$1 AND column_name=$2;`,
          [col.table, col.column]
        );
        if (Number(res.rows[0].n) === 0) {
          missing.push(group.migration + ': ' + col.table + '.' + col.column);
          console.log('MISSING_COLUMN ' + col.table + '.' + col.column + '  (from ' + group.migration + ')');
        }
      }
    }

    // 3) Cross-check: recorded-as-applied but object missing = classic drift -
    console.log('--- DRIFT ANALYSIS ---');
    let drift = false;
    // A row that started but never finished blocks `migrate deploy` (P3009).
    const failedRows = hist.rows.filter((r) => !r.finished_at && !r.rolled_back_at);
    for (const r of failedRows) {
      drift = true;
      console.log('FAILED_HISTORY ' + r.migration_name + '  (blocks migrate deploy: P3009)');
      console.log('  -> FIX: npx prisma migrate resolve --rolled-back ' + r.migration_name);
    }
    for (const group of EXPECTED) {
      const groupMissing = missing.filter((m) => m.startsWith(group.migration + ':'));
      if (groupMissing.length === 0) continue;
      drift = true;
      const state = applied.has(group.migration)
        ? 'RECORDED_APPLIED'
        : recorded.has(group.migration)
        ? 'RECORDED_NOT_FINISHED'
        : 'NOT_RECORDED';
      console.log(group.migration + ': objects MISSING but history says ' + state);
      if (state === 'NOT_RECORDED') {
        console.log('  -> FIX: npx prisma migrate deploy   (applies the pending migration)');
      } else if (state === 'RECORDED_NOT_FINISHED') {
        console.log('  -> FIX: npx prisma migrate resolve --rolled-back ' + group.migration + ' && npx prisma migrate deploy');
      } else {
        // History claims it ran but the objects are absent (history edited, or a
        // restore rolled the schema back). Do NOT touch history: deploying this
        // release runs the idempotent reconciler, which re-creates them.
        console.log('  -> FIX: deploy this release; ' + RECONCILE_MIGRATION + ' re-creates these objects idempotently.');
      }
    }

    // 4) Data sanity (counts only — no rows) --------------------------------
    const users = await conn.query('SELECT COUNT(*) AS n FROM "User";').catch(() => ({ rows: [{ n: 'unavailable' }] }));
    console.log('USER_ROW_COUNT=' + users.rows[0].n);

    console.log('=== RESULT: ' + (drift ? 'DRIFT_DETECTED' : 'IN_SYNC') + ' ===');
    console.log('MISSING_OBJECT_COUNT=' + missing.length);
    process.exit(drift ? 2 : 0);
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('PREFLIGHT_ERROR=' + (e && e.message ? e.message : e));
  process.exit(1);
});

