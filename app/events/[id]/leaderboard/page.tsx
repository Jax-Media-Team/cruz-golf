import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { EventLeaderboard } from "@/components/EventLeaderboard";
import { SpectatorAutoRefresh } from "./auto-refresh";
import type { EventRoundShape } from "@/lib/events/settle";

export const dynamic = "force-dynamic";

/**
 * Public spectator surface for an event's live leaderboard.
 *
 * URL pattern: /events/[id]/leaderboard?token=<spectator_token>
 *
 * Auth: NO auth required. The token in the URL must match the event's
 * spectator_token. We use the service-role client server-side to read
 * the group-scoped rounds + scores (anon client can't via RLS); the
 * token check IS the access gate.
 *
 * Realtime: not available to anon clients (RLS blocks the subscribe).
 * Instead, the page meta-refreshes every 25 seconds so the leaderboard
 * stays current without flashy realtime infrastructure. Patrick's
 * directive: reliability over visual flash. Tap the URL again to
 * force-refresh immediately.
 */
export default async function EventSpectatorPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const token = sp.token?.trim();
  if (!token) notFound();

  const sb = supabaseAdmin();

  // Token gate — the entire spectator access control.
  const { data: event } = await sb
    .from("events")
    .select(
      "id, group_id, name, kind, starts_on, ends_on, spectator_token, deleted_at, commissioner_profile_id, created_at, updated_at, groups(name)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!event || event.deleted_at) notFound();
  if (event.spectator_token !== token) notFound();

  // Linked rounds via service-role (bypasses RLS — token-gated above).
  const { data: rounds } = await sb
    .from("rounds")
    .select(
      "id, date, status, holes, course_id, courses(name, course_tees(id, par, course_holes(hole_number, par, stroke_index))), round_players(id, player_id, team_id, playing_handicap, tee_id, players(display_name))"
    )
    .eq("event_id", id)
    .is("deleted_at", null)
    .order("date", { ascending: true });

  const foursomes = (rounds ?? []) as any[];

  // Same shape as /events/[id]/page.tsx — share this between the two
  // surfaces in a follow-up if maintenance becomes painful.
  const eventRounds: EventRoundShape[] = foursomes.map((r: any) => ({
    id: r.id,
    date: r.date,
    status: r.status,
    holes: (r.holes as 9 | 18) ?? 18,
    course_id: r.course_id,
    course_name: r.courses?.name ?? null,
    course_holes:
      (r.courses?.course_tees?.[0]?.course_holes ?? [])
        .slice()
        .sort((a: any, b: any) => a.hole_number - b.hole_number)
  }));

  const rps: Array<any> = foursomes.flatMap((r: any) =>
    (r.round_players ?? []).map((rp: any) => ({
      id: rp.id,
      player_id: rp.player_id,
      display_name: rp.players?.display_name ?? "Player",
      tee_id: rp.tee_id ?? "",
      tee: { id: rp.tee_id ?? "", name: "", rating: 72, slope: 113, par: 72, holes: [] },
      handicap_index_used: 0,
      course_handicap: 0,
      playing_handicap: rp.playing_handicap ?? 0,
      team_id: rp.team_id ?? null,
      round_id: r.id
    }))
  );
  const rpIds = rps.map((rp) => rp.id);
  const { data: scores } =
    rpIds.length > 0
      ? await sb
          .from("scores")
          .select("round_player_id, hole_number, gross")
          .in("round_player_id", rpIds)
      : { data: [] };

  const { data: eventGames } = await sb
    .from("event_games")
    .select(
      "id, event_id, game_type, name, stake_cents, allowance_pct, config, display_order, created_at"
    )
    .eq("event_id", id)
    .order("display_order");

  return (
    <div className="min-h-screen bg-cream-50">
      {/* Spectator banner — distinct from in-app chrome */}
      <header className="bg-brand-900 text-cream-50 px-5 sm:px-8 py-4">
        <p className="text-[10px] uppercase tracking-[0.32em] text-gold-400">
          Spectator · {(event as any).groups?.name ?? "Group"}
        </p>
        <h1 className="font-serif text-2xl sm:text-3xl mt-1">
          {event.name}
        </h1>
        <p className="text-xs text-cream-100/70 mt-1">
          {event.kind === "tournament"
            ? "Tournament"
            : event.kind === "trip"
            ? "Trip"
            : "Club game"}
          {" · "}
          {event.starts_on}
          {event.ends_on && event.ends_on !== event.starts_on
            ? ` — ${event.ends_on}`
            : ""}
        </p>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {foursomes.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500 text-sm">
            No foursomes started yet — check back when play begins.
          </div>
        ) : (
          <EventLeaderboard
            event={event as any}
            rounds={eventRounds}
            initialRps={rps as any}
            initialScores={(scores ?? []) as any}
            eventGames={(eventGames ?? []) as any}
            spectator
          />
        )}

        {/* Per-foursome links so spectators can drop into a specific
            foursome's live scorecard. Each foursome's own
            spectator_token is the access key. */}
        {foursomes.length > 0 && (
          <section>
            <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">
              Watch a specific foursome
            </p>
            <ul className="space-y-2">
              {foursomes.map((r: any) => {
                const href = r.spectator_token
                  ? `/rounds/${r.id}/leaderboard?token=${r.spectator_token}`
                  : null;
                return (
                  <li key={r.id}>
                    {href ? (
                      <a
                        href={href}
                        className="rounded-xl border border-slate-200 bg-white p-3 flex items-center justify-between gap-3 hover:bg-slate-50"
                      >
                        <span className="font-medium text-slate-900 truncate">
                          {r.courses?.name ?? "Course"}
                          <span className="text-slate-500 text-xs ml-2 font-normal">
                            · {r.date}
                          </span>
                        </span>
                        <span className="text-xs text-gold-700">Watch →</span>
                      </a>
                    ) : (
                      <div className="rounded-xl border border-slate-200 bg-white p-3 text-slate-600 text-sm">
                        {r.courses?.name ?? "Course"}{" "}
                        <span className="text-slate-400 text-xs">
                          (no spectator link)
                        </span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <p className="text-[11px] text-slate-500 text-center pt-2">
          Updates every ~25 seconds. Pull-to-refresh for the latest.
        </p>
      </main>
      <SpectatorAutoRefresh intervalSeconds={25} />
    </div>
  );
}
