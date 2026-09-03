// =============================================================================
// VANTA Locale Detection
// Automatically detects user's locale from multiple signals
// =============================================================================

import { type Locale, locales, defaultLocale, isValidLocale } from './config';

const LOCALE_STORAGE_KEY = 'vanta-locale';
const TIMEZONE_STORAGE_KEY = 'vanta-timezone';

/**
 * Get the user's preferred locale by checking multiple sources in order:
 * 1. Explicit user preference (stored)
 * 2. Browser/device language
 * 3. Geolocation (IP-based, optional)
 * 4. Default locale
 */
export async function detectLocale(): Promise<Locale> {
  // 1. Check stored preference first
  const stored = getStoredLocale();
  if (stored && isValidLocale(stored)) {
    return stored;
  }

  // 2. Check browser languages
  const browser = detectBrowserLocale();
  if (browser) return browser;

  // 3. Fallback to default
  return defaultLocale;
}

/**
 * Detect locale from browser/device settings
 */
export function detectBrowserLocale(): Locale | null {
  if (typeof window === 'undefined') return null;

  // Get browser languages (navigator.languages returns preferred order)
  const languages = navigator.languages || [navigator.language];

  for (const lang of languages) {
    // Try exact match first (e.g., 'en', 'fr')
    if (isValidLocale(lang)) {
      return lang as Locale;
    }

    // Try matching base language (e.g., 'en-US' -> 'en')
    const base = lang.split('-')[0];
    const match = locales.find(l => l === base || l.startsWith(base + '-'));
    if (match) return match;
  }

  return null;
}

/**
 * Store the user's locale preference
 */
export function storeLocale(locale: Locale): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    // Also set a cookie for server-side detection
    document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=${365 * 24 * 60 * 60}; SameSite=Lax`;
  } catch {
    // localStorage might not be available
  }
}

/**
 * Get the stored locale preference
 */
export function getStoredLocale(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Detect user's timezone
 */
export function detectTimezone(): string {
  if (typeof window === 'undefined') return 'UTC';
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/**
 * Store timezone preference
 */
export function storeTimezone(timezone: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(TIMEZONE_STORAGE_KEY, timezone);
  } catch {
    // localStorage might not be available
  }
}

/**
 * Get stored timezone
 */
export function getStoredTimezone(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(TIMEZONE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Get the user's locale from cookie (for server-side)
 */
export function getLocaleFromCookie(): Locale | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/NEXT_LOCALE=([^;]+)/);
  if (match && isValidLocale(match[1])) {
    return match[1] as Locale;
  }
  return null;
}

/**
 * Get all available locales with their display names for a locale selector
 */
export function getLocaleOptions(currentLocale: Locale) {
  const { localeNames } = require('./config');
  return locales.map(code => ({
    code,
    name: localeNames[code as Locale],
    isCurrent: code === currentLocale,
    direction: code === 'ar' || code === 'ur' ? 'rtl' as const : 'ltr' as const,
  }));
}

/**
 * Extract locale from a URL path (locale-prefixed routes)
 */
export function extractLocaleFromPath(path: string): Locale | null {
  const segments = path.split('/').filter(Boolean);
  if (segments.length > 0 && isValidLocale(segments[0])) {
    return segments[0] as Locale;
  }
  return null;
}