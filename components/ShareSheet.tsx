"use client";
import { useEffect, useState } from "react";

type Props = {
  /** What we're sharing — used as the dialog title and Web Share API title. */
  title: string;
  /** The page URL to share (spectator link, public record book, etc.). */
  url: string;
  /** Optional path to a generated PNG (for "Download image" + "Share image"). */
  imageUrl?: string;
  /** Filename used for the Download Image option. */
  imageFilename?: string;
  /** Custom button label/look. */
  triggerLabel?: string;
  triggerClassName?: string;
};

/**
 * Plain-language share sheet. Replaces "Open share image" buttons.
 *
 * Behaviour:
 *  - "Share leaderboard" — opens the OS share sheet (iOS/Android/Edge) via
 *    navigator.share(). On desktop browsers without it, falls back to copy.
 *  - "Copy link" — copies the URL.
 *  - "Download image" — downloads the PNG (only if imageUrl is set).
 *  - "Open image" — opens the image in a new tab (handy for screenshotting).
 *
 * The dialog is a bottom sheet on mobile and a centered card on desktop.
 */
export function ShareSheet({
  title,
  url,
  imageUrl,
  imageFilename,
  triggerLabel = "Share",
  triggerClassName = "btn-secondary text-xs"
}: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

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

  async function shareNative() {
    if (typeof navigator === "undefined" || !("share" in navigator)) {
      // Fallback: copy
      return copy();
    }
    try {
      await (navigator as any).share({ title, url });
      setOpen(false);
    } catch {
      // User cancelled or share failed — silent.
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this link:", url);
    }
  }

  function openImage() {
    if (!imageUrl) return;
    window.open(imageUrl, "_blank", "noopener");
  }

  const hasNativeShare =
    typeof navigator !== "undefined" && "share" in (navigator as any);

  return (
    <>
      <button type="button" className={triggerClassName} onClick={() => setOpen(true)}>
        {triggerLabel}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            aria-label="Close share sheet"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="relative w-full sm:max-w-md bg-brand-950 border-t border-cream-100/15 sm:border sm:rounded-2xl rounded-t-2xl p-5 pb-8 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <p className="h-eyebrow text-gold-400">Share</p>
              <button
                type="button"
                className="btn-ghost text-sm"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            <p className="font-serif text-lg text-cream-50 truncate mb-4">{title}</p>

            <div className="space-y-2">
              {hasNativeShare && (
                <button
                  type="button"
                  className="card w-full p-3 flex items-center gap-3 hover:bg-brand-900/80 transition-colors"
                  onClick={shareNative}
                >
                  <span className="text-2xl">📤</span>
                  <div className="text-left">
                    <div className="font-serif text-cream-50 text-sm">
                      Share leaderboard
                    </div>
                    <p className="text-[11px] text-cream-100/55">
                      Open your phone&apos;s share menu (text, group, social).
                    </p>
                  </div>
                </button>
              )}
              <button
                type="button"
                className="card w-full p-3 flex items-center gap-3 hover:bg-brand-900/80 transition-colors"
                onClick={copy}
              >
                <span className="text-2xl">🔗</span>
                <div className="text-left flex-1 min-w-0">
                  <div className="font-serif text-cream-50 text-sm">
                    {copied ? "Copied!" : "Copy link"}
                  </div>
                  <p className="text-[11px] text-cream-100/55 truncate">{url}</p>
                </div>
              </button>
              {imageUrl && (
                <>
                  <a
                    href={imageUrl}
                    download={imageFilename ?? "leaderboard.png"}
                    className="card w-full p-3 flex items-center gap-3 hover:bg-brand-900/80 transition-colors"
                    onClick={() => setOpen(false)}
                  >
                    <span className="text-2xl">⬇️</span>
                    <div className="text-left">
                      <div className="font-serif text-cream-50 text-sm">
                        Download image
                      </div>
                      <p className="text-[11px] text-cream-100/55">
                        Save the PNG so you can post it anywhere.
                      </p>
                    </div>
                  </a>
                  <button
                    type="button"
                    className="card w-full p-3 flex items-center gap-3 hover:bg-brand-900/80 transition-colors"
                    onClick={openImage}
                  >
                    <span className="text-2xl">🖼️</span>
                    <div className="text-left">
                      <div className="font-serif text-cream-50 text-sm">
                        Open image
                      </div>
                      <p className="text-[11px] text-cream-100/55">
                        Opens in a new tab — good for taking a screenshot.
                      </p>
                    </div>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
