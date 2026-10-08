# VANTA — Production Push Notifications

Real **operating-system-level push notifications** for the VANTA PWA: users get
notified even when the app is in the background, minimized, screen-locked, fully
closed, or recently removed from the app switcher. Highest priority: **incoming
1-to-1 calls**, with an OS notification that works even when VANTA is not
running.

```text
VANTA Backend (Express + Socket.IO)
      │  notification / call event
      ▼
PushNotificationService (eventId dedup, retry, presence, logs)
      │
      ├── Web Push (VAPID) ──► PWA devices (Chrome/Android, Safari 16.4+, Edge, Firefox)
      │
      └── Firebase Cloud Messaging (FCM, optional) ──► Android/iOS native apps (future)
              │
              ▼
         OS-level notification → user taps Answer/Decline → VANTA opens → call joins
```

---

## 1. How it fits VANTA (no rewrites)

- **In-app notifications are untouched.** `NotificationService.createNotification`
  still writes the `Notification` row and emits the socket event; the push layer
  is layered on top and dispatches only when the recipient has **no live
  Socket.IO connection** (foreground dedup).
- **1-to-1 calls keep their WebRTC + Socket.IO signaling.** The server now also
  persists a lightweight `CallSession` (offer + buffered ICE) so an offline
  callee can answer from a cold start, and call-state races (cancel vs answer,
  answered on another device) resolve authoritatively.
- **No data is migrated or dropped.** The new migration is purely additive.

---

## 2. Architecture map

| Piece | File(s) | Responsibility |
|---|---|---|
| Provider contract | `backend/src/services/push/push-provider.interface.ts` | `send(device, payload)` |
| Web Push (VAPID) | `backend/src/services/push/web-push.provider.ts` | Encrypt + POST to the browser push service |
| FCM (Android/iOS) | `backend/src/services/push/fcm.provider.ts` | `firebase-admin` HTTP v1 (inert without credentials) |
| Orchestrator | `backend/src/services/push/push-notification.service.ts` | device store, `sendToUser/sendToDevices/sendToToken`, dedup, throttle, retry, logs |
| Presence | `backend/src/services/push/presence-registry.ts` | foreground dedup signal (socket-connected users) |
| Call state | `backend/src/services/call-session.service.ts` | `CallSession` transitions + cold-start offer/ICE |
| REST | `backend/src/routes/push.routes.ts`, `calls.routes.ts` | device registration + push-answer lookup |
| Client | `frontend/public/vanta-sw.js`, `lib/pushClient.ts`, `context/PushContext.tsx` | subscribe, register, render, route taps |
| Settings | `frontend/src/app/settings/notifications/page.tsx` | per-device opt-in + permission state |

---

## 3. Database

New tables (Postgres; SQLite dev works the same):

- **`PushDevice`** — one row per browser/native device. Columns: `userId, token
  (unique), platform (web|android|ios), provider (webpush|fcm), deviceModel,
  appVersion, isActive, lastSeenAt, createdAt, updatedAt`.
- **`PushDelivery`** — delivery ledger + **idempotency guard**:
  `UNIQUE(eventId, deviceId)` makes a retried/duplicate push a no-op. Also powers
  observability (`status IN SENT|FAILED|INVALID_TOKEN|SKIPPED`).
- **`CallSession`** — server-side call record (`callId unique, callerId,
  calleeId, type, status, offerSdp, iceCandidates, expiresAt`).

Migration (production — Railway runs `prisma migrate deploy`):

```bash
cd backend
npx prisma migrate dev --name add_push_notifications   # dev (SQLite)
# The committed migration is PostgreSQL-compatible; apply on prod with:
npx prisma migrate deploy --schema prisma/schema.prisma
```

---

## 4. Environment variables (backend — server-side only)

```bash
# ---- Web Push (VAPID) — REQUIRED for the PWA channel ----
# Generate once:   npx web-push generate-vapid-keys --json
VAPID_SUBJECT="mailto:notifications@your-domain"
VAPID_PUBLIC_KEY="<url-safe base64 public key>"
VAPID_PRIVATE_KEY="<url-safe base64 private key>"

# ---- Firebase Cloud Messaging (optional; native Android/iOS) ----
# Either the individual fields…
FIREBASE_PROJECT_ID=""
FIREBASE_CLIENT_EMAIL=""
FIREBASE_PRIVATE_KEY=""
FIREBASE_PRIVATE_KEY_ID=""
FIREBASE_CLIENT_ID=""
# …or the full service-account blob:
# FIREBASE_CREDENTIALS_JSON="{ \"type\": \"service_account\", ... }"
# …or a path for firebase-admin's default resolver:
# GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase-service-account.json
```

The client only ever sees the **public** VAPID key (served by
`GET /api/push/config`) — never the private key or any Firebase credential.
`.gitignore` already excludes `*.pem`, `*.key`, `credentials*.json`,
`service-account*.json`.
## 5. Device token lifecycle

1. **Login / navigation** — `PushProvider` registers `/vanta-sw.js` and reads the
   browser's `PushManager.permission` (never prompts on its own).
2. **Permission already granted** → `lib/pushClient.ts` subscribes with
   `applicationServerKey = VAPID public key` and calls
   `POST /api/push/devices` (`{ token: PushSubscription JSON, platform:"web",
   provider:"webpush" }`). Backend upserts by the unique token and bumps
   `lastSeenAt`.
3. **Permission pending/denied (Android 13+, Chrome)** → the Settings row
   ("Notifications → This device") explains the state; tapping it calls
   `enablePush()` → `requestPermissions()` → subscribe → register. Denied
   permanently → guidance to the browser site-settings toggle.
4. **Subscription rotation** — the SW's `pushsubscriptionchange` posts a message
   to the page; `PushProvider` re-subscribes and re-registers the new token.
5. **Invalid token** — provider reports 404/410 (`webpush`) or
   `UNREGISTERED / registration-token-not-registered` (FCM) → backend marks
   `isActive=false` (`push_token_invalidated`) and never retries it.
6. **Logout** — the client calls `DELETE /api/push/devices` with its token.
7. **Cleanup** — the maintenance task deactivates devices inactive for > 120 days.

---

## 6. Notification event routing

```
User action → service → NotificationService.createNotification          (DB row + socket)
                            │ (recipient has no live socket → offline)
                            ▼
               PushNotificationService.dispatchForCreatedNotification   (type-gated)
                            ▼
               sendToUser → per-device provider → OS notification
```

Types that push (matching real VANTA features): `follow`, `like`, `comment`,
`mention`, `message`, `group`, `channel`, `live`, `gift`, `wallet`, `system`,
`milestone`. High-volume noise (`live_interaction`) is excluded.

**Calls** are always pushed (highest priority) with `urgency=high` and a 90s TTL;
the service worker suppresses the OS row when the app is the focused window
(because the realtime socket already shows the in-app call UI).

---

## 7. Incoming-call flow (the core scenario)

```text
Phone A (VANTA open) → User A taps Call
  → socket call:user {callId, conversationId, type, signalData}
  → backend: verifies the direct-chat peer, persists CallSession (RINGING,
    offer stored, ICE buffered) [call-session.service]
  → socket incoming_call to the callee's room (if connected — in-app UI)
  → PushNotificationService.notifyIncomingCall (Web Push, high urgency,
    Actions: Answer / Decline, sound = vanta-ringtone, vibrate)
        ▼
Phone B: OS notification "📞 Incoming VANTA Call — <name> is calling you"
        [ works: VANTA open · background · screen locked · app terminated ]
```

- **Tap notification** → opens the chat conversation.
- **Tap Answer** → VANTA opens `/chat?vantaCall=answer&callId=…&caller=…` →
  `CallProvider` calls `chatCalls.answerCallFromPush` → **validates the call with
  the server** (`GET /api/calls/:callId` — returns the stored offer + buffered
  ICE only to the callee) → builds the WebRTC answer → `call:accept` → the
  caller's overlay connects.
- **Tap Decline** → VANTA opens with `vantaCall=decline` → emits
  `call:decline` → caller sees "declined", callee's other devices stop ringing.
- **Races**: `CallSession.transition` is an atomic `UPDATE … WHERE status=RINGING`,
  so double-answers, answer-after-cancel, and answered-on-another-device are
  impossible. Expired/ended calls return `CALL_EXPIRED/CALL_UNAVAILABLE` — no
  ghost calls.

Multi-device stop-ringing: when any device answers/declines/cancels/ends, the
server emits `call_ringing_stopped` (socket) **and** a resolution push
(`call_answered|…`) that the SW uses to close the visible notification on every
other device.

---

## 8. Duplicate prevention

1. **Database idempotency** — `UNIQUE(eventId, deviceId)` on `PushDelivery`;
   per-device sends are skipped once a terminal status is recorded.
2. **Foreground dedup** — non-call pushes are not sent to users with a live
   socket; the SW additionally suppresses OS rows while the app window is
   focused (page ↔ SW `postMessage` handshake: `vanta-call-handled`).
3. **Retry** — transient failures record `FAILED` and schedule one bounded retry
   on the existing `JobQueue` (`push:deliver`, groupId-deduped, 2s delay).
4. **Throttle** — per-user sliding window (40 pushes/min) plus the existing API
   rate limiters.

---

## 9. Security checklist

- Device registration requires an authenticated session (`authenticateJWT`).
- A token is bound to its owner: re-registering another user's token is refused.
- Push-answer calls are authorized server-side by `calleeId`, status and expiry.
- Notification payloads are minimal and never carry secrets.
- VAPID private key / FCM service account live only in backend env vars.
- Rate limits: `rateLimiter.api` on push routes + the service throttle.
## 10. Logging & observability

Structured JSON logs: `push_token_registered`, `push_token_invalidated`,
`push_send_started`, `push_send_success`, `push_send_failure`,
`incoming_call_push_sent`, `incoming_call_push_failed`, `push_devices_pruned`.
Metrics counters (existing `metricsCollector`): `push.attempts`,
`push.success`, `push.failed`, `push.invalid_tokens`. Never log keys, full
tokens, or message content.

---

## 11. Local development & testing

```bash
# 1. Generate VAPID keys and export them in backend/.env
npx web-push generate-vapid-keys --json

# 2. Migrate + run the backend
cd backend && npm run build && npm start     # or: npm run dev

# 3. Run the frontend with HTTPS (required for SW + camera)
cd frontend && npm run dev:https             # serves https://<LAN-IP>:3000

# 4. Open the app on a real phone, sign in, tap Settings → Notifications →
#    “This device” → enable.
```

Automated tests:

```bash
cd backend
npx jest --config jest.config.js src/__tests__/push-notification.service.test.ts \
                              src/__tests__/call-session.service.test.ts
```

Covers: token registration (new/existing/refresh/foreign token/cap), device
list/unregister, offline suppression, idempotent redelivery, provider-not-
configured no-op, dead-token deactivation, type gating, call-session
authorization, expiry, atomic transitions, ICE buffering.

---

## 12. Real-device matrix (manual)

| State | Expected |
|---|---|
| VANTA open (focused) | in-app call UI; no duplicate OS notification |
| VANTA in background tab / other app | OS notification + ringtone |
| Screen locked | OS notification (calls: high urgency + sound + vibration) |
| App removed from recent apps (Android PWA installed) | push still delivered |
| Phone restarted | re-login re-registers the token (subscription may rotate) |
| Permission denied | Settings explains; site-settings link |
| Multiple devices | all ring; answering one stops the others |

---

## 13. Production deployment

1. Railway backend → Settings → Variables: set `VAPID_SUBJECT`,
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (and FCM creds when a native app
   lands). Use **Railway environment variables** — never commit them.
2. Deploy; `railway.json` runs `prisma migrate deploy` automatically.
3. Vercel frontend: rebuild (serves `public/vanta-sw.js` unchanged).
4. Verify: `curl https://<api>/health` and
   `curl https://<api>/api/push/config` → `providers.webpush: true`.

---

## 14. Troubleshooting

- **Notification never arrives** → check `/api/push/config` shows
  `webpush: true`; Settings → Notifications → "This device" shows enabled; the
  browser notification permission is granted (site settings).
- **iOS Safari doesn't show notifications** → push requires the site **installed
  to the Home Screen** and iOS 16.4+.
- **Android only works when installed** → add the app to the home screen
  (Chrome). Non-installed sites may lose push subscriptions when cleared from
  recents.
- **`push_token_invalidated` spam in logs** → dead subscriptions being cleaned
  up; open the app once to re-register.
- **Answer says "call no longer available"** → the 90s ringing window expired or
  the call was cancelled/answered elsewhere — expected, not a bug.
- **Firebase FCM provider shows `webpush: true` but `fcm: false`** → expected
  until native-app credentials are configured; the PWA runs on Web Push.