// =============================================================================
// VANTA SEO Localization
// hreflang tags, alternate URLs, localized metadata, structured data
// =============================================================================

import { type Locale, locales, defaultLocale, localeNames, localeDirections } from './config';

export const CANONICAL_DOMAIN = 'https://vanta.app';

/**
 * Absolute URL of the social share-preview image (og:image / twitter:image).
 *
 * Next.js 14 resolves *relative* og:image/twitter:image URLs against a dev-time
 * default of `http://localhost:<port>` (the metadata fallback base), so those
 * tags would advertise a localhost media URL that a real phone testing VANTA
 * over HTTPS can never load. We therefore emit an absolute URL: in development
 * from NEXT_PUBLIC_APP_URL (the LAN host a phone can actually reach, e.g.
 * https://10.174.123.177:3000), and everywhere else from the canonical domain,
 * keeping production share previews unchanged.
 */
export const SOCIAL_IMAGE_URL = `${
  process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_APP_URL
    ? process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')
    : CANONICAL_DOMAIN
}/branding/vanta-social.png`;

export interface HreflangTag {
  rel: 'alternate';
  href: string;
  hreflang: string;
}

export interface AlternateUrl {
  locale: Locale;
  url: string;
}

export interface LocalizedMetadata {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  twitterTitle: string;
  twitterDescription: string;
}

export interface StructuredData {
  '@context': 'https://schema.org';
  '@type': string;
  name: string;
  description: string;
  url: string;
  inLanguage: string;
  [key: string]: unknown;
}

/**
 * Map internal locale codes to standard hreflang values (BCP 47)
 */
export function localeToHreflang(locale: Locale): string {
  const map: Record<Locale, string> = {
    'en': 'en',
    'fr': 'fr',
    'es': 'es',
    'pt': 'pt',
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
    'zh': 'zh-Hans',
    'zh-TW': 'zh-Hant',
    'ja': 'ja',
    'ko': 'ko',
  };
  return map[locale] || locale;
}

/**
 * Generate hreflang link tags for all supported locales
 */
export function generateHreflangTags(
  path: string = '',
  domain: string = CANONICAL_DOMAIN
): HreflangTag[] {
  const tags: HreflangTag[] = locales.map(locale => ({
    rel: 'alternate' as const,
    href: `${domain}/${locale === defaultLocale ? '' : locale}${path}`,
    hreflang: localeToHreflang(locale),
  }));

  // Add x-default tag (points to default locale)
  tags.push({
    rel: 'alternate' as const,
    href: `${domain}${path}`,
    hreflang: 'x-default',
  });

  return tags;
}

/**
 * Generate HTML link tags string for hreflang
 */
export function generateHreflangHtml(
  path: string = '',
  domain: string = CANONICAL_DOMAIN
): string {
  return generateHreflangTags(path, domain)
    .map(tag => `<link rel="${tag.rel}" href="${tag.href}" hreflang="${tag.hreflang}" />`)
    .join('\n    ');
}

/**
 * Generate alternate URLs for all locales
 */
export function generateAlternateUrls(
  path: string = '',
  domain: string = CANONICAL_DOMAIN
): AlternateUrl[] {
  return locales.map(locale => ({
    locale,
    url: `${domain}/${locale === defaultLocale ? '' : locale}${path}`,
  }));
}

/**
 * Get localized metadata for a page
 * Uses the translation system for dynamic metadata
 */
export function getLocalizedMetadata(
  locale: Locale,
  pageKey: string,
  customTitle?: string,
): LocalizedMetadata {
  const localeName = localeNames[locale];
  const defaultMeta: Record<string, Partial<LocalizedMetadata>> = {
    home: {
      title: 'VANTA | Where Every Connection Glows',
      description: `Discover people, follow creators, chat, join live streams, and earn rewards.`,
    },
    discover: {
      title: 'Discover - VANTA',
      description: 'Find new people and content on VANTA.',
    },
    live: {
      title: 'Live - VANTA',
      description: 'Watch live streams from creators around the world.',
    },
    messages: {
      title: 'Chat - VANTA',
      description: 'Talk to anyone and build something together on VANTA.',
    },
    profile: {
      title: 'Profile - VANTA',
      description: 'View and edit your VANTA profile.',
    },
    settings: {
      title: 'Settings - VANTA',
      description: 'Manage your VANTA account settings.',
    },
    wallet: {
      title: 'Wallet - VANTA',
      description: 'Manage your VANTA wallet and transactions.',
    },
    admin: {
      title: 'Admin - VANTA',
      description: 'VANTA administration panel.',
    },
    creator: {
      title: 'Creator Studio - VANTA',
      description: 'Manage your content and grow your audience on VANTA.',
    },
  };

  const meta = defaultMeta[pageKey] || defaultMeta.home;
  const suffix = locale !== defaultLocale ? ` | ${localeName}` : '';
  
  const baseTitle = customTitle || meta.title || '';
  const baseDescription = meta.description || '';
  const title = customTitle ? customTitle : `${baseTitle}${suffix}`;

  return {
    title,
    description: baseDescription,
    ogTitle: title,
    ogDescription: baseDescription,
    twitterTitle: title,
    twitterDescription: baseDescription,
  };
}

/**
 * Generate JSON-LD structured data for the platform
 */
export function getStructuredData(
  locale: Locale,
  type: 'WebSite' | 'WebApplication' | 'Organization' = 'WebSite',
  customData?: Record<string, unknown>
): StructuredData {
  const base: StructuredData = {
    '@context': 'https://schema.org',
    '@type': type,
    name: 'VANTA',
    description: 'Premium social streaming, creator, and discovery platform.',
    url: `${CANONICAL_DOMAIN}/${locale === defaultLocale ? '' : locale}`,
    inLanguage: localeToHreflang(locale),
    applicationCategory: 'SocialNetworking',
    operatingSystem: 'All',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    ...customData,
  };

  return base;
}

/**
 * Generate localized Open Graph tags
 */
export function getOpenGraphTags(
  locale: Locale,
  metadata: LocalizedMetadata,
  path: string = '',
  image?: string
): Record<string, string> {
  const direction = localeDirections[locale];
  const url = `${CANONICAL_DOMAIN}/${locale === defaultLocale ? '' : locale}${path}`;

  return {
    'og:title': metadata.ogTitle,
    'og:description': metadata.ogDescription,
    'og:url': url,
    'og:site_name': 'VANTA',
    'og:locale': localeToHreflang(locale),
    'og:type': 'website',
    ...(image ? { 'og:image': image } : {}),
    ...(direction === 'rtl' ? { 'og:locale:alternate': 'en' } : {}),
  };
}

/**
 * Generate localized Twitter Card tags
 */
export function getTwitterCardTags(
  locale: Locale,
  metadata: LocalizedMetadata,
  image?: string
): Record<string, string> {
  return {
    'twitter:card': 'summary_large_image',
    'twitter:title': metadata.twitterTitle,
    'twitter:description': metadata.twitterDescription,
    'twitter:site': '@vanta',
    ...(image ? { 'twitter:image': image } : {}),
  };
}

/**
 * Generate a sitemap entry with hreflang alternates
 */
export function generateSitemapEntry(
  path: string = '',
  lastmod?: string,
  changefreq: string = 'daily',
  priority: number = 0.8
): string {
  const alternates = generateAlternateUrls(path);
  const lines: string[] = [];

  for (const alt of alternates) {
    lines.push(`  <url>`);
    lines.push(`    <loc>${alt.url}</loc>`);
    lines.push(`    <lastmod>${lastmod || new Date().toISOString().split('T')[0]}</lastmod>`);
    lines.push(`    <changefreq>${changefreq}</changefreq>`);
    lines.push(`    <priority>${alt.locale === defaultLocale ? priority : priority - 0.1}</priority>`);
    
    for (const other of alternates) {
      if (other.locale !== alt.locale) {
        lines.push(`    <xhtml:link rel="alternate" hreflang="${localeToHreflang(other.locale)}" href="${other.url}" />`);
      }
    }
    lines.push(`  </url>`);
  }

  return lines.join('\n');
}

/**
 * Generate full sitemap XML
 */
export function generateSitemapXml(
  entries: { path: string; lastmod?: string; changefreq?: string; priority?: number }[]
): string {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.map(e => generateSitemapEntry(e.path, e.lastmod, e.changefreq, e.priority)).join('\n')}
</urlset>`;
  return xml;
}

/**
 * Generate robots.txt content for all locales
 */
export function generateRobotsTxt(domain: string = CANONICAL_DOMAIN): string {
  const lines: string[] = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /_next/',
    'Disallow: /admin/',
    '',
    'Sitemap: https://www.google.com/ping?sitemap=' + encodeURIComponent(`${domain}/sitemap.xml`),
    '',
    '# Host',
    `Host: ${domain}`,
    '',
    '# Crawl-delay',
    'Crawl-delay: 10',
    '',
  ];

  // Add alternate links for each locale
  for (const locale of locales) {
    if (locale !== defaultLocale) {
      lines.push(`Alternate-Link: <${domain}/${locale}>; hreflang="${localeToHreflang(locale)}"`);
    }
  }

  return lines.join('\n');
}