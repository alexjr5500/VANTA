import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // Stable install identity for the Chrome-installed PWA. `id` must not change
    // once people have installed so browsers keep treating this as the same app.
    id: "/",
    name: "VANTA — Create. Connect. Live.",
    short_name: "VANTA",
    description:
      "Premium social streaming, creator, and discovery platform. Discover people, follow creators, chat, join live streams, and build communities.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone"],
    orientation: "any",
    background_color: "#050505",
    theme_color: "#050505",
    icons: [
      { src: "/branding/vanta-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/branding/vanta-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/branding/vanta-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}