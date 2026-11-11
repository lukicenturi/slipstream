import type { MetadataRoute } from "next";

/** The web app manifest. On iPhone, push alerts need the app on the Home Screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Slipstream",
    short_name: "Slipstream",
    description: "A live feed of Hyperliquid perps traders, with alerts for the traders you track.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0b0d",
    theme_color: "#0a0b0d",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
