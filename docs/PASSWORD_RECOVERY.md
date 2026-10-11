# VANTA — Forgot Password / Reset Password

This document explains VANTA's self-service account-recovery flow: how it works,
the environment variables it needs, how email delivery is configured, how to run
the database migration and tests, and how to troubleshoot delivery problems.

## 1. Overview of the flow

The recovery flow is intentionally **two pages + one email + three backend
endpoints**:

1. **Login page** (`/login`) exposes a **"Forgot password?"** link (rendered by
   `frontend/src/components/auth/AuthExperience.tsx`) that navigates to
   `/forgot-password`. It never interferes with the normal password login or the
   Google/Telegram OAuth buttons.

2. **Forgot-password page** (`/forgot-password`,
   `frontend/src/app/forgot-password/page.tsx`) collects an email address and
   calls `POST /api/auth/forgot-password`. It always shows the **same generic
   confirmation** whether or not the address is registered:

   > If an account exists with that email address, you'll receive instructions
   > to reset your password.

3. **Backend request endpoint** (`POST /api/auth/forgot-password` →
   `AuthService.forgotPassword`):
   - Normalizes/validates the email server-side.
   - If the account exists, generates a **cryptographically-random opaque token**
     (`crypto.randomBytes`, 32 bytes = 256 bits by default), stores **only a
     SHA-256 hash** of it in `PasswordResetToken`, records the expiry, and
     invalidates any previously outstanding unused tokens for that account.
   - Builds the reset link from the **trusted, explicitly-configured application
     origin** (`APP_PUBLIC_URL`, falling back to `FRONTEND_URL`) — **never from
     the incoming `Host` header**.
   - Sends the recovery email. If delivery fails, the just-issued token is
     **deleted** so no dangling valid link is left behind.
   - Returns the identical generic response regardless of account existence, and
     applies a small constant latency on the "no such account" path so timing
     cannot disclose existence.

4. **Recovery email** (VANTA-branded, see `backend/src/services/email.service.ts`)
   identifies VANTA as the sender, explains a reset was requested, contains the
   secure reset link, states the link expires (30 min by default) and is
   single-use, and tells the recipient to ignore it if they didn't request it. It
   never contains the current password.

5. **Reset-password page** (`/reset-password`,
   `frontend/src/app/reset-password/page.tsx`) reads `?token=…` from the URL,
   verifies it via `POST /api/auth/verify-reset-token`, then collects a new
   password + confirmation, enforces the password policy, and submits
   `POST /api/auth/reset-password`. It handles invalid, expired, and
   already-used tokens with safe (non-revealing) messages, prevents duplicate
   submissions, and never places passwords in the URL or browser storage. On
   success it tells the user to sign in with the new password (it does **not**
   auto-authenticate).

6. **Backend reset endpoint** (`POST /api/auth/reset-password` →
   `AuthService.resetPassword`):
   - Looks up the token by its SHA-256 hash, rejects if missing / used / expired
     / over the per-token attempt bound.
   - **Atomically consumes** the token with `UPDATE … WHERE usedAt IS NULL`
     inside a transaction, so two concurrent submissions cannot both succeed.
   - Updates the password hash with the app's existing bcrypt scheme.
   - **Revokes every session** for the account (the auth middleware validates
     access tokens against the `Session` row on each request, so this also kills
     short-lived access JWTs).
   - Clears the consumed + any superseded tokens for the account.
   - Only **after the transaction commits**, sends the "password changed"
     confirmation email and writes a security audit event.

## 2. Environment variables

Add these to `backend/.env` (see `backend/.env.example` for the annotated
template). **Never commit real secrets.**

| Variable | Required | Purpose |
|----------|----------|---------|
| `APP_PUBLIC_URL` | Yes (prod) | Trusted **public https** origin used to build reset links, e.g. `https://vanta.example.com`. The backend never trusts the `Host` header. In development it falls back to `FRONTEND_URL`, then `http://localhost:3000`. |
| `FRONTEND_URL` | Fallback | Used as the reset-link origin only when `APP_PUBLIC_URL` is unset. |
| `EMAIL_SERVICE` | — | Provider selector. `sendgrid` is the only production transport today. |
| `SENDGRID_API_KEY` | Yes (prod) | SendGrid v3 API key. **Server-side only** — never exposed to the frontend. |
| `EMAIL_FROM_ADDRESS` | Yes (prod) | Verified sender address on your domain, e.g. `noreply@vanta.app`. |
| `EMAIL_FROM_NAME` | — | Display name, defaults to `VANTA`. |
| `EMAIL_TIMEOUT_MS` | — | HTTP timeout for provider calls (default `10000`). |
| `EMAIL_TRANSPORT` | Dev only | Set `console` in **non-production** to print rendered emails to stdout instead of sending. Refused in production. |
| `PASSWORD_RESET_TOKEN_BYTES` | — | Token entropy (≥ 16, default `32`). |
| `PASSWORD_RESET_EXPIRES_IN` | — | Token TTL (default `30m`). |
| `PASSWORD_RESET_MAX_ATTEMPTS` | — | Per-token verification bound before it's treated as invalid (default `10`). |
| `PASSWORD_RESET_SIMULATED_LATENCY_MS` | — | Constant latency on the "no such account" path to blunt timing enumeration (default `250`). |
| `RATE_LIMIT_PASSWORD_RESET_WINDOW` / `_MAX` | — | Window/max for forgot + reset endpoints (default `3600000` ms / `3`). |
| `RATE_LIMIT_RESET_TOKEN_WINDOW` / `_MAX` | — | Window/max for the token-verification endpoint (default `900000` ms / `10`). |

### Startup validation

On boot, `initializeSecurity()` → `warnRecoveryConfiguration()` logs a loud,
**non-fatal** warning when recovery config is missing. It never crashes startup
(only the email step degrades; the issued token is invalidated rather than left
outstanding). Production additionally requires `SENDGRID_API_KEY` and
`EMAIL_FROM_ADDRESS`; missing **JWT/encryption secrets** still abort startup via

`enforceSecretPolicy()`.

## 3. Configuring email delivery (SendGrid)

1. Create a SendGrid account and generate an API key with **Mail Send** scope.
2. Verify your sender domain (SendGrid → Settings → Sender Authentication), then
   create a single verified sender, e.g. `noreply@vanta.app`.
3. Set, server-side only:

   ```dotenv
   EMAIL_SERVICE="sendgrid"
   SENDGRID_API_KEY="SG.xxxxxxxx"          # never commit
   EMAIL_FROM_ADDRESS="noreply@vanta.app"
   EMAIL_FROM_NAME="VANTA"
   APP_PUBLIC_URL="https://vanta.example.com"
   ```

4. For local development without SendGrid, set `EMAIL_TRANSPORT=console`
   (with `NODE_ENV=development`) to print the rendered email to stdout.

> **Dashboard-only steps** (cannot be done from the repo): creating the SendGrid
> account, generating the API key, and verifying the sender domain/address.

## 4. Configuring the trusted application origin

`APP_PUBLIC_URL` must be the **absolute public origin** of the frontend, e.g.
`https://vanta.example.com` (no path, no trailing slash required). In production
it **must be `https`**; the resolver rejects non-https origins when
`NODE_ENV=production`. This origin is used **only** to build security-sensitive
links (reset, email verification) so a poisoned `Host` header cannot mint a
phishing link.

## 5. Database migration

The recovery model is a new, **purely additive** table. No existing rows or
tables are modified, so it is safe and non-destructive.

```bash
# 1. Apply the migration (PostgreSQL in prod, SQLite in dev)
cd backend
npx prisma migrate deploy          # production / CI
# or, for local dev:
npx prisma migrate dev

# 2. Regenerate the client
npx prisma generate
```

The migration lives at
`backend/prisma/migrations/20261009000000_add_password_reset_tokens/migration.sql`
and creates `PasswordResetToken` with a unique index on `tokenHash`, plus indexes
on `userId`, `expiresAt`, and `usedAt` to keep lookups and expired-token cleanup
fast.

## 6. Running the tests

Backend (Jest):

```bash
cd backend
npx jest --config jest.config.js src/__tests__/security.auth-recovery.test.ts
npx jest --config jest.config.js src/__tests__/security.password-recovery.test.ts
npx jest --config jest.config.js           # full backend suite
```

Frontend (Vitest):

```bash
cd frontend
npm run test
npx tsc --noEmit        # typecheck (next build also typechecks)
```

## 7. Token expiration & invalidation

- **Expiration:** `expiresAt = now + PASSWORD_RESET_EXPIRES_IN` (default 30 min).
  A token past its expiry is rejected on both verify and reset.
- **Single-use:** the reset endpoint consumes the token with an atomic
  `UPDATE … WHERE usedAt IS NULL`; a second submission finds `usedAt` set and is
  rejected.
- **Supersession:** issuing a new token marks all previously outstanding unused
  tokens for the account as used, so an older emailed link stops working the
  moment a newer one is requested.
- **Cleanup:** expired/used tokens are pruned for an account when a new request
  arrives, and superseded/consumed tokens are cleared inside the reset
  transaction. The `expiresAt` index supports a background sweep of stale rows.
- **Attempt bound:** `PASSWORD_RESET_MAX_ATTEMPTS` caps verification attempts
  per token before it is treated as invalid.

## 8. Troubleshooting delivery failures

- **"Password recovery requires configuration that is currently missing: …"** at
  startup → set the listed variables (see §2).
- **Reset link never arrives** → check the SendGrid dashboard for
  bounces/blocks, confirm the sender address is verified, and check the backend
  logs for `[AUTH] Password reset email delivery failed`. When delivery fails the
  token is deleted, so the user can simply request a new link.
- **Reset link says invalid/expired immediately** → the token expired (30 min),
  was already used, or was superseded by a newer request. Request a new link.
- **Local testing** → set `EMAIL_TRANSPORT=console` (non-production) to see the
  rendered email, including the reset URL, in the backend stdout.

## 9. Deployment notes

- Run `npx prisma migrate deploy` as part of the backend release.
- Set `APP_PUBLIC_URL`, `SENDGRID_API_KEY`, and `EMAIL_FROM_ADDRESS` in the
  production environment (server-side only — never in `NEXT_PUBLIC_*`).
- No frontend environment variables are required; the pages call the existing
  backend API through the shared `apiPost` client.

