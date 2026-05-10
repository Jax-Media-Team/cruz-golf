"use client";
import { useState } from "react";
import { ShareSheet } from "@/components/ShareSheet";

/**
 * Per-rivalry share button for the player stats page.
 *
 * Renders a small "Share" link next to each rivalry row. On tap, opens
 * the existing ShareSheet which:
 *   - Web Share API on mobile (native sheet) when available
 *   - Falls back to "copy link" + "open image" otherwise
 *
 * The image URL points at /api/share/rivalry/image?a=...&b=... which
 * the OG card route renders server-side.
 */
export function RivalryShareButton({
  playerAId,
  playerBId,
  playerAName,
  playerBName,
  myWins,
  theirWins
}: {
  playerAId: string;
  playerBId: string;
  playerAName: string;
  playerBName: string;
  myWins: number;
  theirWins: number;
}) {
  // Build a stable share URL. The image route reads a + b from the
  // query string and emits a 1200×630 PNG.
  const [origin, setOrigin] = useState<string>("");
  if (typeof window !== "undefined" && origin === "") {
    setOrigin(window.location.origin);
  }
  const imageUrl = `${origin}/api/share/rivalry/image?a=${playerAId}&b=${playerBId}`;
  // Page link to the player stats page so the share has a destination
  // when the recipient taps it. Falls back to the API image URL itself.
  const pageUrl = `${origin}/players/${playerAId}/stats`;
  const title = `${playerAName} vs ${playerBName}: ${myWins}-${theirWins}`;

  return (
    <ShareSheet
      title={title}
      url={pageUrl}
      imageUrl={imageUrl}
      imageFilename={`cruz-golf-rivalry-${playerAId}-${playerBId}.png`}
      triggerLabel="Share"
      triggerClassName="btn-ghost text-[10px] px-2 py-0.5"
    />
  );
}
