import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { RoundView } from "./round-view";
import { RoundHeaderActions } from "./header-actions";
import { ClaimBanner } from "./claim-banner";
import { UnfinalizeButton } from "./unfinalize-button";
import { MarkPendingButton, ResumeRoundButton } from "./pending-controls";
import { PressControls } from "./press-controls";
import { JunkControls } from "./junk-controls";
import { SettlementSummary } from "@/components/SettlementSummary";
import { statusPillFor, type RoundStatus } from "@/components/RoundBreadcrumb";

export default async function RoundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/login?next=/rounds/${id}`);

  const { data: round } = await sb
    .from("rounds")
    .select("id, group_id, course_id, date, holes, starting_hole, status, spectator_token, pin, access_mode, finalized_at, deleted_at, settings, event_id, courses(name, city, state)")
    .eq("id", id)
    .single();
  if (!round) redirect("/dashboard");

  // If the round belongs to an event, fetch the event name + id so the
  // round header can surface "Part of [Event Name]" with a back-link.
  // Defensive against the events table not existing pre-0039.
  let parentEvent: { id: string; name: string } | null = null;
  if ((round as any).event_id) {
    try {
      const { data: ev } = await sb
        .from("events")
        .select("id, name")
        .eq("id", (round as any).event_id)
        .maybeSingle();
      parentEvent = (ev as any) ?? null;
    } catch {
      /* events table missing — silent */
    }
  }

  // Is this user a commissioner of the round's group?
  const { data: gm } = await sb
    .from("group_members")
    .select("role")
    .eq("group_id", round.group_id)
    .eq("profile_id", user.id)
    .maybeSingle();
  const isCommissioner = gm?.role === "commissioner";

  // If not the commissioner and not in open mode, require invitee status.
  if (!isCommissioner && round.access_mode !== "open_to_group") {
    const { data: invite } = await sb
      .from("round_invitees")
      .select("profile_id")
      .eq("round_id", id)
      .eq("profile_id", user.id)
      .maybeSingle();
    if (!invite) redirect(`/rounds/${id}/join`);
  }

  const { data: rps } = await sb
    .from("round_players")
    .select("id, player_id, tee_id, course_handicap, playing_handicap, team_id, display_order, players(id, display_name, profile_id, venmo_handle), course_tees(id, name, rating, slope, par, course_holes(hole_number, par, stroke_index))")
    .eq("round_id", id)
    .order("display_order");

  // "Claim your spot" — show banner to invitees who don't yet have a linked player.
  let claimCandidates: Array<{ player_id: string; display_name: string; round_player_id: string; is_unclaimed: boolean }> = [];
  if (!isCommissioner) {
    const myLinked = (rps ?? []).some((r: any) => r.players?.profile_id === user.id);
    if (!myLinked) {
      claimCandidates = (rps ?? [])
        .filter((r: any) => !r.players?.profile_id)
        .map((r: any) => ({
          player_id: r.players?.id ?? r.player_id,
          round_player_id: r.id,
          display_name: r.players?.display_name ?? "Player",
          is_unclaimed: true
        }));
    }
  }

  const { data: scores } = await sb
    .from("scores")
    .select("round_player_id, hole_number, gross")
    .in("round_player_id", (rps ?? []).map((r: any) => r.id));

  const { data: games } = await sb
    .from("round_games")
    .select("id, game_type, name, stake_cents, allowance_pct, config")
    .eq("round_id", id);

  // Junk side-bet config + items. Both queries are wrapped in try/catch
  // so a pre-0041 environment doesn't crash the round page.
  let junkConfig: any = null;
  let junkItems: any[] = [];
  try {
    const { data: cfgRow } = await sb
      .from("round_junk_config")
      .select(
        "active_categories, mode, flat_amount_cents, base_amount_cents, escalation_step_cents, escalation_scope"
      )
      .eq("round_id", id)
      .maybeSingle();
    // Treat "all categories disabled" as "junk is off". The
    // commissioner's "Disable" action sets active_categories=[] so
    // historic items still settle, but no new entries can be
    // recorded — and the round page should NOT render the entry
    // panel (or the discoverability hint should come back).
    const hasActiveCats =
      Array.isArray((cfgRow as any)?.active_categories) &&
      ((cfgRow as any).active_categories as string[]).length > 0;
    junkConfig = hasActiveCats ? cfgRow : null;
    if (cfgRow) {
      const { data: jItems } = await sb
        .from("round_junk_items")
        .select(
          "id, round_player_id, hole_number, category, custom_label, amount_cents, created_at, created_by, note"
        )
        .eq("round_id", id)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      junkItems = jItems ?? [];
    }
  } catch {
    /* tables missing — pre-0041 env */
  }

  // Manual presses — pending + accepted, hide expired/declined/withdrawn
  // from the round-page (they're still in the audit log).
  let presses: any[] = [];
  try {
    const { data: pressRows, error: pressErr } = await sb
      .from("round_presses")
      .select(
        "id, game_id, segment_label, start_hole, end_hole, stake_cents, side_a_rp_ids, side_b_rp_ids, opened_by_rp_id, opened_at, accepted_at, declined_at, withdrawn_at, status"
      )
      .eq("round_id", id)
      .in("status", ["pending", "accepted"])
      .order("opened_at", { ascending: false });
    if (!pressErr && pressRows) presses = pressRows;
  } catch {
    /* table missing — pre-0035 env */
  }

  // Resolve "my rp" for the press controls. Players have a profile_id;
  // commissioners may be in the round as a player too. Null when the
  // viewer isn't actually a player in this round.
  const myRpId =
    (rps ?? []).find((r: any) => r.players?.profile_id === user.id)?.id ??
    null;

  // Settlement rows — only fetched for finalized rounds. Drives the
  // "Settlement summary" card so a user looking back at a finalized
  // round on /rounds/[id] doesn't have to navigate to /finalize to
  // see who paid whom. Per Patrick's product framing (2026-05-12):
  // the trust math layer is the moat — settlement must persist where
  // the user actually looks.
  let settlementRows: Array<{
    from_round_player_id: string;
    to_round_player_id: string;
    amount_cents: number;
    breakdown: any;
  }> = [];
  if (round.status === "finalized") {
    const { data: setts } = await sb
      .from("settlements")
      .select("from_round_player_id, to_round_player_id, amount_cents, breakdown")
      .eq("round_id", id)
      .order("amount_cents", { ascending: false });
    settlementRows = (setts as any) ?? [];
  }

  // Stakes flag — used to decide whether to show the optional wagers tile.
  // The old handshake-required gate is gone; we no longer fetch ack rows.
  const hasStakes = (games ?? []).some((g: any) => (g.stake_cents ?? 0) > 0);

  // Auto-finalize prompt: show a banner once every player has a score on
  // every hole the round actually has. Works for shotgun starts (we count
  // distinct hole_numbers, not "did they reach 18"). Only relevant for
  // live rounds with at least one player + one game.
  const expectedScores =
    (rps?.length ?? 0) * Math.min(round.holes ?? 18, 18);
  const enteredScores = (scores ?? []).filter((s: any) => s.gross != null).length;
  const allScoresIn =
    expectedScores > 0 &&
    enteredScores >= expectedScores &&
    round.status === "live";

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        {parentEvent && (
          <Link
            href={`/events/${parentEvent.id}`}
            className="inline-flex items-center gap-1.5 text-xs text-gold-400 hover:underline"
          >
            <span aria-hidden="true">←</span>
            <span>
              Part of <span className="font-medium">{parentEvent.name}</span>
            </span>
          </Link>
        )}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="h-eyebrow text-gold-400">
              {/* Audit P2 #27: ISO date → "Saturday, May 12" so a
                  Saturday-morning return visit reads like a date, not
                  a sortkey. Locale-fixed (en-US) so the display is
                  stable across device locales. */}
              Live leaderboard · {(() => {
                const d = new Date((round.date ?? "") + "T00:00:00");
                if (isNaN(d.getTime())) return round.date;
                return d.toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric"
                });
              })()} · {round.holes} holes
            </p>
            <h1 className="h-display text-3xl text-cream-50 mt-1">{(round as any).courses?.name}</h1>
          </div>
          {(() => {
            const pill = statusPillFor(round.status as RoundStatus);
            return <span className={pill.className}>{pill.label}</span>;
          })()}
        </div>

        {/* Games-in-play strip — every game running on this round */}
        {(games?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-2">
            {(games ?? []).map((g: any) => (
              <span
                key={g.id}
                className="surface rounded-full px-3 py-1 text-xs text-cream-100/85 inline-flex items-center gap-2"
              >
                <span className="font-medium text-cream-50">{g.name}</span>
                {g.stake_cents > 0 && (
                  <span className="text-gold-400 tabular-nums">${(g.stake_cents / 100).toFixed(2)}</span>
                )}
                {g.config?.skin_value_cents > 0 && (
                  <span className="text-gold-400 tabular-nums">${(g.config.skin_value_cents / 100).toFixed(2)}/skin</span>
                )}
              </span>
            ))}
          </div>
        )}
        <RoundHeaderActions
          roundId={id}
          spectatorToken={round.spectator_token}
          pin={isCommissioner ? round.pin : null}
          accessMode={round.access_mode as "invited" | "open_to_group"}
          isCommissioner={isCommissioner}
          isArchived={(round as any).deleted_at != null}
          status={round.status as any}
          hasRealData={
            (scores ?? []).some((s: any) => s.gross != null) ||
            junkItems.length > 0 ||
            presses.length > 0
          }
        />
      </header>

      {/* Wager handshake banners removed: per product decision the handshake
          is opt-in and not surfaced here. Players can still review wagers
          via the "View wagers" tile below if stakes exist. */}

      {/* Pending-finalization banner: round is done playing but not yet
          locked. Shows BOTH paths — finalize now (write settlements) or
          resume scoring (back to live). The round stays editable in
          this state, so the wording avoids any "review-only" language. */}
      {round.status === "pending_finalization" && isCommissioner && (
        <div className="card p-4 flex items-start justify-between gap-3 flex-wrap border border-amber-400/30 bg-amber-500/5">
          <div className="min-w-0">
            <p className="h-eyebrow text-amber-300">Awaiting finalization</p>
            <p className="text-sm text-cream-50 mt-1">
              This round is out of the live bucket but still editable.
              Finalize when you&apos;re ready to lock settlements, or resume
              scoring if anything needs fixing.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <Link
              href={`/rounds/${id}/finalize`}
              className="btn-primary text-xs"
            >
              ✅ Finalize now →
            </Link>
            <ResumeRoundButton roundId={id} />
          </div>
        </div>
      )}

      {/* All-scores-entered banner — only on live rounds. Pending rounds
          already show their own banner above. */}
      {allScoresIn && round.status === "live" && isCommissioner && (
        <div className="card p-4 flex items-start justify-between gap-3 flex-wrap border border-emerald-400/40 bg-emerald-500/5">
          <div className="min-w-0">
            <div className="font-serif text-lg text-cream-50">
              All scores entered
            </div>
            <p className="text-xs text-cream-100/65 mt-0.5">
              Lock in settlements now, or move it to awaiting finalization
              and review later. You can unlock either way.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <Link
              href={`/rounds/${id}/finalize`}
              className="btn-primary text-xs"
            >
              ✅ Finalize →
            </Link>
            <MarkPendingButton roundId={id} variant="inline" />
          </div>
        </div>
      )}

      {claimCandidates.length > 0 && (
        <ClaimBanner roundId={id} candidates={claimCandidates} />
      )}

      {/* Junk discoverability hint — surfaces the feature on the round
          page itself when junk hasn't been enabled yet. Commissioner-
          only, live or pending rounds only. Real-world tester feedback:
          junk lived behind /games and people couldn't find it. */}
      {!junkConfig &&
        isCommissioner &&
        (round.status === "live" || round.status === "pending_finalization") && (
          <Link
            href={`/rounds/${id}/games`}
            className="card p-3 border border-dashed border-gold-500/30 flex items-center justify-between gap-3 flex-wrap hover:bg-gold-500/5 transition-colors"
          >
            <div className="min-w-0">
              <p className="h-eyebrow text-gold-400">Junk side-bets</p>
              <p className="text-xs text-cream-100/65 mt-0.5 leading-snug">
                Birdies, greenies, sandies, chip-ins, poleys, pinnies —
                tap-the-extras tracking. Default is $2 flat per item
                (toggle to escalating in setup if you prefer).
              </p>
            </div>
            <span className="text-xs text-gold-400 shrink-0">
              + Enable for this round →
            </span>
          </Link>
        )}

      {/* Leaderboard moved above the press/junk controls + secondary
          action grid (audit P1 #13). The leaderboard is what people
          came to see; controls live below so they don't bury it. The
          #leaderboard anchor still resolves because it lives right
          before the RoundView. */}
      <div id="leaderboard" />
      <RoundView
        roundId={id}
        rps={rps ?? []}
        initialScores={scores ?? []}
        games={games ?? []}
        manualPresses={presses ?? []}
        totalHoles={(round.holes as 9 | 18) ?? 18}
        startingHole={round.starting_hole ?? 1}
      />

      {/* Junk side-bet panel — entry + live totals + commissioner edits.
          Only renders when junk config exists for this round AND the
          round is editable. Tap-the-extras UX per Patrick's principle. */}
      {junkConfig &&
        (round.status === "live" || round.status === "pending_finalization") &&
        (rps?.length ?? 0) > 0 && (
          <JunkControls
            roundId={id}
            totalHoles={round.holes ?? 18}
            defaultHole={(() => {
              // Best-guess current hole: max hole_number with any score + 1.
              const maxScored = (scores ?? [])
                .filter((s: any) => s.gross != null)
                .reduce(
                  (max: number, s: any) =>
                    Math.max(max, Number(s.hole_number) || 0),
                  0
                );
              return Math.min(
                Math.max(1, maxScored + 1),
                round.holes ?? 18
              );
            })()}
            rps={(rps ?? []).map((r: any) => ({
              id: r.id,
              display_name: r.players?.display_name ?? "Player"
            }))}
            config={junkConfig as any}
            initialItems={junkItems as any}
            isCommissioner={isCommissioner}
          />
        )}

      {/* Manual press controls — open / accept / decline / withdraw +
          live display of accepted presses. Only renders for live or
          pending rounds (finalized = no new presses; engine respects
          the same gate). */}
      {(round.status === "live" || round.status === "pending_finalization") &&
        (rps?.length ?? 0) > 0 && (
          <PressControls
            roundId={id}
            totalHoles={round.holes ?? 18}
            rps={(rps ?? []).map((r: any) => ({
              id: r.id,
              player_id: r.player_id,
              team_id: r.team_id,
              display_name: r.players?.display_name ?? "Player",
              is_me: r.players?.profile_id === user.id
            }))}
            games={(games ?? []) as any}
            presses={presses as any}
            myRpId={myRpId}
            isCommissioner={isCommissioner}
          />
        )}

      {/* Finalized rounds: the settlement card IS the primary surface.
          Visible to every viewer (not commissioner-only — the trust
          math is the moat, and both payer and recipient need to verify
          their own number). The commissioner gets an Unlock button
          inline below. Per Patrick 2026-05-12 product framing. */}
      {round.status === "finalized" && (
        <>
          <SettlementSummary
            roundId={id}
            flows={settlementRows.map((s) => ({
              from_round_player_id: s.from_round_player_id,
              to_round_player_id: s.to_round_player_id,
              amount_cents: s.amount_cents,
              breakdown: s.breakdown
            }))}
            rps={(rps ?? []).map((r: any) => ({
              id: r.id,
              player_id: r.player_id,
              display_name: r.players?.display_name ?? "Player",
              venmo_handle: r.players?.venmo_handle ?? null
            }))}
            finalizedAt={round.finalized_at ?? null}
            viewerRpId={myRpId}
            isCommissioner={isCommissioner}
            courseName={(round as any).courses?.name ?? null}
            roundDate={round.date ?? null}
            spectatorToken={(round as any).spectator_token ?? null}
          />
          {isCommissioner && (
            <div className="card p-3 flex items-center justify-between gap-3 border border-cream-100/15">
              <p className="text-[11px] text-cream-100/55">
                Need to fix a score? Unlock the round, edit, and finalize
                again — settlements re-compute from scratch each time.
              </p>
              <UnfinalizeButton roundId={id} />
            </div>
          )}
        </>
      )}

      {round.status !== "finalized" && (
        <div className="space-y-2">
          {/* Primary CTA — prominent on desktop and mobile so score entry is never lost. */}
          <Link
            href={`/rounds/${id}/score-group`}
            className="card card-hover p-5 sm:p-6 flex items-center justify-between gap-4 border border-gold-500/40 bg-brand-900/40 hover:bg-brand-900/70 transition-colors"
          >
            <div className="flex items-center gap-4">
              <span className="text-3xl sm:text-4xl">📋</span>
              <div>
                <div className="font-serif text-xl sm:text-2xl text-cream-50">Enter scores</div>
                <p className="text-xs sm:text-sm text-cream-100/65 mt-0.5">
                  Tap any player on the leaderboard, or use the group scoresheet.
                </p>
              </div>
            </div>
            <span className="pill bg-gold-500 text-brand-900 hidden sm:inline-flex">Open scoresheet →</span>
          </Link>

          {/* Secondary actions */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <a
              href="#leaderboard"
              className="card card-hover p-3 text-center flex flex-col items-center gap-1"
            >
              <span className="text-xl">🏆</span>
              <span className="font-serif text-sm text-cream-50 leading-tight">Leaderboard</span>
            </a>
            {isCommissioner && (
              <Link
                href={`/rounds/${id}/invites`}
                className="card card-hover p-3 text-center flex flex-col items-center gap-1"
              >
                <span className="text-xl">✉️</span>
                <span className="font-serif text-sm text-cream-50 leading-tight">Invite players</span>
              </Link>
            )}
            {isCommissioner && (
              <Link
                href={`/rounds/${id}/games`}
                className="card card-hover p-3 text-center flex flex-col items-center gap-1"
              >
                <span className="text-xl">🎲</span>
                <span className="font-serif text-sm text-cream-50 leading-tight">Edit games</span>
              </Link>
            )}
            {hasStakes && (
              <Link
                href={`/rounds/${id}/wagers`}
                className="card card-hover p-3 text-center flex flex-col items-center gap-1"
              >
                <span className="text-xl">💰</span>
                <span className="font-serif text-sm text-cream-50 leading-tight">View wagers</span>
              </Link>
            )}
            {/* Finalize tile — only shown when the prominent "All scores
                entered" banner above is NOT showing. One Finalize CTA on
                the page at any time. The banner takes over when ready;
                this tile is the early-finalize escape hatch (e.g. shotgun
                or 9-hole rounds) before the banner triggers. */}
            {!allScoresIn && (
              <Link
                href={`/rounds/${id}/finalize`}
                className="card card-hover p-3 text-center flex flex-col items-center gap-1"
              >
                <span className="text-xl">✅</span>
                <span className="font-serif text-sm text-cream-50 leading-tight">Finalize</span>
              </Link>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
