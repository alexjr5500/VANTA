// =============================================================================
// VANTA Internationalization (i18n) Configuration
// Core locale definitions, constants, and utility types
// =============================================================================

/**
 * All supported locales with their metadata.
 * Adding a new locale here is all that's needed to support a new language
 * (along with creating the translation JSON file).
 */
export const locales = [
  'en',    // English
  'fr',    // French
  'es',    // Spanish
  'pt',    // Portuguese
  'ar',    // Arabic
  'de',    // German
  'it',    // Italian
  'tr',    // Turkish
  'ru',    // Russian
  'hi',    // Hindi
  'ur',    // Urdu
  'bn',    // Bengali
  'id',    // Indonesian
  'vi',    // Vietnamese
  'th',    // Thai
  'zh',    // Chinese (Simplified)
  'zh-TW', // Chinese (Traditional)
  'ja',    // Japanese
  'ko',    // Korean
] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

/**
 * Language display names in their native form
 */
export const localeNames: Record<Locale, string> = {
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

/**
 * Directionality for each locale
 */
export const localeDirections: Record<Locale, 'ltr' | 'rtl'> = {
  'en': 'ltr',
  'fr': 'ltr',
  'es': 'ltr',
  'pt': 'ltr',
  'ar': 'rtl',
  'de': 'ltr',
  'it': 'ltr',
  'tr': 'ltr',
  'ru': 'ltr',
  'hi': 'ltr',
  'ur': 'rtl',
  'bn': 'ltr',
  'id': 'ltr',
  'vi': 'ltr',
  'th': 'ltr',
  'zh': 'ltr',
  'zh-TW': 'ltr',
  'ja': 'ltr',
  'ko': 'ltr',
};

/**
 * Date-fns locale mapping for each supported locale
 */
export const dateFnsLocales: Record<Locale, string> = {
  'en': 'enUS',
  'fr': 'fr',
  'es': 'es',
  'pt': 'ptBR',
  'ar': 'ar',
  'de': 'de',
  'it': 'it',
  'tr': 'tr',
  'ru': 'ru',
  'hi': 'hi',
  'ur': 'ur',
  'bn': 'bn',
  'id': 'id',
  'vi': 'vi',
  'th': 'th',
  'zh': 'zhCN',
  'zh-TW': 'zhTW',
  'ja': 'ja',
  'ko': 'ko',
};

/**
 * Intl locale identifier mapping (for Intl.DateTimeFormat, etc.)
 */
export const intlLocaleMap: Record<Locale, string> = {
  'en': 'en-US',
  'fr': 'fr-FR',
  'es': 'es-ES',
  'pt': 'pt-BR',
  'ar': 'ar-SA',
  'de': 'de-DE',
  'it': 'it-IT',
  'tr': 'tr-TR',
  'ru': 'ru-RU',
  'hi': 'hi-IN',
  'ur': 'ur-PK',
  'bn': 'bn-BD',
  'id': 'id-ID',
  'vi': 'vi-VN',
  'th': 'th-TH',
  'zh': 'zh-CN',
  'zh-TW': 'zh-TW',
  'ja': 'ja-JP',
  'ko': 'ko-KR',
};

/**
 * Number formatting locale map
 */
export const numberLocaleMap: Record<Locale, string> = {
  'en': 'en-US',
  'fr': 'fr-FR',
  'es': 'es-ES',
  'pt': 'pt-BR',
  'ar': 'ar-SA',
  'de': 'de-DE',
  'it': 'it-IT',
  'tr': 'tr-TR',
  'ru': 'ru-RU',
  'hi': 'hi-IN',
  'ur': 'ur-PK',
  'bn': 'bn-BD',
  'id': 'id-ID',
  'vi': 'vi-VN',
  'th': 'th-TH',
  'zh': 'zh-CN',
  'zh-TW': 'zh-TW',
  'ja': 'ja-JP',
  'ko': 'ko-KR',
};

/**
 * Currency formatting locale map (for price display)
 */
export const currencyLocaleMap: Record<Locale, string> = {
  'en': 'en-US',
  'fr': 'fr-FR',
  'es': 'es-ES',
  'pt': 'pt-BR',
  'ar': 'ar-SA',
  'de': 'de-DE',
  'it': 'it-IT',
  'tr': 'tr-TR',
  'ru': 'ru-RU',
  'hi': 'hi-IN',
  'ur': 'ur-PK',
  'bn': 'bn-BD',
  'id': 'id-ID',
  'vi': 'vi-VN',
  'th': 'th-TH',
  'zh': 'zh-CN',
  'zh-TW': 'zh-TW',
  'ja': 'ja-JP',
  'ko': 'ko-KR',
};

/**
 * Default timezone per locale (best guess for primary region)
 */
export const localeTimezones: Record<Locale, string> = {
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

/**
 * First day of week by locale (0 = Sunday, 1 = Monday)
 */
export const localeFirstDayOfWeek: Record<Locale, number> = {
  'en': 0,
  'fr': 1,
  'es': 1,
  'pt': 0,
  'ar': 0,
  'de': 1,
  'it': 1,
  'tr': 1,
  'ru': 1,
  'hi': 0,
  'ur': 0,
  'bn': 0,
  'id': 1,
  'vi': 1,
  'th': 0,
  'zh': 1,
  'zh-TW': 1,
  'ja': 1,
  'ko': 0,
};

/**
 * RTL locales list for quick checks
 */
export const rtlLocales: Locale[] = ['ar', 'ur'];

/**
 * Check if a locale is RTL
 */
export function isRTL(locale: Locale): boolean {
  return localeDirections[locale] === 'rtl';
}

/**
 * Check if a locale string is valid
 */
export function isValidLocale(locale: string): locale is Locale {
  return (locales as readonly string[]).includes(locale);
}

/**
 * Get the base language code from a locale (e.g. 'zh-TW' -> 'zh')
 */
export function getBaseLanguage(locale: Locale): string {
  return locale.split('-')[0];
}