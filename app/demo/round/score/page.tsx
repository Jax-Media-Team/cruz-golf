"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ScorePad } from "@/components/ScorePad";
import { strokesPerHole } from "@/lib/handicap";
import { DEMO_PLAYERS, DEMO_HOLES, DEMO_SCORES } from "@/lib/demo";

export default function DemoScorePage() {
  const [playerId, setPlayerId] = useState(DEMO_PLAYERS[0].id);
  const player = DEMO_PLAYERS.find((p) => p.id === playerId)!;
  const strokes = useMemo(() => strokesPerHole(player.playing_handicap, DEMO_HOLES), [player]);

  // Initial scores from demo fixture
  const initial: Record<number, number | null> = useMemo(() => {
    const out: Record<number, number | null> = {};
    for (const h of DEMO_HOLES) out[h.hole_number] = null;
    for (const s of DEMO_SCORES) {
      if (s.round_player_id === player.id && s.gross != null) {
        out[s.hole_number] = s.gross;
      }
    }
    return out;
  }, [player]);

  const [scores, setScores] = useState(initial);

  function switchPlayer(pid: string) {
    setPlayerId(pid);
    const p = DEMO_PLAYERS.find((x) => x.id === pid)!;
    const fresh: Record<number, number | null> = {};
    for (const h of DEMO_HOLES) fresh[h.hole_number] = null;
    for (const s of DEMO_SCORES) {
      if (s.round_player_id === p.id && s.gross != null) fresh[s.hole_number] = s.gross;
    }
    setScores(fresh);
  }

  // Team partners for the live team-score panel (Cruz + Marco are Team 1, Jeff + Taylor are Team 2)
  const teamMap: Record<string, { name: string; partnerIds: string[] }> = {
    "rp-cruz":   { name: "Team 1 (Cruz · Marco)", partnerIds: ["rp-marco"] },
    "rp-marco":  { name: "Team 1 (Marco · Cruz)", partnerIds: ["rp-cruz"] },
    "rp-jeff":   { name: "Team 2 (Jeff · Taylor)", partnerIds: ["rp-taylor"] },
    "rp-taylor": { name: "Team 2 (Taylor · Jeff)", partnerIds: ["rp-jeff"] }
  };
  const teamConfig = teamMap[player.id];
  const partners = teamConfig
    ? teamConfig.partnerIds.map((pid) => {
        const p = DEMO_PLAYERS.find((x) => x.id === pid)!;
        const partnerScores: Record<number, number | null> = {};
        for (const h of DEMO_HOLES) partnerScores[h.hole_number] = null;
        for (const s of DEMO_SCORES) {
          if (s.round_player_id === pid && s.gross != null) partnerScores[s.hole_number] = s.gross;
        }
        return { display_name: p.display_name, scores: partnerScores };
      })
    : [];

  function save(hole: number, gross: number) {
    setScores((s) => ({ ...s, [hole]: gross }));
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <Link href="/demo/round" className="btn-ghost text-sm">← Back</Link>
        <select
          className="input text-sm py-1.5 max-w-[180px]"
          value={playerId}
          onChange={(e) => switchPlayer(e.target.value)}
          aria-label="Choose player to score"
        >
          {DEMO_PLAYERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name} (PH {p.playing_handicap})
            </option>
          ))}
        </select>
      </header>

      <ScorePad
        playerName={player.display_name}
        playingHandicap={player.playing_handicap}
        holes={DEMO_HOLES}
        scores={scores}
        strokes={strokes}
        onSave={save}
        team={teamConfig ? { name: teamConfig.name, partners, mode: "best_ball" } : undefined}
      />

      <p className="text-xs text-cream-100/45 text-center">
        Demo: edits stay in your browser. Switch players at the top right to score for anyone else in the group.
      </p>
    </div>
  );
}
