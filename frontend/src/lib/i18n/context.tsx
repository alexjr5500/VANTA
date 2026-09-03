'use client';

// =============================================================================
// VANTA i18n Context and Hook
// Provides localization throughout the app with dynamic language switching
// =============================================================================

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { Locale } from './config';
import { defaultLocale } from './config';
import { detectLocale, storeLocale, detectTimezone, storeTimezone } from './locale-detection';
import type { TranslationKeys } from './types';
import enDefaultTranslations from './translations/en.json';

type TranslationValue = string | { [key: string]: TranslationValue };

interface I18nContextType {
  locale: Locale;
  direction: 'ltr' | 'rtl';
  isLoading: boolean;
  setLocale: (locale: Locale) => Promise<void>;
  t: (path: string, params?: Record<string, string | number>) => string;
  formatDate: (date: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatTime: (date: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatDateTime: (date: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatCompactNumber: (value: number) => string;
  formatCurrency: (value: number, currency: string, options?: Intl.NumberFormatOptions) => string;
  formatRelativeTime: (date: Date | string | number) => string;
  formatDuration: (seconds: number) => string;
  timezone: string;
  isRTL: boolean;
}

const I18nContext = createContext<I18nContextType | null>(null);

// Cache loaded translations (used for dynamic imports beyond default locale)
const translationCache = new Map<string, TranslationKeys>();
// Pre-populate cache with default locale so SSR and first client render match
translationCache.set('en', enDefaultTranslations as unknown as TranslationKeys);

function resolveNestedValue(obj: TranslationKeys | TranslationValue, path: string): string | null {
  const keys = path.split('.');
  let current: TranslationValue | undefined = obj as TranslationValue;

  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return null;
    }
    current = (current as Record<string, TranslationValue>)[key];
  }

  if (typeof current === 'string') {
    return current;
  }

  return null;
}

function interpolateTemplate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = params[key];
    return value !== undefined ? String(value) : match;
  });
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);
  // Initialize with pre-loaded English translations so SSR and first client render match
  const [translations, setTranslations] = useState<TranslationKeys>(enDefaultTranslations as unknown as TranslationKeys);
  const [isLoading, setIsLoading] = useState(true);
  const [timezone, setTimezone] = useState('UTC');
  const mountedRef = useRef(true);

  const direction = locale === 'ar' || locale === 'ur' ? 'rtl' : 'ltr';
  const isRTL = direction === 'rtl';

  // Load translations for a locale
  const loadTranslations = useCallback(async (localeCode: Locale) => {
    // Check cache first
    if (translationCache.has(localeCode)) {
      return translationCache.get(localeCode)!;
    }

    try {
      // Dynamic import of translation JSON
      const translations = await import(`./translations/${localeCode}.json`);
      translationCache.set(localeCode, translations.default || translations);
      return translationCache.get(localeCode)!;
    } catch {
      // Fallback to English
      console.warn(`Failed to load translations for ${localeCode}, falling back to English`);
      if (!translationCache.has('en')) {
        const enTranslations = await import('./translations/en.json');
        translationCache.set('en', enTranslations.default || enTranslations);
      }
      return translationCache.get('en')!;
    }
  }, []);

  // Set locale and load its translations
  const setLocale = useCallback(async (newLocale: Locale) => {
    setIsLoading(true);
    const translations = await loadTranslations(newLocale);
    if (mountedRef.current) {
      setTranslations(translations);
      setLocaleState(newLocale);
      storeLocale(newLocale);
      // Update html attributes — only runs on client after hydration, safe here
      document.documentElement.lang = newLocale;
      document.documentElement.dir = newLocale === 'ar' || newLocale === 'ur' ? 'rtl' : 'ltr';
      setIsLoading(false);
    }
  }, [loadTranslations]);

  // Translate a key with optional parameters
  const t = useCallback((path: string, params?: Record<string, string | number>): string => {
    if (!translations) return path;

    const value = resolveNestedValue(translations, path);
    if (value === null) {
      console.warn(`Missing translation key: ${path}`);
      return path;
    }

    return interpolateTemplate(value, params);
  }, [translations]);

  // Locale-aware formatters
  const formatDate = useCallback((date: Date | string | number, options?: Intl.DateTimeFormatOptions) => {
    const d = new Date(date);
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : locale === 'zh' ? 'zh-CN' : locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: timezone,
      ...options,
    }).format(d);
  }, [locale, timezone]);

  const formatTime = useCallback((date: Date | string | number, options?: Intl.DateTimeFormatOptions) => {
    const d = new Date(date);
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : locale === 'zh' ? 'zh-CN' : locale, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
      ...options,
    }).format(d);
  }, [locale, timezone]);

  const formatDateTime = useCallback((date: Date | string | number, options?: Intl.DateTimeFormatOptions) => {
    const d = new Date(date);
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : locale === 'zh' ? 'zh-CN' : locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
      ...options,
    }).format(d);
  }, [locale, timezone]);

  const formatNumber = useCallback((value: number, options?: Intl.NumberFormatOptions) => {
    return new Intl.NumberFormat(locale === 'en' ? 'en-US' : locale === 'zh' ? 'zh-CN' : locale, options).format(value);
  }, [locale]);

  const formatCompactNumber = useCallback((value: number) => {
    return new Intl.NumberFormat(locale === 'en' ? 'en-US' : locale === 'zh' ? 'zh-CN' : locale, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  }, [locale]);

  const formatCurrency = useCallback((value: number, currency: string, options?: Intl.NumberFormatOptions) => {
    return new Intl.NumberFormat(locale === 'en' ? 'en-US' : locale === 'zh' ? 'zh-CN' : locale, {
      style: 'currency',
      currency,
      ...options,
    }).format(value);
  }, [locale]);

  const formatRelativeTime = useCallback((date: Date | string | number): string => {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const seconds = Math.floor(Math.abs(diffMs) / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return t('common.justNow');
    if (minutes < 60) {
      return minutes === 1 ? t('common.minuteAgo') : t('common.minutesAgo', { value: minutes });
    }
    if (hours < 24) {
      return hours === 1 ? t('common.hourAgo') : t('common.hoursAgo', { value: hours });
    }
    if (days < 7) {
      return days === 1 ? t('common.dayAgo') : t('common.daysAgo', { value: days });
    }
    return formatDate(d);
  }, [t, formatDate]);

  const formatDuration = useCallback((seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${formatNumber(h)}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${formatNumber(m)}:${String(s).padStart(2, '0')}`;
  }, [formatNumber]);

  // Initialize locale on mount
  useEffect(() => {
    mountedRef.current = true;

    async function init() {
      const detected = await detectLocale();
      const tz = detectTimezone();

      setTimezone(tz);
      storeTimezone(tz);

      await setLocale(detected);
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }

    init();

    return () => {
      mountedRef.current = false;
    };
  }, [setLocale]);

  const value: I18nContextType = {
    locale,
    direction,
    isLoading,
    setLocale,
    t,
    formatDate,
    formatTime,
    formatDateTime,
    formatNumber,
    formatCompactNumber,
    formatCurrency,
    formatRelativeTime,
    formatDuration,
    timezone,
    isRTL,
  };

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextType {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}

export { I18nContext };