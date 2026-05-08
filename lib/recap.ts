import type { CourseHole, RoundGame, RoundPlayer, Score } from "./types";
import { settleGame } from "./games";

export type Moment = {
  emoji: string;
  title: string;
  caption: string;
  player_ids?: string[];
};

type Input = {
  players: RoundPlayer[];
  scores: Score[];
  holes: CourseHole[];
  games: RoundGame[];
};

const fmt$ = (cents: number) => "$" + (Math.abs(cents) / 100).toFixed(2);

/**
 * Generate a "clubhouse recap" — a list of memorable moments from the round.
 * Pure function. No UI, no DB. Designed to be funny without being mean.
 */
export function generateRecap({ players, scores, holes, games }: Input): Moment[] {
  const out: Moment[] = [];
  if (players.length === 0 || holes.length === 0) return out;

  const nameOf = (id: string) => players.find((p) => p.id === id)?.display_name ?? "Player";
  const par = holes.reduce((s, h) => s + h.par, 0);

  // ── Birdie run ──────────────────────────────────────────────────────────
  for (const p of players) {
    const ms = scores
      .filter((s) => s.round_player_id === p.id && s.gross != null)
      .sort((a, b) => a.hole_number - b.hole_number);
    let run = 0;
    let bestRun = 0;
    let bestEnd = 0;
    for (const s of ms) {
      const h = holes.find((x) => x.hole_number === s.hole_number);
      if (!h) continue;
      if ((s.gross as number) < h.par) {
        run++;
        if (run > bestRun) {
          bestRun = run;
          bestEnd = s.hole_number;
        }
      } else {
        run = 0;
      }
    }
    if (bestRun >= 2) {
      out.push({
        emoji: "🔥",
        title: "Birdie run",
        caption: `${p.display_name} ripped off ${bestRun} birdies in a row through hole ${bestEnd}.`,
        player_ids: [p.id]
      });
      break; // only one birdie-run shout-out
    }
  }

  // ── Hot stretch — par-or-better streak of 5+ ───────────────────────────
  for (const p of players) {
    const ms = scores
      .filter((s) => s.round_player_id === p.id && s.gross != null)
      .sort((a, b) => a.hole_number - b.hole_number);
    let run = 0;
    let bestRun = 0;
    let bestStart = 0;
    let bestEnd = 0;
    for (const s of ms) {
      const h = holes.find((x) => x.hole_number === s.hole_number);
      if (!h) continue;
      if ((s.gross as number) <= h.par) {
        run++;
        if (run > bestRun) {
          bestRun = run;
          bestEnd = s.hole_number;
          bestStart = bestEnd - run + 1;
        }
      } else {
        run = 0;
      }
    }
    if (bestRun >= 5) {
      out.push({
        emoji: "🎯",
        title: "Hot stretch",
        caption: `${p.display_name} went ${bestRun} straight at par or better, holes ${bestStart}–${bestEnd}.`,
        player_ids: [p.id]
      });
      break;
    }
  }

  // ── Worst hole — biggest blow-up vs par ───────────────────────────────
  let worst: { id: string; hole: number; gross: number; par: number } | null = null;
  for (const s of scores) {
    if (s.gross == null) continue;
    const h = holes.find((x) => x.hole_number === s.hole_number);
    if (!h) continue;
    const diff = s.gross - h.par;
    if (!worst || diff > worst.gross - worst.par) {
      worst = { id: s.round_player_id, hole: h.hole_number, gross: s.gross, par: h.par };
    }
  }
  if (worst && worst.gross - worst.par >= 3) {
    const over = worst.gross - worst.par;
    out.push({
      emoji: "🤡",
      title: "Worst hole",
      caption: `${nameOf(worst.id)} put up a ${worst.gross} on hole ${worst.hole} (par ${worst.par}). +${over}.`,
      player_ids: [worst.id]
    });
  }

  // ── Comeback kid — biggest front-9 → back-9 improvement ────────────────
  let comeback: { id: string; front: number; back: number; delta: number } | null = null;
  for (const p of players) {
    let f = 0;
    let b = 0;
    let fc = 0;
    let bc = 0;
    for (const s of scores) {
      if (s.round_player_id !== p.id || s.gross == null) continue;
      if (s.hole_number <= 9) {
        f += s.gross;
        fc++;
      } else if (s.hole_number <= 18) {
        b += s.gross;
        bc++;
      }
    }
    if (fc === 9 && bc === 9) {
      const delta = f - b;
      if (!comeback || delta > comeback.delta) {
        comeback = { id: p.id, front: f, back: b, delta };
      }
    }
  }
  if (comeback && comeback.delta >= 3) {
    out.push({
      emoji: "🪂",
      title: "Comeback kid",
      caption: `${nameOf(comeback.id)} shot ${comeback.front} on the front, ${comeback.back} on the back. ${comeback.delta} strokes better coming home.`,
      player_ids: [comeback.id]
    });
  }

  // ── Money tally per game ──────────────────────────────────────────────
  const totals = new Map<string, number>();
  for (const p of players) totals.set(p.id, 0);
  let skinsLeader: { id: string; amt: number } | null = null;
  let skinHoleCount = 0;

  for (const g of games) {
    if (g.game_type === "ctp" || g.game_type === "long_drive" || g.game_type === "custom") continue;
    const r = settleGame({ game: g, players, scores, course: { holes, par } });
    for (const [pid, v] of r.perPlayer) {
      totals.set(pid, (totals.get(pid) ?? 0) + v.delta_cents);
    }
    if (g.game_type.startsWith("skins")) {
      let topPid: string | null = null;
      let topAmt = 0;
      for (const [pid, v] of r.perPlayer) {
        if (v.delta_cents > topAmt) {
          topAmt = v.delta_cents;
          topPid = pid;
        }
      }
      if (topPid) {
        skinsLeader = { id: topPid, amt: topAmt };
        skinHoleCount = r.highlights.length;
      }
    }
  }

  // ── Skins king ────────────────────────────────────────────────────────
  if (skinsLeader && skinsLeader.amt > 0 && skinHoleCount > 0) {
    out.push({
      emoji: "💰",
      title: "Skins king",
      caption: `${nameOf(skinsLeader.id)} swept the board with ${skinHoleCount} skin${skinHoleCount === 1 ? "" : "s"} for ${fmt$(skinsLeader.amt)}.`,
      player_ids: [skinsLeader.id]
    });
  }

  // ── Take the W ────────────────────────────────────────────────────────
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0 && sorted[0][1] > 0) {
    const winner = sorted[0];
    out.push({
      emoji: "🥇",
      title: "Take the W",
      caption: `${nameOf(winner[0])} walks with ${fmt$(winner[1])} for the day.`,
      player_ids: [winner[0]]
    });
  }

  // ── Dead money — finished negative on every game ──────────────────────
  if (games.filter((g) => !["ctp", "long_drive", "custom"].includes(g.game_type)).length >= 2) {
    let loser: { id: string; total: number } | null = null;
    for (const p of players) {
      const total = totals.get(p.id) ?? 0;
      if (total >= 0) continue;
      // Check that they were negative on every game
      let allNegative = true;
      for (const g of games) {
        if (["ctp", "long_drive", "custom"].includes(g.game_type)) continue;
        const r = settleGame({ game: g, players, scores, course: { holes, par } });
        if ((r.perPlayer.get(p.id)?.delta_cents ?? 0) >= 0) {
          allNegative = false;
          break;
        }
      }
      if (allNegative && (!loser || total < loser.total)) {
        loser = { id: p.id, total };
      }
    }
    if (loser && loser.total <= -500) {
      out.push({
        emoji: "🪦",
        title: "Dead money",
        caption: `${nameOf(loser.id)} couldn't catch a break — down ${fmt$(loser.total)} on every game.`,
        player_ids: [loser.id]
      });
    }
  }

  return out;
}
