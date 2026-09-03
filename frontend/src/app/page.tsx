import type { Metadata } from "next";
import LandingExperience from "@/components/landing/LandingExperience";
import { SOCIAL_IMAGE_URL } from "@/lib/i18n/seo";

export const metadata: Metadata = {
  title: "VANTA | Create. Connect. Live.",
  description: "Create, discover, connect, and build your community on VANTA.",
  alternates: { canonical: "https://vanta.app" },
  openGraph: {
    title: "VANTA | Create. Connect. Live.",
    description: "A next-generation social platform for moments, creators, communities, and LIVE experiences.",
    url: "https://vanta.app",
    siteName: "VANTA",
    type: "website",
    images: [{ url: SOCIAL_IMAGE_URL, width: 1200, height: 630, alt: "VANTA social platform" }],
  },
  twitter: { card: "summary_large_image", title: "VANTA | Create. Connect. Live.", description: "Create, discover, connect, and go LIVE on VANTA.", images: [SOCIAL_IMAGE_URL] },
};

export default function Home() {
  return <LandingExperience />;
}