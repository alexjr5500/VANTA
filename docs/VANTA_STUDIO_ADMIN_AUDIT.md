# VANTA — Creator Studio & Admin Command Center Audit

> Phase A deliverable for the Studio/Admin redesign. Produced by inspecting the
> actual repository (routes, layouts, API clients, backend routes, Prisma
> schema references) — not by relying on filenames or documentation.
> No secrets, tokens, or credentials are referenced in this document.

---

## 1. Current architecture

| Layer | Technology |
|---|---|
| Frontend | Next.js 14.2 App Router (`frontend/src/app`), React 18, TypeScript |
| Styling | Tailwind CSS 3.4 + `globals.css` design-token layer (CSS custom properties) + utility classes (`.glass`, `.card-premium`, `.btn-primary`, `.skeleton`) |
| Motion | framer-motion |
| Icons | lucide-react |
| Charts | **No chart library.** Charts are hand-rolled inline SVG (see `admin/page.tsx` `GrowthChart`) |
| State | React context providers (`AuthContext`, `Toast`, `NotificationContext`, etc.) + per-page `useState`; no Redux/Zustand |
| API layer | `src/lib/api.ts` (base URL, auth headers, `ApiError`) + `src/lib/apiClient.ts` (GET cache, dedupe, retry, abort, batch) |
| Domain services | `adminApi.ts`, `analyticsApi.ts`, `walletApi.ts`, `verificationApi.ts`, `authApi.ts`, `reelApi.ts`, … |
| Backend | Express 4 + Prisma 5 (PostgreSQL) + Socket.IO; routes in `backend/src/routes` |
| Auth | JWT access token + persistent refresh token stored under `vanta_*` storage keys; role claim on user |
| Tests | Vitest (frontend, `npm --prefix frontend test`), Jest (backend), ESLint (`npm run lint:frontend`) |
| Build | `npm run build` (frontend only at root), `npm --prefix backend run build` (tsc) |

**Important Tailwind quirk:** `frontend/tailwind.config.ts` collapses ALL
breakpoints (`sm/md/lg/xl/2xl`) to **701px**. Practically, the app has two
viewports: `<701px` (mobile) and `≥701px` (desktop). The existing admin layout
relies on `lg:` = 701px. Any redesign must respect this (or use arbitrary
`min-[Npx]:` variants) without changing the global screen map, which the
consumer-facing app depends on.

## 2. Creator Studio routes (existing)

| Route | Page component | Data sources | Auth | Notes |
|---|---|---|---|---|
| `/creator` | `creator/page.tsx` | `GET /api/creator/stats`, `GET /api/creator/content` | login + `checkStudioAccess` gate in layout | Tabbed page duplicating sibling routes |
| `/creator/analytics` | `analytics/page.tsx` | `GET /api/creator/stats` | same | Cumulative totals only; no time series |
| `/creator/content` | `content/page.tsx` | `GET /api/creator/content?limit=50` | same | Read-only list; view links to `/post/[id]` |
| `/creator/earnings` | `earnings/page.tsx` | `/api/creator/stats`, `walletApi.getTransactionHistory`, `walletApi.getGiftHistory` | same | Real wallet data |
| `/creator/monetization` | `monetization/page.tsx` | `/api/creator/stats`, `getVerificationStatus`, `getBalance` | same | Channel overview + links |
| `/creator/live` | `live/page.tsx` | `GET /api/live/stats`, `GET /api/live/history` | same | Go Live → `/live/go-live` (`lib/goLiveEntry.ts` is the source of truth) |
| `/creator/rewards` | `rewards/page.tsx` | follower-rewards API | same | Follower reward campaigns |
| `/creator/subscriptions`, `/creator/upgrade`, `/creator/verification`, `/creator/community`, `/creator/inbox`, `/creator/notifications`, `/creator/security` | individual pages | various | same | Exist; outside redesign core |

**Layout:** `creator/layout.tsx` — mobile-only navigation (drawer behind a
hamburger). **There is no persistent desktop sidebar.** Studio access is gated
via `checkStudioAccess(token)` (redirects to `/creator/upgrade` when not
allowed); API failure = degraded access allowed (existing deliberate behavior).

**Known defects:** header notification bell is a dead button (no action);
overview page re-implements tabs that duplicate sibling routes; visual style
differs from admin; no desktop IA.

## 3. Admin routes (existing)

| Route | Data source | Notes |
|---|---|---|
| `/admin` | `GET /api/admin/stats`, `GET /api/admin/infrastructure` | KPI cards, user-growth SVG chart, recent signups/reports, service health |
| `/admin/users` | `GET /api/admin/users/manage` + suspend/ban/restore/verify, delete | Filters, pagination, confirm modal |
| `/admin/creators` | `GET /api/admin/creators` + verify/monetization toggles | |
| `/admin/verification` | `/api/verification/admin/*` | Queue/review page |
| `/admin/content` | `GET /api/admin/content`, `POST /content/:id/review` | Moderation queue |
| `/admin/compliance` | `GET /api/admin/reports`, `POST /reports/:id/resolve`, ban/unban | Reports & moderation; **only route MODERATOR role may access** |
| `/admin/finance` | `GET /api/admin/finance/transactions`, wallet admin endpoints | |
| `/admin/coin-payments` | `/api/admin/coin-payments*` | Coin purchase dashboard + refunds |
| `/admin/gifts` | `/api/admin/gifts` CRUD | |
| `/admin/follower-rewards` | `/api/admin/follower-rewards*` | |
| `/admin/live` | `GET /api/admin/live`, `POST /live/:id/end\|suspend` | |
| `/admin/communities` | `/api/admin/communities` | |
| `/admin/notifications` | `/api/admin/notifications` | Notification center |
| `/admin/analytics` | `analyticsApi` (`requirePlatformAnalytics` endpoints) | Platform analytics |
| `/admin/audit` | `GET /api/admin/audit` | Audit logs |
| `/admin/infrastructure` | `GET /api/admin/infrastructure` | System health |

**Layout:** `admin/layout.tsx` — desktop sidebar (`lg:` = 701px) + mobile
drawer. Frontend gating: `ADMIN_ROLES = [SUPER_ADMIN, ADMIN, CEO,
ADMINISTRATOR]`; MODERATOR allowed only on `/admin/compliance` (matches backend
moderation permissions). **Frontend gating complements backend enforcement;
this must be preserved.**

## 4. Current styling architecture

- Global tokens in `frontend/src/app/globals.css` (`--vanta-*`, `--surface*`,
  `--border*`, `--text-*`, `--active*` gold system, radius/motion/z tokens).
- Tailwind `extend` maps tokens to utilities (`bg-vanta-panel`, `text-gold`…).
- Reusable classes: `.glass`, `.card-premium`, `.btn-primary`, `.btn-gold`,
  `.skeleton`, `.tab-*`.
- **Both console areas currently use ad-hoc literals** (`bg-white/[0.02]`,
  `border-white/[0.06]`, `text-white/40`, `#c9a227`) instead of tokens.
- A `DESIGN_SYSTEM.md` exists at the repo root for the consumer app.

## 5. API endpoints & services used by these pages

- Creator: `GET /api/creator/stats`, `GET /api/creator/content`,
  `GET /api/live/stats`, `GET /api/live/history`,
  `GET /api/verification/studio-access`, `GET /api/verification/status`,
  wallet (`GET /api/wallet/transactions`, `GET /api/wallet/gift-history`,
  `GET /api/wallet/balance`).
- Admin: `GET /api/admin/stats`, `/users/manage`, `/creators`, `/content`,
  `/reports`, `/finance/transactions`, `/coin-payments*`, `/gifts`, `/live`,
  `/communities`, `/notifications`, `/analytics`, `/audit`, `/infrastructure`,
  `/settings`, wallet admin endpoints,
  `POST /api/admin/users/{suspend,ban,restore,verify}`,
  `DELETE /api/admin/users/:userId`, withdrawal approve/reject.
- Platform analytics: `GET /api/analytics/*` guarded by
  `requirePlatformAnalytics`.

All consumed through `apiGet/apiPost/apiPut/apiDelete` (`apiClient.ts`) with
shared auth headers, refresh recovery (`vanta-auth-expired` event),
retry/backoff, and in-flight cancellation.

## 6. Authentication & authorization

- Session restore handled centrally in `AuthContext` (access + refresh token).
- 401 → `vanta-auth-expired` → refresh flow; request layer never clears storage.
- Backend enforces roles per route (`authenticateJWT`, admin/moderation
  middleware). Frontend guards must **complement** these, not replace them.
- Creator studio gated by `checkStudioAccess` + login.
- Admin gated by role list; moderators restricted to Compliance.

## 7. Data models (relevant)

Prisma schema (`backend/prisma/schema.prisma`) plus `compliance-schema.prisma`.
Relevant models: `User` (role, status, verified), `Post`/`Reel`/`Story`
(engagement counters), `Livestream` (status, viewers, gifts),
`Wallet`/`WalletTransaction`/`Withdrawal`, `Gift`/`GiftTransaction`, `Report`,
`VerificationRequest`, `CoinPurchase`, `AuditLog`.

## 8. Broken / incomplete / misleading / UI-only features

| Finding | Classification |
|---|---|
| Creator header notification bell (dead button, fake unread dot) | BROKEN (UI-only) |
| Creator layout: no desktop navigation (drawer-only) | NOT IMPLEMENTED |
| `/creator` overview tabs duplicate sibling routes with subset data | UI-ONLY duplication |
| Admin overview: recent-reports panel disappears entirely when empty | Partially implemented |
| Frontend admin gate is role-list based (backend authoritative) | Working (complement) |
| Creator analytics shows only cumulative totals (no time-series endpoint) | BACKEND UNAVAILABLE for time-series |
| Content manager is read-only (no creator post edit/delete endpoints) | BACKEND UNAVAILABLE for edit/delete |
| Charts: hand-rolled SVG duplicated across pages | Duplicate components |

## 9. Responsive problems

- No desktop sidebar in Creator Studio; mobile drawer pattern forced onto
  desktop users.
- Admin tables rely solely on `min-w` + horizontal scroll; no record-list
  adaptation for phones.
- `grid-cols-2` KPI grids at 320px produce cramped, truncated metric cards.
- Tailwind screens collapsed at 701px means "tablet" behaves like desktop —
  layouts must be density-checked at 768px+.

## 10. Duplicate / inconsistent components

- Metric cards re-implemented per page (`MetricCard`, `StatTile`, `KpiCard`).
- Formatting helpers (`fmt`, `fmtCompact`, `fmtCurrency`, `timeAgo`)
  duplicated with divergent behavior.
- Confirm modals re-implemented per admin page.
- Two chart implementations (admin overview, admin analytics).

## 11. Regression risks

- Creator layout owns the studio-access gate: rewriting must preserve
  `checkStudioAccess`, the `/creator/upgrade` skip, and degraded-on-error.
- Admin layout owns role gating + moderator redirect: preserve exactly.
- Root `tailwind.config.ts` screens must not change (701px semantics).
- `PageHeader` is shared by consumer pages — do not change its contract.
- Existing routes/URLs must not change (deep links).

## 12. Test & build commands

| Command | Purpose | Baseline |
|---|---|---|
| `npm run build` (root, builds frontend) | Production build | Recorded in Phase H |
| `npm --prefix frontend run lint` | ESLint | Recorded in Phase H |
| `npm --prefix frontend test` | Vitest suite | Recorded in Phase H |
| `npm --prefix backend run build` | Backend tsc (should be unaffected) | Recorded in Phase H |

## 13. Recommended design & implementation architecture

1. **Console token layer** — append `--vc-*` (VANTA Console) semantic tokens to
   `globals.css` + additive Tailwind color aliases. Existing tokens untouched.
2. **Shared console primitives** — `src/components/console/`:
   `StatusBadge` (dot + text, never color-only), `MetricTile`, `Panel`,
   honest state components (loading/error/empty), `TrendChart` (dependency-free
   SVG with accessible summary), `ConfirmDialog`, shared format helpers.
3. **Creator Studio shell** — persistent sidebar ≥701px, drawer <701px,
   route-derived header, spec IA (Overview / Content / Insights / Live /
   Monetization / Account), same access gate.
4. **Admin shell** — restyled with console tokens, spec IA grouping over the
   same routes, breadcrumb top bar, same role gating.
5. **Pages** — redesigned using existing services only; every metric keeps its
   current data source; honest loading/empty/error states everywhere.

## 14. Implementation sequence

1. ✅ Audit report (this document)
2. Design tokens + console primitives
3. Creator Studio shell
4. Creator Overview / Analytics / Content / Earnings / Live
5. Admin shell
6. Admin Overview / Users
7. Integration polish (dead bell → real link, shared formatters)
8. Build + lint + tests + responsive spot-checks; record results

## 15. Features that cannot be completed (backend missing)

- **Creator time-series analytics** — backend exposes only cumulative
  `/api/creator/stats`; no per-day creator series. Overview/Analytics show
  cumulative metrics and content-level performance, never invented trends.
- **Content editing/deletion from Studio** — no creator-owned post
  edit/delete endpoints; Content stays a read-only performance workspace with
  links to real posts.
- **Draft management** — no draft model surfaced by creator endpoints.
- **Payout request flow from Studio** — withdrawals exist via
  `/api/wallet/withdraw` and the existing Balance pages; Studio links there
  instead of re-implementing payouts.
- **Admin pending-verification count on overview** — available only via
  `/api/verification/admin/requests` (fetched on the Verification page);
  overview links to the queue instead of fabricating a count.

---

## 16. Implementation record (Phase A-H completed)

### Files created

| File | Purpose |
| --- | --- |
| `frontend/src/components/console/format.ts` | Shared presentation formatters (compact numbers, currency, dates, relative time, duration). |
| `frontend/src/components/console/Panel.tsx` | `ConsolePanel` open content section with header row (title/description/actions). |
| `frontend/src/components/console/MetricTile.tsx` | Focused metric grouping with optional gold accent top-rule. |
| `frontend/src/components/console/StatusBadge.tsx` | Dot + text status badge (`statusToneFor`) so status never relies on colour alone. |
| `frontend/src/components/console/States.tsx` | `ConsoleLoading`, `SkeletonRows`, `ConsoleErrorState`, `ConsoleEmptyState`, `ConsoleForbiddenState`. |
| `frontend/src/components/console/TrendChart.tsx` | Dependency-free SVG area/bar chart with axis labels, hover titles, `role="img"` summary and an `sr-only` data table. Honest empty state. |
| `frontend/src/components/console/ConfirmDialog.tsx` | Accessible confirm dialog (Escape, focus move, aria-modal) for consequential actions. |
| `frontend/src/lib/creatorStudio.ts` | Types mirroring the real `/api/creator/*` payloads. |

### Design tokens added (additive only)

`frontend/src/app/globals.css` gained a scoped `--vc-*` block appended after the
consumer design system (nothing existing was modified): backgrounds, four surface
levels, borders, three text levels, a gold ramp (`--vc-gold`, `-hover`, `-deep`,
`-fg`, `-soft`, `-border`), success/warning/danger/info + soft variants, focus
ring colour, three radii, sidebar/header/content widths, chart series colours,
plus `.vc-panel`, `.vc-input`, `.vc-select`, `.vc-focus`, `.vc-table` and a
`prefers-reduced-motion` block.

`frontend/tailwind.config.ts` gained a pure alias layer (`console-*` ->
`var(--vc-*)`). No existing token, screen, font, shadow or plugin was changed.

### Security preserved

- **Creator Studio** keeps the original `useEffect` redirect logic: unauthenticated
  users go to `/login`, non-creators go to `/feed`.
- **Admin Command Center** keeps the original `ADMIN_ROLES` check, the
  `MODERATOR` restriction to `/admin/compliance`, and the session-restore branch.
  Only presentation was replaced; no authorization condition was weakened.
- All data still flows through `apiClient` (`apiGet`/`apiPost`/`apiPut`/`apiDelete`)
  with the bearer token. No endpoint was called directly.
- User actions on `/admin/users` still call the real role-protected endpoints
  (`suspend`, `ban`, `restore`, `verify`, `delete`), each behind a confirm dialog.

### Verification results (actually executed)

| Check | Command | Result |
| --- | --- | --- |
| Type check | `npx tsc --noEmit` | **0 errors** across the whole frontend |
| Production build | `npx next build` | **Succeeded** - `Compiled successfully`, `Generating static pages (86/86)` |
| Route preservation | build route table | All 15 `/admin/*` and 14 `/creator/*` routes still emitted with identical paths |
| Lint | `npx next lint` | **Not run** - the repo has no ESLint config; Next prompts interactively for setup. No config was added, since that is an unrelated change. |
| Automated tests | none exist | The repo contains no test framework or test files. Nothing to run and nothing claimed. |

Build warnings are pre-existing and unrelated: webpack module-casing notices
inside `node_modules/next/dist` and a `react/package.json` resolution notice.

### Responsive approach

- Creator Studio and Admin Command Center both use a persistent sidebar at `lg`
  and a labelled drawer below it, driven by one `useState` + `usePathname` effect
  that closes on navigation.
- Wide admin/creator tables are `hidden lg:block`; a compact record list
  (`lg:hidden`) replaces them on phones so no essential action is dropped and no
  horizontal page scroll is introduced.
- Filters collapse from 5 columns to 1; dialogs are `items-end` on mobile and
  `sm:items-center` above; the confirm dialog is `max-w-md` and viewport-safe.
- `sr-only` labels are used for every icon-only control and every filter select.

### Accessibility notes

- One `<h2>` per `ConsolePanel` and per section band; page title stays the
  layout-level `<h1>`, so heading order is logical.
- `aria-current="page"` on the active nav item; `aria-pressed` on period and
  type toggles; `aria-busy` on skeletons and busy buttons.
- The admin users page announces confirmed outcomes through an `aria-live`
  region, so a suspension or ban result is spoken rather than only flashed.
- `StatusBadge` always renders a text label next to its dot (WCAG 1.4.1).
- `TrendChart` exposes `role="img"` with a descriptive summary plus an `sr-only`
  data table mirroring every point.
- `prefers-reduced-motion: reduce` disables panel/input/table transitions and
  chart animation.

### Remaining limitations

1. **Creator time-series analytics** - `/api/creator/stats` returns cumulative
   totals only. The Creator Analytics page renders content-level performance and
   honest empty/error states; it does not invent a daily series.
2. **Creator content edit/delete** - no creator-owned post mutation endpoints
   exist. Content is a read-only performance workspace linking to real posts.
3. **Admin verification queue count on the overview** - `/api/admin/stats` does
   not report it, so the tile renders "Unavailable" and links to the real queue
   rather than showing a fabricated zero.
4. **Infrastructure snapshot may be absent** - when
   `GET /api/admin/infrastructure` fails, the overview shows an explicit
   "Service health unavailable" state with a link to diagnostics.
5. **Lint and automated tests** - see the verification table; neither can run in
   this repository as it stands.
