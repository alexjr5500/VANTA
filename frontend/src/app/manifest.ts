import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VANTA — Create. Connect. Live.",
    short_name: "VANTA",
    description:
      "Premium social streaming, creator, and discovery platform. Discover people, follow creators, chat, join live streams, and build communities.",
    start_url: "/",
    display: "standalone",
    background_color: "#050505",
    theme_color: "#050505",
    icons: [
      { src: "/branding/vanta-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/branding/vanta-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/branding/vanta-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}