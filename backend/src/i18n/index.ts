// =============================================================================
// VANTA Backend Localization Module
// Server-side i18n support, locale detection, and translation management
// =============================================================================

import { Router, Request, Response, NextFunction } from 'express';

// Supported locales
export const SUPPORTED_LOCALES = [
  'en', 'fr', 'es', 'pt', 'ar', 'de', 'it', 'tr', 'ru',
  'hi', 'ur', 'bn', 'id', 'vi', 'th', 'zh', 'zh-TW', 'ja', 'ko',
] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

// RTL locales
export const RTL_LOCALES: Locale[] = ['ar', 'ur'];

// Locale display names
export const LOCALE_NAMES: Record<Locale, string> = {
  'en': 'English',
  'fr': 'Français',
  'es': 'Español',
  'pt': 'Português',
  'ar': 'العربية',
  'de': 'Deutsch',
  'it': 'Italiano',
  'tr': 'Türkçe',
  'ru': 'Русский',
  'hi': 'हिन्दी',
  'ur': 'اردو',
  'bn': 'বাংলা',
  'id': 'Bahasa Indonesia',
  'vi': 'Tiếng Việt',
  'th': 'ไทย',
  'zh': '中文 (简体)',
  'zh-TW': '中文 (繁體)',
  'ja': '日本語',
  'ko': '한국어',
};

// Default timezones by locale
export const LOCALE_TIMEZONES: Record<Locale, string> = {
  'en': 'America/New_York',
  'fr': 'Europe/Paris',
  'es': 'Europe/Madrid',
  'pt': 'America/Sao_Paulo',
  'ar': 'Asia/Riyadh',
  'de': 'Europe/Berlin',
  'it': 'Europe/Rome',
  'tr': 'Europe/Istanbul',
  'ru': 'Europe/Moscow',
  'hi': 'Asia/Kolkata',
  'ur': 'Asia/Karachi',
  'bn': 'Asia/Dhaka',
  'id': 'Asia/Jakarta',
  'vi': 'Asia/Ho_Chi_Minh',
  'th': 'Asia/Bangkok',
  'zh': 'Asia/Shanghai',
  'zh-TW': 'Asia/Taipei',
  'ja': 'Asia/Tokyo',
  'ko': 'Asia/Seoul',
};

// Supported currencies with locale mapping
export const SUPPORTED_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'NGN', 'INR', 'BRL', 'CAD', 'AUD',
  'JPY', 'KRW', 'AED', 'SAR', 'CHF', 'CNY', 'TRY', 'RUB',
] as const;

export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

// Default currency by locale
export const LOCALE_CURRENCIES: Record<Locale, Currency> = {
  'en': 'USD',
  'fr': 'EUR',
  'es': 'EUR',
  'pt': 'BRL',
  'ar': 'SAR',
  'de': 'EUR',
  'it': 'EUR',
  'tr': 'TRY',
  'ru': 'RUB',
  'hi': 'INR',
  'ur': 'PKR' as Currency || 'INR',
  'bn': 'BDT' as Currency || 'INR',
  'id': 'IDR' as Currency || 'USD',
  'vi': 'VND' as Currency || 'USD',
  'th': 'THB' as Currency || 'USD',
  'zh': 'CNY',
  'zh-TW': 'TWD' as Currency || 'CNY',
  'ja': 'JPY',
  'ko': 'KRW',
};

// Currency exchange rates (base: USD, updated periodically)
// In production, fetch from an exchange rate API
export const EXCHANGE_RATES: Record<string, number> = {
  'USD': 1,
  'EUR': 0.92,
  'GBP': 0.79,
  'NGN': 1550,
  'INR': 83.5,
  'BRL': 5.05,
  'CAD': 1.36,
  'AUD': 1.53,
  'JPY': 149.5,
  'KRW': 1320,
  'AED': 3.67,
  'SAR': 3.75,
  'CHF': 0.88,
  'CNY': 7.24,
  'TRY': 30.5,
  'RUB': 92.0,
};

// Timezone list for validation
export const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'America/Mexico_City',
  'America/Argentina/Buenos_Aires',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Europe/Istanbul',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Jakarta',
  'Asia/Ho_Chi_Minh',
  'Asia/Karachi',
  'Africa/Lagos',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
];

// =============================================================================
// Locale Detection Middleware
// =============================================================================

declare global {
  namespace Express {
    interface Request {
      locale: Locale;
      timezone: string;
      currency: Currency;
    }
  }
}

export function localeMiddleware(req: Request, res: Response, next: NextFunction) {
  // Detect locale from multiple sources in order:
  // 1. Cookie
  // 2. Accept-Language header
  // 3. Query parameter
  // 4. Default
  
  const cookieLocale = req.cookies?.NEXT_LOCALE;
  const headerLocale = parseAcceptLanguage(req.headers['accept-language'] as string);
  const queryLocale = req.query.lang as string;

  const detected = cookieLocale || queryLocale || headerLocale || DEFAULT_LOCALE;
  req.locale = SUPPORTED_LOCALES.includes(detected as Locale) 
    ? detected as Locale 
    : DEFAULT_LOCALE;

  // Detect timezone
  req.timezone = req.headers['x-timezone'] as string || 
    req.cookies?.['vanta-timezone'] || 
    LOCALE_TIMEZONES[req.locale] || 
    'UTC';

  // Detect currency
  req.currency = LOCALE_CURRENCIES[req.locale] || 'USD';

  next();
}

function parseAcceptLanguage(header?: string): Locale | null {
  if (!header) return null;
  
  const languages = header.split(',').map(lang => {
    const [locale, quality = '1'] = lang.trim().split(';q=');
    return { locale: locale.split('-')[0], quality: parseFloat(quality) || 1 };
  }).sort((a, b) => b.quality - a.quality);

  for (const { locale } of languages) {
    const match = SUPPORTED_LOCALES.find(l => l === locale || l.startsWith(locale + '-'));
    if (match) return match;
  }

  return null;
}

// =============================================================================
// Translation Management API
// =============================================================================

export function createI18nRouter(): Router {
  const router = Router();

  // Get supported locales
  router.get('/api/i18n/locales', (req: Request, res: Response) => {
    res.json({
      locales: SUPPORTED_LOCALES.map(code => ({
        code,
        name: LOCALE_NAMES[code as Locale],
        isRTL: RTL_LOCALES.includes(code as Locale),
        timezone: LOCALE_TIMEZONES[code as Locale],
        currency: LOCALE_CURRENCIES[code as Locale],
      })),
      defaultLocale: DEFAULT_LOCALE,
    });
  });

  // Get current locale info
  router.get('/api/i18n/locale', (req: Request, res: Response) => {
    res.json({
      locale: req.locale,
      timezone: req.timezone,
      currency: req.currency,
      direction: RTL_LOCALES.includes(req.locale) ? 'rtl' : 'ltr',
      localeName: LOCALE_NAMES[req.locale],
    });
  });

  // Get exchange rates
  router.get('/api/i18n/exchange-rates', (req: Request, res: Response) => {
    res.json({
      base: 'USD',
      rates: EXCHANGE_RATES,
      updatedAt: new Date().toISOString(),
    });
  });

  // Convert currency
  router.post('/api/i18n/convert', (req: Request, res: Response) => {
    const { amount, from, to } = req.body;
    
    if (!amount || !from || !to) {
      return res.status(400).json({ error: 'Missing required fields: amount, from, to' });
    }

    const fromRate = EXCHANGE_RATES[from];
    const toRate = EXCHANGE_RATES[to];

    if (!fromRate || !toRate) {
      return res.status(400).json({ error: 'Unsupported currency' });
    }

    const usdAmount = amount / fromRate;
    const convertedAmount = usdAmount * toRate;

    res.json({
      amount: parseFloat(convertedAmount.toFixed(2)),
      from,
      to,
      rate: parseFloat((toRate / fromRate).toFixed(6)),
      timestamp: new Date().toISOString(),
    });
  });

  // Get timezone info
  router.post('/api/i18n/timezone', (req: Request, res: Response) => {
    const { timezone } = req.body;
    
    if (!timezone) {
      return res.status(400).json({ error: 'Timezone is required' });
    }

    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en', {
        timeZone: timezone,
        timeZoneName: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
      
      const parts = formatter.formatToParts(now);
      const timeStr = parts.map(p => p.value).join('');
      const tzName = parts.find(p => p.type === 'timeZoneName')?.value || timezone;

      const offsetFormatter = new Intl.DateTimeFormat('en', {
        timeZone: timezone,
        timeZoneName: 'longOffset',
      });
      const offsetParts = offsetFormatter.formatToParts(now);
      const offset = offsetParts.find(p => p.type === 'timeZoneName')?.value || '';

      res.json({
        timezone,
        currentTime: timeStr,
        offset,
        abbreviation: tzName,
        timestamp: now.toISOString(),
      });
    } catch {
      res.status(400).json({ error: 'Invalid timezone' });
    }
  });

  // Get common timezones
  router.get('/api/i18n/timezones', (req: Request, res: Response) => {
    res.json({
      timezones: COMMON_TIMEZONES,
    });
  });

  return router;
}

// =============================================================================
// Currency Formatting Utilities
// =============================================================================

export function formatCurrency(
  amount: number,
  currency: Currency,
  locale: Locale = DEFAULT_LOCALE
): string {
  try {
    const localeMap: Record<string, string> = {
      'en': 'en-US', 'fr': 'fr-FR', 'es': 'es-ES', 'pt': 'pt-BR',
      'ar': 'ar-SA', 'de': 'de-DE', 'it': 'it-IT', 'tr': 'tr-TR',
      'ru': 'ru-RU', 'hi': 'hi-IN', 'ur': 'ur-PK', 'bn': 'bn-BD',
      'id': 'id-ID', 'vi': 'vi-VN', 'th': 'th-TH', 'zh': 'zh-CN',
      'zh-TW': 'zh-TW', 'ja': 'ja-JP', 'ko': 'ko-KR',
    };
    
    return new Intl.NumberFormat(localeMap[locale] || 'en-US', {
      style: 'currency',
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function convertCurrency(
  amount: number,
  from: Currency,
  to: Currency
): number {
  const usdAmount = amount / (EXCHANGE_RATES[from] || 1);
  return parseFloat((usdAmount * (EXCHANGE_RATES[to] || 1)).toFixed(2));
}

export function formatDateForLocale(
  date: Date,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = {}
): string {
  const localeMap: Record<string, string> = {
    'en': 'en-US', 'fr': 'fr-FR', 'es': 'es-ES', 'pt': 'pt-BR',
    'ar': 'ar-SA', 'de': 'de-DE', 'it': 'it-IT', 'tr': 'tr-TR',
    'ru': 'ru-RU', 'hi': 'hi-IN', 'ur': 'ur-PK', 'bn': 'bn-BD',
    'id': 'id-ID', 'vi': 'vi-VN', 'th': 'th-TH', 'zh': 'zh-CN',
    'zh-TW': 'zh-TW', 'ja': 'ja-JP', 'ko': 'ko-KR',
  };

  try {
    return new Intl.DateTimeFormat(localeMap[locale] || 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      ...options,
    }).format(date);
  } catch {
    return date.toLocaleDateString();
  }
}

export default {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  LOCALE_NAMES,
  RTL_LOCALES,
  LOCALE_TIMEZONES,
  SUPPORTED_CURRENCIES,
  LOCALE_CURRENCIES,
  EXCHANGE_RATES,
  COMMON_TIMEZONES,
  localeMiddleware,
  createI18nRouter,
  formatCurrency,
  convertCurrency,
  formatDateForLocale,
};