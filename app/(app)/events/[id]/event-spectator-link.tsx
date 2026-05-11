"use client";
import { useEffect, useState } from "react";

/**
 * Copyable spectator URL for an event. Renders the full URL once the
 * client knows the origin (server-rendered URL wouldn't have the
 * host). Tap-to-copy with a 2-second confirmation toast.
 */
export function EventSpectatorLink({
  eventId,
  token
}: {
  eventId: string;
  token: string;
}) {
  const [url, setUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setUrl(
      `${window.location.origin}/events/${eventId}/leaderboard?token=${encodeURIComponent(token)}`
    );
  }, [eventId, token]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      /* clipboard denied — fall back to selecting the input */
    }
  }

  return (
    <section className="card p-4 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="h-eyebrow text-cream-100/55">Spectator link</p>
        {copied && (
          <span className="text-[11px] text-emerald-300">
            ✓ Copied
          </span>
        )}
      </div>
      <p className="text-xs text-cream-100/65 leading-snug">
        Share this URL with anyone — family, friends in another foursome,
        members at the clubhouse bar. No account required. The page
        updates live as foursomes post scores.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="input text-xs font-mono flex-1 min-w-0"
          aria-label="Spectator URL"
        />
        <button
          type="button"
          onClick={copy}
          disabled={!url}
          className="btn-primary text-xs shrink-0"
        >
          Copy
        </button>
      </div>
    </section>
  );
}
