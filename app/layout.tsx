import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import Script from "next/script";
import "./globals.css";

// Google Analytics measurement ID. Hardcoded — GA IDs are public
// (they ship in client-side script tags anyway) so there's no benefit
// to env-vault gymnastics. NEXT_PUBLIC_GA_ID can override at build
// time if a staging deploy needs a different stream.
//
// Gated to production so `npm run dev` doesn't pollute the analytics
// stream with localhost traffic.
const GA_ID =
  process.env.NEXT_PUBLIC_GA_ID ?? "G-E53NK6G8JN";
const GA_ENABLED = process.env.NODE_ENV === "production";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap"
});

const instrument = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-instrument",
  display: "swap"
});

export const metadata: Metadata = {
  title: { default: "Cruz Golf", template: "%s · Cruz Golf" },
  description: "Live scoring + betting for Cruz's golf group.",
  applicationName: "Cruz Golf",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/cruz-logo.png", type: "image/png" }],
    apple: [{ url: "/cruz-logo.png" }],
    shortcut: ["/cruz-logo.png"]
  },
  appleWebApp: {
    capable: true,
    title: "Cruz Golf",
    statusBarStyle: "black-translucent"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // maximumScale dropped 2026-05-11 — the prior value of 1 prevented
  // pinch-zoom on iOS, which is an accessibility regression. iOS
  // already auto-zooms on form inputs <16px so the PWA-feel use case
  // is covered by font-size, not viewport lockdown.
  // viewportFit: "cover" is REQUIRED for proper notch / Dynamic Island
  // handling on iPhones with edge-to-edge screens. Without it the app
  // gets letterboxed and `env(safe-area-inset-*)` returns 0.
  viewportFit: "cover",
  // Theme color synced with `public/manifest.webmanifest` (#0a1f1a —
  // brand-900) so the iOS PWA status-bar tint matches the launch
  // background and there's no "flash to a different green" on cold
  // start.
  themeColor: "#0a1f1a"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${instrument.variable} dark`}>
      <head>
        {/* Google Analytics — gtag.js. Loaded with `afterInteractive` so
            it doesn't block the LCP. The script tag still lands inside
            <head> via Next.js's deduper. Production only — dev traffic
            does not hit GA. */}
        {GA_ENABLED && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga-init" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}', { send_page_view: true });`}
            </Script>
          </>
        )}
      </head>
      <body className="font-sans antialiased min-h-screen">{children}</body>
    </html>
  );
}
