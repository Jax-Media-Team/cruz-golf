import Link from "next/link";

/**
 * Sticky read-only marker for any surface a Platform Admin reaches via the
 * spectator path. The whole point: when an admin is debugging or
 * supporting another user, the UI should be unmistakable about who they
 * are looking at and that nothing they do here mutates that user's data.
 *
 * This is NOT impersonation. There is no auth/session swap. The admin
 * keeps their own permissions; the page they're rendering is the existing
 * token-keyed public spectator surface, just with a banner overlay.
 *
 * Render this above the round leaderboard / group view / round detail
 * whenever the URL signals admin observability mode (`?adminMode=1`).
 */
export function AdminSpectatorBanner({
  subject,
  context,
  backHref = "/admin"
}: {
  /** "viewing Patrick's round" / "viewing Sunday Crew group" */
  subject?: string;
  /** Optional second-line context: "live · finalize when ready" etc. */
  context?: string;
  /** Where the "back to admin" link points — defaults to /admin home. */
  backHref?: string;
}) {
  return (
    <div
      className="sticky top-0 z-30 border-b border-gold-500/40 bg-gold-500/10 backdrop-blur"
      role="status"
      aria-live="polite"
    >
      <div className="max-w-3xl mx-auto px-4 py-2 flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base shrink-0" aria-hidden="true">🛡</span>
          <div className="min-w-0">
            <div className="text-gold-400 font-medium leading-tight">
              Platform Admin · read-only spectator
            </div>
            {(subject || context) && (
              <div className="text-cream-100/70 text-[11px] leading-tight truncate">
                {subject}
                {subject && context ? " · " : ""}
                {context}
              </div>
            )}
          </div>
        </div>
        <Link
          href={backHref}
          className="btn-ghost text-[11px] shrink-0 border border-gold-500/30"
        >
          ← Admin
        </Link>
      </div>
    </div>
  );
}
