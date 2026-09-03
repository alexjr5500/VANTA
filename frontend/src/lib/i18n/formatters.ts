// =============================================================================
// VANTA Locale-Aware Formatters
// Dates, times, numbers, currencies, and relative time formatting
// Always use these utilities instead of raw Intl or Date methods
// =============================================================================

import {
  type Locale,
  intlLocaleMap,
  numberLocaleMap,
  currencyLocaleMap,
  localeTimezones,
} from './config';

/**
 * Format a date according to the user's locale
 */
export function formatDate(
  date: Date | string | number,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = {}
): string {
  const d = toDate(date);
  const localeCode = intlLocaleMap[locale];
  try {
    return new Intl.DateTimeFormat(localeCode, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      ...options,
    }).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

/**
 * Format a time according to the user's locale
 */
export function formatTime(
  date: Date | string | number,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = {}
): string {
  const d = toDate(date);
  const localeCode = intlLocaleMap[locale];
  try {
    return new Intl.DateTimeFormat(localeCode, {
      hour: '2-digit',
      minute: '2-digit',
      ...options,
    }).format(d);
  } catch {
    return d.toLocaleTimeString();
  }
}

/**
 * Format a date and time together
 */
export function formatDateTime(
  date: Date | string | number,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = {}
): string {
  const d = toDate(date);
  const localeCode = intlLocaleMap[locale];
  try {
    return new Intl.DateTimeFormat(localeCode, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      ...options,
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

/**
 * Format a date as "Today", "Yesterday", or the formatted date
 */
export function formatDateRelative(
  date: Date | string | number,
  locale: Locale
): string {
  const d = toDate(date);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today'; // Translation key
  if (diffDays === 1) return 'yesterday';
  if (diffDays === -1) return 'tomorrow';
  if (diffDays < 7) return formatDate(d, locale, { weekday: 'long' });
  return formatDate(d, locale);
}

/**
 * Format a relative time string (e.g., "3 minutes ago")
 */
export function formatRelativeTime(
  date: Date | string | number,
  locale: Locale,
  now: Date = new Date()
): { value: number; unit: Intl.RelativeTimeFormatUnit; key: string } {
  const d = toDate(date);
  const diffMs = now.getTime() - d.getTime();
  const absDiffMs = Math.abs(diffMs);
  const seconds = Math.floor(absDiffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (seconds < 60) return { value: seconds, unit: 'second', key: 'justNow' };
  if (minutes < 60) return { value: minutes, unit: 'minute', key: minutes === 1 ? 'minuteAgo' : 'minutesAgo' };
  if (hours < 24) return { value: hours, unit: 'hour', key: hours === 1 ? 'hourAgo' : 'hoursAgo' };
  if (days < 7) return { value: days, unit: 'day', key: days === 1 ? 'dayAgo' : 'daysAgo' };
  if (weeks < 5) return { value: weeks, unit: 'week', key: weeks === 1 ? 'weekAgo' : 'weeksAgo' };
  if (months < 12) return { value: months, unit: 'month', key: months === 1 ? 'monthAgo' : 'monthsAgo' };
  return { value: years, unit: 'year', key: years === 1 ? 'yearAgo' : 'yearsAgo' };
}

/**
 * Format a number according to the user's locale
 */
export function formatNumber(
  value: number,
  locale: Locale,
  options: Intl.NumberFormatOptions = {}
): string {
  const localeCode = numberLocaleMap[locale];
  try {
    return new Intl.NumberFormat(localeCode, options).format(value);
  } catch {
    return value.toLocaleString();
  }
}

/**
 * Format a number with compact notation (e.g., 1.5M, 2.3K)
 */
export function formatCompactNumber(
  value: number,
  locale: Locale
): string {
  const localeCode = numberLocaleMap[locale];
  try {
    return new Intl.NumberFormat(localeCode, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return value.toString();
  }
}

/**
 * Format a percentage
 */
export function formatPercent(
  value: number,
  locale: Locale,
  fractionDigits: number = 1
): string {
  const localeCode = numberLocaleMap[locale];
  try {
    return new Intl.NumberFormat(localeCode, {
      style: 'percent',
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value / 100);
  } catch {
    return `${value.toFixed(fractionDigits)}%`;
  }
}

/**
 * Format a currency amount
 */
export function formatCurrency(
  value: number,
  currency: string,
  locale: Locale,
  options: Intl.NumberFormatOptions = {}
): string {
  const localeCode = currencyLocaleMap[locale] || numberLocaleMap[locale];
  try {
    return new Intl.NumberFormat(localeCode, {
      style: 'currency',
      currency: currency,
      ...options,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

/**
 * Format VANTA coin amounts with no fractional part.
 */
export function formatVantaCoins(
  amount: number,
  locale: Locale
): string {
  return formatNumber(amount, locale, { maximumFractionDigits: 0 });
}

/**
 * Format a phone number in E.164 or localized format
 */
export function formatPhoneNumber(
  phone: string,
  locale: Locale
): string {
  // Remove non-digit characters
  const digits = phone.replace(/\D/g, '');
  
  // Simple formatting based on common patterns
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  // International format
  return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 11)}`;
}

/**
 * Convert a Date to the user's timezone
 */
export function toTimezone(
  date: Date | string | number,
  timezone: string
): Date {
  const d = toDate(date);
  return d; // Date objects are timezone-agnostic, formatting handles display
}

/**
 * Get the user's timezone offset string for display
 */
export function getTimezoneOffset(timezone: string): string {
  const now = new Date();
  try {
    const formatter = new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    });
    const parts = formatter.formatToParts(now);
    const offsetPart = parts.find(p => p.type === 'timeZoneName');
    return offsetPart?.value || '';
  } catch {
    return '';
  }
}

/**
 * Format a duration in seconds to a human-readable string
 */
export function formatDuration(
  seconds: number,
  locale: Locale
): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${formatNumber(h, locale)}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${formatNumber(m, locale)}:${String(s).padStart(2, '0')}`;
}

/**
 * Format file size in bytes to human-readable
 */
export function formatFileSize(
  bytes: number,
  locale: Locale
): string {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${formatNumber(size, locale, {
    maximumFractionDigits: unitIndex > 0 ? 1 : 0,
  })} ${units[unitIndex]}`;
}

/**
 * Format a date for API/backend (always ISO 8601 in UTC)
 */
export function toISOString(date: Date | string | number): string {
  return toDate(date).toISOString();
}

/**
 * Parse a string into a Date safely
 */
function toDate(date: Date | string | number): Date {
  if (date instanceof Date) return date;
  if (typeof date === 'number') return new Date(date);
  return new Date(date);
}

/**
 * Get current date in UTC
 */
export function nowUTC(): Date {
  return new Date();
}

/**
 * Format a date to UTC ISO string for storage
 * Always store dates in UTC
 */
export function toUTCStorage(date: Date | string | number): string {
  return toDate(date).toISOString();
}

/**
 * Common date format presets
 */
export const datePresets = {
  short: { month: 'numeric', day: 'numeric' } as Intl.DateTimeFormatOptions,
  medium: { year: 'numeric', month: 'short', day: 'numeric' } as Intl.DateTimeFormatOptions,
  long: { year: 'numeric', month: 'long', day: 'numeric' } as Intl.DateTimeFormatOptions,
  full: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' } as Intl.DateTimeFormatOptions,
  time: { hour: '2-digit', minute: '2-digit' } as Intl.DateTimeFormatOptions,
  timeWithSeconds: { hour: '2-digit', minute: '2-digit', second: '2-digit' } as Intl.DateTimeFormatOptions,
  dateTime: { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } as Intl.DateTimeFormatOptions,
  dateTimeFull: { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } as Intl.DateTimeFormatOptions,
  isoDate: { year: 'numeric', month: '2-digit', day: '2-digit' } as Intl.DateTimeFormatOptions,
  isoDateTime: { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false } as Intl.DateTimeFormatOptions,
};