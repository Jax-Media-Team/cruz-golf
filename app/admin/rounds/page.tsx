import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { statusPillFor, type RoundStatus } from "@/components/RoundBreadcrumb";

export const dynamic = "force-dynamic";

export default async function AdminRoundsPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const status = sp.status;
  const sb = supabaseAdmin();

  let query = sb
    .from("rounds")
    .select(
      "id, date, status, holes, created_at, group_id, course_id, spectator_token, groups(name), courses(name)"
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (
    status === "live" ||
    status === "finalized" ||
    status === "draft" ||
    status === "pending_finalization"
  ) {
    query = query.eq("status", status);
  }
  const { data: rounds } = await query;

  const ids = (rounds ?? []).map((r: any) => r.id);
  const { data: rps } = await sb
    .from("round_players")
    .select("round_id")
    .in("round_id", ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const playerCount = new Map<string, number>();
  for (const rp of (rps ?? []) as any[]) {
    playerCount.set(rp.round_id, (playerCount.get(rp.round_id) ?? 0) + 1);
  }

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="h-eyebrow text-gold-400">Rounds</p>
          <h1 className="h-display text-3xl text-cream-50 mt-1">
            {(rounds?.length ?? 0).toLocaleString()} {status ? status : "rounds"}
          </h1>
        </div>
        <nav className="flex gap-1 text-xs">
          <Link href="/admin/rounds" className={`btn-ghost ${!status ? "bg-brand-800/70" : ""}`}>All</Link>
          <Link href="/admin/rounds?status=live" className={`btn-ghost ${status === "live" ? "bg-brand-800/70" : ""}`}>Live</Link>
          <Link href="/admin/rounds?status=pending_finalization" className={`btn-ghost ${status === "pending_finalization" ? "bg-brand-800/70" : ""}`}>Pending</Link>
          <Link href="/admin/rounds?status=finalized" className={`btn-ghost ${status === "finalized" ? "bg-brand-800/70" : ""}`}>Finalized</Link>
          <Link href="/admin/rounds?status=draft" className={`btn-ghost ${status === "draft" ? "bg-brand-800/70" : ""}`}>Draft</Link>
        </nav>
      </header>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-brand-950/50 text-[10px] uppercase tracking-wider text-cream-100/55">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Course</th>
                <th className="px-3 py-2 text-left">Group</th>
                <th className="px-3 py-2 text-right">Holes</th>
                <th className="px-3 py-2 text-right">Players</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(rounds ?? []).map((r: any) => (
                <tr key={r.id} className="border-t border-cream-100/8 hover:bg-brand-900/30">
                  <td className="px-3 py-2 text-cream-100/85 tabular-nums">{r.date}</td>
                  <td className="px-3 py-2 text-cream-50">{r.courses?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-cream-100/85">
                    <Link href={`/admin/groups/${r.group_id}`} className="hover:underline">
                      {r.groups?.name ?? "—"}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.holes}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{playerCount.get(r.id) ?? 0}</td>
                  <td className="px-3 py-2">
                    {(() => {
                      const pill = statusPillFor(r.status as RoundStatus);
                      return <span className={`${pill.className} text-xs`}>{pill.label}</span>;
                    })()}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {r.status === "live" && r.spectator_token && (
                      <Link
                        href={`/rounds/${r.id}/leaderboard?token=${r.spectator_token}&adminMode=1`}
                        className="text-xs text-cream-100/85 hover:text-gold-400 mr-3"
                        title="Read-only live leaderboard with admin banner"
                      >
                        👀 Spectate
                      </Link>
                    )}
                    <Link href={`/admin/rounds/${r.id}`} className="text-xs text-gold-400 underline">
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
              {(rounds?.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-cream-100/55 text-sm">
                    No rounds.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
