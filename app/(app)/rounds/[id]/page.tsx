import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { RoundView } from "./round-view";
import { RoundHeaderActions } from "./header-actions";
import { ClaimBanner } from "./claim-banner";
import { UnfinalizeButton } from "./unfinalize-button";

export default async function RoundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/login?next=/rounds/${id}`);

  const { data: round } = await sb
    .from("rounds")
    .select("id, group_id, course_id, date, holes, starting_hole, status, spectator_token, pin, access_mode, finalized_at, settings, courses(name, city, state)")
    .eq("id", id)
    .single();
  if (!round) redirect("/dashboard");

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
    .select("id, player_id, tee_id, course_handicap, playing_handicap, team_id, display_order, players(id, display_name, profile_id), course_tees(id, name, rating, slope, par, course_holes(hole_number, par, stroke_index))")
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
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="h-eyebrow text-gold-400">
              Live leaderboard · {round.date} · {round.holes} holes
            </p>
            <h1 className="h-display text-3xl text-cream-50 mt-1">{(round as any).courses?.name}</h1>
          </div>
          <span className={round.status === "live" ? "pill-live" : round.status === "finalized" ? "pill-final" : "pill-draft"}>
            {round.status}
          </span>
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
        />
      </header>

      {/* Wager handshake banners removed: per product decision the handshake
          is opt-in and not surfaced here. Players can still review wagers
          via the "View wagers" tile below if stakes exist. */}

      {allScoresIn && isCommissioner && (
        <Link
          href={`/rounds/${id}/finalize`}
          className="card p-4 flex items-center justify-between gap-3 hover:bg-brand-900/80 transition-colors border border-emerald-400/40 bg-emerald-500/5"
        >
          <div>
            <div className="font-serif text-lg text-cream-50">
              ✅ All scores entered. Review and finalize?
            </div>
            <p className="text-xs text-cream-100/65 mt-0.5">
              Lock in the round and compute settlements. You can unlock later
              if anything needs fixing.
            </p>
          </div>
          <span className="pill bg-emerald-500 text-brand-900">Finalize →</span>
        </Link>
      )}

      {claimCandidates.length > 0 && (
        <ClaimBanner roundId={id} candidates={claimCandidates} />
      )}

      {round.status === "finalized" && isCommissioner && (
        <div className="card p-4 flex items-center justify-between gap-3 border border-cream-100/15">
          <div>
            <p className="h-eyebrow text-gold-400">Locked</p>
            <p className="text-sm text-cream-50 mt-1">
              This round is finalized. Settlements are written.
            </p>
            <p className="text-[11px] text-cream-100/55 mt-0.5">
              Need to fix a score? Unlock and re-finalize.
            </p>
          </div>
          <UnfinalizeButton roundId={id} />
        </div>
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
            <Link
              href={`/rounds/${id}/finalize`}
              className="card card-hover p-3 text-center flex flex-col items-center gap-1"
            >
              <span className="text-xl">✅</span>
              <span className="font-serif text-sm text-cream-50 leading-tight">Finalize</span>
            </Link>
          </div>
        </div>
      )}

      <div id="leaderboard" />
      <RoundView
        roundId={id}
        rps={rps ?? []}
        initialScores={scores ?? []}
        games={games ?? []}
        totalHoles={(round.holes as 9 | 18) ?? 18}
        startingHole={round.starting_hole ?? 1}
      />
    </div>
  );
}
