"use client";
import { useEffect, useState } from "react";

/**
 * Lightweight install/PWA prompt.
 *
 * Two paths:
 *   - Chromium (Android, desktop Chrome/Edge): listens for the
 *     `beforeinstallprompt` event and surfaces a card with an
 *     "Install" button that calls `prompt()`.
 *   - iOS Safari: never fires beforeinstallprompt. We detect it from
 *     navigator.userAgent and show a card with "Add to Home Screen"
 *     instructions.
 *
 * The prompt is dismissable; we remember the dismissal in localStorage
 * so it doesn't nag every visit. Re-shows after 30 days.
 */
const DISMISS_KEY = "cruz-golf:installPrompt:dismissedAt";
const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  // Chrome standalone or iOS standalone.
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  // Don't include iPadOS desktop UA — those will fire beforeinstallprompt
  // through Chromium-on-iPadOS-with-feature-flag, but mostly we still want
  // the iOS-style guidance there too.
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function InstallPrompt() {
  const [event, setEvent] = useState<BIPEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (isStandaloneDisplay()) {
      setInstalled(true);
      return;
    }
    // Respect dismissal cooldown.
    try {
      const last = Number(localStorage.getItem(DISMISS_KEY) || "0");
      if (Date.now() - last < COOLDOWN_MS) return;
    } catch {
      /* localStorage disabled — proceed */
    }

    // Chromium path
    function onBIP(e: Event) {
      e.preventDefault();
      setEvent(e as BIPEvent);
    }
    window.addEventListener("beforeinstallprompt", onBIP as any);

    // iOS Safari fallback — no event, just show after a short delay
    if (isIos()) {
      const t = window.setTimeout(() => setShowIos(true), 1500);
      return () => {
        window.clearTimeout(t);
        window.removeEventListener("beforeinstallprompt", onBIP as any);
      };
    }

    return () => window.removeEventListener("beforeinstallprompt", onBIP as any);
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setEvent(null);
    setShowIos(false);
  }

  async function install() {
    if (!event) return;
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
    } catch {
      /* user cancelled */
    }
    setEvent(null);
  }

  if (installed) return null;
  if (!event && !showIos) return null;

  return (
    <div
      className="fixed inset-x-3 z-40 sm:right-4 sm:left-auto sm:max-w-sm"
      style={{ bottom: "calc(5rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <div className="card p-3 border border-gold-500/40 shadow-2xl bg-brand-950 flex items-start gap-3">
        <span className="text-2xl mt-0.5">📲</span>
        <div className="flex-1 min-w-0">
          <p className="font-serif text-sm text-cream-50">Install Cruz Golf</p>
          {event ? (
            <p className="text-[11px] text-cream-100/65 mt-0.5">
              Add it to your home screen for one-tap access on the cart.
            </p>
          ) : (
            <p className="text-[11px] text-cream-100/65 mt-0.5">
              Tap <span className="text-cream-50">Share</span> ▾ then{" "}
              <span className="text-cream-50">&ldquo;Add to Home Screen&rdquo;</span>.
            </p>
          )}
          <div className="mt-2 flex gap-2">
            {event && (
              <button onClick={install} className="btn-primary text-xs">
                Install
              </button>
            )}
            <button onClick={dismiss} className="btn-ghost text-xs">
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
