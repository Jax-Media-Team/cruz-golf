/**
 * PartnersBanner — surfaces "who is partnered with whom right now" on
 * the score-entry screen + the round detail page.
 *
 * Patrick 2026-05-13 #9: "In partner games, the app must clearly show
 * who is partnered with who. This is especially important for 6-6-6,
 * best ball, scramble, aggregate, Ryder Cup/event formats. The Enter
 * Scores screen and Leaderboard should make current partners blatantly
 * obvious. For rotating games like 6-6-6: show current segment, show
 * current partners, make it obvious when partners change."
 *
 * The component is a pure presentation layer over `resolveActivePartners`
 * in `lib/games/partners.ts`. When that returns null (no partner game
 * is active or rps aren't ready), this renders nothing.
 *
 * The banner is gold/cream styled to match the brand chrome. It's
 * intentionally tall + prominent because Patrick's concern is that
 * 6-6-6 partner changes were getting lost in the UI.
 */

import {
  resolveActivePartners,
  type PartnerDescriptor
} from "@/lib/games/partners";

type Props = {
  games: Array<{
    id: string;
    game_type: string;
    name: string;
    config?: any;
  }>;
  rps: Array<{
    id: string;
    display_name: string;
    team_id?: string | null;
  }>;
  currentHole: number;
  totalHoles?: 9 | 18;
  /** Optional eyebrow override — defaults to "Current partners". */
  eyebrow?: string;
};

export function PartnersBanner({
  games,
  rps,
  currentHole,
  totalHoles = 18,
  eyebrow = "Current partners"
}: Props) {
  const desc = resolveActivePartners({ games, rps, currentHole, totalHoles });
  if (!desc) return null;
  return <PartnersBannerView desc={desc} eyebrow={eyebrow} />;
}

/** Decoupled pure renderer — handy for tests / Storybook later. */
export function PartnersBannerView({
  desc,
  eyebrow
}: {
  desc: PartnerDescriptor;
  eyebrow: string;
}) {
  return (
    <section
      className="card p-4 border border-gold-500/30 bg-gold-500/5"
      aria-label="Current partners"
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="h-eyebrow text-gold-400">{eyebrow}</p>
        <p className="text-[11px] uppercase tracking-wider text-cream-100/55">
          {desc.game_name}
        </p>
      </div>
      <p className="font-serif text-base text-cream-50 mt-1">
        {desc.segment_label}
      </p>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-2">
        {desc.sides.map((side, i) => (
          <PartnerSide key={side.side_label} side={side} accent={i === 0} />
        ))}
        {/* "vs" divider — only renders between two sides, hidden on 3+
            (rare). The `auto` middle column of the grid puts it cleanly
            between the two side cards on desktop; on mobile it stacks
            vertically. */}
      </div>
      {desc.next_segment_label && (
        <p className="text-[11px] text-amber-300/85 mt-3 flex items-center gap-1.5">
          <span aria-hidden="true">⟳</span>
          <span>{desc.next_segment_label}</span>
        </p>
      )}
    </section>
  );
}

function PartnerSide({
  side,
  accent
}: {
  side: PartnerDescriptor["sides"][number];
  accent: boolean;
}) {
  return (
    <div
      className={`rounded-lg px-3 py-2.5 ${
        accent
          ? "bg-emerald-500/10 border border-emerald-400/30"
          : "bg-brand-900/60 border border-cream-100/15"
      }`}
    >
      <p className="text-[10px] uppercase tracking-wider text-cream-100/55">
        {side.side_label}
      </p>
      <p className="font-serif text-base text-cream-50 mt-0.5 leading-tight">
        {side.player_names.join(" + ")}
      </p>
    </div>
  );
}
