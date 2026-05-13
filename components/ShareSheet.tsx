"use client";
import { useEffect, useState } from "react";

type Props = {
  /** What we're sharing — used as the dialog title and Web Share API title. */
  title: string;
  /** The page URL to share (spectator link, public record book, etc.). */
  url: string;
  /** Optional path to a generated PNG (for "Download image" + native file share). */
  imageUrl?: string;
  /** Filename used for the Download Image option + native file share. */
  imageFilename?: string;
  /** Custom button label/look. */
  triggerLabel?: string;
  triggerClassName?: string;
};

/**
 * Plain-language share sheet. Replaces "Open share image" buttons.
 *
 * Targets in order:
 *  - Native share sheet (iOS + Android): opens the OS share sheet via
 *    navigator.share(). On iPhone this surfaces Facebook, Instagram,
 *    Messages, Mail, X, etc. — every installed app shows up. When the
 *    browser supports Web Share Level 2 (`canShare({files})`) we ALSO
 *    attach the leaderboard PNG so receiving apps don't have to scrape
 *    OG tags — Instagram in particular only accepts files, not URLs.
 *  - "Share on Facebook" — direct facebook.com/sharer/sharer.php link.
 *    Works on every browser including desktop. Facebook scrapes the
 *    OG image meta tag from the spectator URL so the leaderboard image
 *    auto-attaches to the post.
 *  - "Share on X" — direct twitter.com/intent/tweet link. Same OG image
 *    scraping. Works on every browser.
 *  - Copy link — for group chats / Messages / anywhere else.
 *  - Download image — saves the PNG so the user can attach it manually
 *    to Instagram stories or any other app that doesn't appear in the
 *    native sheet.
 *  - "Post to Instagram" — instructions card, because Meta does NOT
 *    expose a web URL for IG posting. iOS native share sheet works
 *    directly; desktop users have to save the image + post manually.
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
  const [busyShare, setBusyShare] = useState(false);

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

  /**
   * Try to share the leaderboard image as a FILE via the native share
   * sheet. iOS Safari + Android Chrome support this (Web Share Level 2).
   * When the file share works, every social app gets the image directly
   * — Instagram in particular only accepts files (not URLs). When the
   * browser doesn't support files, fall back to URL-only share which
   * relies on the receiving app scraping the OG image meta tag.
   */
  async function shareNative() {
    if (typeof navigator === "undefined" || !("share" in navigator)) {
      return copy();
    }
    setBusyShare(true);
    try {
      // Try file share first when imageUrl is available + browser
      // supports it. Fetch the PNG, wrap in a File, call canShare to
      // confirm the runtime accepts it.
      if (imageUrl && typeof (navigator as any).canShare === "function") {
        try {
          const absoluteImageUrl = imageUrl.startsWith("http")
            ? imageUrl
            : `${window.location.origin}${imageUrl}`;
          const res = await fetch(absoluteImageUrl);
          if (res.ok) {
            const blob = await res.blob();
            const file = new File(
              [blob],
              imageFilename ?? "cruz-golf-leaderboard.png",
              { type: blob.type || "image/png" }
            );
            const payload = { title, url, files: [file] } as any;
            if ((navigator as any).canShare(payload)) {
              await (navigator as any).share(payload);
              setBusyShare(false);
              setOpen(false);
              return;
            }
          }
        } catch {
          // File fetch / share failed — fall through to URL-only share.
        }
      }
      // URL-only fallback. iOS still surfaces every social app in the
      // share sheet; they each scrape the spectator URL's OG image
      // when previewing. Works fine for FB, X, Messages, Mail — not
      // for Instagram (which only accepts files).
      await (navigator as any).share({ title, url });
      setBusyShare(false);
      setOpen(false);
    } catch {
      // User cancelled or share failed — silent.
      setBusyShare(false);
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

  function shareToFacebook() {
    const encoded = encodeURIComponent(url);
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${encoded}`,
      "_blank",
      "noopener,width=600,height=600"
    );
  }

  function shareToX() {
    const encoded = encodeURIComponent(url);
    const text = encodeURIComponent(title);
    window.open(
      `https://twitter.com/intent/tweet?url=${encoded}&text=${text}`,
      "_blank",
      "noopener,width=600,height=600"
    );
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
          <div className="relative w-full sm:max-w-md bg-brand-950 border-t border-cream-100/15 sm:border sm:rounded-2xl rounded-t-2xl p-5 pb-8 shadow-2xl max-h-[90vh] overflow-y-auto">
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
                  className="card w-full p-3 flex items-center gap-3 hover:bg-brand-900/80 transition-colors disabled:opacity-50"
                  onClick={shareNative}
                  disabled={busyShare}
                >
                  <span className="text-2xl">📤</span>
                  <div className="text-left">
                    <div className="font-serif text-cream-50 text-sm">
                      {busyShare ? "Opening share sheet…" : "Share"}
                    </div>
                    <p className="text-[11px] text-cream-100/55">
                      Open your phone&apos;s share menu — Messages, Instagram, FB, X, anywhere.
                    </p>
                  </div>
                </button>
              )}

              {/* Direct Facebook share — works on desktop and as a fallback
                  on mobile. Facebook scrapes the spectator URL's OG image
                  so the leaderboard preview attaches automatically. */}
              <button
                type="button"
                className="card w-full p-3 flex items-center gap-3 hover:bg-brand-900/80 transition-colors"
                onClick={shareToFacebook}
              >
                <span
                  className="text-2xl inline-flex items-center justify-center w-7 h-7 rounded-md"
                  style={{ background: "#1877F2", color: "white" }}
                  aria-hidden="true"
                >
                  f
                </span>
                <div className="text-left flex-1 min-w-0">
                  <div className="font-serif text-cream-50 text-sm">
                    Share on Facebook
                  </div>
                  <p className="text-[11px] text-cream-100/55">
                    Opens a Facebook share window with the leaderboard preview attached.
                  </p>
                </div>
              </button>

              {/* Direct X share — text + URL prefilled. */}
              <button
                type="button"
                className="card w-full p-3 flex items-center gap-3 hover:bg-brand-900/80 transition-colors"
                onClick={shareToX}
              >
                <span
                  className="text-2xl inline-flex items-center justify-center w-7 h-7 rounded-md text-white font-bold text-sm"
                  style={{ background: "#000" }}
                  aria-hidden="true"
                >
                  𝕏
                </span>
                <div className="text-left flex-1 min-w-0">
                  <div className="font-serif text-cream-50 text-sm">
                    Share on X
                  </div>
                  <p className="text-[11px] text-cream-100/55">
                    Tweet the leaderboard link — image preview attaches automatically.
                  </p>
                </div>
              </button>

              {/* Instagram instructions — no web URL exists for IG posting.
                  iPhone users get IG in the native share sheet above
                  (Web Share Level 2 sends the file directly). Desktop +
                  fallback path: download the image, then post manually. */}
              {imageUrl && (
                <div className="card w-full p-3 flex items-start gap-3 border border-cream-100/15">
                  <span
                    className="text-2xl inline-flex items-center justify-center w-7 h-7 rounded-md text-white font-bold flex-shrink-0"
                    style={{
                      background:
                        "linear-gradient(45deg,#f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%)"
                    }}
                    aria-hidden="true"
                  >
                    ◉
                  </span>
                  <div className="text-left flex-1 min-w-0">
                    <div className="font-serif text-cream-50 text-sm">
                      Post to Instagram
                    </div>
                    <p className="text-[11px] text-cream-100/55 leading-snug">
                      On iPhone: tap <span className="text-cream-50">Share</span> above → pick Instagram from the system sheet.
                      On desktop: tap <span className="text-cream-50">Download image</span> below, then attach manually in Instagram (Meta doesn&apos;t support direct web posting).
                    </p>
                  </div>
                </div>
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
                        Save the PNG to post manually in Instagram or anywhere else.
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
