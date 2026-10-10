# VANTA Security Hardening Guide

Implemented protections, security assumptions, configuration requirements, and
operational procedures. Companion to `SECURITY_AUDIT.md` and `SECURITY_TEST_PLAN.md`.

---

## 1. Authentication & Session Security

- **Password hashing:** bcrypt (cost ≥ 10, enforced by startup warning) with legacy
  Argon2id verification support in `CryptoUtils.verifyPassword`.
- **JWT:** short-lived access tokens (default `15m`, `JWT_ACCESS_EXPIRES_IN`) + rotating
  refresh tokens (`JWT_REFRESH_SECRET`, default `7d`). Refresh-token reuse severs the
  session and is audit-logged (`REFRESH_TOKEN_REUSE_DETECTED`).
- **Sessions:** a `Session` row stores the exact access token for lookup-based
  revocation; `authenticate` re-checks the DB row, expiry, and account `status` on
  **every** request. Suspended/banned/deactivated accounts are rejected immediately.
- **Login hardening (2026-10-09):** account-status responses now require a *correct*
  password (no unauthenticated status enumeration); `/login/2fa` is throttled
  per-user+IP (`rateLimiter.login2fa`, default 10 per 15 min).
- **Password change (2026-10-09):** revokes every other session; password **reset**
  revokes all sessions for the account.
- **2FA:** TOTP (speakeasy) with backup codes and trusted devices; setup returns the
  secret + QR; enable requires a valid code; disable requires the password.
- **Recovery (2026-10-09):** `forgot-password` issues a signed 1h `password-reset`
  token; `verify-reset-token` and `reset-password` validate it server-side.
  `verify-email` requires a signed `email-verification` token.

## 2. Authorization Model

- **Roles:** `USER`, `CREATOR`, `MODERATOR`, `ADMIN`, `CEO`, `SUPER_ADMIN`
  (see `security/rbac.ts`). Roles come from the **database** row on every request —
  never from the JWT alone, never from client input. `requireRole` / `requirePermission`
  middleware enforce the boundary; `parseRole` normalizes unknown roles to `USER`
  (fail-safe).
- **Ownership:** resource-owner checks are implemented per domain
  (messages/participants, groups/channels, streams/host, uploads/user). The analytics
  surface (2026-10-09) now enforces admin roles and self-or-admin ownership.
- **Admin:** every `/api/admin/*` route is behind `requireRole(ADMIN, CEO, SUPER_ADMIN)`.
- **Financial:** the server is the only authority for prices, balances, fees, and
  rewards; wallets use compare-and-swap (`updateMany where coinBalance >= x`) inside
  `$transaction`, with `requestId` idempotency keys and per-user OTP challenges bound
  to the intended recipient/amount/session.

## 3. Real-Time (Socket.IO) Security

- **Canonical handshake:** `io/namespaces` use `authenticateSocket`
  (`security/webSocketSecurity.ts`) — DB session lookup, session/token binding, expiry,
---

## 4. Upload & Media

- Multer per-route instances enforce size + allowed-type filters;
  `uploadService.uploadFile` re-verifies magic bytes, extension allowlist, duration
  (video), and writes randomized storage names; chunked uploads validate session size,
  part count, and re-run the same pipeline on completion.
- Media is served from `/uploads` with `nosniff`, explicit content types, and
  long-lived cache only for known media extensions.
- **Known limitation:** media (including chat attachments) is accessible by URL without
  per-request auth (128-bit random names). See RISK-02; a private-media streaming
  endpoint is recommended before opening chat attachments to non-participants at scale.

## 5. Operational Configuration Requirements

Required secrets (differs by environment — see `backend/.env.example` and
`deploy/PROD_ENV_GUIDE.md`):

```
JWT_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_KEY   # fail-closed enforced in production
DATABASE_URL                                     # PostgreSQL (TLS in prod)
ADMIN_PASSWORD                                    # seed/admin; never defaulted in prod
```

Deliberately configured limits and knobs:
- `RATE_LIMIT_LOGIN2FA_MAX` / `RATE_LIMIT_LOGIN2FA_WINDOW` — per-account 2FA throttle.
- `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `MAX_SESSIONS_PER_USER`.
- `PLATFORM_TRANSFER_LIMITS`, per-user `TransferLimit` clamps (server-authoritative).

**Recovery delivery (RISK-01):** wire an email/SMS provider and, in
`backend/src/services/auth.service.ts`, deliver the reset token / OTP out-of-band
(never log it). Until configured, `forgot-password` will not complete delivery —
operators should temporarily rely on admin-initiated resets.

## 6. Monitoring & Incident Response

Audit events (append-only `SecurityLog`) already cover: failed/blocked logins,
`REFRESH_TOKEN_REUSE_DETECTED`, privilege changes, session revocations,
administrative actions, wallet OTP failures, rate-limit hits, upload abuse signals.
Alerts should trigger on: repeated `RATE_LIMIT_HIT`, `REFRESH_TOKEN_REUSE_DETECTED`,
wallet OTP failures, withdrawal processing, and balance-reconciliation mismatches.

Incident-response checklist:
1. Detect via structured audit logs + metrics.
2. Triage severity (account / financial / infrastructure).
3. Contain: suspend account(s), revoke all sessions, freeze wallets, disable the
   integration via env flag (e.g. disable a provider OAuth by removing its client id).
4. Rotate credentials through the authorized management UI (never via code).
5. Preserve evidence (audit log export; DB snapshot by DBA).
6. Recover per rollback plan (§7 below); re-verify with the security test suites.
7. Root-cause analysis; user notification where legally/ethically required.
8. Post-incident corrective actions (new regression tests).

## 7. Deployment & Rollback

- Backend builds with `npm run build` (`tsc -p tsconfig.build.json` + `prisma generate`).
- Migrations are backward-compatible; this audit introduced **no** schema migrations.
- Rollback: revert the changed `backend/src/**` files and redeploy — no DB migration
  steps are required.
- Before deploy: `prisma generate && prisma migrate deploy`, full `jest` run, and a
  staged smoke test using the checklist in SECURITY_TEST_PLAN.md §4.

## 8. Recommended CI / Ongoing Hardening

- `npm audit` on both manifests (requires registry access).
- GitHub CodeQL / secret scanning on every PR.
- OWASP ZAP baseline + authenticated scans against a staging instance.
- Nightly wallet reconciliation job + anomaly alerts.
- Future work: hash session tokens at rest; move private media behind an authenticated
  stream endpoint; delete the dead `AuthService` login/google/apple paths; add
  per-IP + per-user gating to `/api/auth/phone/*` once delivery is wired.
  account `status`. The `/gifts` namespace (financial) and `/analytics` namespace
  (2026-10-09) are now on this middleware too.
- **Rooms:** chat rooms require `chatService.isParticipant`; stream rooms classify
  host/guest/viewer server-side; the `/analytics` admin room is role-gated.
- **Limits:** `maxHttpBufferSize: 1e6`, per-user live-rate limiter
  (`security/liveRateLimiter.ts`), typing/join throttles.
- **Reconnect:** sockets re-authenticate from the presented token on every handshake
  (including reconnects) so a revoked session cannot re-join.