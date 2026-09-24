// =============================================================================
// VANTA-owned contact & social destinations — SINGLE SOURCE OF TRUTH.
// The landing page footer, Contact page, Settings Help Center and any other
// VANTA surface must import these URLs instead of defining their own copies so
// there is never a second, diverging set of links.
// =============================================================================

export interface VantaSocialLink {
  platform: string;
  label: string;
  href: string;
  ariaLabel: string;
}

export const VANTA_SOCIAL_LINKS: VantaSocialLink[] = [
  {
    platform: "x",
    label: "X",
    href: "https://x.com/Vantaapp",
    ariaLabel: "Follow VANTA on X",
  },
  {
    platform: "telegram",
    label: "Telegram Channel",
    href: "https://t.me/Vanta_HQ",
    ariaLabel: "Subscribe to the VANTA Telegram channel",
  },
  {
    platform: "telegramGroup",
    label: "Telegram Group",
    href: "https://t.me/Vantanow",
    ariaLabel: "Join the VANTA Telegram group",
  },
];

export const VANTA_SUPPORT_EMAIL = "support@vanta.app";
export const VANTA_GENERAL_EMAIL = "hello@vanta.app";
export const VANTA_WEBSITE_URL = "https://vanta.app";