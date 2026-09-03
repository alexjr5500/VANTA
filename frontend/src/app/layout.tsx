import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./auth.css";
import "@/components/landing/landing.css";
import "@/components/profile/v2/creator-hub.css";
import AppLayout from "@/components/AppLayout";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { ToastProvider } from "@/components/ui/Toast";
import { AccessibilityProvider } from "@/context/AccessibilityContext";
import { I18nProvider } from "@/lib/i18n/context";
import { CANONICAL_DOMAIN, SOCIAL_IMAGE_URL } from "@/lib/i18n/seo";
import { ContentCreationProvider } from "@/components/create/ContentCreationContext";
import { cookies } from "next/headers";
import AnalyticsWrapper from "@/components/AnalyticsWrapper";
import ErrorBoundary from "@/components/ErrorBoundary";
import { NotificationProvider } from "@/context/NotificationContext";
import { ChatUnreadProvider } from "@/context/ChatUnreadContext";
import { CallProvider } from "@/context/CallContext";

export const metadata: Metadata = {
  metadataBase: new URL('https://vanta.app'),
  title: {
    default: "VANTA | Create. Connect. Live.",
    template: "%s | VANTA",
  },
  description:
    "VANTA is a premium social and creator platform for posts, reels, live rooms, communities, and meaningful connection.",
  keywords: [
    "social streaming",
    "live streaming",
    "creator platform",
    "social discovery",
    "premium social",
    "VANTA",
  ],
  icons: {
    icon: [
      { url: "/branding/vanta-icon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/branding/vanta-icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: [
      { url: "/branding/vanta-icon-192.png", sizes: "192x192", type: "image/png" },
    ],
  },
  openGraph: {
    title: "VANTA | Create. Connect. Live.",
    description:
      "Premium social streaming, creator, and discovery platform.",
    type: "website",
    siteName: "VANTA",
    locale: "en_US",
    images: [
      { url: SOCIAL_IMAGE_URL, width: 1200, height: 630, alt: "VANTA — Create. Connect. Live." },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "VANTA | Create. Connect. Live.",
    description: "Premium social and creator platform.",
    images: [SOCIAL_IMAGE_URL],
  },
  alternates: {
    canonical: "https://vanta.app",
    languages: {
      'en': 'https://vanta.app',
      'fr': 'https://vanta.app/fr',
      'es': 'https://vanta.app/es',
      'pt': 'https://vanta.app/pt',
      'ar': 'https://vanta.app/ar',
      'de': 'https://vanta.app/de',
      'it': 'https://vanta.app/it',
      'tr': 'https://vanta.app/tr',
      'ru': 'https://vanta.app/ru',
      'hi': 'https://vanta.app/hi',
      'ur': 'https://vanta.app/ur',
      'bn': 'https://vanta.app/bn',
      'id': 'https://vanta.app/id',
      'vi': 'https://vanta.app/vi',
      'th': 'https://vanta.app/th',
      'zh-Hans': 'https://vanta.app/zh',
      'zh-Hant': 'https://vanta.app/zh-TW',
      'ja': 'https://vanta.app/ja',
      'ko': 'https://vanta.app/ko',
    },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#050505",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Detect language and direction from cookie for SSR
  const cookieStore = await cookies();
  const locale = cookieStore.get('NEXT_LOCALE')?.value || 'en';
  const dir = cookieStore.get('NEXT_DIR')?.value || 'ltr';

  return (
    <html lang={locale} dir={dir} className="dark" suppressHydrationWarning>
      <head>
        {/* DNS prefetch for critical origins */}
        <link rel="dns-prefetch" href="//api.vanta.app" />
        <link rel="dns-prefetch" href="//cdn.vanta.app" />
        
        {/* JSON-LD Structured Data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: "VANTA",
              description: "Premium social and creator platform.",
              url: `${CANONICAL_DOMAIN}/${locale === 'en' ? '' : locale}`,
              inLanguage: locale,
              applicationCategory: "SocialNetworking",
              operatingSystem: "All",
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
              },
            }),
          }}
        />
      </head>
      <body className="bg-[var(--background)] text-[var(--foreground)] min-h-screen flex flex-col antialiased">
        <I18nProvider>
          <AccessibilityProvider>
            <ThemeProvider>
              <AuthProvider>
                <CallProvider>
                  <ToastProvider>
                    <NotificationProvider>
                      <ChatUnreadProvider>
                        <ContentCreationProvider>
                          <div id="main-content" tabIndex={-1}>
                            <ErrorBoundary>
                              <AppLayout>{children}</AppLayout>
                            </ErrorBoundary>
                          </div>
                        </ContentCreationProvider>
                      </ChatUnreadProvider>
                    </NotificationProvider>
                  </ToastProvider>
                </CallProvider>
              </AuthProvider>
            </ThemeProvider>
          </AccessibilityProvider>
        </I18nProvider>
        <AnalyticsWrapper />
      </body>
    </html>
  );
}
