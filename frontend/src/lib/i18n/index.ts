// =============================================================================
// VANTA i18n Barrel Export
// All localization utilities are exported from here
// =============================================================================

// Configuration
export {
  locales, defaultLocale, type Locale,
  isRTL, isValidLocale, localeNames, localeDirections,
  rtlLocales, getBaseLanguage, intlLocaleMap, numberLocaleMap,
  currencyLocaleMap, localeTimezones, localeFirstDayOfWeek
} from './config';

// Types
export type { TranslationKeys } from './types';

// Formatters
export {
  formatDate, formatTime, formatDateTime, formatDateRelative,
  formatRelativeTime, formatNumber, formatCompactNumber, formatPercent,
  formatCurrency, formatVantaCoins, formatPhoneNumber, formatDuration,
  formatFileSize, nowUTC, toUTCStorage, datePresets
} from './formatters';

// Context & Provider
export { I18nProvider, useI18n, I18nContext } from './context';

// Locale Detection
export {
  detectLocale, detectBrowserLocale, storeLocale, getStoredLocale,
  detectTimezone, storeTimezone, getStoredTimezone, getLocaleFromCookie,
  getLocaleOptions, extractLocaleFromPath
} from './locale-detection';

// SEO
export {
  CANONICAL_DOMAIN, generateHreflangTags, generateHreflangHtml,
  generateAlternateUrls, getLocalizedMetadata, getStructuredData,
  getOpenGraphTags, getTwitterCardTags, generateSitemapEntry,
  generateSitemapXml, generateRobotsTxt, localeToHreflang
} from './seo';

// Regional Configuration
export {
  countries, currencies, paymentMethods, taxConfigs,
  phoneFormats, addressFormats, vantaCoinPrices,
  defaultCurrencyByCountry, getCountryByCode, getCountriesByRegion,
  getLaunchMarkets, getCurrenciesForCountry, getPaymentMethodsForCountry,
  getTaxForCountry, formatAddress
} from './regional-config';

// Notification Scheduler
export {
  scheduleNotification, queueBatchNotifications,
  getBestDeliveryTime, formatNotificationTime,
  getLocalizedNotificationContent, getTimeUntilNextDeliveryWindow,
  prioritizeNotifications, NotificationPriority
} from './notification-scheduler';
export type { NotificationSchedule, LocalizedNotification } from './notification-scheduler';
