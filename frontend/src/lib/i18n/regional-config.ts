// =============================================================================
// VANTA Regional Configuration
// Countries, currencies, payment methods, tax rates, and regional formatting
// =============================================================================

export interface CountryInfo {
  code: string;
  code3: string;
  numeric: string;
  name: string;
  locales: string[];
  defaultLocale: string;
  timezone: string;
  region: Region;
  callingCode: string;
  currency: string;
  isLaunchMarket: boolean;
}

export type Region = 'north_america' | 'south_america' | 'western_europe' | 'central_europe' | 'middle_east' | 'south_asia' | 'southeast_asia' | 'east_asia' | 'oceania';

export interface CurrencyInfo {
  code: string;
  numeric: string;
  symbol: string;
  name: string;
  decimals: number;
  symbolPosition: 'before' | 'after';
  spaceBetween: boolean;
  isCrypto: boolean;
}

export interface PaymentMethod {
  id: string;
  name: string;
  type: 'card' | 'wallet' | 'bank' | 'crypto' | 'carrier' | 'cash';
  regions: Region[];
  countries: string[];
}

export interface TaxConfig {
  country: string;
  name: string;
  rate: number;
  type: 'vat' | 'gst' | 'sales_tax' | 'service_tax';
  appliesTo: string[];
}

export interface PhoneFormat {
  country: string;
  code: string;
  pattern: string;
  example: string;
  length: number;
}

export interface AddressFormat {
  country: string;
  format: string;
  fields: string[];
  required: string[];
}

export const countries: CountryInfo[] = [
  { code: 'US', code3: 'USA', numeric: '840', name: 'United States', locales: ['en'], defaultLocale: 'en', timezone: 'America/New_York', region: 'north_america', callingCode: '1', currency: 'USD', isLaunchMarket: true },
  { code: 'CA', code3: 'CAN', numeric: '124', name: 'Canada', locales: ['en', 'fr'], defaultLocale: 'en', timezone: 'America/Toronto', region: 'north_america', callingCode: '1', currency: 'CAD', isLaunchMarket: true },
  { code: 'MX', code3: 'MEX', numeric: '484', name: 'Mexico', locales: ['es'], defaultLocale: 'es', timezone: 'America/Mexico_City', region: 'north_america', callingCode: '52', currency: 'MXN', isLaunchMarket: false },
  { code: 'BR', code3: 'BRA', numeric: '076', name: 'Brazil', locales: ['pt'], defaultLocale: 'pt', timezone: 'America/Sao_Paulo', region: 'south_america', callingCode: '55', currency: 'BRL', isLaunchMarket: true },
  { code: 'GB', code3: 'GBR', numeric: '826', name: 'United Kingdom', locales: ['en'], defaultLocale: 'en', timezone: 'Europe/London', region: 'western_europe', callingCode: '44', currency: 'GBP', isLaunchMarket: true },
  { code: 'FR', code3: 'FRA', numeric: '250', name: 'France', locales: ['fr'], defaultLocale: 'fr', timezone: 'Europe/Paris', region: 'western_europe', callingCode: '33', currency: 'EUR', isLaunchMarket: true },
  { code: 'ES', code3: 'ESP', numeric: '724', name: 'Spain', locales: ['es'], defaultLocale: 'es', timezone: 'Europe/Madrid', region: 'western_europe', callingCode: '34', currency: 'EUR', isLaunchMarket: true },
  { code: 'PT', code3: 'PRT', numeric: '620', name: 'Portugal', locales: ['pt'], defaultLocale: 'pt', timezone: 'Europe/Lisbon', region: 'western_europe', callingCode: '351', currency: 'EUR', isLaunchMarket: false },
  { code: 'DE', code3: 'DEU', numeric: '276', name: 'Germany', locales: ['de'], defaultLocale: 'de', timezone: 'Europe/Berlin', region: 'central_europe', callingCode: '49', currency: 'EUR', isLaunchMarket: true },
  { code: 'IT', code3: 'ITA', numeric: '380', name: 'Italy', locales: ['it'], defaultLocale: 'it', timezone: 'Europe/Rome', region: 'central_europe', callingCode: '39', currency: 'EUR', isLaunchMarket: true },
  { code: 'TR', code3: 'TUR', numeric: '792', name: 'Turkey', locales: ['tr'], defaultLocale: 'tr', timezone: 'Europe/Istanbul', region: 'central_europe', callingCode: '90', currency: 'TRY', isLaunchMarket: true },
  { code: 'RU', code3: 'RUS', numeric: '643', name: 'Russia', locales: ['ru'], defaultLocale: 'ru', timezone: 'Europe/Moscow', region: 'central_europe', callingCode: '7', currency: 'RUB', isLaunchMarket: true },
  { code: 'SA', code3: 'SAU', numeric: '682', name: 'Saudi Arabia', locales: ['ar'], defaultLocale: 'ar', timezone: 'Asia/Riyadh', region: 'middle_east', callingCode: '966', currency: 'SAR', isLaunchMarket: false },
  { code: 'AE', code3: 'ARE', numeric: '784', name: 'UAE', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Dubai', region: 'middle_east', callingCode: '971', currency: 'AED', isLaunchMarket: false },
  { code: 'IN', code3: 'IND', numeric: '356', name: 'India', locales: ['hi', 'en'], defaultLocale: 'hi', timezone: 'Asia/Kolkata', region: 'south_asia', callingCode: '91', currency: 'INR', isLaunchMarket: true },
  { code: 'PK', code3: 'PAK', numeric: '586', name: 'Pakistan', locales: ['ur', 'en'], defaultLocale: 'ur', timezone: 'Asia/Karachi', region: 'south_asia', callingCode: '92', currency: 'PKR', isLaunchMarket: true },
  { code: 'BD', code3: 'BGD', numeric: '050', name: 'Bangladesh', locales: ['bn'], defaultLocale: 'bn', timezone: 'Asia/Dhaka', region: 'south_asia', callingCode: '880', currency: 'BDT', isLaunchMarket: true },
  { code: 'ID', code3: 'IDN', numeric: '360', name: 'Indonesia', locales: ['id'], defaultLocale: 'id', timezone: 'Asia/Jakarta', region: 'southeast_asia', callingCode: '62', currency: 'IDR', isLaunchMarket: true },
  { code: 'TH', code3: 'THA', numeric: '764', name: 'Thailand', locales: ['th'], defaultLocale: 'th', timezone: 'Asia/Bangkok', region: 'southeast_asia', callingCode: '66', currency: 'THB', isLaunchMarket: false },
  { code: 'VN', code3: 'VNM', numeric: '704', name: 'Vietnam', locales: ['vi'], defaultLocale: 'vi', timezone: 'Asia/Ho_Chi_Minh', region: 'southeast_asia', callingCode: '84', currency: 'VND', isLaunchMarket: true },
  { code: 'JP', code3: 'JPN', numeric: '392', name: 'Japan', locales: ['ja'], defaultLocale: 'ja', timezone: 'Asia/Tokyo', region: 'east_asia', callingCode: '81', currency: 'JPY', isLaunchMarket: true },
  { code: 'KR', code3: 'KOR', numeric: '410', name: 'South Korea', locales: ['ko'], defaultLocale: 'ko', timezone: 'Asia/Seoul', region: 'east_asia', callingCode: '82', currency: 'KRW', isLaunchMarket: true },
  { code: 'CN', code3: 'CHN', numeric: '156', name: 'China', locales: ['zh'], defaultLocale: 'zh', timezone: 'Asia/Shanghai', region: 'east_asia', callingCode: '86', currency: 'CNY', isLaunchMarket: false },
  { code: 'TW', code3: 'TWN', numeric: '158', name: 'Taiwan', locales: ['zh-TW'], defaultLocale: 'zh-TW', timezone: 'Asia/Taipei', region: 'east_asia', callingCode: '886', currency: 'TWD', isLaunchMarket: false },
  { code: 'AU', code3: 'AUS', numeric: '036', name: 'Australia', locales: ['en'], defaultLocale: 'en', timezone: 'Australia/Sydney', region: 'oceania', callingCode: '61', currency: 'AUD', isLaunchMarket: true },
  { code: 'AR', code3: 'ARG', numeric: '032', name: 'Argentina', locales: ['es'], defaultLocale: 'es', timezone: 'America/Argentina/Buenos_Aires', region: 'south_america', callingCode: '54', currency: 'ARS', isLaunchMarket: false },
  { code: 'CO', code3: 'COL', numeric: '170', name: 'Colombia', locales: ['es'], defaultLocale: 'es', timezone: 'America/Bogota', region: 'south_america', callingCode: '57', currency: 'COP', isLaunchMarket: false },
  { code: 'NG', code3: 'NGA', numeric: '566', name: 'Nigeria', locales: ['en'], defaultLocale: 'en', timezone: 'Africa/Lagos', region: 'western_europe', callingCode: '234', currency: 'NGN', isLaunchMarket: false },
  { code: 'EG', code3: 'EGY', numeric: '818', name: 'Egypt', locales: ['ar'], defaultLocale: 'ar', timezone: 'Africa/Cairo', region: 'middle_east', callingCode: '20', currency: 'EGP', isLaunchMarket: false },
];

export const currencies: CurrencyInfo[] = [
  { code: 'USD', numeric: '840', symbol: '$', name: 'US Dollar', decimals: 2, symbolPosition: 'before', spaceBetween: false, isCrypto: false },
  { code: 'EUR', numeric: '978', symbol: '€', name: 'Euro', decimals: 2, symbolPosition: 'before', spaceBetween: false, isCrypto: false },
  { code: 'GBP', numeric: '826', symbol: '£', name: 'British Pound', decimals: 2, symbolPosition: 'before', spaceBetween: false, isCrypto: false },
  { code: 'JPY', numeric: '392', symbol: '¥', name: 'Japanese Yen', decimals: 0, symbolPosition: 'before', spaceBetween: false, isCrypto: false },
  { code: 'KRW', numeric: '410', symbol: '₩', name: 'South Korean Won', decimals: 0, symbolPosition: 'before', spaceBetween: false, isCrypto: false },
  { code: 'CNY', numeric: '156', symbol: '¥', name: 'Chinese Yuan', decimals: 2, symbolPosition: 'before', spaceBetween: false, isCrypto: false },
  { code: 'INR', numeric: '356', symbol: '₹', name: 'Indian Rupee', decimals: 2, symbolPosition: 'before', spaceBetween: false, isCrypto: false },
  { code: 'BRL', numeric: '986', symbol: 'R$', name: 'Brazilian Real', decimals: 2, symbolPosition: 'before', spaceBetween: false, isCrypto: false },
  { code: 'CAD', numeric: '124', symbol: 'CA$', name: 'Canadian Dollar', decimals: 2, symbolPosition: 'before', spaceBetween: false, isCrypto: false },
  { code: 'AUD', numeric: '036', symbol: 'A$', name: 'Australian Dollar', decimals: 2, symbolPosition: 'before', spaceBetween: false, isCrypto: false },
  { code: 'MXN', numeric: '484', symbol: 'MX$', name: 'Mexican Peso', decimals: 2, symbolPosition: 'before', spaceBetween: false, isCrypto: false },
  { code: 'TRY', numeric: '949', symbol: '₺', name: 'Turkish Lira', decimals: 2, symbolPosition: 'before', spaceBetween: false, isCrypto: false },
  { code: 'RUB', numeric: '643', symbol: '₽', name: 'Russian Ruble', decimals: 2, symbolPosition: 'after', spaceBetween: true, isCrypto: false },
  { code: 'SAR', numeric: '682', symbol: '﷼', name: 'Saudi Riyal', decimals: 2, symbolPosition: 'after', spaceBetween: true, isCrypto: false },
  { code: 'AED', numeric: '784', symbol: 'د.إ', name: 'UAE Dirham', decimals: 2, symbolPosition: 'after', spaceBetween: true, isCrypto: false },
  { code: 'PKR', numeric: '586', symbol: '₨', name: 'Pakistani Rupee', decimals: 2, symbolPosition: 'before', spaceBetween: false, isCrypto: false },
  { code: 'BDT', numeric: '050', symbol: '৳', name: 'Bangladeshi Taka', decimals: 2, symbolPosition: 'before', spaceBetween: false, isCrypto: false },
  { code: 'IDR', numeric: '360', symbol: 'Rp', name: 'Indonesian Rupiah', decimals: 0, symbolPosition: 'before', spaceBetween: true, isCrypto: false },
  { code: 'THB', numeric: '764', symbol: '฿', name: 'Thai Baht', decimals: 2, symbolPosition: 'before', spaceBetween: false, isCrypto: false },
  { code: 'VND', numeric: '704', symbol: '₫', name: 'Vietnamese Dong', decimals: 0, symbolPosition: 'after', spaceBetween: true, isCrypto: false },
  { code: 'TWD', numeric: '901', symbol: 'NT$', name: 'Taiwan Dollar', decimals: 2, symbolPosition: 'before', spaceBetween: false, isCrypto: false },
  { code: 'NGN', numeric: '566', symbol: '₦', name: 'Nigerian Naira', decimals: 2, symbolPosition: 'before', spaceBetween: false, isCrypto: false },
  { code: 'EGP', numeric: '818', symbol: 'E£', name: 'Egyptian Pound', decimals: 2, symbolPosition: 'before', spaceBetween: false, isCrypto: false },
  { code: 'ARS', numeric: '032', symbol: 'AR$', name: 'Argentine Peso', decimals: 2, symbolPosition: 'before', spaceBetween: false, isCrypto: false },
  { code: 'COP', numeric: '170', symbol: 'COL$', name: 'Colombian Peso', decimals: 2, symbolPosition: 'before', spaceBetween: false, isCrypto: false },
];

export const defaultCurrencyByCountry: Record<string, string> = {
  US: 'USD', CA: 'CAD', MX: 'MXN', BR: 'BRL', GB: 'GBP', FR: 'EUR', ES: 'EUR',
  PT: 'EUR', DE: 'EUR', IT: 'EUR', TR: 'TRY', RU: 'RUB', SA: 'SAR', AE: 'AED',
  IN: 'INR', PK: 'PKR', BD: 'BDT', ID: 'IDR', TH: 'THB', VN: 'VND', JP: 'JPY',
  KR: 'KRW', CN: 'CNY', TW: 'TWD', AU: 'AUD', AR: 'ARS', CO: 'COP', NG: 'NGN', EG: 'EGP',
};

export const vantaCoinPrices: Record<string, { coins: number; price: number; currency: string }[]> = {
  USD: [
    { coins: 100, price: 0.99, currency: 'USD' },
    { coins: 500, price: 4.99, currency: 'USD' },
    { coins: 1200, price: 9.99, currency: 'USD' },
    { coins: 2500, price: 19.99, currency: 'USD' },
    { coins: 6500, price: 49.99, currency: 'USD' },
    { coins: 14000, price: 99.99, currency: 'USD' },
  ],
};

export const paymentMethods: PaymentMethod[] = [
  { id: 'visa', name: 'Visa', type: 'card', regions: ['north_america', 'south_america', 'western_europe', 'central_europe', 'middle_east', 'south_asia', 'southeast_asia', 'east_asia', 'oceania'], countries: [] },
  { id: 'mastercard', name: 'Mastercard', type: 'card', regions: ['north_america', 'south_america', 'western_europe', 'central_europe', 'middle_east', 'south_asia', 'southeast_asia', 'east_asia', 'oceania'], countries: [] },
  { id: 'amex', name: 'American Express', type: 'card', regions: ['north_america', 'western_europe', 'oceania'], countries: ['US', 'CA', 'GB', 'AU'] },
  { id: 'paypal', name: 'PayPal', type: 'wallet', regions: ['north_america', 'western_europe', 'central_europe', 'oceania'], countries: [] },
  { id: 'apple_pay', name: 'Apple Pay', type: 'wallet', regions: ['north_america', 'western_europe', 'east_asia', 'oceania'], countries: [] },
  { id: 'google_pay', name: 'Google Pay', type: 'wallet', regions: ['north_america', 'western_europe', 'central_europe', 'south_asia', 'east_asia', 'oceania'], countries: [] },
  { id: 'alipay', name: 'Alipay', type: 'wallet', regions: ['east_asia', 'southeast_asia'], countries: ['CN'] },
  { id: 'wechat_pay', name: 'WeChat Pay', type: 'wallet', regions: ['east_asia'], countries: ['CN'] },
  { id: 'paytm', name: 'Paytm', type: 'wallet', regions: ['south_asia'], countries: ['IN'] },
  { id: 'upi', name: 'UPI', type: 'wallet', regions: ['south_asia'], countries: ['IN'] },
  { id: 'easypaisa', name: 'Easypaisa', type: 'wallet', regions: ['south_asia'], countries: ['PK'] },
  { id: 'jazzcash', name: 'JazzCash', type: 'wallet', regions: ['south_asia'], countries: ['PK'] },
  { id: 'dana', name: 'DANA', type: 'wallet', regions: ['southeast_asia'], countries: ['ID'] },
  { id: 'ovo', name: 'OVO', type: 'wallet', regions: ['southeast_asia'], countries: ['ID'] },
  { id: 'gopay', name: 'GoPay', type: 'wallet', regions: ['southeast_asia'], countries: ['ID'] },
  { id: 'pix', name: 'Pix', type: 'wallet', regions: ['south_america'], countries: ['BR'] },
  { id: 'boleto', name: 'Boleto Bancário', type: 'cash', regions: ['south_america'], countries: ['BR'] },
  { id: 'pago_efectivo', name: 'Pago Efectivo', type: 'cash', regions: ['south_america'], countries: ['PE'] },
  { id: 'oxxo', name: 'OXXO', type: 'cash', regions: ['north_america'], countries: ['MX'] },
  { id: 'konbini', name: 'Konbini', type: 'cash', regions: ['east_asia'], countries: ['JP'] },
  { id: 'line_pay', name: 'LINE Pay', type: 'wallet', regions: ['east_asia', 'southeast_asia'], countries: ['JP', 'TH', 'TW'] },
  { id: 'truemoney', name: 'TrueMoney', type: 'wallet', regions: ['southeast_asia'], countries: ['TH', 'VN'] },
  { id: 'momo', name: 'MoMo', type: 'wallet', regions: ['southeast_asia'], countries: ['VN'] },
  { id: 'stc_pay', name: 'STC Pay', type: 'wallet', regions: ['middle_east'], countries: ['SA'] },
  { id: 'tabby', name: 'Tabby', type: 'wallet', regions: ['middle_east'], countries: ['AE', 'SA'] },
  { id: 'bank_transfer', name: 'Bank Transfer', type: 'bank', regions: ['north_america', 'south_america', 'western_europe', 'central_europe', 'middle_east', 'south_asia', 'southeast_asia', 'east_asia', 'oceania'], countries: [] },
];

export function getPaymentMethodsForCountry(countryCode: string): PaymentMethod[] {
  return paymentMethods.filter(pm => pm.countries.length === 0 || pm.countries.includes(countryCode));
}

export const taxConfigs: TaxConfig[] = [
  { country: 'GB', name: 'VAT', rate: 20, type: 'vat', appliesTo: ['digital', 'goods'] },
  { country: 'FR', name: 'VAT', rate: 20, type: 'vat', appliesTo: ['digital', 'goods'] },
  { country: 'DE', name: 'VAT', rate: 19, type: 'vat', appliesTo: ['digital', 'goods'] },
  { country: 'IT', name: 'VAT', rate: 22, type: 'vat', appliesTo: ['digital', 'goods'] },
  { country: 'ES', name: 'VAT', rate: 21, type: 'vat', appliesTo: ['digital', 'goods'] },
  { country: 'PT', name: 'VAT', rate: 23, type: 'vat', appliesTo: ['digital', 'goods'] },
  { country: 'TR', name: 'KDV', rate: 18, type: 'vat', appliesTo: ['digital', 'goods'] },
  { country: 'IN', name: 'GST', rate: 18, type: 'gst', appliesTo: ['digital', 'goods'] },
  { country: 'BR', name: 'ICMS', rate: 17, type: 'sales_tax', appliesTo: ['goods'] },
  { country: 'SA', name: 'VAT', rate: 15, type: 'vat', appliesTo: ['digital', 'goods'] },
  { country: 'AE', name: 'VAT', rate: 5, type: 'vat', appliesTo: ['digital', 'goods'] },
  { country: 'JP', name: 'Consumption Tax', rate: 10, type: 'sales_tax', appliesTo: ['digital', 'goods'] },
  { country: 'AU', name: 'GST', rate: 10, type: 'gst', appliesTo: ['digital', 'goods'] },
  { country: 'KR', name: 'VAT', rate: 10, type: 'vat', appliesTo: ['digital', 'goods'] },
  { country: 'RU', name: 'VAT', rate: 20, type: 'vat', appliesTo: ['digital', 'goods'] },
  { country: 'PK', name: 'Sales Tax', rate: 13, type: 'sales_tax', appliesTo: ['digital'] },
  { country: 'BD', name: 'VAT', rate: 15, type: 'vat', appliesTo: ['digital'] },
  { country: 'ID', name: 'PPN', rate: 11, type: 'vat', appliesTo: ['digital', 'goods'] },
  { country: 'TH', name: 'VAT', rate: 7, type: 'vat', appliesTo: ['digital', 'goods'] },
  { country: 'VN', name: 'VAT', rate: 10, type: 'vat', appliesTo: ['digital', 'goods'] },
];

export function getTaxForCountry(countryCode: string): TaxConfig | undefined {
  return taxConfigs.find(t => t.country === countryCode);
}

export const phoneFormats: PhoneFormat[] = [
  { country: 'US', code: '1', pattern: '+1 (XXX) XXX-XXXX', example: '+1 (555) 123-4567', length: 10 },
  { country: 'GB', code: '44', pattern: '+44 XXXX XXXXXX', example: '+44 7911 123456', length: 10 },
  { country: 'IN', code: '91', pattern: '+91 XXXXX-XXXXX', example: '+91 98765-43210', length: 10 },
  { country: 'BR', code: '55', pattern: '+55 (XX) XXXXX-XXXX', example: '+55 (11) 98765-4321', length: 11 },
  { country: 'PK', code: '92', pattern: '+92 XXX-XXXXXXX', example: '+92 300-1234567', length: 10 },
  { country: 'ID', code: '62', pattern: '+62 XXX-XXXX-XXXX', example: '+62 812-3456-7890', length: 10 },
  { country: 'NG', code: '234', pattern: '+234 XXX XXX XXXX', example: '+234 803 123 4567', length: 10 },
  { country: 'JP', code: '81', pattern: '+81 X0-XXXX-XXXX', example: '+81 90-1234-5678', length: 10 },
  { country: 'KR', code: '82', pattern: '+82 XX-XXXX-XXXX', example: '+82 10-1234-5678', length: 10 },
  { country: 'TR', code: '90', pattern: '+90 XXX XXX XXXX', example: '+90 532 123 4567', length: 10 },
  { country: 'RU', code: '7', pattern: '+7 XXX XXX-XX-XX', example: '+7 912 123-45-67', length: 10 },
  { country: 'VN', code: '84', pattern: '+84 XX XXXX XXXX', example: '+84 90 1234 567', length: 9 },
  { country: 'TH', code: '66', pattern: '+66 X-XXXX-XXXX', example: '+66 81-234-5678', length: 9 },
  { country: 'BD', code: '880', pattern: '+880 XXXX-XXXXXX', example: '+880 1712-345678', length: 10 },
  { country: 'SA', code: '966', pattern: '+966 X-XXX-XXXX', example: '+966 5-123-4567', length: 9 },
  { country: 'AE', code: '971', pattern: '+971 X-XXX-XXXX', example: '+971 50-123-4567', length: 9 },
];

export const addressFormats: AddressFormat[] = [
  { country: 'US', format: '{street}\n{city}, {state} {zip}\n{country}', fields: ['street', 'city', 'state', 'zip', 'country'], required: ['street', 'city', 'state', 'zip', 'country'] },
  { country: 'GB', format: '{street}\n{city}\n{state}\n{zip}\n{country}', fields: ['street', 'city', 'state', 'zip', 'country'], required: ['street', 'city', 'zip', 'country'] },
  { country: 'DE', format: '{street}\n{zip} {city}\n{country}', fields: ['street', 'zip', 'city', 'country'], required: ['street', 'zip', 'city', 'country'] },
  { country: 'FR', format: '{street}\n{zip} {city}\n{country}', fields: ['street', 'zip', 'city', 'country'], required: ['street', 'zip', 'city', 'country'] },
  { country: 'JP', format: '{zip}\n{state} {city}\n{street}\n{country}', fields: ['zip', 'state', 'city', 'street', 'country'], required: ['zip', 'state', 'city', 'street', 'country'] },
  { country: 'BR', format: '{street}\n{zip}\n{city} - {state}\n{country}', fields: ['street', 'zip', 'city', 'state', 'country'], required: ['street', 'zip', 'city', 'state', 'country'] },
  { country: 'IN', format: '{street}\n{city} - {zip}\n{state}\n{country}', fields: ['street', 'city', 'zip', 'state', 'country'], required: ['street', 'city', 'zip', 'state', 'country'] },
];

export function getCountryByCode(code: string): CountryInfo | undefined {
  return countries.find(c => c.code === code || c.code3 === code);
}

export function getCountriesByRegion(region: Region): CountryInfo[] {
  return countries.filter(c => c.region === region);
}

export function getLaunchMarkets(): CountryInfo[] {
  return countries.filter(c => c.isLaunchMarket);
}

export function getCurrenciesForCountry(countryCode: string): CurrencyInfo[] {
  const country = getCountryByCode(countryCode);
  if (!country) return [];
  const currency = currencies.find(c => c.code === country.currency);
  return currency ? [currency] : [];
}

export function formatAddress(countryCode: string, fields: Record<string, string>): string {
  const format = addressFormats.find(f => f.country === countryCode);
  if (!format) return [fields.street, fields.city, fields.state, fields.zip, fields.country].filter(Boolean).join('\n');
  let result = format.format;
  for (const [key, value] of Object.entries(fields)) {
    result = result.replace(`{${key}}`, value || '');
  }
  return result;
}