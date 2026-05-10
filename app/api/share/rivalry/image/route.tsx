import { ImageResponse } from "next/og";
import { createClient } from "@supabase/supabase-js";
import {
  buildRivalrySignals,
  type ClubhouseRound,
  type ClubhouseRoundPlayer,
  type ClubhouseSettlement
} from "@/lib/clubhouse";

export const runtime = "nodejs";
export const revalidate = 60;

/**
 * Rivalry share card — 1200×630 OG-style PNG showing head-to-head record
 * for two players in the same group.
 *
 * URL: /api/share/rivalry/image?a=<player_a_id>&b=<player_b_id>
 *
 * Privacy: same posture as the round spectator card — the data exposed
 * (player names + W-L over rounds together) is equivalent to what the
 * public spectator leaderboard already shows. No money totals exposed
 * unless the rivalry has measurable lifetime cents (≥ $20 absolute).
 *
 * The URL must include both player IDs. Anyone with the URL can view
 * the image — same model as round share links — which is the
 * intentional "shareable in group chat" UX.
 */

const BG = "#04150f";
const PANEL = "#0d3b2a";
const CREAM = "#f5efe0";
const CREAM_DIM = "rgba(245,239,224,0.65)";
const YELLOW = "#D9AD2C";
const EMERALD = "#34d399";
const RED = "#f87171";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const a = url.searchParams.get("a");
  const b = url.searchParams.get("b");
  if (!a || !b) return new Response("missing player ids", { status: 400 });
  if (a === b) return new Response("a and b must differ", { status: 400 });

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // Look up both players. They must share a group_id; the rivalry only
  // counts rounds in their common group.
  const { data: players } = await sb
    .from("players")
    .select("id, group_id, display_name")
    .in("id", [a, b]);
  if (!players || players.length !== 2) {
    return new Response("players not found", { status: 404 });
  }
  const pa = players.find((p: any) => p.id === a);
  const pb = players.find((p: any) => p.id === b);
  if (!pa || !pb || pa.group_id !== pb.group_id) {
    return new Response("players are not in the same group", { status: 400 });
  }
  const groupId = pa.group_id;

  // Pull the group's finalized rounds + every rp + settlements. Could
  // be expensive for very long-history groups; cap at 500 rounds.
  const [{ data: rounds }, { data: rps }, { data: settlements }] =
    await Promise.all([
      sb
        .from("rounds")
        .select("id, date, status, holes, course_id, courses(name)")
        .eq("group_id", groupId)
        .eq("status", "finalized")
        .is("deleted_at", null)
        .order("date", { ascending: false })
        .limit(500),
      sb
        .from("round_players")
        .select("id, round_id, player_id, players(display_name)"),
      sb
        .from("settlements")
        .select(
          "round_id, from_round_player_id, to_round_player_id, amount_cents"
        )
    ]);

  const chRounds: ClubhouseRound[] = ((rounds as any[]) ?? []).map((r) => ({
    id: r.id,
    date: r.date,
    status: "finalized" as const,
    course_name: r.courses?.name ?? null,
    course_id: r.course_id ?? null,
    spectator_token: null,
    holes: r.holes ?? 18
  }));
  const roundIds = new Set(chRounds.map((r) => r.id));
  const chRps: ClubhouseRoundPlayer[] = ((rps as any[]) ?? [])
    .filter((rp) => roundIds.has(rp.round_id))
    .map((rp) => ({
      round_player_id: rp.id,
      round_id: rp.round_id,
      player_id: rp.player_id,
      display_name: rp.players?.display_name ?? "Player"
    }));
  const chSettles: ClubhouseSettlement[] = ((settlements as any[]) ?? [])
    .filter((s) => roundIds.has(s.round_id))
    .map((s) => {
      const round = chRounds.find((r) => r.id === s.round_id);
      return {
        round_id: s.round_id,
        round_date: round?.date ?? "",
        from_round_player_id: s.from_round_player_id,
        to_round_player_id: s.to_round_player_id,
        amount_cents: s.amount_cents
      };
    });

  const rivalry = buildRivalrySignals(chRps, chSettles, chRounds, {
    minRounds: 1
  }).find(
    (r) =>
      (r.player_a_id === a && r.player_b_id === b) ||
      (r.player_a_id === b && r.player_b_id === a)
  );

  if (!rivalry) {
    return new Response("no shared rounds", { status: 404 });
  }

  // Re-orient from the requested perspective (caller passed `a` first).
  const isA = rivalry.player_a_id === a;
  const aName = isA ? rivalry.player_a_name : rivalry.player_b_name;
  const bName = isA ? rivalry.player_b_name : rivalry.player_a_name;
  const aWins = isA ? rivalry.a_wins : rivalry.b_wins;
  const bWins = isA ? rivalry.b_wins : rivalry.a_wins;
  const aRun = isA ? rivalry.recent_run : -rivalry.recent_run;

  // Lifetime $ from a's perspective.
  const rpToPlayer = new Map(chRps.map((rp) => [rp.round_player_id, rp.player_id]));
  let netAvsB = 0;
  for (const s of chSettles) {
    const fromPid = rpToPlayer.get(s.from_round_player_id);
    const toPid = rpToPlayer.get(s.to_round_player_id);
    if (toPid === a && fromPid === b) netAvsB += s.amount_cents;
    else if (fromPid === a && toPid === b) netAvsB -= s.amount_cents;
  }
  const moneyVisible = Math.abs(netAvsB) >= 2000; // ≥ $20

  // The runner-tagline copy. Stays restrained per CLAUDE.md tone discipline.
  const runLabel =
    Math.abs(aRun) >= 2
      ? aRun > 0
        ? `${aName} on ${aRun} in a row`
        : `${bName} on ${-aRun} in a row`
      : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: "flex",
          flexDirection: "column",
          background: BG,
          padding: 60,
          fontFamily: "system-ui, sans-serif"
        }}
      >
        {/* Title */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              fontSize: 14,
              letterSpacing: "0.3em",
              color: YELLOW,
              textTransform: "uppercase"
            }}
          >
            Cruz Golf · Head to head
          </div>
        </div>

        {/* Names + W-L */}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            gap: 40,
            marginTop: 32
          }}
        >
          {/* Player A */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              textAlign: "right"
            }}
          >
            <div
              style={{
                fontSize: 72,
                fontWeight: 700,
                color: CREAM,
                lineHeight: 1
              }}
            >
              {aName}
            </div>
            <div
              style={{
                fontSize: 120,
                fontWeight: 800,
                color: aWins >= bWins ? EMERALD : CREAM_DIM,
                lineHeight: 1,
                marginTop: 16,
                fontVariantNumeric: "tabular-nums"
              }}
            >
              {aWins}
            </div>
          </div>

          <div
            style={{
              fontSize: 56,
              color: CREAM_DIM,
              fontWeight: 300
            }}
          >
            vs
          </div>

          {/* Player B */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              textAlign: "left"
            }}
          >
            <div
              style={{
                fontSize: 72,
                fontWeight: 700,
                color: CREAM,
                lineHeight: 1
              }}
            >
              {bName}
            </div>
            <div
              style={{
                fontSize: 120,
                fontWeight: 800,
                color: bWins > aWins ? EMERALD : CREAM_DIM,
                lineHeight: 1,
                marginTop: 16,
                fontVariantNumeric: "tabular-nums"
              }}
            >
              {bWins}
            </div>
          </div>
        </div>

        {/* Footer line */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 24,
            paddingTop: 24,
            borderTop: `1px solid ${PANEL}`,
            color: CREAM_DIM,
            fontSize: 24
          }}
        >
          <div>
            {rivalry.rounds_together} round
            {rivalry.rounds_together === 1 ? "" : "s"} together
          </div>
          {rivalry.pushes > 0 && (
            <div>
              {rivalry.pushes} push{rivalry.pushes === 1 ? "" : "es"}
            </div>
          )}
          {runLabel && <div style={{ color: YELLOW }}>· {runLabel}</div>}
          {moneyVisible && (
            <div style={{ color: netAvsB > 0 ? EMERALD : RED }}>
              {netAvsB > 0 ? "+" : "−"}${(Math.abs(netAvsB) / 100).toFixed(0)}{" "}
              {aName}
            </div>
          )}
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
