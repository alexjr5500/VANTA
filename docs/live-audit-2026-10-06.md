# VANTA LIVE — Master Audit, Rebuild & Production Hardening Report

_Date: 2026-10-06 · Commit base: `021cbad` · Scope: VANTA LIVE (frontend + backend + realtime + payments)_

---

## 1. Executive summary

VANTA LIVE is a **real, working, server-authoritative livestream platform** — not a
mock. LiveKit rooms, a full session lifecycle with heartbeat-based stale-session
sweeping, realtime chat/reactions/gifts over Socket.IO, a server-validated VANTA
Coin gift economy with idempotent transactions, guest/co-host staging, moderation
and post-live analytics are all implemented and tested.

During this engagement we **audited every LIVE surface** and then shipped a focused
**production-hardening pass** on the highest-risk realtime paths (flood control,
moderation gaps, session-creation races, teardown correctness) plus **UX
improvements to LIVE discovery**. No working system was removed or replaced with a
mock; the gift catalog, VANTA Coins wallet, verification, auth and profiles are
untouched.

---

## 2. Current LIVE architecture (as audited)

### Frontend (`frontend/src`)
| Surface | File | Notes |
| --- | --- | --- |
| LIVE discovery | `app/live/page.tsx` | Tabs (For You / Following / Popular) + featured stream + grid; real `/api/live/discover` data |
| Go Live + creator room | `app/live/go-live/page.tsx` (2081 lines) | Single full-screen surface: permissions → camera preview → live room; phases `IDLE → REQUESTING_PERMISSIONS → CAMERA_PREVIEW → CONFIGURING_LIVE → CONNECTING_TO_LIVE → LIVE → ENDING_LIVE → LIVE_ENDED` |
| Viewer room | `app/live/[streamId]/page.tsx` (1594 lines) | Full-screen LiveKit playback, chat overlays, reactions, gifts, guests, share, report/follow/mute/block, ended/error states |
| Land/stream cards | `components/live/LiveFeaturedStream.tsx`, `LiveStreamCard.tsx` | Verified badges, LIVE badge, viewer count, category |
| Stage layout | `components/live/liveStageLayout.ts` + `LiveParticipantGrid.tsx` | Pure grid rules (1–5 participants), host-anchored, unit-tested |
| Camera capture | `lib/hooks/useLiveCamera.ts`, `lib/cameraCapture.ts` | Real `getUserMedia`, per-kind permission mapping, AF/quality |
| LiveKit | `lib/hooks/useLiveKit.ts`, `lib/mediaPermissions.ts` | Room connect, publish verify, reconnect, active speakers |
| Gifts | `components/social/GiftPicker.tsx`, `components/gifts/GiftArtworkSvgs.tsx`, `GiftAnimationOverlay.tsx`, `lib/giftCatalog.ts`, `lib/vanta-gifts.ts` | Real catalog, artwork system, animated overlays |
| Socket client | `lib/socketClient.ts` | Pooled, reconnecting, batched emit helper |

### Backend (`backend/src`)
| Area | File |
| --- | --- |
| Session service | `services/live.service.ts` — start/end/sweep/heartbeat/join/leave/chat/reactions/moderation/guests/analytics/report |
| Realtime | `sockets/live.socket.ts` — auth, chat, reactions, gifts, guests, moderation, heartbeat, sweeper |
| Gift economy | `services/gift.service.ts` (atomic `sendGift` + `requestId` idempotency + 70% recipient conversion), `sockets/gift.socket.ts` (`/gifts` namespace) |
| REST | `routes/live.routes.ts`, `controllers/live.controller.ts`, `routes/monetization.routes.ts` (`/gifts/send`) |
| Media | `services/livekit.service.ts` — host/viewer/guest tokens, room lifecycle |
| Infrastructure | LiveKit WebRTC (host publish / viewer subscribe), Socket.IO, Prisma (SQLite dev / Postgres prod), in-memory + Redis cache |

### Session state machine (verified)
```
DRAFT → PREPARING → CONNECTING → LIVE ⇄ RECONNECTING → ENDING → ENDED
                                  ↘ FAILED (client error phase)
                                  ↘ ENDED (host_timeout via heartbeat sweeper)
```
---

## 3. Problems found

### Security
1. **No realtime rate limiting** (critical). The socket layer had zero flood
   protection: chat, reactions, guest requests, moderation actions and gifts were
   unbounded per user. A scripted client could flood comments/reactions into the
   DB write path and the room broadcast. → **FIXED** (see §5).
2. **Reactions ignored stream moderation** — `addReaction` did not check
   `bannedUsers`/`mutedUsers` (chat did), so a banned viewer could keep spamming
   likes. → **FIXED**.
3. **Duplicate “Go Live” race** — the “already active” check ran before the DB
   insert (non-atomic); two rapid taps could create two active sessions for one
   host (only one would heartbeat → orphaned second session). → **FIXED** (the
   guard now lives inside the same transaction as the create).
4. Legacy `likeStream` REST endpoint could like ended sessions. → **FIXED**.
5. Comments could be posted to ended sessions via REST `POST /:streamId/message`
   (service only checked pause/ban/mute, not LIVE status). → **FIXED**.
6. Gift `isSuper` was passed through a typed option that didn’t declare it
   (pre-existing TS error, behaviour relied on a cast). → **FIXED** (typed opt-in).

### Realtime / correctness
7. `finishStream` never removed `StreamViewer` rows → ended sessions accumulated
   membership rows forever and stale sockets could decrement ended sessions.
   → **FIXED** (roster torn down at end; last live `viewerCount` snapshot preserved).
8. Viewer-count mutations (`join/leave/like`) did not invalidate the per-stream
   cache → discovery/detail counts could serve stale values until TTL. → **FIXED**.

### UX
9. **LIVE discovery**: no category filter despite the backend supporting
   `?category=`; the grid never refreshed itself (ended streams lingered, new
   lives required a manual reload/tab switch). → **FIXED** (category chips from the
   real catalog + 30s silent auto-refresh).
10. Discovery already had a Go Live CTA, featured stream, verified badges and
    complete empty/loading/error states — retained.
11. Go-Live and Viewer rooms are large monoliths (2.1k / 1.6k lines). Functional
    and safe; flagged as the next refactor (split into the component library listed
    in the brief) — **not rebuilt** in this pass to avoid regression risk.

### Database
12. No partial-unique index for `(hostId WHERE active=true)` — SQLite cannot
    express partial indexes; the interactive-transaction guard (fix #3) closes the
    race without a schema change. For Postgres multi-instance deployments a
    `UNIQUE (hostId, active)` approach or a dedicated `active_session_guard` table
    is recommended (see §8).
13. `guests` / `approvedGuests` / `mutedUsers` / `bannedUsers` are JSON strings on
    `LiveStream` — workable, but they are read frequently; consider normalizing
    guests/mutes/bans to child tables in a future migration.

### API
14. `GET /:streamId/chat` and `GET /:streamId` are unauthenticated and cached —
    fine for discovery, but `followStreamer` route derives host from a cached
    stream read; acceptable today.
15. `send_message`, `like` do not enforce LIVE status at the controller (fixed in
    the service layer, which the controller wraps).
---

## 4. Feature decision table

| Feature | Current implementation | Status | Decision | Reason |
| --- | --- | --- | --- | --- |
| Go Live flow | Phased permissions→camera→connect→LIVE | Working | **Keep, polish** | Solid state machine; real camera, real LiveKit, error recovery |
| Camera preview | Full-bleed, mirrored, filters/beauty | Working | **Keep** | Real `getUserMedia`, per-kind permission errors |
| Go Live button states | Preparing/Connecting/LIVE/Reconnecting/Failed | Working | **Keep** | Stale-session guard + atomic start (now hardened) |
| LIVE room (creator) | Video-first, floating controls, chat, guests, gifts | Working | **Keep** | Premium immersive surface already |
| Viewer room | Full-screen video, overlays, gifts, guests, share | Working | **Keep** | Meets TikTok-level interaction model (no branding copied) |
| Guest/co-host stage | LiveKit publish tokens + host approval + adaptive grid | Working | **Keep + harden** | Stage layout is unit-tested; guests were rate-unbounded → **fixed** |
| Comments | Realtime, dedupe, slow-mode, pause, ban/mute, delete, pin | Working | **Keep + harden** | Added per-user flood control + LIVE-status check |
| Reactions | Shadow hearts, aggregated `likes` counter, deduped marker | Working | **Keep + harden** | Added ban/mute enforcement |
| Gifts | Real catalog, atomic idempotent send, artwork animations | Working | **Keep** | Server-authoritative; VANTA Coins untouched |
| VANTA Coins | Existing wallet (frozen/locked/auto-conversion) | Working | **Keep** | Not modified |
| Follow | `streamFollower` + notifications | Working | **Keep** | Preserved |
| Verification badge | Blue/Gold via `VerificationBadge` | Working | **Keep** | Preserved |
| Notifications | live-started/follow/gift notifications | Working | **Keep** | Preserved |
| Moderation (host) | mute/ban/pause/slow-mode/clear/delete/pin | Working | **Keep + harden** | Actions were rate-unbounded → **fixed** |
| LIVE discovery | Tabs + featured + grid | Working | **Improve** | Added category filter + auto-refresh |
| End-Live summary | Real analytics endpoint (`/api/live/:id/analytics`) | Working | **Keep** | Real data only |
| Admin moderation | `adminEndStream` / `adminSuspendStream` + real data | Working | **Keep** | Preserved |
| `likeStream` REST | Legacy unguarded increment | Working | **Fix** | Now guarded against ended sessions |
| Stream replay | `recordingUrl` if `recordingEnabled` | Conditional | **Keep** | Depends on LiveKit Egress config; not mocked |
| LiveKit Egress / recording | Not provisioned | Not configured | **Keep (dependency)** | Not fake-enabled |
---

## 5. Changes shipped in this pass

### Backend
1. **`security/liveRateLimiter.ts` (new)** — in-memory sliding-window limiter keyed
   by authenticated user + action. Limits: comments 30/30s, reactions 60/10s,
   gifts 5/15s, guest requests 4/60s, guest actions 25/60s, host actions 40/60s,
   heartbeats 12/30s, joins 10/60s. Bounded bucket map (25k cap), lazy pruning.
2. **`sockets/live.socket.ts`** — wired the limiter into every write-path handler
   (comment, reaction, gift, join, heartbeat, host moderation, guest stage, share)
   using the existing per-feature error channels so clients see normal recoverable
   errors. Heartbeats stay generous so a reconnecting studio is never cut off.
3. **`sockets/gift.socket.ts`** — same per-user gift throttle on the `/gifts`
   namespace.
4. **`services/live.service.ts`** —
   - `addReaction` now enforces ban/mute before touching the likes counter;
   - `postChatMessage` rejects ended sessions (`Stream is not live`);
   - `startStream` guard moved **inside** the create transaction → atomic
     duplicate-start prevention; stale-session LiveKit rooms closed after commit;
   - `finishStream` deletes the `StreamViewer` roster for the ended session;
---

## 7. Testing report

| Suite | Result |
| --- | --- |
| Backend `live.service.test.ts` | ✅ 25 passed (incl. new: reaction ban/mute, chat on ended session, viewer-roster teardown, atomic duplicate-start serialization) |
| Backend `live.ratelimit.test.ts` (new) | ✅ 8 passed (window limit, override, slide, per-user isolation, per-action isolation, flood persistence, reset, sweep) |
| Backend `gift.service.test.ts` | ✅ passed (economy untouched) |
| Backend `websocket.test.ts` | ✅ passed |
| Frontend live suite (liveStageLayout, goLiveEntry, liveChatDedupe, cameraCapture) | ✅ 43 passed |
| Backend type-check (`tsc --noEmit -p tsconfig.test.json`) | ✅ no errors in modified files (only pre-existing errors in unrelated test files remain, e.g. `auth.service.test.ts` mock typing under `isolatedModules`, and a pre-existing test-only assertion in `live.service.test.ts:171`) |
| Frontend type-check | ✅ no errors from modified files (only pre-existing stale `.next/types` artifact for a deleted `creator/ai` page) |

**Known limitations**
- The rate limiter is in-memory per process: correct for the single-instance
  socket host; a multi-instance deployment should back it with Redis (design
  already isolates the limiter behind one class for that swap).
- Full manual QA (real device camera, LiveKit room) must be performed in the dev
  environment; unit coverage is logic-level by design (no mocks of the video path).

---

## 8. Production readiness report

```
LIVE DISCOVERY: READY      (category filters + auto-refresh shipped)
GO LIVE:        READY      (atomic duplicate-start guard, stale-session cleanup)
CAMERA:         READY      (unchanged, previously hardened)
LIVE ROOM:      READY      (unchanged, previously hardened)
COMMENTS:       READY      (+ per-user rate limit, LIVE-status enforcement)
GIFTS:          READY      (+ per-user rate limit; economy untouched)
COINS:          READY      (untouched wallet, server-authoritative conversions)
GUESTS:         READY      (+ request/action rate limits)
MODERATION:     READY      (+ rate limits; reactions honor ban/mute)
ANALYTICS:      READY      (real data only)
SECURITY:       READY      (with the two follow-ups below)
PERFORMANCE:    READY      (bounded sockets-to-DB pressure, cache invalidation)
```

**Recommended follow-ups (next release, no action needed to ship this pass)**
1. Multi-instance: move the live rate limiter to Redis; add a
   `UNIQUE (hostId, active)`-style guard table (or partial index on Postgres) for
   cross-instance duplicate-start prevention.
2. Refactor the 2.1k-line Go-Live page and 1.6k-line Viewer page into the
   component library named in the brief (`GoLive`, `CameraPreview`, `CameraControls`,
   `LiveRoom`, `LiveHeader`, `LiveComments`, `LiveReactions`, `GiftPanel`,
   `GiftAnimation`, `GuestPanel`, `LiveControls`, `LiveModeration`, `LiveProfile`,
   `LiveAnalytics`). This is a pure refactor — the current monolithic pages are
   working production code.
3. Normalize `guests/approvedGuests/mutedUsers/bannedUsers` JSON columns into
   child tables once the migration window exists.
   - `join/leave/like/reaction` invalidate the per-stream cache;
   - `likeStream` requires a genuinely live session.
5. **`services/gift.service.ts`** — declared `isSuper` in the send options type
   (removes the pre-existing TS error; behaviour unchanged).

### Frontend
6. **`app/live/page.tsx`** — LIVE discovery improvements:
   - Category filter chips loaded from the real `/api/live/categories` catalog,
     wired to `/api/live/discover?category=…` (Following tab unaffected);
   - 30s silent auto-refresh so live rooms never go stale and ended streams
     disappear without a loading flicker;
   - kept the Go Live CTA, featured stream, verified badges and all states.

---

## 6. UI/UX changes (documented per surface)

| Surface | Before | After (this pass) |
| --- | --- | --- |
| LIVE discovery | Grid only; no way to narrow by category; stale until reload | Category chips (real catalog) + auto-refresh + existing featured card/Go Live CTA |
| Go Live | (unchanged) recent full redesign | Preserved: camera-first, floating controls, live room, end-flow summary |
| Camera | (unchanged) | Preserved: real preview, flip/flash-quality/filters/beauty, per-error recovery |
| LIVE room | (unchanged) | Preserved: immersive video, host chat, guest stage, moderation sheet |
| Comments | (unchanged) | Preserved + server-side flood protection with friendly rate-limit errors |
| Gifts | (unchanged) | Preserved premium picker/animations; throttled only at the transport layer |
| Guests | (unchanged) | Preserved approval flow + adaptive grid; request/action throttling added |
| Moderation | (unchanged) | Preserved host controls; actions throttled; banned/muted users can no longer react |
| End LIVE | (unchanged) | Preserved real analytics summary |