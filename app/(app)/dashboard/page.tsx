import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { RoundsList } from "./rounds-list";
import {
  OnboardingTour,
  ReplayTourButton
} from "@/components/OnboardingTour";
import { ClubhouseStrip } from "@/components/ClubhouseStrip";
import {
  buildClubhouse,
  type ClubhouseRound,
  type ClubhouseRoundPlayer,
  type ClubhouseScore,
  type ClubhouseSettlement
} from "@/lib/clubhouse";

export default async function DashboardPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/dashboard");

  const { data: profile } = await sb
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  // Get the user's first group (if any) so we can show context-aware onboarding state.
  const { data: groups } = await sb.from("groups").select("id, name").limit(1);
  // No group yet -> the signup bootstrap didn't complete (likely email
  // confirmation flow). Send to the onboarding finisher.
  if ((groups?.length ?? 0) === 0) redirect("/onboarding");
  const groupId = groups?.[0]?.id;
  const groupName = groups?.[0]?.name;

  // Defensive: filter archived rounds via deleted_at, falling back to
  // unfiltered if migration 0021 isn't applied yet (so the dashboard
  // never goes blank because of a missing column).
  async function fetchRounds() {
    const filtered = await sb
      .from("rounds")
      .select("id, date, status, courses(name)")
      .is("deleted_at", null)
      .order("date", { ascending: false })
      .limit(10);
    if (!filtered.error) return filtered;
    return await sb
      .from("rounds")
      .select("id, date, status, courses(name)")
      .order("date", { ascending: false })
      .limit(10);
  }

  // Archived rounds — separate, smaller bucket. Surfaces in a
  // collapsed "Archived rounds" section at the bottom so commissioners
  // can find them to Restore (the round detail page promised a
  // restore path, and "from the dashboard" only works if we list
  // them somewhere). Defensive against pre-0021 envs (no deleted_at).
  async function fetchArchivedRounds() {
    try {
      const out = await sb
        .from("rounds")
        .select("id, date, status, courses(name)")
        .not("deleted_at", "is", null)
        .order("date", { ascending: false })
        .limit(20);
      return out.error ? null : out.data;
    } catch {
      return null;
    }
  }

  const [
    { count: courseCount },
    { count: playerCount },
    { data: rounds },
    archivedRounds
  ] = await Promise.all([
    sb.from("courses").select("id", { count: "exact", head: true }).eq("group_id", groupId ?? "").is("deleted_at", null),
    sb.from("players").select("id", { count: "exact", head: true }).eq("group_id", groupId ?? "").is("deleted_at", null),
    fetchRounds(),
    fetchArchivedRounds()
  ]);

  // Platform-admin nav surface: also unlocks the Admin quick-link below.
  let isPlatformAdmin = false;
  try {
    const { data } = await sb.rpc("fn_is_platform_admin");
    isPlatformAdmin = !!data;
  } catch {
    isPlatformAdmin = false;
  }

  // Newest in-progress round so we can offer a one-tap "Enter scores" link.
  const activeRound = (rounds ?? []).find((r: any) => r.status === "live" || r.status === "draft") as
    | { id: string; date: string; status: string; courses?: { name?: string } | null }
    | undefined;

  // Events the group is running — surfaced as a section above the rounds
  // list when any exist. Phase 2 of MULTI_GROUP_DESIGN.md. Defensive
  // try/catch against the events table not existing (pre-0039 envs).
  let events: Array<{
    id: string;
    name: string;
    kind: string;
    starts_on: string;
    ends_on: string | null;
  }> = [];
  try {
    const { data: ev } = await sb
      .from("events")
      .select("id, name, kind, starts_on, ends_on")
      .eq("group_id", groupId)
      .is("deleted_at", null)
      .order("starts_on", { ascending: false })
      .limit(5);
    events = (ev as any[]) ?? [];
  } catch {
    /* events table missing pre-0039 */
  }

  // Is the viewer a commissioner of the active group? Controls whether
  // the "+ New event" CTA shows.
  let isGroupCommissioner = false;
  if (groupId) {
    const { data: gm } = await sb
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("profile_id", user.id)
      .maybeSingle();
    isGroupCommissioner = (gm as any)?.role === "commissioner";
  }

  const hasCourses = (courseCount ?? 0) > 0;
  const hasPlayers = (playerCount ?? 0) > 0;
  const hasRounds = (rounds?.length ?? 0) > 0;
  const showChecklist = !hasRounds; // Onboarding checklist only when there are no rounds yet.

  // Living-clubhouse signals — only fetched when the user is past
  // first-round onboarding (otherwise there's nothing to show and we'd
  // be paying query latency for an empty card).
  //
  // Pull the FULL group history (capped at 500 rounds for performance)
  // so rivalries / partner chemistry / group lifetime have real data.
  // The 30-day activity rollup is computed in-memory from the same set.
  // For most groups 500 rounds = 5+ years, which is plenty.
  let clubhouse:
    | ReturnType<typeof buildClubhouse>
    | null = null;
  if (hasRounds && groupId) {
    const [{ data: chRounds }, { data: chRps }, { data: chSettles }] = await Promise.all([
      // Archive vs delete (per Patrick's polish spec):
      //   - Archive = deleted_at set; round STAYS in stats/records/
      //     clubhouse history because it really happened.
      //   - Delete (via fn_delete_round) = row gone forever; for bad
      //     starts, test rounds, accidental creation.
      // So we deliberately do NOT filter by `deleted_at IS NULL` here.
      // The engine only counts finalized rounds (status filter is
      // applied inside lib/clubhouse.ts), so archived non-finalized
      // rounds (e.g. abandoned test drafts that got archived) still
      // don't pollute the signals.
      sb
        .from("rounds")
        .select("id, date, status, holes, spectator_token, course_id, courses(name)")
        .eq("group_id", groupId)
        .order("date", { ascending: false })
        .limit(500),
      sb
        .from("round_players")
        .select("id, round_id, player_id, team_id, players(display_name)")
        .order("round_id"),
      sb
        .from("settlements")
        .select("round_id, from_round_player_id, to_round_player_id, amount_cents")
    ]);

    const roundsForBundle: ClubhouseRound[] = ((chRounds as any[]) ?? []).map((r) => ({
      id: r.id,
      date: r.date,
      status: r.status,
      course_name: r.courses?.name ?? null,
      course_id: r.course_id ?? null,
      spectator_token: r.spectator_token ?? null,
      holes: r.holes ?? 18
    }));
    const roundIds = new Set(roundsForBundle.map((r) => r.id));

    const rpsForBundle: ClubhouseRoundPlayer[] = ((chRps as any[]) ?? [])
      .filter((rp) => roundIds.has(rp.round_id))
      .map((rp) => ({
        round_player_id: rp.id,
        round_id: rp.round_id,
        player_id: rp.player_id,
        display_name: rp.players?.display_name ?? "Player",
        team_id: rp.team_id ?? null
      }));

    const settlesForBundle: ClubhouseSettlement[] = ((chSettles as any[]) ?? [])
      .filter((s) => roundIds.has(s.round_id))
      .map((s) => {
        const round = roundsForBundle.find((r) => r.id === s.round_id);
        return {
          round_id: s.round_id,
          round_date: round?.date ?? "",
          from_round_player_id: s.from_round_player_id,
          to_round_player_id: s.to_round_player_id,
          amount_cents: s.amount_cents
        };
      });

    // Live-round leader requires per-hole scores + per-hole pars. Only
    // pull scores for live rounds — finalized data isn't needed for any
    // current signal and would balloon the query.
    const liveRoundIds = roundsForBundle.filter((r) => r.status === "live").map((r) => r.id);
    let chScores: ClubhouseScore[] = [];
    if (liveRoundIds.length > 0) {
      const liveRpIds = rpsForBundle
        .filter((rp) => liveRoundIds.includes(rp.round_id))
        .map((rp) => rp.round_player_id);
      if (liveRpIds.length > 0) {
        const { data: scoreRows } = await sb
          .from("scores")
          .select("round_player_id, hole_number, gross")
          .in("round_player_id", liveRpIds);
        // Per-hole par lives on course_holes via course_tees. Pull it
        // through the round_players → tee → course_holes chain in one
        // shot. Each rp is on one tee, and tees share par across the
        // round, so any tee per round_id works for par lookup.
        const { data: parRows } = await sb
          .from("round_players")
          .select(
            "id, round_id, course_tees(course_holes(hole_number, par))"
          )
          .in("round_id", liveRoundIds);
        const parByRoundHole = new Map<string, number>();
        for (const rp of (parRows as any[]) ?? []) {
          const holes = rp.course_tees?.course_holes ?? [];
          for (const h of holes) {
            parByRoundHole.set(`${rp.round_id}:${h.hole_number}`, h.par);
          }
        }
        const rpToRound = new Map(
          rpsForBundle.map((rp) => [rp.round_player_id, rp.round_id])
        );
        chScores = ((scoreRows as any[]) ?? []).map((s) => ({
          round_player_id: s.round_player_id,
          hole_number: s.hole_number,
          par:
            parByRoundHole.get(
              `${rpToRound.get(s.round_player_id) ?? ""}:${s.hole_number}`
            ) ?? 4,
          gross: s.gross
        }));
      }
    }

    clubhouse = buildClubhouse({
      group_name: groupName ?? "your group",
      rounds: roundsForBundle,
      rps: rpsForBundle,
      scores: chScores,
      settlements: settlesForBundle,
      windowDays: 30
    });
  }

  type Step = {
    done: boolean;
    blocked: boolean;
    title: string;
    body: string;
    href: string;
    cta: string;
  };
  const steps: Step[] = [
    {
      done: hasCourses,
      blocked: false,
      title: "Pick your home course",
      body: "Snap a scorecard photo or quick-add Jacksonville Golf & Country Club. The course library remembers tees, par, and stroke index so you never set this up twice.",
      href: "/courses",
      cta: hasCourses ? "Manage courses" : "Add your first course"
    },
    {
      done: hasPlayers,
      blocked: false,
      title: "Add your crew",
      body: "Drop your regular foursome in — names + Handicap Indexes are enough to start. Venmo handles, GHIN numbers, and account claims can come later.",
      href: "/players",
      cta: hasPlayers ? "Manage your roster" : "Add your crew"
    },
    {
      done: hasRounds,
      // No longer blocked when prereqs are missing. /rounds/new now
      // surfaces an inline "Quick-add JGCC / scorecard photo / type
      // it in" prompt when no courses exist, and the player section
      // already has inline guest-add. The user can finish all three
      // setup steps on one screen. Per Patrick 2026-05-12 framing —
      // setup welcome trumps configurability.
      blocked: false,
      title: "Tee it up",
      body: "Pick your course, your players, and the games you want to run. New here? You can add the course + players inline from the round form. Each player joins on their phone with a 4-digit PIN — no account required to play.",
      href: "/rounds/new",
      cta: "Start a round"
    }
  ];

  // First-visit auto-tour: only triggered for users who have never finished
  // a round AND have no players or courses set up yet. After the first
  // round is in, we never auto-show the tour. ReplayTourButton stays
  // visible so it can be re-triggered manually.
  const showAutoTour = !hasRounds && !hasPlayers;

  return (
    <div className="space-y-6">
      <OnboardingTour
        displayName={profile?.display_name ?? user.email ?? null}
        eligibleForAutoShow={showAutoTour}
      />

      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="h-eyebrow">{groupName ?? "Clubhouse"}</p>
          <h1 className="h-display text-4xl text-cream-50 mt-1">Rounds</h1>
        </div>
        <div className="flex items-center gap-2">
          <ReplayTourButton
            displayName={profile?.display_name ?? user.email ?? null}
          />
          <Link href="/rounds/new" className="btn-primary">New round</Link>
        </div>
      </header>

      {showChecklist && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="h-eyebrow text-gold-400">Set up your group</p>
            <p className="text-xs text-cream-100/55">{steps.filter((s) => s.done).length} of {steps.length} done</p>
          </div>
          <ol className="space-y-2">
            {steps.map((step, i) => (
              <li
                key={i}
                className={`card p-4 flex items-start gap-3 ${
                  step.done ? "border border-emerald-400/20 bg-brand-900/40" : ""
                }`}
              >
                <span
                  className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-serif text-sm ${
                    step.done
                      ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40"
                      : "bg-brand-800 text-cream-100/80 ring-1 ring-cream-100/15"
                  }`}
                >
                  {step.done ? "✓" : i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-serif text-lg text-cream-50">{step.title}</div>
                  <p className="text-xs text-cream-100/65 mt-0.5 leading-relaxed">{step.body}</p>
                </div>
                {step.blocked ? (
                  <span
                    className="btn text-xs shrink-0 bg-brand-800/40 border border-cream-100/10 text-cream-100/45 cursor-not-allowed"
                    title={
                      !hasCourses && !hasPlayers
                        ? "Add a course and players above first"
                        : !hasCourses
                        ? "Add a course above first"
                        : "Add players above first"
                    }
                  >
                    Add{" "}
                    {!hasCourses && !hasPlayers
                      ? "a course + players"
                      : !hasCourses
                      ? "a course"
                      : "players"}{" "}
                    first
                  </span>
                ) : (
                  <Link
                    href={step.href}
                    className={`btn text-xs shrink-0 ${
                      step.done
                        ? "bg-brand-800/70 border border-cream-100/15 text-cream-100/85"
                        : i === steps.findIndex((s) => !s.done && !s.blocked)
                        ? "bg-cream-100 text-brand-900"
                        : "bg-brand-800/70 border border-cream-100/15 text-cream-100/85"
                    }`}
                  >
                    {step.cta} →
                  </Link>
                )}
              </li>
            ))}
          </ol>
          <p className="text-xs text-cream-100/45 text-center">
            Or <Link href="/demo" className="text-gold-400 underline">tour the demo</Link> first to see it all in action.
          </p>
        </div>
      )}

      {/* Living-clubhouse strip — group-centric activity above the rounds
          list. Renders nothing if there's no live activity, no streaks,
          and no recent rounds. NEVER shows during onboarding (clubhouse
          variable is null until first round exists). */}
      {clubhouse && <ClubhouseStrip bundle={clubhouse} />}

      {/* Active-round shortcut — one tap to score-entry from the dashboard. */}
      {activeRound && (
        <Link
          href={`/rounds/${activeRound.id}/score-group`}
          className="card card-hover p-4 sm:p-5 flex items-center justify-between gap-3 border border-gold-500/40 bg-brand-900/40 hover:bg-brand-900/70 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl sm:text-3xl">📋</span>
            <div>
              <p className="h-eyebrow text-gold-400">In progress</p>
              <div className="font-serif text-lg sm:text-xl text-cream-50 mt-0.5">
                Enter scores · {activeRound.courses?.name ?? "Round"}
              </div>
              <p className="text-[11px] text-cream-100/55 mt-0.5">
                {activeRound.date} · status {activeRound.status}
              </p>
            </div>
          </div>
          <span className="pill bg-gold-500 text-brand-900 hidden sm:inline-flex">Open scoresheet →</span>
        </Link>
      )}

      {/* Returning-user hero card. Per Patrick 2026-05-12 product framing:
          setup welcome > configurability. When there's history we pre-fill
          everything from the last round (course, lineup, games, stakes)
          via /rounds/new?fromLast=1. The user lands on a form that's
          already configured — one scroll to "Start round". A small "or
          customize" link routes to the same form without the pre-fill
          for power users / different game days. */}
      {hasRounds && !activeRound && (
        <div className="card p-5 sm:p-6 border border-gold-500/40 bg-brand-900/40 flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p className="h-eyebrow text-gold-400">Saturday game</p>
            <div className="font-serif text-xl sm:text-2xl text-cream-50 mt-0.5">
              Start today&apos;s round
            </div>
            {(rounds?.[0] as any)?.courses?.name ? (
              <p className="text-[12px] text-cream-100/65 mt-1 leading-snug">
                We&apos;ll re-use last round at{" "}
                <span className="text-cream-50">
                  {(rounds?.[0] as any).courses.name}
                </span>
                {" "}— same lineup, same games. One tap to start.
              </p>
            ) : (
              <p className="text-[12px] text-cream-100/65 mt-1">
                Course, players, games — set up in under a minute.
              </p>
            )}
            <Link
              href="/rounds/new"
              className="text-[11px] text-cream-100/55 hover:text-cream-100 underline underline-offset-2 mt-1.5 inline-block"
            >
              Or customize →
            </Link>
          </div>
          <Link
            href={
              (rounds?.[0] as any)?.courses?.name
                ? "/rounds/new?fromLast=1"
                : "/rounds/new"
            }
            className="btn-primary text-sm shrink-0"
          >
            Start round →
          </Link>
        </div>
      )}

      {/* Quick links — always-visible nav surface for the side rooms of the app. */}
      <section className="space-y-2">
        <p className="h-eyebrow text-gold-400">Quick links</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Link href="/leaderboards" className="card card-hover p-3 text-center flex flex-col items-center gap-1">
            <span className="text-xl">📊</span>
            <span className="font-serif text-sm text-cream-50">Leaderboards</span>
            <span className="text-[10px] text-cream-100/55">Across all finalized rounds</span>
          </Link>
          <Link href="/records" className="card card-hover p-3 text-center flex flex-col items-center gap-1">
            <span className="text-xl">🏆</span>
            <span className="font-serif text-sm text-cream-50">Records</span>
            <span className="text-[10px] text-cream-100/55">Best gross, biggest wins, milestones</span>
          </Link>
          <Link href="/courses" className="card card-hover p-3 text-center flex flex-col items-center gap-1">
            <span className="text-xl">🗺️</span>
            <span className="font-serif text-sm text-cream-50">Courses</span>
            <span className="text-[10px] text-cream-100/55">Add a course or import a scorecard</span>
          </Link>
          <Link href="/ledger" className="card card-hover p-3 text-center flex flex-col items-center gap-1">
            <span className="text-xl">💵</span>
            <span className="font-serif text-sm text-cream-50">Ledger</span>
            <span className="text-[10px] text-cream-100/55">Who owes whom</span>
          </Link>
          {isPlatformAdmin && (
            <Link
              href="/admin"
              className="card card-hover p-3 text-center flex flex-col items-center gap-1 border border-gold-500/40 sm:col-span-1 col-span-2"
            >
              <span className="text-xl">🛡️</span>
              <span className="font-serif text-sm text-gold-400">Admin</span>
              <span className="text-[10px] text-cream-100/55">Platform-wide users, groups, audits</span>
            </Link>
          )}
        </div>
      </section>

      {(events.length > 0 || isGroupCommissioner) && (
        <section className="space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="h-eyebrow text-gold-400">Events</p>
            {isGroupCommissioner && (
              <Link
                href="/events/new"
                className="text-xs text-gold-400 underline"
              >
                + New event
              </Link>
            )}
          </div>
          {events.length === 0 ? (
            <div className="card p-3 text-xs text-cream-100/65">
              Running a tournament, trip, or club game with multiple
              foursomes? Create an event and add foursomes to it — each
              foursome stays a normal round, the event aggregates
              standings across them.
            </div>
          ) : (
            <ul className="space-y-2">
              {events.map((ev) => (
                <li key={ev.id}>
                  <Link
                    href={`/events/${ev.id}`}
                    className="card card-hover p-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-serif text-base text-cream-50 truncate">
                        {ev.name}
                      </div>
                      <p className="text-[11px] text-cream-100/55 mt-0.5">
                        {ev.kind === "tournament"
                          ? "Tournament"
                          : ev.kind === "trip"
                          ? "Trip"
                          : "Club game"}
                        {" · "}
                        {ev.starts_on}
                        {ev.ends_on && ev.ends_on !== ev.starts_on
                          ? ` — ${ev.ends_on}`
                          : ""}
                      </p>
                    </div>
                    <span className="text-xs text-cream-100/55 shrink-0">
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {hasRounds && (
        <>
          <p className="text-[11px] text-cream-100/45">
            Tip: swipe a round left, or tap the &ldquo;⋯&rdquo;, to archive.
            Archived rounds drop off the dashboard but stay in records — see
            the &ldquo;Archived rounds&rdquo; section below.
          </p>
          <RoundsList initialRounds={(rounds as any) ?? []} />
        </>
      )}

      {/* Archived rounds — a separate collapsed section so commissioners
          can find a round they archived to restore it. The round-detail
          page's commissioner block promises "restore from the dashboard
          or back here" — this fulfills that promise. */}
      {archivedRounds && archivedRounds.length > 0 && (
        <details className="card p-3">
          <summary className="cursor-pointer text-xs uppercase tracking-[0.22em] text-cream-100/55 select-none flex items-center justify-between gap-2">
            <span>
              Archived rounds · {archivedRounds.length}
            </span>
            <span className="text-cream-100/45">▾</span>
          </summary>
          <p className="text-[11px] text-cream-100/55 mt-2 leading-snug">
            Hidden from the main list. Tap a round to open it, then use
            the &ldquo;Restore round&rdquo; button in its settings.
          </p>
          <ul className="mt-2 space-y-1.5">
            {archivedRounds.map((r: any) => (
              <li key={r.id}>
                <Link
                  href={`/rounds/${r.id}`}
                  className="block rounded-md bg-brand-900/30 px-3 py-2 hover:bg-brand-900/50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-cream-50 text-sm truncate">
                      {r.courses?.name ?? "Round"}
                    </span>
                    <span className="text-[11px] text-cream-100/55 tabular-nums shrink-0">
                      {r.date} · {r.status}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
