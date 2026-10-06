# Archived migrations (SQLite-era) — NOT applied by Prisma Migrate

The folders in `backend/prisma/migrations-archive/` are the original migration
history that was generated against a **SQLite** development database (before
VANTA production moved to PostgreSQL on Railway):

* `PRAGMA defer_foreign_keys` / `PRAGMA foreign_keys` directives,
* `DATETIME` column type (SQLite-only),
* the SQLite "create new table → copy → drop → rename" rebuild pattern.

They therefore **cannot run on the PostgreSQL production database** and are
archived here for reference only. Production was kept in sync with
`prisma db push` instead — which is what caused the `CoinTransfer`
`@@unique([senderId, requestId])` deployment failure (see
`20261005000000_baseline_production_schema/migration.sql` and
`backend/railway.json`).

The live, PostgreSQL-compatible migration history lives in
`backend/prisma/migrations/`:

1. `20261005000000_baseline_production_schema` — idempotent, additive-only
   baseline of the full production schema (never touches existing rows).
2. `20261006000000_transfer_otp_challenges` — `TransferOtpChallenge` table and
   `CoinTransfer.requestId` + `@@unique([senderId, requestId])` idempotency key.
3. `20261006000001_wallet_reconciliation` — `WalletReconciliationLog` table.
4. `20261006000002_phone_otp_table` — `PhoneOTP` table.

The obsolete SQLite-era history is preserved in git history as well
(`git log -- backend/prisma/migrations-archive`).