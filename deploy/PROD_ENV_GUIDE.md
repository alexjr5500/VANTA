# VANTA — Phase 2 Production Deployment Guide (PC OFF)

Goal: open VANTA from any phone via a normal HTTPS URL with NO PC involved.
Services: **Vercel** (frontend) + **Railway** (backend + Postgres + storage volume) + **LiveKit Cloud** (WebRTC).

> Auto-deploys: connect this GitHub repo (`alexjr5500/VANTA`) to Vercel and Railway once (dashboard "New Project → Import repo")；every `git push` to `main` redeploys automatically. The backend already ships `railway.json` (build/start/healthcheck); the frontend is a standard Next.js app (Vercel detects it automatically).

---

## 1. Services to create

| Service | Provider | Purpose | URL you get |
|---|---|---|---|
| Frontend | Vercel | Next.js app (HTTPS) | `https://vanta-xxxx.vercel.app` (or custom domain) |
| Backend | Railway | Express + Socket.IO API (HTTPS) | `https://vanta-backend-production-xxxx.up.railway.app` |
| Database | Railway (PostgreSQL) | Prisma data store | internal URL `postgresql://...` (project-internal; not public) |
| Media storage | Railway Volume **or** Cloudinary | uploaded images/videos/reels | volume → served by backend at `/uploads`; Cloudinary → its CDN URL |
| Live streaming | LiveKit Cloud | WebRTC signaling + SFU media | `wss://<project>.livekit.cloud` |

Storage choice (pick ONE):
- **Railway Volume (simplest, zero extra accounts):** attach a volume mounted at `/data` to the backend service and set `UPLOAD_STORAGE_DIR=/data/uploads`. The frontend already auto-resolves `/uploads/...` media URLs against the API origin — media URLs keep looking exactly like today (`https://<api>/uploads/....jpg`).
- **Cloudinary (CDN, optional):** set the 3 `CLOUDINARY_*` vars; backend auto-detects and uploads there instead (no code changes; URL fields get the CDN link, frontend passes CDN URLs through untouched).

---

## 2. Railway — backend service

1. Railway → **New Project → Deploy from GitHub repo** → select `alexjr5500/VANTA`.
2. In the service's **Settings → Root Directory** set `backend` (**important** — railway.json commands assume backend/ is the root`.
3. Add a **PostgreSQL** plugin/service to the same project (Railway → New → Database → PostgreSQL15. Copy its **internal** `DATABASE_URL`.
4. Add a **Volume** to the backend service, mount path `/data` (if using Railway storage).
5. In backend **Variables**, set (values from `deploy/.env.production` — see the env tables below).
### Backend variables (Railway)

| Variable | Value source |
|---|---|
| `DATABASE_URL` | Railway Postgres internal URL (append `?sslmode=disable` if internal-net connection issues) |
| `PORT` | `5000` |
| `JWT_SECRET` | generated 32+ hex (`deploy/.env.production`) |
| `JWT_REFRESH_SECRET` | generated 32+ hex |
| `ENCRYPTION_KEY` | generated 32+ hex |
| `FRONTEND_URL` | `https://<your-frontend>.vercel.app` |
| `CORS_ALLOWED_ORIGINS` | `https://<your-frontend>.vercel.app` |
| `UPLOAD_STORAGE_DIR` | `/data/uploads` (only with Railway volume) |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | only if Cloudinary |
| `LIVEKIT_HOST` | `https://<project>.livekit.cloud` |
| `LIVEKIT_API_KEY` | LiveKit Cloud dashboard |
| `LIVEKIT_API_SECRET` | LiveKit Cloud dashboard |
| `REQUIRE_EMAIL_VERIFICATION` | `false` (MVP) |
| `RATE_LIMIT_ENABLED` | unset (prod default on) |

**Do NOT set** `HTTPS_DEV_CERT` / `HTTPS_DEV_KEY` — dev-only absolute paths that would crash prod.

The build pipeline in `railway.json` automatically: `npm install` → swaps schema provider sqlite→postgresql → `prisma generate` → `tsc build` → `prisma db push` (creates Postgres schema; old SQLite migrations are not used).

6. After first deploy, run ONE-time seeds:
```bash
railway run -- npx prisma db push --accept-data-loss   # already ran in build; safe re-run
railway run -- npm run seed                  # base seed (admin/categories)
railway run -- npm run seed:gifts           # gift catalog (73 gifts — the flow you tested)
railway run -- npm run seed:dev-wallet     # optional dev wallet
```
(`railway run` executes with the service's vars; if `ts-node` isn't in prod, use `railway run -- npx ts-node --transpile-only prisma/seed.ts` etc.)
---

## 3. Vercel — frontend service

1. Vercel → **Add New → Project → Import GitHub repo** → `alexjr5500/VANTA`; Root Directory `frontend`; Framework preset **Next.js** (build `npm run build`; output default) — zero changes needed.

2. **Environment Variables** (Production):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<your-backend>.up.railway.app` |
| `NEXT_PUBLIC_SOCKET_URL` | `https://<your-backend>.up.railway.app` |
| `NEXT_PUBLIC_APP_URL` | `https://<your-frontend>.vercel.app` |
| `NEXT_PUBLIC_LIVEKIT_URL` | `wss://<project>.livekit.cloud` |
| `NEXT_PUBLIC_ENV` | `production` |

3. Deploy. After build, open the Vercel URL — HTTPS with a real CA, nothing to install on the phone.

> Note: the frontend repo's local `.env*` files (LAN IPs) are git-ignored and never uploaded — Vercel uses only dashboard vars. Local LAN testing keeps working independently via `npm run dev:https`.
---

## 4. LiveKit Cloud

1. Create account/project at livekit.cloud → **Keys** → create API key+secret.
2. Backend vars: `LIVEKIT_HOST=https://<project>.livekit.cloud`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
3. Frontend var: `NEXT_PUBLIC_LIVEKIT_URL=wss://<project>.livekit.cloud`.
4. (Optional) add your frontend origin to LiveKit's allowed origins.
No local WSS bridge is needed in prod — LiveKit Cloud terminates TLS itself.

---

## 5. Custom domain (optional nice-to-have)

- Vercel: project → **Domains** → `vanta.yourdomain.com` (they handle TLS).
- Railway: **Settings → Networking → Generate Domain** (or custom `api.yourdomain.com` — Railway supports custom domains + TLS. Then update `FRONTEND_URL`/`CORS_ALLOWED_ORIGINS`/`NEXT_PUBLIC_*` and redeploy/rebuild.



---

## 6. Verify on the phone (PC OFF!

```powershell
# API health
curl https://<your-backend>.up.railway.app/health

# Reusable e2e suites (point them at prod:
$env:VANTA_TEST_BASE='https://<your-backend>.up.railway.app'
node scripts/e2e-phone-test-2.mjs    # gifts, groups, channels, live tokens, search
node scripts/e2e-live-test.mjs           # live streaming end-to-end (8 checks)
```
Open `https://<your-frontend>.vercel.app` from the phone: register, profile, uploads, reels, chat, gifts, live streaming — all over HTTPS, PC OFF.



---

## 7. Security checklist (production)

- [ ] All `JWT_*`/`ENCRYPTION_KEY` replaced with generated secrets((never the `dev_` values。
- [ ] `NODE_ENV=production` (done in railway.json; Vercel sets its own)。
- [ ] `FRONTEND_URL` + `CORS_ALLOWED_ORIGINS` are the exact Vercel origin。
- [ ] `HTTPS_DEV_CERT/KEY` NOT set on Railway..
- [ ] LiveKit API key/secret are prod values (not `devkey`/`secret`)。.
- [ ] Postgres DB backed up periodically (Railway has backups on paid plans; enable)。

---

## 8. Troubleshooting: "Unable to load Reel — MEDIA_ELEMENT_ERROR"

**Symptom:** the Reels feed/detail page shows *"Unable to load Reel — The server
returned no playable video source: MEDIA_ELEMENT_ERROR"* in the browser.

**Root cause (verified 2026-09-08 against the production backend):** Reel videos
are served by the backend from `/uploads` (local disk). If uploads land on an
**EPHEMERAL container filesystem** (Railway without a volume, or without
`UPLOAD_STORAGE_DIR` pointing into one), the file is wiped on the next
restart/redeploy while the Postgres row survives. `/api/reels` keeps returning
`/uploads/<file>.mp4`, the browser `<video>` GETs it and receives a **JSON 404**
(`Content-Type: application/json`) — browsers cannot demux JSON and report
`MEDIA_ELEMENT_ERROR`. Avatars, post images, chat attachments etc. break the
same way (silently).

**Verify (2 minutes):**
```powershell
# 1. What URL does the API return for a Reel?
curl https://<your-backend>.up.railway.app/api/reels?limit=3
# 2. Open the returned videoUrl directly — it must be HTTP 200 video/mp4:
curl -I https://<your-backend>.up.railway.app/uploads/<returned-file>.mp4
# 3. /health now reports a mediaStorage diagnostic (mode, missingOnDisk, healthy):
curl https://<your-backend>.up.railway.app/health
# 4. Fully automated probe (registers + uploads + verifies + cleans up):
node scripts/prod-reel-probe.mjs https://<your-backend>.up.railway.app
```

**Fix (pick ONE — Railway volume is the documented default):**

| Option | What to change on Railway | Result |
|---|---|---|
| **Railway Volume (recommended)** | 1. Backend service → **Settings → Volumes → New Volume**, mount path **`/data`**<br>2. Backend **Variables**: **`UPLOAD_STORAGE_DIR`** = **`/data/uploads`** | Files persist across deploys; `/uploads` URLs keep working; already-existing URL shapes are unchanged |
| **Cloudinary CDN (optional)** | Backend **Variables**: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Uploads go to Cloudinary (code already auto-detects the 3 vars); stored URLs become CDN links that never 404 on deploy |

Existing rows whose files were already wiped cannot be restored (the bytes are
gone) — re-upload those Reels/avatars after the fix. After deploying the fix,
redeploy once and re-run `node scripts/prod-reel-probe.mjs` (or open a Reel):
new uploads must keep playing across subsequent deploys.

**Code help:** the backend `/health` endpoint and startup logs now surface this
exact condition (`mediaStorage.healthy === false`, `missingOnDisk > 0`), and
regression tests in `backend/src/__tests__/media-serving.test.ts` +
`storage-diagnostics.test.ts` plus `frontend/src/lib/mediaUrl.test.ts` pin the
media delivery + URL resolution contract.



---

## 8. What still needs a human acting in dashboards (one-time

1. Create Vercel + Railway + LiveKit Cloud accounts (or log in)。
2. Import the repo in both (2 clicks each)。
3. Paste the vars from `deploy/.env.production` (prepared locally; see scripts/prepare-prod-env.ps1)。
4. Run one-time seeds (section 2.6。
5. (Optional) domain setup。







Everything else is automated: pushes to `main` redeploy both services; `railway.json` builds + syncs schema; healthcheck `/health` monitors the backend. Your PC cans its OFF — GitHub Vercel Railway LiveKit handle the rest。