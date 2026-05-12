import Link from "next/link";
import { BrandLockup } from "@/components/BrandLockup";

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col pb-20 sm:pb-0">
      <header className="sticky top-0 z-10 bg-brand-950/90 backdrop-blur border-b border-cream-100/10">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 flex items-center justify-between gap-4 min-h-[80px] sm:min-h-[112px]">
          <Link
            href="/demo"
            className="flex items-center shrink-0"
            aria-label="Cruz Golf demo home"
          >
            <span className="hidden sm:inline-flex">
              <BrandLockup iconHeight={120} />
            </span>
            <span className="sm:hidden inline-flex">
              <BrandLockup iconHeight={72} />
            </span>
          </Link>
          <nav className="hidden sm:flex items-center gap-1">
            <Link href="/demo/round" className="btn-ghost text-sm">Leaderboard</Link>
            <Link href="/demo/round/score" className="btn-ghost text-sm">Score</Link>
            <Link href="/demo/profile" className="btn-ghost text-sm">Profile</Link>
            <Link href="/demo/ledger" className="btn-ghost text-sm">Ledger</Link>
          </nav>
          <Link href="/" className="btn-secondary text-xs">Back to site</Link>
        </div>
        <div className="bg-gold-500/15 border-t border-gold-500/30 px-4 py-1.5 text-center">
          <span className="text-[10px] uppercase tracking-[0.28em] text-gold-300">
            Demo mode · dummy data · no login required
          </span>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">{children}</main>
      <nav
        // Demo mobile nav — mirror the main app's safe-area padding
        // so the home indicator on installed iPhones doesn't overlap
        // the tab targets. (Chaos QA, 2026-05-12.)
        className="sm:hidden fixed bottom-0 inset-x-0 bg-brand-950/95 backdrop-blur border-t border-cream-100/10 grid grid-cols-4"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <Tab href="/demo/round" label="Leaderboard" />
        <Tab href="/demo/round/score" label="Score" />
        <Tab href="/demo/profile" label="Profile" />
        <Tab href="/demo/ledger" label="Ledger" />
      </nav>
    </div>
  );
}

function Tab({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="py-3 text-center text-sm font-medium text-cream-100/80">
      {label}
    </Link>
  );
}
