import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format-date";
import { AddFoursomeButton } from "./add-foursome-button";
import { EventLeaderboard } from "@/components/EventLeaderboard";
import { EventSpectatorLink } from "./event-spectator-link";
import { EventGamesSection } from "./event-games-section";
import type { EventRoundShape } from "@/lib/events/settle";

export const dynamic = "force-dynamic";

/**
 * Event home page (Phase 2 of MULTI_GROUP_DESIGN.md).
 *
 * Shows the event's foursomes (linked rounds) + commissioner controls.
 * Field-wide leaderboard + spectator surface come in Phase 3 — for now
 * this page is a coordination view: who's playing, where they are,
 * what's left.
 */
export default async function EventHomePage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await supabaseServer();
  const {
    data: { user }
  } = await sb.auth.getUser();
  if (!user) redirect(`/login?next=/events/${id}`);

  const { data: event } = await sb
    .from("events")
    .select(
      "id, group_id, name, kind, starts_on, ends_on, spectator_token, commissioner_profile_id, deleted_at, groups(name)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!event) notFound();

  // Group-membership gate (RLS would block non-members anyway — this
  // catches it server-side so we redirect cleanly instead of 404'ing on
  // a row that exists but isn't visible).
  const { data: membership } = await sb
    .from("group_members")
    .select("role")
    .eq("group_id", event.group_id)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!membership) redirect("/dashboard");
  const isCommissioner =
    membership.role === "commissioner" ||
    event.commissioner_profile_id === user.id;

  // Linked rounds — the foursomes that belong to this event.
  // Pulling course_holes too so the field-leaderboard engine has par
  // info per round (events at multiple courses are supported).
  const { data: rounds } = await sb
    .from("rounds")
    .select(
      "id, date, status, holes, course_id, courses(name, course_tees(id, par, course_holes(hole_number, par, stroke_index))), round_players(id, player_id, team_id, playing_handicap, tee_id, players(display_name))"
    )
    .eq("event_id", id)
    .is("deleted_at", null)
    .order("date", { ascending: true });

  const foursomes = (rounds ?? []) as any[];

  // Build the EventRoundShape array for the field-leaderboard engine.
  // Use the FIRST tee on each round's course as canonical (every round
  // shares the same hole layout regardless of which tee individual
  // players are on — par is per-hole, not per-tee).
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

  // Flatten round_players across all rounds, each tagged with round_id
  // so the field-leaderboard engine can group by round.
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

  // Event-level games (Phase 3 — none surfaced via UI yet; query
  // anyway so the leaderboard's Money tab is ready when Phase 3 adds
  // the event-game picker).
  const { data: eventGames } = await sb
    .from("event_games")
    .select(
      "id, event_id, game_type, name, stake_cents, allowance_pct, config, display_order, created_at"
    )
    .eq("event_id", id)
    .order("display_order");

  // Courses available in the group — used by the AddFoursomeButton dialog.
  const { data: courses } = await sb
    .from("courses")
    .select("id, name")
    .eq("group_id", event.group_id)
    .is("deleted_at", null)
    .order("name");

  const statusCounts = {
    live: foursomes.filter((r) => r.status === "live").length,
    finalized: foursomes.filter((r) => r.status === "finalized").length,
    pending: foursomes.filter((r) => r.status === "pending_finalization").length,
    draft: foursomes.filter((r) => r.status === "draft").length
  };

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="h-eyebrow text-gold-400">
            {(event as any).groups?.name ?? "Group"} ·{" "}
            {event.kind === "tournament"
              ? "Tournament"
              : event.kind === "trip"
              ? "Trip"
              : "Club game"}
          </p>
          <h1 className="h-display text-3xl text-cream-50 mt-1">
            {event.name}
          </h1>
          <p className="text-sm text-cream-100/65 mt-1">
            {formatDate(event.starts_on)}
            {event.ends_on && event.ends_on !== event.starts_on
              ? ` — ${formatDate(event.ends_on)}`
              : ""}
            {event.deleted_at && (
              <span className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] bg-cream-100/10 text-cream-100/65">
                archived
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/dashboard`}
            className="btn-ghost text-xs"
          >
            ← Dashboard
          </Link>
        </div>
      </header>

      {/* Summary strip — at-a-glance status across all foursomes. */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
        <SummaryStat label="Foursomes" value={foursomes.length} />
        <SummaryStat
          label="Live"
          value={statusCounts.live}
          accent={statusCounts.live > 0 ? "emerald" : undefined}
        />
        <SummaryStat label="Awaiting" value={statusCounts.pending} />
        <SummaryStat label="Finalized" value={statusCounts.finalized} />
      </section>

      {/* Field-wide leaderboard — the headline surface. Realtime
          subscribes to every foursome's scores so the standings move
          as players post holes. Hides itself when there are no
          foursomes yet (which means there's nothing to lead). */}
      {foursomes.length > 0 && (
        <EventLeaderboard
          event={event as any}
          rounds={eventRounds}
          initialRps={rps as any}
          initialScores={(scores ?? []) as any}
          eventGames={(eventGames ?? []) as any}
        />
      )}

      {/* Field games — commissioner-only "+ Add" affordance. Only
          settles game types the engine supports field-wide (skins +
          individual stroke). Per-foursome games stay in
          /rounds/[id]/games. */}
      <EventGamesSection
        eventId={id}
        isCommissioner={isCommissioner}
        initialGames={(eventGames ?? []) as any}
      />

      {/* Foursomes list */}
      <section className="space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-serif text-xl text-cream-50">Foursomes</h2>
          {isCommissioner && !event.deleted_at && (
            <AddFoursomeButton
              eventId={id}
              groupId={event.group_id}
              courses={(courses ?? []) as any}
              defaultDate={event.starts_on}
            />
          )}
        </div>
        {foursomes.length === 0 ? (
          <div className="card p-6 sm:p-8 text-center text-cream-100/75 space-y-2">
            <p className="font-serif text-lg text-cream-50">
              No foursomes added yet.
            </p>
            <p className="text-xs text-cream-100/65">
              Each foursome is a round under this event. Add one for each
              group that&apos;ll be playing — each foursome keeps its own
              scorer + presses, and the event aggregates standings across
              them.
            </p>
            {isCommissioner && !event.deleted_at && (
              <p className="text-[11px] text-cream-100/55 pt-1">
                Use the &quot;Add foursome&quot; button above to create
                the first one.
              </p>
            )}
          </div>
        ) : (
          <ul className="space-y-2">
            {foursomes.map((r) => {
              const playerNames = (r.round_players ?? [])
                .map(
                  (rp: any) => rp.players?.display_name ?? "Player"
                )
                .join(", ");
              const statusColor =
                r.status === "live"
                  ? "text-emerald-300"
                  : r.status === "finalized"
                  ? "text-cream-100/55"
                  : r.status === "pending_finalization"
                  ? "text-amber-300"
                  : "text-cream-100/55";
              return (
                <li key={r.id}>
                  <Link
                    href={`/rounds/${r.id}`}
                    className="card card-hover p-4 flex items-start justify-between gap-3 flex-wrap"
                  >
                    <div className="min-w-0">
                      <div className="font-serif text-base text-cream-50 truncate">
                        {r.courses?.name ?? "Course"}
                        <span className="text-cream-100/55 text-xs ml-2 normal-case">
                          · {formatDate(r.date)} · {r.holes} holes
                        </span>
                      </div>
                      {playerNames && (
                        <p className="text-xs text-cream-100/65 mt-1 truncate">
                          {playerNames}
                        </p>
                      )}
                    </div>
                    <span className={`text-xs ${statusColor} shrink-0`}>
                      {r.status === "pending_finalization"
                        ? "awaiting finalization"
                        : r.status}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Spectator link — public read via spectator_token. The
          /events/[id]/leaderboard?token=... page lands family / non-
          players on a read-only foursomes list with per-round watch
          links. Phase 3a; the full field-leaderboard view lands in
          Phase 3b once the service-role spectator RPC ships. */}
      {event.spectator_token && (
        <EventSpectatorLink
          eventId={id}
          token={event.spectator_token}
        />
      )}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  accent
}: {
  label: string;
  value: number | string;
  accent?: "emerald";
}) {
  return (
    <div
      className={`card p-3 ${
        accent === "emerald" ? "border border-emerald-400/30" : ""
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider text-cream-100/55">
        {label}
      </div>
      <div className="text-2xl font-serif text-cream-50 mt-0.5 tabular-nums">
        {value}
      </div>
    </div>
  );
}
