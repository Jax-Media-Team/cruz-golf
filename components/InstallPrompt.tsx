"use client";
import { useEffect, useState } from "react";

/**
 * Lightweight install/PWA prompt.
 *
 * Three paths:
 *   1. Chromium with `beforeinstallprompt`: surfaces an "Install" button
 *      that calls `prompt()`.
 *   2. iOS Safari (the only iOS browser that supports A2HS): shows the
 *      "tap the Share button at the bottom of Safari, then Add to Home
 *      Screen" walkthrough with the actual Safari icon glyph + arrow.
 *   3. iOS in a non-Safari context (Chrome, Firefox, in-app webview):
 *      tells the user to open in Safari first, since A2HS doesn't work
 *      anywhere else on iOS. We can deep-link with x-safari-https://.
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
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * Detect Safari (the only iOS browser that supports A2HS). Apple gates
 * Add-to-Home-Screen behind WebKit + Safari's UI specifically — Chrome
 * iOS, Firefox iOS, and in-app webviews all use WebKit but won't show
 * the option.
 */
function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  if (!isIos()) return false;
  const ua = navigator.userAgent;
  // True Safari on iOS contains "Safari/" and does NOT contain CriOS,
  // FxiOS, or "EdgiOS" (Edge for iOS), and is NOT inside a WKWebView
  // (most webviews omit "Safari/" entirely; some custom UAs include it,
  // so this is best-effort).
  if (/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|DuckDuckGo/i.test(ua)) return false;
  if (!/Safari\//.test(ua)) return false;
  // Webviews like Instagram / FB / Twitter / Slack often add their app name
  // to the UA. Detect the common ones.
  if (/FBAN|FBAV|Instagram|Twitter|Pinterest|LinkedInApp|Line/i.test(ua)) return false;
  return true;
}

export function InstallPrompt() {
  const [event, setEvent] = useState<BIPEvent | null>(null);
  const [iosVariant, setIosVariant] = useState<"safari" | "non-safari" | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (isStandaloneDisplay()) {
      setInstalled(true);
      return;
    }
    try {
      const last = Number(localStorage.getItem(DISMISS_KEY) || "0");
      if (Date.now() - last < COOLDOWN_MS) return;
    } catch {
      /* localStorage disabled — proceed */
    }

    function onBIP(e: Event) {
      e.preventDefault();
      setEvent(e as BIPEvent);
    }
    window.addEventListener("beforeinstallprompt", onBIP as any);

    if (isIos()) {
      const variant: "safari" | "non-safari" = isIosSafari() ? "safari" : "non-safari";
      const t = window.setTimeout(() => setIosVariant(variant), 1500);
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
    setIosVariant(null);
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
  if (!event && !iosVariant) return null;

  return (
    <div
      className="fixed inset-x-3 z-40 sm:right-4 sm:left-auto sm:max-w-sm"
      style={{ bottom: "calc(5rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <div className="card p-3 border border-gold-500/40 shadow-2xl bg-brand-950 flex items-start gap-3">
        <span className="text-2xl mt-0.5">📲</span>
        <div className="flex-1 min-w-0">
          <p className="font-serif text-sm text-cream-50">Install Cruz Golf</p>

          {/* Chromium path — actual prompt() */}
          {event && (
            <p className="text-[11px] text-cream-100/65 mt-0.5">
              Add it to your home screen for one-tap access on the cart.
            </p>
          )}

          {/* iOS Safari path — actual A2HS walkthrough */}
          {iosVariant === "safari" && (
            <div className="text-[11px] text-cream-100/65 mt-0.5 space-y-1.5">
              <p>
                Tap the{" "}
                {/* Apple's share-sheet glyph: square with up arrow */}
                <span
                  aria-label="Safari Share button"
                  className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-cream-100/15 text-cream-50 text-[11px] align-[-3px] mx-0.5"
                  title="Share"
                >
                  ↑
                </span>{" "}
                <span className="text-cream-50">Share</span> button at the{" "}
                <span className="text-cream-50">bottom of Safari</span>, then
                scroll and pick{" "}
                <span className="text-cream-50">&ldquo;Add to Home Screen&rdquo;</span>.
              </p>
              <p className="text-cream-100/45 italic">
                On iPhone the Share button is in the toolbar at the bottom edge
                of Safari (between the back/forward arrows and the tabs icon).
              </p>
            </div>
          )}

          {/* iOS non-Safari (Chrome / Firefox / in-app browser) — A2HS
              isn't available; redirect them to Safari. */}
          {iosVariant === "non-safari" && (
            <div className="text-[11px] text-cream-100/65 mt-0.5 space-y-1.5">
              <p>
                On iPhone, &ldquo;Add to Home Screen&rdquo; only works in{" "}
                <span className="text-cream-50">Safari</span>. Open this page
                in Safari, then tap{" "}
                <span className="text-cream-50">Share</span> →{" "}
                <span className="text-cream-50">Add to Home Screen</span>.
              </p>
              <p className="text-cream-100/45">
                If you&apos;re in another app (Chrome, Instagram, Slack), tap
                the &ldquo;⋯&rdquo; or &ldquo;Open in browser&rdquo; option to
                jump to Safari first.
              </p>
            </div>
          )}

          <div className="mt-2 flex gap-2">
            {event && (
              <button onClick={install} className="btn-primary text-xs">
                Install
              </button>
            )}
            {iosVariant === "non-safari" && (
              <a
                href={typeof window !== "undefined" ? window.location.href : "/"}
                onClick={(e) => {
                  // x-safari-https:// scheme jumps to Safari from most iOS
                  // browsers / webviews. Falls back to current URL if unsupported.
                  e.preventDefault();
                  const url = window.location.href.replace(/^https?:\/\//, "x-safari-https://");
                  window.location.href = url;
                  // Some browsers swallow the scheme — fall back after 800ms
                  // by navigating normally so the user isn't stuck.
                  setTimeout(() => {
                    window.location.href = window.location.href;
                  }, 800);
                }}
                className="btn-primary text-xs"
              >
                Open in Safari
              </a>
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
