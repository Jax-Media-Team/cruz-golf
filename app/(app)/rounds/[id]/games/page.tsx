import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { RoundBreadcrumb } from "@/components/RoundBreadcrumb";
import { GamesEditor } from "./games-editor";

export const dynamic = "force-dynamic";

/**
 * Commissioner-only mid-round game/bet editor.
 *
 * Lets the round commissioner add new games, change stakes, swap gross<->net,
 * or remove games before finalize. Players see the changes the next time
 * they refresh. Removing a game when scores already exist is allowed but
 * warned — settlements are recomputed at finalize time anyway.
 */
export default async function RoundGamesPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await supabaseServer();
  const {
    data: { user }
  } = await sb.auth.getUser();
  if (!user) redirect(`/login?next=/rounds/${id}/games`);

  const { data: round } = await sb
    .from("rounds")
    .select("id, group_id, status, holes, courses(name), date")
    .eq("id", id)
    .single();
  if (!round) notFound();

  // Commissioner-only gate.
  const { data: gm } = await sb
    .from("group_members")
    .select("role")
    .eq("group_id", round.group_id)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (gm?.role !== "commissioner") {
    return (
      <div className="card p-8 max-w-md mx-auto text-center">
        <p className="h-eyebrow text-amber-300">Commissioner only</p>
        <h1 className="font-serif text-xl text-cream-50 mt-2">
          You can&apos;t edit games for this round
        </h1>
        <p className="text-sm text-cream-100/65 mt-2">
          Ask the commissioner to make changes — only they can add or remove
          games and adjust stakes.
        </p>
        <Link href={`/rounds/${id}`} className="btn-ghost text-sm mt-4 inline-block">
          ← Back to round
        </Link>
      </div>
    );
  }

  const isFinalized = round.status === "finalized";

  const [{ data: games }, { data: rps }, { data: scores }] = await Promise.all([
    sb
      .from("round_games")
      .select("id, game_type, name, stake_cents, allowance_pct, config")
      .eq("round_id", id)
      .order("name"),
    sb
      .from("round_players")
      .select("id, players(display_name)")
      .eq("round_id", id)
      .order("created_at", { ascending: true }),
    sb
      .from("scores")
      .select("round_player_id", { count: "exact", head: true })
      .in("round_player_id", []) // placeholder; we'll re-issue once we have rp ids
  ]);

  const rpIds = (rps ?? []).map((r: any) => r.id);
  const safeRpIds = rpIds.length > 0 ? rpIds : ["00000000-0000-0000-0000-000000000000"];
  const { count: scoreCount } = await sb
    .from("scores")
    .select("round_player_id", { count: "exact", head: true })
    .in("round_player_id", safeRpIds)
    .not("gross", "is", null);

  // Junk config — surface "is this round opted in?" to the editor.
  // Wrapped in try/catch so pre-0041 deployments still load the page.
  let junkConfig: any = null;
  try {
    const { data } = await sb
      .from("round_junk_config")
      .select(
        "active_categories, mode, flat_amount_cents, base_amount_cents, escalation_step_cents, escalation_scope, custom_categories"
      )
      .eq("round_id", id)
      .maybeSingle();
    junkConfig = data ?? null;
  } catch {
    /* table missing — pre-0041 env */
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <RoundBreadcrumb
        roundId={id}
        courseName={(round as any).courses?.name ?? null}
        date={round.date}
        status={round.status as any}
        page="Games & bets"
      />
      <header>
        <p className="h-eyebrow text-gold-400">Games & bets</p>
        <h1 className="h-display text-3xl text-cream-50 mt-1">
          {round.holes} holes ·{" "}
          {scoreCount
            ? `${scoreCount} score${scoreCount === 1 ? "" : "s"} entered`
            : "no scores yet"}
        </h1>
      </header>

      {isFinalized ? (
        <div className="card p-5 border border-amber-400/30 bg-amber-500/5">
          <p className="font-serif text-lg text-cream-50">Round is finalized</p>
          <p className="text-xs text-cream-100/65 mt-1">
            Games can&apos;t be edited after finalize. If a settlement is wrong,
            unfinalize the round from the round page first.
          </p>
        </div>
      ) : (
        <GamesEditor
          roundId={id}
          initialGames={(games as any) ?? []}
          players={((rps as any) ?? []).map((r: any) => ({
            id: r.id,
            display_name: r.players?.display_name ?? "Player"
          }))}
          initialJunkConfig={junkConfig as any}
          hasScores={(scoreCount ?? 0) > 0}
        />
      )}
      {/* Back-to-round duplicate removed — RoundBreadcrumb at the top is
          the single canonical "back" affordance per the no-duplicate-UI
          principle. */}
    </div>
  );
}
