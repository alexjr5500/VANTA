# VANTA - Production Database Migration Runbook (Prisma P3005 / P1001)

**Audience:** whoever is on call for Railway project `observant-consideration`,
environment `production`, backend service `carefree-luck`.

**Rule zero:** this is production. It holds real user data. Nothing in this
runbook drops, truncates, deletes, or reseeds anything. There is no
`migrate reset`, no `db push`, and no `--accept-data-loss` anywhere in it.

---

## 0. Incident 2026-10-18 - `P2022: The column User.suspendedAt does not exist`

**Status: fixed in code and regression-tested. Production is NOT fixed until the
steps below run and the health check passes.**

**Symptom.** The backend binds :8080, then every authenticated request dies with
`P2022 - The column User.suspendedAt does not exist in the current database.`

**Root cause - reproduced end-to-end against a clean PostgreSQL 18:**

1. `20261008000000_add_push_notifications` created `"CallSession"` **without** its
   `expiresAt` column, then ran
   `CREATE INDEX "CallSession_status_expiresAt_idx" ON "CallSession"("status","expiresAt")`
   -> PostgreSQL `42703 column "expiresAt" does not exist`.
2. Prisma applies each migration in a transaction, so that migration is recorded as
   **failed** (`finished_at IS NULL`) and **nothing after it is ever applied**:
   `20261009000000_add_password_reset_tokens` and
   `20261014000000_account_moderation_appeals` (the one that adds
   `User.suspendedAt/suspendedReason/suspendedUntil/bannedAt/bannedReason` and
   `AccountAppeal`) never ran.
3. `prisma migrate deploy` refuses to go past a failed migration
   (`P3009 - ... migration ... failed`), so the gap could never heal on its own.
4. The deployed Prisma client reads the columns from `schema.prisma` -> **P2022**.

The same file also omitted `PushDelivery."type"`, so the committed chain diverged
from `schema.prisma` even on databases where it did apply.

**What this release changes (all additive, nothing dropped or rewritten):**

| File | Change |
|---|---|
| `prisma/migrations/20261008000000_add_push_notifications/migration.sql` | added the missing `CallSession."expiresAt"` and `PushDelivery."type"` columns to their `CREATE TABLE` statements. Safe: the original statement could never have completed anywhere `CallSession` did not already exist, and no later migration depends on the old shape. |
| `prisma/migrations/20261018000000_reconcile_post_baseline_drift/migration.sql` | **NEW** idempotent reconciliation: re-creates every post-baseline object when it is missing - `User.suspended*/banned*`, `AccountAppeal`, `PushDevice`, `PushDelivery`, `CallSession`, `PasswordResetToken`, `TransferOtpChallenge`, `WalletReconciliationLog`, `PhoneOTP`, `CoinTransfer.requestId` + their indexes/FKs. A complete no-op on a healthy database. |
| `src/__tests__/migrations.safety.test.ts` | static regression tests: no UTF-8 BOM, no destructive SQL, **indexes may only reference columns the same file creates**, and the reconciliation stays idempotent. |

**Recovery steps - run in this order:**

```bash
cd backend

# 0. BACKUP FIRST (section 2). Do not proceed without a restore-tested backup.

# 1. READ-ONLY diagnosis (section 3, scripted):
#    prints each migration's history state, every missing object, and the fix.
railway run --service carefree-luck node scripts/preflight-schema-check.cjs
npx prisma migrate status --schema prisma/schema.prisma

# 2. ONLY if the output contains
#      P3009 / "The `20261008000000_add_push_notifications` migration ... failed"
#    re-record that FAILED migration so deploy can proceed. --rolled-back (never
#    --applied) is the correct verb: its SQL never succeeded.
npx prisma migrate resolve --rolled-back 20261008000000_add_push_notifications --schema prisma/schema.prisma

# 3. Deploy this commit. Railway's preDeploy (backend/railway.json) runs
#    `node dist/deploy/migrate-deploy.js` == `prisma migrate deploy` BEFORE any
#    replica starts, which applies:
#      20261008000000 (fixed) -> 20261009 -> 20261014 -> 20261018 (reconcile)
git add backend/prisma/migrations backend/prisma/MIGRATION_RUNBOOK.md \
        backend/scripts/preflight-schema-check.cjs backend/src/__tests__
git commit -m "fix(db): repair broken push migration; add idempotent post-baseline reconcile"
git push origin main          # Railway auto-deploys, or: railway up --service carefree-luck

# 4. VERIFY - all four must pass before anyone says production is healthy:
railway logs --service carefree-luck     # [MIGRATE] Database migration step completed successfully.
npx prisma migrate status --schema prisma/schema.prisma   # Database schema is up to date!
node scripts/preflight-schema-check.cjs                  # === RESULT: IN_SYNC ===
curl -s https://<backend-url>/health                      # "database":{"status":"ok"}
```

```sql
-- 5. Data must be byte-for-byte intact: counts compared with section 2 notes.
SELECT COUNT(*) AS users               FROM "User";
SELECT COUNT(*) AS wallets             FROM "Wallet";
SELECT COUNT(*) AS posts               FROM "Post";
SELECT COUNT(*) AS messages            FROM "Message";
SELECT COUNT(*) AS completed_transfers FROM "CoinTransfer" WHERE status = 'COMPLETED';
SELECT COUNT(*) AS wallet_txs          FROM "WalletTransaction";
SELECT "username", "coins" FROM "User" ORDER BY "createdAt" LIMIT 5;   -- spot check
```

**Why this cannot lose data:** the reconciliation is only
`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` / column adds inside
`DO $$ ... IF NOT EXISTS` guards. There is no `DROP`, `TRUNCATE`, `DELETE`,
`UPDATE`, no `NOT NULL` change and no type change, so no existing row is touched
or rewritten. It was verified against three simulated production states (healthy,
"objects missing but recorded as applied", "failed migration row"): the final
`prisma migrate diff` was an empty script and seeded users / wallets / messages /
posts / transfers kept their original counts and balances.
---

---

## 1. What actually went wrong

| Symptom | Real cause |
|---|---|
| `P3005 - The database schema is not empty` | The production PostgreSQL schema was created and maintained by `prisma db push`. `db push` is a **diff** tool: it makes the database match the schema but **never writes `_prisma_migrations`**. So production has a complete schema and **no migration history at all**. `prisma migrate deploy` refuses to run against a populated database with no history. |
| Endless `migrate deploy` retry loop | The old `startCommand` wrapped `migrate deploy` in `until ... retry 10`, `src/provision-db.ts` retried 10 more times on **every** failure, and `restartPolicyMaxRetries: 3` restarted the container. **P3005 is permanent** - retrying it can never succeed. A permanent error was being retried as though the database were still booting. |
| `P1001 - cannot reach postgres.railway.internal:5432` | Genuinely **transient**: the PostgreSQL service was not yet accepting connections. This is the *only* failure class that should ever be retried. |

---

## 2. Preconditions - DO THIS FIRST

**Do not proceed without a verified, restorable backup.** Baselining writes to
`_prisma_migrations`; it is reversible, but on production you verify first.

```bash
# 1. Confirm the PostgreSQL service is healthy and reachable (Railway dashboard:
#    service -> status must be green, not "deploying"/"crashed").

# 2. Confirm DATABASE_URL resolves to the intended database.
railway variables --service carefree-luck | grep -c DATABASE_URL   # must print 1
# Confirm it is PostgreSQL; print ONLY host/db, never the password:
railway run -- printenv DATABASE_URL | sed -E "s#://[^:]+:[^@]+@#://***:***@#"

# 3. Take a backup and VERIFY it restores. Railway: service -> Data -> Backups,
#    or use "Point-in-Time Recovery". Note the backup reference here:
#    BACKUP REFERENCE: ______________________
#
#    A backup you have not restore-tested is not a backup. Verify it before
#    continuing. If you cannot verify one, STOP and escalate - do not baseline.
```

---

## 3. Establish ground truth (read-only)

Run these **before** changing anything. They tell you exactly which migrations
are already represented in the live database. All are read-only.

```bash
cd backend
npx prisma migrate status --schema prisma/schema.prisma
```

Expect `P3005` / "database schema is not empty" on a `db push`-created database.

Then inspect the live database directly (via `railway run` / Railway psql):

```sql
-- A. Does migration history exist at all?
SELECT to_regclass("public._prisma_migrations") AS migrations_table;

-- B. If it exists, what is recorded?
SELECT migration_name, finished_at, rolled_back_at
FROM _prisma_migrations ORDER BY started_at;

-- C. THE DECISIVE EVIDENCE. The post-baseline migrations are NOT applied if
--    their objects are absent. Each of these MUST be missing for the
--    "baseline only" strategy to be correct:
SELECT to_regclass("public.""TransferOtpChallenge""")    AS transfer_otp,   -- 20261006000000
       to_regclass("public.""WalletReconciliationLog""") AS wallet_recon,   -- 20261006000001
       to_regclass("public.""PhoneOTP""")                AS phone_otp,      -- 20261006000002
       to_regclass("public.""PushDevice""")              AS push_device,    -- 20261008000000
       to_regclass("public.""CallSession""")             AS call_session;   -- 20261008000000

-- D. ...and the baseline-era schema IS present:
SELECT to_regclass("public.""User""")         AS user_table,
       to_regclass("public.""CoinTransfer""") AS coin_transfer,
       (SELECT COUNT(*) FROM information_schema.columns
         WHERE table_name = "CoinTransfer" AND column_name = "requestId") AS has_request_id;
```

### How to read the result

| Finding | Meaning | Action |
|---|---|---|
| `migrations_table` is **NULL** | No history. Pure `db push` database. | **Proceed with section 4 - baseline only.** |
| `migrations_table` exists with rows | History partially exists. | **STOP.** Do not baseline blindly. Reconcile with section 7. |
| `has_request_id = 0` | `20261006000000` not applied. | Correct - it must run for real. |
| `has_request_id = 1` | `20261006000000` **already** applied. | **STOP** - see section 7. |
| Any of `transfer_otp` / `wallet_recon` / `phone_otp` / `push_device` is **not NULL** | That migration is already applied. | **STOP** - see section 7. |

`has_request_id = 0` is expected and safe: `CoinTransfer.requestId` is
**nullable**, and PostgreSQL treats NULLs in a unique index as distinct, so the
existing COMPLETED transfer rows are untouched when the unique index is created.
---

## 4. Baseline - mark ONLY the migration that is genuinely already applied

`20261005000000_baseline_production_schema` is an **idempotent snapshot of the
already-live schema**: every statement is `CREATE TABLE IF NOT EXISTS` or a
`DO $$ ... IF NOT EXISTS` foreign-key guard, and there is no `DROP`, `TRUNCATE`,
`DELETE`, or `UPDATE` anywhere in it. It is therefore exactly the migration that
should be marked as already applied.

`prisma migrate resolve --applied` **records** the migration in
`_prisma_migrations` **without executing its SQL** - which is precisely what
baselining requires.

```bash
cd backend

# 1. Record the baseline as applied. Does NOT run its SQL.
npx prisma migrate resolve --applied 20261005000000_baseline_production_schema --schema prisma/schema.prisma

# 2. Apply the migrations that are genuinely pending. These are additive:
#    TransferOtpChallenge + CoinTransfer.requestId, WalletReconciliationLog,
#    PhoneOTP, PushDevice/PushDelivery/CallSession, PasswordResetToken.
npx prisma migrate deploy --schema prisma/schema.prisma

# 3. VERIFY. Must report "Database schema is up to date".
npx prisma migrate status --schema prisma/schema.prisma
```

**Do NOT mark the other migrations as applied.** They were never applied to
production: `20261006*` arrived in commit 021cbad whose deploys crashed at
`db push`, and `20261008*` / `20261009*` came later. Step 2 must actually run
them, otherwise those tables silently never exist and every feature depending
on them fails at runtime.

### Verify data survived

```sql
SELECT COUNT(*) AS users                FROM "User";
SELECT COUNT(*) AS wallets              FROM "Wallet";
SELECT COUNT(*) AS completed_transfers  FROM "CoinTransfer" WHERE status = 'COMPLETED';
SELECT COUNT(*) AS recon_logs           FROM "WalletReconciliationLog";  -- new table, may be 0
```

Compare the user/wallet/transfer counts against your pre-migration note. They
must be unchanged.

---

## 5. Deploy

The fixed `backend/railway.json` now runs migrations in the **pre-deploy phase**:

```json
"deploy": {
  "preDeployCommand": "node dist/deploy/migrate-deploy.js",
  "preDeployTimeoutSeconds": 600,
  "startCommand": "node dist/index.js"
}
```

The pre-deploy step runs **once per deployment in its own container, before any
replica starts**, so replicas can never migrate concurrently. It retries
**only** transient connection failures (P1001/P1002/...) and fails fast - with
the exact remediation - on P3005 or a failed migration.

```bash
railway up --service carefree-luck        # or push to main for auto-deploy
railway logs --service carefree-luck      # expect: [MIGRATE] Database migration step completed successfully.
curl -s https://<backend-url>/health      # expect: "database":{"status":"ok"}
```

---

## 6. If it fails again

| Log says | Meaning | Do |
|---|---|---|
| `failed permanently (HISTORY_MISSING)` | Section 4 was not completed. | Run section 3 then 4. This is **not** retryable; redeploying will not help. |
| `failed permanently (MIGRATION_FAILED)` | A migration errored, or history drifted. | Section 7. For the 2026-10-18 outage the cause was `P3009 ... 20261008000000_add_push_notifications ... failed`: `migrate resolve --rolled-back 20261008000000_add_push_notifications`, then deploy (section 0). |
| `P3018 /42703 column "expiresAt" does not exist` | The CallSession index bug from section 0 is back in a migration file. | This release fixes it; `src/__tests__/migrations.safety.test.ts` fails on the same defect. Do not patch production by hand - fix the file and redeploy. |
| `still unreachable after N attempts` | Transient: DB down / wrong `DATABASE_URL` / private networking. | Check PostgreSQL service health and `DATABASE_URL`. Retrying is legitimate here. |

---

## 7. Non-obvious states - STOP and reconcile manually

If section 3 shows that history partially exists, or that a post-baseline
migration objects are already present, the database is in a state this runbook
does not cover. **Do not baseline blindly.** Determine exactly which migrations
the live schema already reflects, and mark **only those** as applied:

```bash
npx prisma migrate status --schema prisma/schema.prisma          # see the state
npx prisma migrate resolve --applied <exact-migration-name>       # only if genuinely applied
# ...or, if a migration was left half-applied and must be undone:
npx prisma migrate resolve --rolled-back <exact-migration-name>
npx prisma migrate deploy --schema prisma/schema.prisma
npx prisma migrate status  --schema prisma/schema.prisma
```

Escalate to a senior engineer before proceeding if the picture is unclear.

---

## 8. Never do these in production

- `prisma migrate reset` - **destroys all data.**
- `prisma db push` (especially `--accept-data-loss`) - bypasses history and can
  silently alter/drop schema. It is what caused this incident.
- Marking **pending** migrations as applied with `migrate resolve --applied`.
  Recording a migration that has not run means its tables/columns silently never
  exist and every feature depending on them fails at runtime with P2022 - that is
  exactly how outages hide. `--applied` is for the **baseline only** (section 4);
  a migration that genuinely **failed** takes `--rolled-back` (section 0).
- Running migrations from the app start command with multiple replicas -
  concurrent migrations. The pre-deploy phase exists to prevent this.

---

## 9. Future releases (steady state)

1. Change `prisma/schema.prisma`.
2. `npx prisma migrate dev --name <change>` (generates the SQL).
3. Review the generated SQL. Keep it additive; never edit an already-applied
   migration (that triggers `was modified after it was applied` / P3018).
   *The one justified exception, used for `20261008000000_add_push_notifications`
   in section 0: a migration whose SQL never completed anywhere (it failed at
   first contact with every database) has no successful execution to invalidate.*
4. Run `npx jest src/__tests__/migrations.safety.test.ts` - it rejects BOMs,
   destructive SQL, and indexes over columns the file does not create.
5. Commit the new migration folder.
6. Push. The pre-deploy step applies it once, before replicas start.
7. `prisma migrate status` + `scripts/preflight-schema-check.cjs` must both be
   clean before the release is declared good.
