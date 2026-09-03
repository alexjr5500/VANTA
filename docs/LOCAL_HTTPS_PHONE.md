# VANTA — Local HTTPS + Phone Access (Development Runbook)

This document explains how VANTA is served over local HTTPS so a **phone on the
same LAN** can open `https://10.174.123.177:3000/`, register, log in, and use the
app (API, media, reels, live) with no mixed-content or CORS failures.

## Port map

| Port | Service            | Protocol            | Bound to |
|------|--------------------|---------------------|----------|
| 3000 | Next.js dev server | `https://`          | `0.0.0.0` |
| 5000 | Express API + Socket.IO | `https://` / `wss://` | `0.0.0.0` |
| 7443 | LiveKit WSS bridge  | `wss://`            | `0.0.0.0` (via scripts/livekit-wss-proxy.mjs) |
| 7880 | LiveKit signaling   | `ws://` (loopback for bridge) | `0.0.0.0` |
| 7881/7882 | LiveKit WebRTC media | TCP / UDP         | `0.0.0.0` |

## How HTTPS is wired

- **Certificates** (dev only): mkcert CA + leaf cert live in
  `frontend/.certs-dev/` (`rootCA.pem`, `vanta-local.pem`, `vanta-local-key.pem`).
  The leaf cert's SAN includes `DNS:localhost`, `IP Address:127.0.0.1`, and
  `IP Address:10.174.123.177`, so HTTPS validates on both the laptop and the
  phone for the LAN IP.
- **Frontend**: `npm run dev:https` starts Next.js with
  `--experimental-https --experimental-https-key .certs-dev/vanta-local-key.pem
  --experimental-https-cert .certs-dev/vanta-local.pem --experimental-https-ca
  .certs-dev/rootCA.pem -p 3000 -H 0.0.0.0`. `-H 0.0.0.0` makes it reachable via
  both `https://localhost:3000` and `https://10.174.123.177:3000`.
- **Backend**: `backend/.env` sets `HTTPS_DEV_CERT`/`HTTPS_DEV_KEY` (absolute
  paths to the same mkcert certs), so `backend/src/index.ts` creates an HTTPS
  server. Socket.IO is attached to the same HTTPS server, so it upgrades to
  WSS automatically. When unset, the backend stays plain HTTP (production-like).
- **LiveKit signaling** goes through `scripts/livekit-wss-proxy.mjs` on port 7443
  using the same mkcert certs, so the HTTPS phone page is not blocked as mixed
  content. LiveKit itself is untouched.
- Dev certs/keys are git-ignored (`*.pem`, `*.key` in `.gitignore`), so secrets
  never enter Git.

## Starting the stack (the important part)

**Run exactly ONE Next.js dev server.** Next.js shares the `.next` build cache.
Launching multiple `next dev` instances at once (e.g. a plain `npm run dev` on
port 3000 plus `--experimental-https` instances on 3001/3002/3005, or vice versa)
corrupts that cache and produces exactly the symptom `GET / 404` /
`TypeError: Cannot read properties of undefined (reading 'entryCSSFiles')`.

Correct sequence:

```powershell
# 1. Backend (API :5000) - one instance
npm run dev:backend

# 2. Frontend HTTPS (:3000) - one instance, script already pins -H 0.0.0.0
npm run dev:https
# or: npm --prefix frontend run dev:https
```

If you see 404s / `entryCSSFiles` errors, stop every `next`/`node` dev process,
clear the corrupted cache, and restart the single HTTPS server:

```powershell
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne <backend-pid> } | Stop-Process -Force
Remove-Item -Recurse -Force .\frontend\.next
npm run dev:https
```
## Phone certificate trust (required once per phone)

The mkcert **root CA** must be trusted by the phone, otherwise HTTPS is rejected.
Install `frontend/.certs-dev/rootCA.pem`:

- **iPhone / iPad**: transfer `rootCA.pem` to the phone (AirDrop, email, or
  download via a local file server), open it to install the profile
  (Settings → Profile Downloaded → Install). Then enable full trust:
  **Settings → General → About → Certificate Trust Settings → enable
  "mkcert development CA..."**.
- **Android**: copy `rootCA.pem` to the phone, then
  **Settings → Security → Encryption & credentials → Install a certificate →
  CA certificate**, selecting the file. (Chrome on Android uses the installed
  CA for HTTPS validation once installed.)

After installing, open `https://10.174.123.177:3000/` — the padlock should be
valid. Do **not** add security bypasses or disable certificate validation; the
proper local trust is the fix.

## Firewall

The Windows Firewall must allow inbound TCP on **3000** (frontend) and **5000**
(API/Socket.IO). Run [scripts/add-vanta-https-firewall-admin.cmd](../scripts/add-vanta-https-firewall-admin.cmd)
once (right-click → **Run as administrator**). It only adds these two minimal
rules:

```text
netsh advfirewall firewall add rule name="VANTA HTTPS Frontend 3000" dir=in action=allow protocol=TCP localport=3000
netsh advfirewall firewall add rule name="VANTA HTTPS API 5000" dir=in action=allow protocol=TCP localport=5000
```

LiveKit ports (7443, 7881, 7882) are covered by
[scripts/add-livekit-firewall-admin.cmd](../scripts/add-livekit-firewall-admin.cmd)
if needed.

Note: if the current Wi-Fi/network profile is **Public**, Windows blocks
inbound by default; the explicit rules above (or switching the network to
Private) are required.

## Client-side endpoints (what the phone's browser uses)

All client-side endpoints are environment-driven and **must use `https`** so the
phone page has no mixed content:

- `frontend/.env` / `frontend/.env.local`:
  - `NEXT_PUBLIC_API_URL=https://10.174.123.177:5000`
  - `NEXT_PUBLIC_SOCKET_URL=https://10.174.123.177:5000`
  - `NEXT_PUBLIC_APP_URL=https://10.174.123.177:3000`
  - `NEXT_PUBLIC_LIVEKIT_URL=wss://10.174.123.177:7443`
- `backend/.env`:
  - `FRONTEND_URL=https://10.174.123.177:3000` (CORS allow list + OAuth redirects)
  - `HTTPS_DEV_CERT` / `HTTPS_DEV_KEY` as above

Backend CORS already accepts the exact LAN origin
`https://10.174.123.177:3000` (private-LAN origins on port 3000 are allowed in
development; production still uses the explicit `CORS_ALLOWED_ORIGINS` /
`FRONTEND_URL` allow list). Auth is JWT-bearer stored in localStorage with a
refresh flow — no cookie/domain issues across LAN origins.

Media URLs returned by the API are origin-relative (`/uploads/...`) and the
frontend resolves them against the current `NEXT_PUBLIC_API_URL`, so images,
videos, and reels play from the phone without baking in `localhost`.

## When the laptop's LAN IP changes

The cert SAN and the `.env*` files above are pinned to `10.174.123.177`. If the
laptop gets a new IP, regenerate the dev certificate including the new IP and
update the `NEXT_PUBLIC_*`/`FRONTEND_URL` values in the four env files, then
restart backend + frontend.

## Live safety

Live/LiveKit components, configuration, and server processes were **not**
modified for HTTPS/phone work. LiveKit's own firewall rules and the WSS bridge
are pre-existing and left as-is.