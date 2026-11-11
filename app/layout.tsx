import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";

import { BottomNav, BottomNavLinks } from "@/components/layout/BottomNav";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Slipstream",
  description: "A read-only live feed of Hyperliquid perps traders.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // On iPhone, push alerts work only for the app on the Home Screen.
  appleWebApp: { capable: true, title: "Slipstream", statusBarStyle: "black" },
};

// viewport-fit=cover makes env(safe-area-inset-bottom) work on iPhones,
// so the mobile bottom bar clears the home indicator.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0b0d",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* The bottom padding reserves the space of the mobile bottom bar (0 from lg up). */}
      <body className="flex min-h-full flex-col pb-(--bottom-nav-space)">
        <Providers>
          <Header />
          <main className="flex min-h-0 flex-1 flex-col">{children}</main>
          <Footer />
          {/* The bar reads the URL, so it needs a Suspense boundary (cacheComponents). */}
          <Suspense fallback={<BottomNavLinks active={null} />}>
            <BottomNav />
          </Suspense>
        </Providers>
      </body>
    </html>
  );
}
