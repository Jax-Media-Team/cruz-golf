import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/format-date";
import { statusPillFor, type RoundStatus } from "@/components/RoundBreadcrumb";

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

  // All presses on this round (every status). Critical for press
  // disputes — the admin needs to see the full lifecycle:
  // who opened, who accepted/declined/withdrew, when. Joins through
  // round_players → players for human-readable names. Defensive
  // against pre-0035 envs.
  type AdminPressRow = {
    id: string;
    status: string;
    segment_label: string;
    start_hole: number;
    end_hole: number;
    stake_cents: number;
    side_a_rp_ids: string[];
    side_b_rp_ids: string[];
    opened_by_rp_id: string | null;
    accepted_by_rp_id: string | null;
    declined_by_rp_id: string | null;
    opened_at: string;
    accepted_at: string | null;
    declined_at: string | null;
    withdrawn_at: string | null;
  };
  let presses: AdminPressRow[] = [];
  const nameByRpId = new Map<string, string>();
  for (const rp of (rps ?? []) as any[]) {
    nameByRpId.set(rp.id, rp.players?.display_name ?? rp.id.slice(0, 8));
  }
  try {
    const { data } = await sb
      .from("round_presses")
      .select(
        "id, status, segment_label, start_hole, end_hole, stake_cents, side_a_rp_ids, side_b_rp_ids, opened_by_rp_id, accepted_by_rp_id, declined_by_rp_id, opened_at, accepted_at, declined_at, withdrawn_at"
      )
      .eq("round_id", id)
      .order("opened_at", { ascending: false });
    presses = (data as any[]) ?? [];
  } catch {
    /* pre-0035 env — table missing */
  }

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
            {" · "}{(() => {
              const pill = statusPillFor(r.status as RoundStatus);
              return <span className={`${pill.className} text-xs`}>{pill.label}</span>;
            })()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Spectate live: read-only token-keyed leaderboard with the
              admin banner. Replaces the old "View as user →" which tried
              to open the round page in the admin's own session — that
              path was blocked by RLS for any group the admin wasn't a
              member of, so the link silently bounced to the dashboard.
              The new path is observability-by-design. */}
          {r.spectator_token && (
            <Link
              href={`/rounds/${r.id}/leaderboard?token=${r.spectator_token}&adminMode=1`}
              className="btn-secondary text-sm"
            >
              👀 Spectate live →
            </Link>
          )}
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
        <Stat label="Created" value={formatDate(r.created_at)} />
      </section>

      {/* Manual presses — full lifecycle visible for dispute support.
          Per-row: status pill, segment, stake, hole range, sides, plus
          the actor names + timestamps for open / accept / decline /
          withdraw. Empty section hides itself when there are no
          presses (or the table doesn't exist pre-0035). */}
      {presses.length > 0 && (
        <section className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-lg text-cream-50">
              Manual presses ({presses.length})
            </h2>
            <Link
              href={`/admin/audit?kind=press.open`}
              className="text-xs text-gold-400 underline"
            >
              Audit log →
            </Link>
          </div>
          <ul className="divide-y divide-cream-100/8 text-sm">
            {presses.map((p) => {
              const opener =
                (p.opened_by_rp_id && nameByRpId.get(p.opened_by_rp_id)) ??
                "—";
              const responder =
                (p.accepted_by_rp_id &&
                  `accepted by ${nameByRpId.get(p.accepted_by_rp_id) ?? "—"}`) ||
                (p.declined_by_rp_id &&
                  `declined by ${nameByRpId.get(p.declined_by_rp_id) ?? "—"}`) ||
                null;
              const sideA = p.side_a_rp_ids
                .map((id) => nameByRpId.get(id) ?? "—")
                .join(" + ");
              const sideB = p.side_b_rp_ids
                .map((id) => nameByRpId.get(id) ?? "—")
                .join(" + ");
              const statusClass =
                p.status === "accepted"
                  ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30"
                  : p.status === "pending"
                  ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/30"
                  : p.status === "declined"
                  ? "bg-red-500/15 text-red-300 ring-1 ring-red-400/30"
                  : "bg-cream-100/8 text-cream-100/65 ring-1 ring-cream-100/15";
              const settlementTs =
                p.accepted_at ?? p.declined_at ?? p.withdrawn_at ?? null;
              return (
                <li key={p.id} className="py-3 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`pill text-[10px] px-2 py-0.5 font-medium ${statusClass}`}
                    >
                      {p.status}
                    </span>
                    <span className="text-cream-50 font-medium">
                      {p.segment_label}
                    </span>
                    <span className="text-cream-100/65 text-xs">
                      · holes {p.start_hole}-{p.end_hole}
                    </span>
                    <span className="text-gold-400 text-xs tabular-nums">
                      · ${(p.stake_cents / 100).toFixed(0)}
                    </span>
                  </div>
                  <div className="text-xs text-cream-100/65">
                    {sideA} <span className="text-cream-100/45">vs</span>{" "}
                    {sideB}
                  </div>
                  <div className="text-[11px] text-cream-100/55 leading-snug">
                    Opened by {opener} at{" "}
                    <span className="tabular-nums">
                      {new Date(p.opened_at).toLocaleString()}
                    </span>
                    {responder && (
                      <>
                        {" · "}
                        {responder}
                        {settlementTs && (
                          <>
                            {" at "}
                            <span className="tabular-nums">
                              {new Date(settlementTs).toLocaleString()}
                            </span>
                          </>
                        )}
                      </>
                    )}
                  </div>
                  <div className="font-mono text-[10px] text-cream-100/45 truncate">
                    press {p.id}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
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
