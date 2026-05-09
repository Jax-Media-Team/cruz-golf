import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function AdminRoundDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = supabaseAdmin();
  const { data: r } = await sb
    .from("rounds")
    .select(
      "id, date, status, holes, created_at, finalized_at, group_id, course_id, access_mode, pin, spectator_token, groups(name), courses(name, city, state)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!r) notFound();

  const [{ data: rps }, { data: games }] = await Promise.all([
    sb
      .from("round_players")
      .select("id, course_handicap, playing_handicap, players(display_name)")
      .eq("round_id", id)
      .order("display_order"),
    sb.from("round_games").select("id, name, game_type, stake_cents, allowance_pct, config").eq("round_id", id)
  ]);

  // Count scores via the round's round_player_ids
  const rpIds = (rps ?? []).map((rp: any) => rp.id);
  const { count: scoreCount } = await sb
    .from("scores")
    .select("*", { head: true, count: "exact" })
    .in("round_player_id", rpIds.length > 0 ? rpIds : ["00000000-0000-0000-0000-000000000000"]);

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="h-eyebrow text-gold-400">Round</p>
          <h1 className="h-display text-3xl text-cream-50 mt-1">
            {(r as any).courses?.name ?? "Course"} <span className="text-cream-100/55">·</span> {r.date}
          </h1>
          <p className="text-sm text-cream-100/65 mt-1">
            <Link href={`/admin/groups/${r.group_id}`} className="hover:underline">{(r as any).groups?.name ?? "Group"}</Link>
            {" · "}{r.holes} holes
            {" · "}<span className={r.status === "live" ? "pill-live text-xs" : r.status === "finalized" ? "pill-final text-xs" : "pill-draft text-xs"}>{r.status}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/rounds/${r.id}`} className="btn-ghost text-sm">View as user →</Link>
          <Link href="/admin/rounds" className="btn-ghost text-sm">← All rounds</Link>
        </div>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <h2 className="font-serif text-lg text-cream-50 mb-2">Players ({rps?.length ?? 0})</h2>
          <ul className="divide-y divide-cream-100/8 text-sm">
            {(rps ?? []).map((rp: any) => (
              <li key={rp.id} className="py-2 flex items-center justify-between gap-3">
                <span className="text-cream-50">{rp.players?.display_name ?? "Player"}</span>
                <span className="text-xs text-cream-100/55 tabular-nums">CH {rp.course_handicap} · PH {rp.playing_handicap}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card p-4">
          <h2 className="font-serif text-lg text-cream-50 mb-2">Games ({games?.length ?? 0})</h2>
          <ul className="divide-y divide-cream-100/8 text-sm">
            {(games ?? []).map((g: any) => (
              <li key={g.id} className="py-2 flex items-center justify-between gap-3">
                <span className="text-cream-50">{g.name}</span>
                <span className="text-xs text-cream-100/65">
                  {g.game_type} · ${(g.stake_cents / 100).toFixed(2)} · {g.allowance_pct}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="card p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <Stat label="Scores entered" value={scoreCount ?? 0} />
        <Stat label="Access mode" value={r.access_mode} />
        <Stat label="PIN" value={r.pin ?? "—"} />
        <Stat label="Created" value={new Date(r.created_at).toLocaleDateString()} />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-cream-100/55">{label}</div>
      <div className="text-cream-50 mt-0.5">{value}</div>
    </div>
  );
}
