import { ImageResponse } from "next/og";
import { createClient } from "@supabase/supabase-js";
import { buildPlayerSheet, leaderboard } from "@/lib/scoring";
import { settleGame, minimumFlow } from "@/lib/games";
import type { CourseHole, RoundPlayer, Score } from "@/lib/types";

export const runtime = "nodejs";
export const revalidate = 30;

const BG = "#04150f";
const PANEL = "#0d3b2a";
const PANEL_2 = "#155340";
const CREAM = "#f5efe0";
const CREAM_DIM = "rgba(245,239,224,0.65)";
const YELLOW = "#D9AD2C";
const RED = "#f87171";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: round } = await sb
    .from("rounds")
    .select("id, date, holes, status, spectator_token, courses(name)")
    .eq("id", id)
    .single();
  if (!round) return new Response("not found", { status: 404 });
  if (token && token !== round.spectator_token) return new Response("forbidden", { status: 403 });

  const { data: rps } = await sb
    .from("round_players")
    .select(
      "id, player_id, course_handicap, playing_handicap, team_id, display_order, players(display_name), course_tees(course_holes(hole_number, par, stroke_index))"
    )
    .eq("round_id", id)
    .order("display_order");

  const { data: scoresRaw } = await sb
    .from("scores")
    .select("round_player_id, hole_number, gross")
    .in("round_player_id", (rps ?? []).map((r: any) => r.id));

  const { data: gamesRaw } = await sb
    .from("round_games")
    .select("id, game_type, name, stake_cents, allowance_pct, config")
    .eq("round_id", id);

  const players: RoundPlayer[] = (rps ?? []).map((r: any) => ({
    id: r.id,
    player_id: r.player_id,
    display_name: r.players?.display_name ?? "Player",
    tee_id: "",
    tee: {
      id: "",
      name: "",
      rating: 72,
      slope: 113,
      par: 72,
      holes: (r.course_tees?.course_holes ?? []).slice().sort((a: CourseHole, b: CourseHole) => a.hole_number - b.hole_number)
    },
    handicap_index_used: 0,
    course_handicap: r.course_handicap,
    playing_handicap: r.playing_handicap,
    team_id: r.team_id
  }));
  const holes = players[0]?.tee?.holes ?? [];
  const scores: Score[] = (scoresRaw ?? []) as Score[];
  const sheets = players.map((p) => buildPlayerSheet(p, scores, holes));
  const board = leaderboard(sheets, "net").slice(0, 5);

  // Tally settlement for the share card.
  const totals = new Map<string, number>();
  for (const id of players.map((p) => p.id)) totals.set(id, 0);
  for (const g of (gamesRaw ?? [])) {
    if (g.game_type === "ctp" || g.game_type === "long_drive" || g.game_type === "custom") continue;
    const out = settleGame({
      game: g as any,
      players,
      scores,
      course: { holes, par: holes.reduce((s, h) => s + h.par, 0) }
    });
    for (const [pid, v] of out.perPlayer) {
      totals.set(pid, (totals.get(pid) ?? 0) + v.delta_cents);
    }
  }
  const flows = minimumFlow(totals).slice(0, 4);
  const labelOf = (id: string) => players.find((p) => p.id === id)?.display_name ?? "Player";
  const fmtUsd = (c: number) => "$" + (Math.abs(c) / 100).toFixed(2);
  const fmtPar = (vs: number, played: number) => {
    if (played === 0) return "—";
    if (vs === 0) return "E";
    return vs > 0 ? `+${vs}` : `${vs}`;
  };

  const courseName = (round as any).courses?.name ?? "Round";
  const isFinal = round.status === "finalized";
  const origin = url.origin;
  const logoUrl = `${origin}/cruz-logo.png`;

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          background: `linear-gradient(180deg, ${PANEL} 0%, ${BG} 60%)`,
          color: CREAM,
          fontFamily: "Georgia, 'Times New Roman', serif",
          padding: "48px 56px",
          position: "relative"
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUrl} alt="" width={88} height={88} style={{ display: "block" }} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 14, letterSpacing: 4, textTransform: "uppercase", color: YELLOW, opacity: 0.85 }}>
              Cruz Golf · Live Leaderboard
            </div>
            <div style={{ display: "flex", fontSize: 38, marginTop: 4, color: CREAM }}>
              {courseName}
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ display: "flex", fontSize: 12, letterSpacing: 3, textTransform: "uppercase", color: CREAM_DIM }}>
              {isFinal ? "Final" : "Live"}
            </div>
            <div style={{ display: "flex", fontSize: 22, color: CREAM }}>{round.date}</div>
          </div>
        </div>

        {/* Leaderboard */}
        <div
          style={{
            marginTop: 36,
            background: PANEL,
            borderRadius: 24,
            padding: "28px 32px",
            display: "flex",
            flexDirection: "column",
            border: "1px solid rgba(245,239,224,0.10)"
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 12,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: "rgba(245,239,224,0.5)",
              paddingBottom: 12,
              borderBottom: "1px solid rgba(245,239,224,0.10)"
            }}
          >
            <span style={{ width: 60 }}>POS</span>
            <span style={{ flex: 1 }}>PLAYER</span>
            <span style={{ width: 110, textAlign: "right" }}>TO PAR</span>
            <span style={{ width: 80, textAlign: "right" }}>THRU</span>
            <span style={{ width: 80, textAlign: "right" }}>NET</span>
          </div>
          {board.map((r, i) => (
            <div
              key={r.round_player_id}
              style={{
                display: "flex",
                alignItems: "center",
                paddingTop: 16,
                paddingBottom: 16,
                borderBottom: i < board.length - 1 ? "1px solid rgba(245,239,224,0.06)" : "none"
              }}
            >
              <span style={{ width: 60, fontSize: 36, color: YELLOW }}>{r.position}</span>
              <span style={{ flex: 1, fontSize: 30, color: CREAM }}>{r.display_name}</span>
              <span
                style={{
                  width: 110,
                  textAlign: "right",
                  fontSize: 44,
                  color: r.vsPar < 0 && r.thru > 0 ? RED : CREAM
                }}
              >
                {fmtPar(r.vsPar, r.thru)}
              </span>
              <span style={{ width: 80, textAlign: "right", fontSize: 22, color: CREAM_DIM }}>
                {r.thru === 0 ? "—" : r.thru === 18 ? "F" : r.thru}
              </span>
              <span style={{ width: 80, textAlign: "right", fontSize: 22, color: CREAM }}>
                {r.thru === 0 ? "—" : r.net}
              </span>
            </div>
          ))}
        </div>

        {/* Settlement */}
        {flows.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 24 }}>
            <div style={{ display: "flex", fontSize: 12, letterSpacing: 4, textTransform: "uppercase", color: YELLOW, opacity: 0.85 }}>
              Settlement
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 10 }}>
              {flows.map((f, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    background: PANEL_2,
                    borderRadius: 12,
                    padding: "10px 16px",
                    fontSize: 22,
                    color: CREAM
                  }}
                >
                  <span>{labelOf(f.from)}</span>
                  <span style={{ color: CREAM_DIM }}>→</span>
                  <span>{labelOf(f.to)}</span>
                  <span style={{ color: YELLOW, marginLeft: 8 }}>{fmtUsd(f.amount_cents)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            display: "flex",
            position: "absolute",
            left: 56,
            right: 56,
            bottom: 32,
            justifyContent: "space-between",
            alignItems: "center",
            color: CREAM_DIM,
            fontSize: 14,
            letterSpacing: 2,
            textTransform: "uppercase"
          }}
        >
          <span>cruz golf</span>
          <span>{round.holes} holes</span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control": "public, max-age=15, s-maxage=30, stale-while-revalidate=120"
      }
    }
  );
}

// (Logo for OG image is now loaded as the static asset at /cruz-logo.png.)
