// @ts-check

import { createRequire } from 'node:module';

// `allowedDevOrigins` (the dev-server origin allow-list used for physical-phone
// LAN testing) was added in Next.js 15.0.0. Setting it on Next 14.2.x logs:
//   "Unsupported allowedDevOrigins option detected ..."
// Read the installed Next version and only set the option when it is actually
// supported, so the 14.2.23 build stays warning-free while Wi-Fi phone testing
// keeps working automatically after a future Next.js upgrade.
const require = createRequire(import.meta.url);
const nextMajorVersion = Number.parseInt(
  require('next/package.json').version.split('.')[0] ?? '0',
  10,
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
  
  // Enable React strict mode for development
  reactStrictMode: true,

  // Physical-phone LAN testing: allow the dev server to be reached from a phone
  // on the same Wi-Fi at https://10.174.123.177:3000. Newer Next.js releases
  // lock the dev server to known origins (localhost by default) and read this
  // allow-list; Next 14.2.x ignores it harmlessly. Keep it so upgrades keep
  // phone testing working.
  ...(nextMajorVersion >= 15
    ? { allowedDevOrigins: ['10.174.123.177'] }
    : {}),
  
  // Image optimization configuration
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [320, 480, 640, 750, 828, 1080, 1200, 1920, 2048],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 86400,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  
  compress: true,
  productionBrowserSourceMaps: false,
  
  experimental: {
    // Vercel Hobby build machines cap at 8 GB with no swap; a cold `next build`
    // of this app was getting OOM-killed silently during the compile phase.
    // Next 14.2 forks 4 static-generation workers by default (each loads the
    // whole app graph e.g. three.js) - limiting to 1 keeps peak memory well
    // below the cap. This machine reports 2 cores, so no parallelism is lost.
    cpus: 1,
    optimizePackageImports: [
      'lucide-react',
      'socket.io-client',
      '@vercel/analytics',
    ],
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // VANTA Live needs camera + microphone. An empty allowlist `()` disables
          // getUserMedia for the site's OWN origin, blocking Go Live at the
          // Permissions-Policy layer before the browser permission prompt appears.
          // `(self)` grants the VANTA origin access while still denying third-party
          // iframes. FLoC (interest-cohort) stays disabled for privacy.
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), display-capture=(self), geolocation=(), interest-cohort=()' },
        ],
      },
      {
        source: '/images/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/fonts/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
      },
    ];
  },

  async redirects() {
    return [
      { source: '/chat', destination: '/messages', permanent: false },
      { source: '/chat/:conversationId', destination: '/messages?conversation=:conversationId', permanent: false },
      { source: '/wallet', destination: '/balance', permanent: false },
      { source: '/wallet/transactions', destination: '/balance/transactions', permanent: false },
      { source: '/wallet/withdraw', destination: '/balance/withdraw', permanent: false },
      { source: '/gift-store', destination: '/gifts', permanent: false },
    ];
  },

  poweredByHeader: false,
  distDir: '.next',
  trailingSlash: false,
  generateEtags: true,
};

export default nextConfig;