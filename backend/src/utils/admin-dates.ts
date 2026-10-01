/**
 * Consistent, timezone-aware date ranges for the Admin area.
 *
 * Every admin metric that uses "today", "this week", "this month" or "this year"
 * MUST derive its boundaries from this module so the same instant means the same
 * thing everywhere (dashboard cards, user growth, active users, finance, ...).
 *
 * The database stores UTC timestamps. Admin boundaries are computed in a fixed
 * local timezone (default: Africa/Lagos, UTC+1) so that a "day" is the same
 * calendar day for the administrators regardless of the server's own timezone.
 * Override with ADMIN_TZ_OFFSET_MINUTES (e.g. 60 for UTC+1, 0 for UTC).
 */

const DEFAULT_TZ_OFFSET_MINUTES = 60; // Africa/Lagos (UTC+1)

function tzOffsetMinutes(): number {
  const raw = process.env.ADMIN_TZ_OFFSET_MINUTES;
  if (!raw) return DEFAULT_TZ_OFFSET_MINUTES;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_TZ_OFFSET_MINUTES;
}

/** Current instant shifted into the admin timezone (as a UTC Date). */
export function adminNow(): Date {
  return new Date(Date.now() + tzOffsetMinutes() * 60_000);
}

/** Convert an admin-tz wall-clock time back to a real UTC Date. */
function fromAdminWallClock(date: Date): Date {
  return new Date(date.getTime() - tzOffsetMinutes() * 60_000);
}

/** Start of the current day in the admin timezone (as a real UTC Date). */
export function startOfToday(): Date {
  const now = adminNow();
  const wall = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return fromAdminWallClock(wall);
}

/**
 * Start of the current week in the admin timezone.
 * Weeks start on Monday (ISO-8601) — a single, documented rule.
 */
export function startOfThisWeek(): Date {
  const now = adminNow();
  const day = now.getDay(); // 0 = Sunday
  const daysSinceMonday = (day + 6) % 7;
  const wall = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
  return fromAdminWallClock(wall);
}

/** Start of the current month in the admin timezone. */
export function startOfThisMonth(): Date {
  const now = adminNow();
  const wall = new Date(now.getFullYear(), now.getMonth(), 1);
  return fromAdminWallClock(wall);
}

/** Start of the current year in the admin timezone. */
export function startOfThisYear(): Date {
  const now = adminNow();
  const wall = new Date(now.getFullYear(), 0, 1);
  return fromAdminWallClock(wall);
}

/** Start of the day `n` days ago in the admin timezone (n=0 is today). */
export function startOfDaysAgo(n: number): Date {
  const now = adminNow();
  const wall = new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
  return fromAdminWallClock(wall);
}

/** Start of the month `n` months ago in the admin timezone (n=0 is this month). */
export function startOfMonthsAgo(n: number): Date {
  const now = adminNow();
  const wall = new Date(now.getFullYear(), now.getMonth() - n, 1);
  return fromAdminWallClock(wall);
}

/**
 * Build `days` daily buckets ending today, each labelled with a local calendar
 * date (YYYY-MM-DD). Used by the user-growth chart.
 */
export function dailyBuckets(days: number): { start: Date; end: Date; label: string }[] {
  const buckets: { start: Date; end: Date; label: string }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = startOfDaysAgo(i);
    const end = new Date(start.getTime() + 86_400_000);
    const wall = adminNow();
    // Label in the admin timezone using local calendar parts of the shifted date.
    const shifted = new Date(start.getTime() + tzOffsetMinutes() * 60_000);
    const label = `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}-${String(shifted.getDate()).padStart(2, '0')}`;
    buckets.push({ start, end, label });
    void wall;
  }
  return buckets;
}

/**
 * Build `months` monthly buckets ending this month, each labelled YYYY-MM.
 */
export function monthlyBuckets(months: number): { start: Date; end: Date; label: string }[] {
  const buckets: { start: Date; end: Date; label: string }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const start = startOfMonthsAgo(i);
    const next = startOfMonthsAgo(i - 1);
    const shifted = new Date(start.getTime() + tzOffsetMinutes() * 60_000);
    const label = `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}`;
    buckets.push({ start, end: next, label });
  }
  return buckets;
}

/** Human-readable label for a range (used in the admin UI). */
export function rangeLabel(range: 'today' | 'week' | 'month' | 'year'): string {
  switch (range) {
    case 'today': return 'Today';
    case 'week': return 'This week';
    case 'month': return 'This month';
    case 'year': return 'This year';
  }
}