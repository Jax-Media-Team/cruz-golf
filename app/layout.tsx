import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import "./globals.css";

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
  maximumScale: 1,
  themeColor: "#0d3b2a"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${instrument.variable} dark`}>
      <body className="font-sans antialiased min-h-screen">{children}</body>
    </html>
  );
}
