"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";

type Game = {
  id: string;
  game_type: string;
  name: string;
  stake_cents: number;
  allowance_pct: number;
  config: any;
};

type Person = {
  profile_id: string;
  display_name: string;
  acked: boolean;
};

type JunkConfig = {
  active_categories?: string[] | null;
  mode?: "flat" | "escalating" | null;
  flat_amount_cents?: number | null;
  base_amount_cents?: number | null;
  escalation_step_cents?: number | null;
  escalation_scope?: "per_hole" | "per_round" | "per_category" | null;
  custom_categories?: string[] | null;
};

type TeamPlayer = {
  id: string;
  display_name: string;
  team_id: string | null;
};

const fmtMoney = (cents: number) => "$" + (cents / 100).toFixed(2);

const JUNK_CATEGORY_LABELS: Record<string, string> = {
  birdie: "Birdie",
  eagle: "Eagle",
  greenie: "Greenie",
  sandy: "Sandy",
  chip_in: "Chip-in",
  poley: "Poley",
  pinny: "Pinny"
};

function junkCategoryLabel(key: string): string {
  return (
    JUNK_CATEGORY_LABELS[key] ??
    key
      .split("_")
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ")
  );
}

/**
 * Build the per-row config description for a game on the wagers card.
 *
 * Patrick 2026-05-12 chaos-QA: "View wagers shows 6-6-6 but nothing
 * about the 2-down auto-press, the junk, etc."
 *
 * Before this rewrite `describeGame` was a thin sniff over a handful
 * of generic config keys. It missed:
 *   - 6-6-6 partner rotation segments
 *   - Nassau auto-press details + total-at-risk
 *   - Best Ball team composition
 *   - Match-play vs stroke-play modes
 *   - Junk side-bet terms (handled separately as its own card)
 *
 * Now it switches on game_type, surfacing the relevant fields for
 * each format. Lines that don't apply for a given game are skipped.
 */
function describeGame(g: Game, lineups: TeamPlayer[]): string[] {
  const parts: string[] = [];

  // Stake. For Nassau we'll override with the F/B/O breakdown below.
  if (g.stake_cents > 0 && !g.game_type.startsWith("nassau")) {
    if (g.game_type === "six_six_six") {
      parts.push(`Stake ${fmtMoney(g.stake_cents)} per segment (3 segments)`);
    } else if (g.game_type.startsWith("skins")) {
      // Skins uses skin_value_cents below — no top-line stake to print.
    } else {
      parts.push(`Stake ${fmtMoney(g.stake_cents)}`);
    }
  }

  // Skins value + carry rule + birdie-required.
  if (g.game_type.startsWith("skins")) {
    const sv = g.config?.skin_value_cents;
    if (typeof sv === "number" && sv > 0) {
      parts.push(`${fmtMoney(sv)} per skin`);
    }
    if (g.config?.escalation === "double") parts.push("Doubles on carry");
    if (g.config?.escalation === "linear") parts.push("Linear carry");
    if (g.config?.escalation === "none") parts.push("No carry");
    if (g.config?.require_birdie) parts.push("Birdie required to win");
  }

  // Nassau — F/B/O split + auto-press + match/stroke + total at risk.
  if (g.game_type.startsWith("nassau")) {
    const front = g.config?.front_stake_cents ?? g.stake_cents;
    const back = g.config?.back_stake_cents ?? g.stake_cents;
    const overall = g.config?.overall_stake_cents ?? g.stake_cents;
    if (front === back && back === overall) {
      parts.push(`Stake ${fmtMoney(front)} on each of Front · Back · Overall`);
      parts.push(`Total at risk: ${fmtMoney(front * 3)} per player`);
    } else {
      parts.push(
        `F ${fmtMoney(front)} · B ${fmtMoney(back)} · Overall ${fmtMoney(overall)}`
      );
      parts.push(`Total at risk: ${fmtMoney(front + back + overall)} per player`);
    }
    if (g.config?.presses === "auto_2_down") {
      parts.push("Automatic press at 2-down");
    } else if (g.config?.presses === "manual") {
      parts.push("Manual presses (opener invites, opponent must accept)");
    } else if (g.config?.presses === "none") {
      parts.push("No presses");
    }
    if (g.config?.match_play === false) parts.push("Stroke-play scoring");
    else parts.push("Match-play scoring");
  }

  // 6-6-6 — partner rotation per segment + auto-press settings.
  if (g.game_type === "six_six_six") {
    const players = lineups
      .filter((p) => p.team_id == null) // 6-6-6 uses rp ids directly, not team_id
      .slice(0, 4);
    // Default rotation is AB-CD / AC-BD / AD-BC.
    const fallback = lineups.slice(0, 4).map((p) => p.display_name);
    const rotation = (g.config?.rotation as Array<{
      label?: string;
      side_a?: string[];
      side_b?: string[];
    }>) ?? null;
    if (rotation && rotation.length > 0) {
      // Resolve rp ids → display names.
      const nameById = new Map(lineups.map((p) => [p.id, p.display_name]));
      const segs = rotation
        .slice(0, 3)
        .map((s, i) => {
          const a = (s.side_a ?? []).map((id) => nameById.get(id) ?? "?");
          const b = (s.side_b ?? []).map((id) => nameById.get(id) ?? "?");
          if (a.length === 0 || b.length === 0) return null;
          const startHole = i === 0 ? 1 : i === 1 ? 7 : 13;
          const endHole = i === 0 ? 6 : i === 1 ? 12 : 18;
          return `Holes ${startHole}–${endHole}: ${a.join(" + ")} vs ${b.join(" + ")}`;
        })
        .filter((x): x is string => x != null);
      if (segs.length > 0) parts.push(...segs);
    } else if (fallback.length === 4) {
      const [A, B, C, D] = fallback;
      parts.push(`Holes 1–6: ${A} + ${B} vs ${C} + ${D}`);
      parts.push(`Holes 7–12: ${A} + ${C} vs ${B} + ${D}`);
      parts.push(`Holes 13–18: ${A} + ${D} vs ${B} + ${C}`);
    }
    if (g.config?.presses === "auto_2_down") {
      parts.push("Automatic press at 2-down within each segment");
    } else if (g.config?.presses === "manual") {
      parts.push("Manual presses allowed");
    }
  }

  // Best Ball / team match — surface the team composition.
  if (
    g.game_type === "best_ball" ||
    g.game_type === "team_match_play" ||
    g.game_type === "scramble"
  ) {
    const byTeam = new Map<string, string[]>();
    for (const p of lineups) {
      if (!p.team_id) continue;
      const list = byTeam.get(p.team_id) ?? [];
      list.push(p.display_name);
      byTeam.set(p.team_id, list);
    }
    const teamLabels = [...byTeam.values()].map((names) => names.join(" + "));
    if (teamLabels.length >= 2) {
      parts.push(teamLabels.join(" vs "));
    }
    if (g.config?.scoring === "gross") parts.push("Gross best ball");
    if (g.config?.scoring === "net") parts.push("Net best ball");
  }

  // Universal: allowance % when non-default.
  if (g.allowance_pct !== 100 && g.allowance_pct != null) {
    parts.push(`${g.allowance_pct}% handicap allowance`);
  }

  return parts;
}

function describeJunk(j: JunkConfig): { headline: string; lines: string[] } {
  const standards = (j.active_categories ?? []).filter(
    (c) => !(j.custom_categories ?? []).includes(c)
  );
  const customs = j.custom_categories ?? [];
  const allLabels = [
    ...standards.map(junkCategoryLabel),
    ...customs.map(junkCategoryLabel)
  ];
  const lines: string[] = [];
  if (j.mode === "flat" && typeof j.flat_amount_cents === "number") {
    lines.push(`${fmtMoney(j.flat_amount_cents)} flat per item`);
  } else if (j.mode === "escalating") {
    const base = typeof j.base_amount_cents === "number" ? j.base_amount_cents : 200;
    const step =
      typeof j.escalation_step_cents === "number" ? j.escalation_step_cents : 200;
    const scope =
      j.escalation_scope === "per_hole"
        ? "per hole"
        : j.escalation_scope === "per_category"
        ? "per category"
        : "per round";
    lines.push(`Starts at ${fmtMoney(base)}, climbs ${fmtMoney(step)} ${scope}`);
  }
  if (allLabels.length > 0) {
    lines.push(`Tracking: ${allLabels.join(", ")}`);
  }
  return {
    headline:
      allLabels.length > 0
        ? `Junk side-bets · ${allLabels.length} categor${allLabels.length === 1 ? "y" : "ies"}`
        : "Junk side-bets",
    lines
  };
}

export function WagerAckClient({
  roundId,
  games,
  myAck,
  peopleStatus,
  junkConfig = null,
  teamLineups = []
}: {
  roundId: string;
  games: Game[];
  myAck: boolean;
  peopleStatus: Person[];
  /** Round junk config — when set, the "Junk side-bets" card surfaces
   *  with the active categories + amount. Patrick: "View wagers shows
   *  6-6-6 but nothing about ... the junk." */
  junkConfig?: JunkConfig | null;
  /** Round players with team_id — used to label 6-6-6 rotation segments
   *  and Best Ball team composition with real names. */
  teamLineups?: TeamPlayer[];
}) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [acked, setAcked] = useState(myAck);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function ack() {
    setBusy(true);
    setErr(null);
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      setBusy(false);
      setErr("Not signed in.");
      return;
    }
    const { error } = await sb
      .from("round_wager_acks")
      .upsert({ round_id: roundId, profile_id: user.id });
    setBusy(false);
    if (error) {
      setErr(friendlyAuthError(error));
      return;
    }
    setAcked(true);
    router.refresh();
  }

  async function unack() {
    setBusy(true);
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    await sb.from("round_wager_acks").delete().eq("round_id", roundId).eq("profile_id", user.id);
    setBusy(false);
    setAcked(false);
    router.refresh();
  }

  const moneyGames = games.filter((g) => g.stake_cents > 0 || (g.config?.skin_value_cents ?? 0) > 0);

  // Junk surfaces as its own card even when no main game has money,
  // since junk is a standalone side-bet system.
  const junk = junkConfig ? describeJunk(junkConfig) : null;
  const showBookCard = moneyGames.length > 0 || junk != null;

  return (
    <div className="space-y-4">
      <div className="card p-5 space-y-3">
        <div className="font-serif text-xl text-cream-50">The book</div>
        {!showBookCard ? (
          <p className="text-sm text-cream-100/65">No money on this one — no wagers configured.</p>
        ) : (
          <ul className="divide-y divide-cream-100/8">
            {moneyGames.map((g) => {
              const lines = describeGame(g, teamLineups);
              return (
                <li key={g.id} className="py-3 flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-cream-50 font-medium">{g.name}</div>
                    {lines.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-xs text-cream-100/65 leading-relaxed">
                        {lines.map((line, i) => (
                          <li key={i}>· {line}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="font-serif text-2xl tabular-nums text-[#FFCD00] shrink-0">
                    {g.stake_cents > 0 ? fmtMoney(g.stake_cents) : fmtMoney(g.config?.skin_value_cents ?? 0) + "/skin"}
                  </div>
                </li>
              );
            })}
            {junk != null && (
              <li className="py-3 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="text-cream-50 font-medium">{junk.headline}</div>
                  {junk.lines.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs text-cream-100/65 leading-relaxed">
                      {junk.lines.map((line, i) => (
                        <li key={i}>· {line}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="font-serif text-sm tabular-nums text-[#FFCD00]/85 shrink-0 self-center">
                  side-bet
                </div>
              </li>
            )}
          </ul>
        )}
      </div>

      <div className="card p-5">
        <div className="font-serif text-lg text-cream-50">Handshake</div>
        <p className="text-sm text-cream-100/65 mt-1">
          You agree to the stakes above and to settle up with whoever comes out on top.
        </p>
        {err && <p className="text-sm text-red-300 mt-2">{err}</p>}
        <div className="mt-4">
          {acked ? (
            <div className="flex items-center gap-3">
              <div className="pill-final">✓ Confirmed</div>
              <button className="btn-ghost text-xs" disabled={busy} onClick={unack}>Withdraw</button>
            </div>
          ) : (
            <button className="btn-primary w-full sm:w-auto" disabled={busy} onClick={ack}>
              {busy ? "Locking it in…" : "I'm in — confirm wagers"}
            </button>
          )}
        </div>
      </div>

      <div className="card p-5">
        <div className="font-serif text-lg text-cream-50">Who&apos;s in</div>
        <ul className="mt-3 divide-y divide-cream-100/8">
          {peopleStatus.length === 0 && <li className="text-sm text-cream-100/55 py-2">No invitees yet.</li>}
          {peopleStatus.map((p) => (
            <li key={p.profile_id} className="py-2 flex items-center justify-between">
              <span className="text-cream-50">{p.display_name}</span>
              <span className={p.acked ? "pill-live" : "pill-draft"}>
                {p.acked ? "Confirmed" : "Pending"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
