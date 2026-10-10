# VANTA Security Test Plan

Executable security regression tests live under `backend/src/__tests__/`.
This plan documents each security case, the expected result, the actual result,
and any areas that could not be exercised in this environment.

Run with: `cd backend && npx jest --config jest.config.js`

---

## 1. New regression suites (added by this audit)

### 1.1 `security.analytics-routes.test.ts` — analytics authorization (VANTA-002)

| # | Case | Expected | Actual |
|---|---|---|---|
| 1 | Anonymous request to `/api/analytics/overview` | 401 | **PASS** |
| 2 | Authenticated USER on 15 platform analytics paths | 403 each | **PASS** |
| 3 | Authenticated ADMIN on `/overview` | 200 | **PASS** |
| 4 | Creator reading OWN `/creators/analytics` | 200 | **PASS** |
| 5 | Creator reading ANOTHER creator's analytics | 403 | **PASS** |
| 6 | Host reading OWN `/streams/performance/host` | 200 | **PASS** |
| 7 | Host reading another host's performance | 403 | **PASS** |
| 8 | ADMIN reading any creator's analytics | 200 | **PASS** |
| 9 | `/track` empty eventType | 400 | **PASS** |
| 10 | `/track/batch` with 60 events | 400 | **PASS** |
| 11 | `/track` valid bounded event | 200 | **PASS** |

### 1.2 `security.auth-recovery.test.ts` — recovery flows (VANTA-001)

| # | Case | Expected | Actual |
|---|---|---|---|
| 1 | `forgotPassword` for existing & missing accounts returns identical message | identical, no enumeration | **PASS** |
| 2 | `verifyPasswordResetToken` genuine reset token | true | **PASS** |
| 3 | `verifyPasswordResetToken` ACCESS token | false | **PASS** |
| 4 | `verifyPasswordResetToken` tampered/garbage token | false | **PASS** |
| 5 | `resetPassword` valid token → hash updated + all sessions deleted | service calls made | **PASS** |
| 6 | `resetPassword` ACCESS token → rejects, **no** DB writes | thrown + no calls | **PASS** |
| 7 | `verifyEmailToken` genuine email-verification token | true + `emailVerified:true` | **PASS** |
| 8 | `verifyEmailToken` ACCESS token | false + no DB writes | **PASS** |

---

## 2. Related pre-existing suites (must remain green)

| Suite | Guards |
|---|---|
| `security.auth-middleware.test.ts` | Canonical REST auth: revoked/expired sessions, status checks |
| `security.session-manager.test.ts` | Refresh rotation, reuse detection |
| `security.startup-config.test.ts` | Fail-closed production secret policy |
| `websocket.test.ts` | Socket security infrastructure |
| `wallet.transfer-security.test.ts`, `wallet.withdrawal.test.ts`, `wallet.reconciliation.test.ts` | Financial atomicity, idempotency, OTP challenges |
| `coin-payment.service.test.ts`, `wallet.coin-purchase.test.ts`, `monetization-no-bonus.test.ts` | Purchase/refund integrity, no-bonus invariants |
| `gift.service.test.ts`, `gift-catalog.test.ts` | Gift pricing/attribution/idempotency |
| `chat.service.test.ts`, `chat-permissions.test.ts`, `group-ownership.test.ts`, `channel-ownership.test.ts` | Private message & group/channel access control |
| `oauth.service.test.ts` | PKCE/state/JWKS/account-linking |
| `upload.service.test.ts`, `chunk-upload.service.test.ts`, `reel-upload-multer.test.ts`, `upload-audio.test.ts` | Upload validation, magic bytes, limits |
| `cors.test.ts`, `prod-errors.fix.test.ts`, `media-serving.test.ts` | CORS, error handling, media static serving |

---

## 3. Environment notes / not-executed items

| Item | Limitation |
|---|---|
| Full `jest` suite | Started in background; did not complete within session window. Target suites above were run individually and pass. Run the full suite before deployment. |
| `tsc --noEmit` | Repo does not type-check clean in this environment: generated `@prisma/client` is stale vs `schema.prisma` (`compliance.service.ts`, `monetization.service.ts`, `verification-payment.service.ts` pre-existing errors in files NOT touched by this audit). Run `prisma generate` then re-run tsc. |
| Live external-provider tests | Stripe/CoinPayments webhooks, SendGrid/SMS, Firebase push, LiveKit, Google/Telegram/Apple OAuth — not executed; no credentials available. |
| Concurrency DB tests | Existing wallet concurrency tests use mocked Prisma; a real-PostgreSQL integration harness exists only in `backend/scripts/` and was not executed. |
| DAST (OWASP ZAP), SAST (CodeQL/GitHub), `npm audit` | Not available in this offline environment; `npm audit` requires registry access. Recommended as CI steps (see SECURITY_HARDENING.md §8). |
| PWA/Android permission behavior | Reviewed in source only; no device/emulator available. No native-API exposure found; the PWA uses standard web APIs (see report notes). |

---

## 4. Manual test checklist for a staged environment

- [ ] Login for a suspended account with the WRONG password → 401 "Invalid email or password" (no status leak).
- [ ] Login for a suspended account with the CORRECT password → 403 "Account suspended".
- [ ] `POST /api/auth/forgot-password` for an existing and a missing email → identical response.
- [ ] `POST /api/auth/verify-reset-token` with garbage → `{valid:false}`.
- [ ] `POST /api/auth/reset-password` with a valid (dev-issued) token → password changes, all sessions invalidated.
- [ ] `POST /api/auth/verify-email` with garbage token → 400.
- [ ] USER calling `/api/analytics/revenue/analytics` → 403; ADMIN → 200.
- [ ] Impersonation: user A calling `/api/analytics/creators/analytics?creatorId=B` → 403.
- [ ] Socket `/gifts`: connect with a token whose session was revoked → connect_error.
- [ ] Socket `/gifts`: suspended account token → connect_error.
### 1.3 `security.gift-socket-auth.test.ts` — `/gifts` socket auth (VANTA-003)

| # | Case | Expected | Actual |
|---|---|---|---|
| 1 | Connect with no token | rejected | **PASS** |
| 2 | Connect with forged signature | rejected | **PASS** |
| 3 | Revoked session (no session row) | rejected | **PASS** |
| 4 | Session-id claim mismatch | rejected | **PASS** |
| 5 | Suspended account | rejected | **PASS** |
| 6 | Active session + active user | connected | **PASS** |