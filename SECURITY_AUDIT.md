# VANTA Security Audit — Findings & Evidence

**Date:** 2026-10-09
**Scope:** `backend/` (Express + Prisma + Socket.IO), `frontend/` (Next.js PWA), deployment configuration.
**Auditor role:** Principal application security engineer / penetration tester (authorized).
**Version audited:** `e14bae13` (main).

This document records the architecture and attack surface, the confirmed findings,
the evidence for each finding, the remediation status, and the residual risks.

---

## 1. Architecture & Attack-Surface Summary

### 1.1 Components

| Component | Technology | Notes |
|---|---|---|
| Frontend | Next.js 15 (App Router) PWA installed via Chrome | `frontend/`, served from Vercel origin |
| Backend API | Express 4 | `backend/src/index.ts`, REST under `/api/*` |
| Real-time | Socket.IO 4 (namespaces `/` chat+live, `/gifts`, `/ai`, `/analytics`) | auth via `security/webSocketSecurity.ts` |
| Database | PostgreSQL via Prisma 5 | `backend/prisma/schema.prisma` |
| Payments | Stripe, CoinPayments (webhooks, simulated in test mode) | purchase/refund flows |
| Object storage | Local disk (`/uploads`), served via `express.static` | no external bucket used |
| Live video | LiveKit | tokens issued server-side |
| Email/SMS | Not wired (see §7) | password-reset delivery requires operator config |
| Push | Web Push (web-push) + Firebase Admin | `services/push/` |
| Cache | In-process + Prisma-backed rate limiting | no Redis |

### 1.2 Attack surface inventory

- Public unauthenticated REST: auth register/login/refresh, OAuth authorize/callback/exchange,
  coin purchase webhooks, feed/community/live/gift catalog reads, `/uploads` static media.
- Authenticated REST: profiles, messaging, wallet (transfers/withdrawals/PIN/limits/purchases),
  posts/stories/reels, groups/channels/communities, live streams, notifications, admin, analytics.
- Socket.IO: chat, live streams (host/guest/viewer), gifts (financial), AI, analytics.
- File uploads: images/videos/audio/docs + resumable chunked uploads; magic-byte validation.
- Admin/audit: `/api/admin/*`, `/api/compliance/*`, `/api/analytics/*` (admin dashboards).

### 1.3 Dependency map of security controls (highest-value paths)

| Entry point | AuthN | AuthZ | Input validation | Rate limit | Notes |
---

## 2. Confirmed Findings

Severity: **Critical / High / Medium / Low / Informational**. Confidence: Confirmed = verified in source and/or by automated test.

### VANTA-001 — Account recovery & email/phone verification were non-functional stubs (High, Confirmed & Fixed)

**Affected:** `backend/src/controllers/auth.controller.ts` (`forgotPassword`, `verifyResetToken`,
`resetPassword`, `verifyEmail`, `phoneSendOTP`, `phoneVerifyOTP`), `backend/src/routes/auth.routes.ts`.

**Evidence (source):**
- `verifyResetToken` unconditionally returned `{ valid: true }` for any input.
- `resetPassword` returned `"Password reset successfully"` without changing any password.
- `forgotPassword` never issued or delivered a reset token.
- `verifyEmail` returned `"Email verified successfully"` without verifying anything.
- `phoneSendOTP`/`phoneVerifyOTP` returned `200` "sent"/"verified"-style responses without sending or verifying
  anything; `phoneVerifyOTP` returned an **empty `token`** — i.e. it could never sign a user in.
- The secure implementations already existed in `backend/src/services/auth.service.ts` but were **never wired**
  (module referenced only by `auth.service.test.ts`).

**Realistic impact:** Users who lose their password cannot recover the account (account lockout / availability);
clients were told security actions succeeded when nothing happened. The endpoints were not directly exploitable
to take over an account (no password was ever changed), but the controls do not exist while the API claims they do.

**Fix (implemented):** Controllers now call the real server-side flows:
- `forgotPassword` → `authService.forgotPassword` (signed 1h `password-reset` JWT; response identical whether the
  account exists — no enumeration).
- `verifyResetToken` → `authService.verifyPasswordResetToken` (real signature/type/expiry validation).
- `resetPassword` → `authService.resetPassword` (verifies token, updates bcrypt hash, revokes **all** sessions).
- `verifyEmail` → `authService.verifyEmailToken` (signed `email-verification` token required; fails closed).
- `phoneSendOTP`/`phoneVerifyOTP` → `authService.sendPhoneOTP`/`verifyPhoneOTP` (crypto-random 6-digit OTP stored
  only as a bcrypt hash, expiry + 3-attempt limit, single-use by delete-on-success).
- Legacy `googleAuth`/`appleAuth` stubs now return `501` instead of a fake token pair.

**Regression tests:** `backend/src/__tests__/security.auth-recovery.test.ts` (8 tests) — **PASS**.
All tests fail against the pre-fix stubs (e.g. `verifyPasswordResetToken` true for any string).

**Delivery channel caveat:** issuing/validating tokens works; *delivering* the reset link/OTP out-of-band still
requires an operator-configured email/SMS provider (see §5 and SECURITY_HARDENING.md).

### VANTA-002 — `/api/analytics/*` lacked function/object-level authorization (High, Confirmed & Fixed)

**Affected:** `backend/src/routes/analytics.routes.ts`, `backend/src/controllers/analytics.controller.ts`.

**Evidence (source + regression tests):**
- Every analytics route was protected only by `authenticateJWT` — any signed-in user could read
  `/overview`, `/users/metrics|dau|online|retention|growth`, `/revenue/analytics|arpu|ad`,
  `/streams/active`, `/streams/:streamId`, `/ltv`, `/screens`, `/performance/api`, `/predictions`,
  `/funnel`, `/alerts/*`, `/marketing/*`, `/reports/*`, `/creators/leaderboard`.
- `/creators/analytics?creatorId=<any>` and `/streams/performance/host?hostId=<any>` returned anything requested
  by id — object-level access to other users' creator/host analytics.
- No role check existed anywhere in this router (the admin-gated `/dashboard/*` and `/realtime` live in a
  **different** router, `src/analytics/analytics.routes.ts`).
### VANTA-003 — Socket.IO `/gifts` namespace authenticated by signature only (High, Confirmed & Fixed)

**Affected:** `backend/src/sockets/gift.socket.ts`.

**Evidence (source + regression tests):**
- The `/gifts` namespace registered its own middleware that performed only `jwt.verify(token, JWT_SECRET)`.
  It never checked: token `type` (access), the presence/liveness of the database session, session expiry, or the
  user's account status.
- `gift:send` executes a **real financial transaction** (`giftService.sendGift` debits the sender wallet).
  A revoked-session attacker or a suspended account could keep sending real gifts over the socket for up to the
  full access-token lifetime (default 15m) after revocation/suspension.

**Realistic impact:** Financial authorization bypass window after session revocation / role / status change,
and a weaker security boundary than the equivalent REST endpoint (`POST /api/monetization/gifts/send`).

**Fix (implemented):** Replaced the weak middleware with the canonical `authenticateSocket`
(`security/webSocketSecurity.ts`): DB session lookup by token, `session.userId === decoded.userId`,
`decoded.sessionId === session.id`, expiry enforcement, and `status === 'ACTIVE'`; sender username is now looked up
server-side instead of trusting a client claim. Connection is rejected at handshake otherwise.

**Regression tests:** `backend/src/__tests__/security.gift-socket-auth.test.ts` (6 tests over a real
Socket.IO server + client) — **PASS**: no-token / bad-signature / revoked-session / session-id-mismatch /
suspended-account all rejected; active session accepted.

### VANTA-004 — Socket.IO `/analytics` namespace had no authentication (Medium, Confirmed & Fixed)

**Affected:** `backend/src/analytics/analytics.sockets.ts`.

**Evidence (source):**
- `io.of('/analytics')` registered **no** middleware (`analyticsNamespace.use(...)` never called). Child namespaces
  do not inherit `io.use()` middleware in Socket.IO 4, so connections were anonymous.
- The handler joined rooms and answered `analytics:request:dashboard` (executive: DAU/MAU/revenue) for anyone,
  and `analytics:track` accepted an arbitrary `data.userId` — an anonymous caller could stream internal metrics and
  attribute analytics events to any user (sybil/pollution of platform analytics).
- The frontend does not consume this namespace (no client connects to `/analytics`), so this channel was
  exclusively an unauthenticated data egress + event-injection surface.

**Fix (implemented):** `analyticsNamespace.use(authenticateSocket)`, drop unidentified connections, restrict the
admin channels and executive dashboard to `ADMIN`/`CEO`/`SUPER_ADMIN`, and bind `analytics:track` userId to the
authenticated socket identity.

### VANTA-005 — Login disclosed account status before password verification (Medium, Confirmed & Fixed)

**Affected:** `backend/src/controllers/auth.controller.ts` (`login`).

**Evidence (source):**
- `if (user.status !== 'ACTIVE')` ran **before** the password check, returning 403 "Account suspended/banned/
  deactivated/locked" for an arbitrary (wrong) password — definitive enumeration of restricted accounts.
- `/api/auth/login/2fa` used a generic IP-keyed limiter and returned the raw `userId` two-factor pre-login
---

## 3. Verified-Safe Areas (with test evidence)

- **REST authentication middleware** — canonical `authenticate`: rejects missing/invalid/expired tokens, revoked
  sessions (session row lookup), session/token mismatch, non-ACTIVE accounts. Covered by the pre-existing
  `security.auth-middleware.test.ts` (passes).
- **JWT secret handling** — `startupValidation.enforceSecretPolicy()` fails closed in production on missing/weak
  secrets; verified by `security.startup-config.test.ts` (passes).
- **Refresh-token rotation with reuse detection** — `sessionManager.refreshTokens` severs sessions on reuse;
  covered by pre-existing `security.session-manager.test.ts` (passes).
- **Wallet finances** — compare-and-swap debits, `$transaction` atomicity, `requestId` idempotency keys,
  OTP challenge bound to user+recipient+amount+session and consumed atomically, daily/single-transfer limits
  clamped server-side, withdrawals CAS'd. Covered by the pre-existing wallet suite
  (`wallet.transfer-security.test.ts`, `wallet.withdrawal.test.ts`, `wallet.reconciliation.test.ts`,
  `coin-payment.service.test.ts`, etc.).
- **Gift server-authoritative pricing** — price/coins computed from the DB `Gift` row; `requestId` uniqueness
  enforced; concurrency guarded by CAS; covered by `gift.service.test.ts` and `monetization-no-bonus.test.ts`.
- **Chat private-message access** — participant membership enforced in `chatService` and socket join handlers;
  covered by `chat.service.test.ts`, `chat-permissions.test.ts`.
- **OAuth** — PKCE, server-side state tickets, JWKS RS256/ES256-only verification, exchange-code single use;
  covered by `oauth.service.test.ts` (passes).
- **Uploads** — multer type filters + magic-byte verification + size limits + duration limits + randomized
  filenames; covered by `upload.service.test.ts`, `chunk-upload.service.test.ts`, `reel-upload-multer.test.ts`.
- **Secrets hygiene** — `.env*`, keys, credentials, stores are gitignored; `git ls-files` shows only
  `.env.example`; `prisma/admin-credentials.ts` reads `ADMIN_PASSWORD` from the environment and fails fast in
  production when absent.

---

## 4. Confirmed but Unresolved / Residual Risks

### RISK-01 (High, unresolved — requires external provider) Reset / OTP *delivery*
Token generation and verification are now secure, but delivering the reset link and phone OTP out-of-band requires
an email/SMS/push provider to be configured (`EMAIL_SERVICE`/`SENDGRID_API_KEY`/SMS). Until then, self-service
password recovery still cannot complete for real users; ops must configure delivery (see SECURITY_HARDENING.md §5).

### RISK-02 (Medium, unresolved — architectural) Private chat media served without per-request authorization
All uploaded media — including private conversation attachments — is served from `/uploads` via `express.static`
with no session check. Files are stored under 128-bit random names, which resists enumeration, but any party who
learns a URL (e.g. a forwarded link) can fetch a private attachment without authentication. Proper containment
would move private media behind an authenticated streaming endpoint (see SECURITY_HARDENING.md §6).

### RISK-03 (Low, unresolved) Login status messages for restricted accounts
With a *correct* password, suspended/banned users still receive status-specific messages. This is intentional UX
for legitimate owners, but it allows credential-holders (i.e. the account owner or someone with the password) to
confirm status; it no longer allows unauthenticated enumeration (VANTA-005).

### RISK-04 (Low, unresolved) `AuthService` duplicate implementation (dead code)
`services/auth.service.ts` contains `login`/`register`/`googleAuth`/`appleAuth` paths that are unused by any
controller and were previously unhardened (e.g. `appleAuth` used `jwt.decode` without verification). No route
reaches them after this audit; they should be deleted or consolidated to prevent future mis-wiring.

### RISK-05 (Low, unresolved) `/api/auth/google` & `/api/auth/apple` now return 501
These legacy stubs previously returned fake success with empty tokens. They now fail explicitly. If any external
integration depended on them, it must switch to `/api/auth/oauth/*`.

### RISK-06 (Informational) Session row stores the raw JWT
`Session.token`/`refreshToken` store the full signed tokens for revocation lookups. Acceptable given DB access
control, but hashing tokens in the DB would reduce the impact of a DB dump (needs a schema change + migration).

---

## 5. Testing Limitations

- **Full suite:** the complete `jest` suite was started in the background but did not finish within this session's
  window; targeted suites were run and PASS. A full clean-suite run is required at deploy time.
- **`tsc --noEmit`:** the repository does not currently compile clean in this environment because the generated
  Prisma client is out of sync with `schema.prisma` (dozens of `Property does not exist on type 'PrismaClient'`
  errors in untouched files such as `compliance.service.ts`, `monetization.service.ts`,
  `verification-payment.service.ts`). Those files were **not** modified by this audit. Run `prisma generate`
  (against the current schema) before relying on `tsc`.
- **External providers:** Stripe/CoinPayments live webhooks, SendGrid/SMS delivery, Firebase push, LiveKit,
  Google/Telegram/Apple OAuth callbacks were NOT exercised against live external services (no credentials).
- **No destructive/load testing** was performed on any environment.
  confirmation; TOTP guessing was therefore only throttled per IP, not per account.

**Fix (implemented):**
- Password is verified first; account-status and email-verification responses now only follow a *correct* password
  (same message for existing-but-restricted vs wrong-password at the pre-auth stage). Legitimate users still see the
  precise status after entering the right password.
- Added `rateLimiter.login2fa` (per-user+IP, default 10/15min) and wired it to `/login/2fa`.

### VANTA-006 — Password change did not revoke other sessions (Low/Medium, Confirmed & Fixed)

**Affected:** `backend/src/controllers/auth.controller.ts` (`changePassword`).

**Evidence (source):** After a successful password change the account's other sessions kept working until natural
expiry; a password-change is a typical response to compromise, so retained sessions weaken the response.

**Fix:** `changePassword` now revokes every other session for the account (current session, which proved the
password, survives).

**Realistic impact:** Confidential platform financial/operational metrics (revenue, ARPU, DAU/MAU, LTV, ad revenue,
funnel conversion, alert configuration, prediction models) available to every user; cross-account analytics
disclosure for creators/streamers. High information-disclosure impact.

**Fix (implemented):**
- Platform-wide endpoints gated with `requireRole(ADMIN, CEO, SUPER_ADMIN)`.
- `/creators/analytics` and `/streams/performance/host` enforce **self-or-admin** ownership checks.
- `/streams/:streamId`, `/creators/leaderboard` are admin-only (no legitimate non-admin consumer found).
- `/track` & `/track/batch` (product telemetry) now validate bounded payloads (≤50 events, eventType ≤120 chars,
  ≤4 KB/event) instead of accepting arbitrary bodies.

**Regression tests:** `backend/src/__tests__/security.analytics-routes.test.ts` (7 tests) — **PASS**.
They assert 401 anonymous, 403 USER on 15 platform paths, 200 ADMIN, self-or-admin ownership for creator/host
analytics, and `/track` payload validation.
|---|---|---|---|---|---|
| `/api/auth/login` | credential check | — | validator | login limiter + `checkLoginAttempts` | status check moved after password (this audit) |
| `/api/auth/*` others | session/JWT | role where needed | validator | route limiters | reset/verify wired to real logic (this audit) |
| `/api/wallets/*` | `authenticateJWT` | per-user scoping | YES | route + OTP limiters | CAS transfers, OTP challenges, idempotency keys |
| `/api/admin/*` | `authenticate` | `requireRole(ADMIN,CEO,SUPER_ADMIN)` | controllers | global | all admin routes gated |
| `/api/analytics/*` | `authenticateJWT` | **added** admin + self-or-admin (this audit) | validator for `/track` | global | previously auth-only (High finding) |
| Chat REST/Socket | `authenticateJWT` / `authenticateSocket` | `isParticipant` checks | service-level | messaging limiter | private messages enforced |
| `/gifts` socket | **added** `authenticateSocket` (this audit) | gift service | requestId regex | liveRateLimiter | previously signature-only (High finding) |
| `/analytics` socket | **added** `authenticateSocket` (this audit) | role-gated dashboards | — | — | previously unauthenticated (Medium finding) |
| `/uploads/*` | none (static) | none | — | — | unguessable filenames only (see RISK-02) |