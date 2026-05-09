"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type Item = { href: string; label: string; emoji: string; tone?: "gold" };

export function MobileMoreMenu({ isPlatformAdmin }: { isPlatformAdmin: boolean }) {
  const [open, setOpen] = useState(false);

  // Close on route change (link click) and on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const items: Item[] = [
    { href: "/leaderboards", label: "Leaderboards", emoji: "📊" },
    { href: "/records", label: "Records", emoji: "🏆" },
    { href: "/dashboard", label: "Rounds", emoji: "⛳" },
    { href: "/players", label: "Players", emoji: "👥" },
    { href: "/courses", label: "Courses", emoji: "🗺️" },
    { href: "/ledger", label: "Ledger", emoji: "💵" },
    { href: "/feedback", label: "Send feedback", emoji: "💬" }
  ];
  if (isPlatformAdmin) {
    items.push({ href: "/admin", label: "Admin", emoji: "🛡️", tone: "gold" });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="py-3 text-center text-sm font-medium text-cream-100/80 active:bg-brand-900"
        aria-label="More menu"
      >
        More
      </button>
      {open && (
        <div
          className="sm:hidden fixed inset-0 z-50 flex flex-col"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            aria-label="Close menu"
            className="flex-1 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="bg-brand-950 border-t border-cream-100/15 rounded-t-2xl p-4 pb-8 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <p className="h-eyebrow text-gold-400">Menu</p>
              <button
                type="button"
                className="btn-ghost text-sm"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {items.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={() => setOpen(false)}
                  className={`card p-4 flex flex-col items-start gap-1 hover:bg-brand-900/80 transition-colors ${
                    it.tone === "gold" ? "border border-gold-500/40" : ""
                  }`}
                >
                  <span className="text-xl">{it.emoji}</span>
                  <span
                    className={`font-serif text-sm ${
                      it.tone === "gold" ? "text-gold-400" : "text-cream-50"
                    }`}
                  >
                    {it.label}
                  </span>
                </Link>
              ))}
            </div>
            <form action="/auth/signout" method="post" className="mt-3">
              <button
                type="submit"
                className="btn-ghost w-full text-sm text-cream-100/70"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
