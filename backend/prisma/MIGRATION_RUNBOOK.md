# VANTA - Production Database Migration Runbook (Prisma P3005 / P1001)

**Audience:** whoever is on call for Railway project `observant-consideration`,
environment `production`, backend service `carefree-luck`.

**Rule zero:** this is production. It holds real user data. Nothing in this
runbook drops, truncates, deletes, or reseeds anything. There is no
`migrate reset`, no `db push`, and no `--accept-data-loss` anywhere in it.

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
| `failed permanently (MIGRATION_FAILED)` | A migration errored, or history drifted. | Section 7. |
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
- Marking **all five** migrations applied - four of them are not in production
  yet; their tables/columns would silently never be created, and every feature
  depending on them would fail at runtime.
- Running migrations from the app start command with multiple replicas -
  concurrent migrations. The pre-deploy phase exists to prevent this.

---

## 9. Future releases (steady state)

1. Change `prisma/schema.prisma`.
2. `npx prisma migrate dev --name <change>` (generates the SQL).
3. Review the generated SQL. Keep it additive; never edit an already-applied
   migration (that triggers `was modified after it was applied` / P3018).
4. Commit the new migration folder.
5. Push. The pre-deploy step applies it once, before replicas start.
