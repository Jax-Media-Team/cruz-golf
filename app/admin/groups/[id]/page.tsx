import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function AdminGroupDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = supabaseAdmin();

  const { data: group } = await sb
    .from("groups")
    .select("id, name, owner_id, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!group) notFound();

  const [{ data: members }, { data: rounds }, { data: players }, { data: profiles }] = await Promise.all([
    sb.from("group_members").select("profile_id, player_id, role").eq("group_id", id),
    sb
      .from("rounds")
      .select("id, date, status, courses(name)")
      .eq("group_id", id)
      .order("date", { ascending: false }),
    sb.from("players").select("id, display_name, profile_id, is_guest, deleted_at, handicap_index").eq("group_id", id),
    sb.from("profiles").select("id, display_name")
  ]);

  const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p.display_name]));

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="h-eyebrow text-gold-400">Group</p>
          <h1 className="h-display text-3xl text-cream-50 mt-1">{group.name}</h1>
          <p className="text-xs text-cream-100/55 font-mono mt-1">{group.id}</p>
        </div>
        <Link href="/admin/groups" className="btn-ghost text-sm">← All groups</Link>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <h2 className="font-serif text-lg text-cream-50 mb-2">
            Members ({members?.length ?? 0})
          </h2>
          <ul className="divide-y divide-cream-100/8 text-sm">
            {(members ?? []).map((m: any) => (
              <li key={`${m.profile_id ?? m.player_id}`} className="py-2 flex items-center justify-between gap-3">
                <Link href={m.profile_id ? `/admin/users/${m.profile_id}` : "#"} className="text-cream-50 hover:underline">
                  {profileMap.get(m.profile_id) ?? <span className="font-mono text-xs">{(m.profile_id ?? m.player_id ?? "").slice(0, 8)}</span>}
                </Link>
                <span className="text-xs text-cream-100/55">{m.role}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card p-4">
          <h2 className="font-serif text-lg text-cream-50 mb-2">
            Roster ({(players ?? []).filter((p: any) => !p.deleted_at).length})
          </h2>
          <ul className="divide-y divide-cream-100/8 text-sm">
            {(players ?? []).map((p: any) => (
              <li key={p.id} className="py-2 flex items-center justify-between gap-3">
                <span className={`text-cream-50 ${p.deleted_at ? "line-through opacity-50" : ""}`}>
                  {p.display_name}
                  {p.is_guest && <span className="ml-1 text-[10px] text-cream-100/55 uppercase">guest</span>}
                </span>
                <span className="text-xs text-cream-100/55 tabular-nums">
                  HI {p.handicap_index ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="card p-4">
        <h2 className="font-serif text-lg text-cream-50 mb-2">Rounds ({rounds?.length ?? 0})</h2>
        <ul className="divide-y divide-cream-100/8 text-sm">
          {(rounds ?? []).map((r: any) => (
            <li key={r.id} className="py-2 flex items-center justify-between gap-3">
              <Link href={`/admin/rounds/${r.id}`} className="text-cream-50 hover:underline">
                {r.courses?.name ?? "Course"}{" "}
                <span className="text-cream-100/55 text-xs">· {r.date}</span>
              </Link>
              <span className={r.status === "live" ? "pill-live text-xs" : r.status === "finalized" ? "pill-final text-xs" : "pill-draft text-xs"}>
                {r.status}
              </span>
            </li>
          ))}
          {(rounds?.length ?? 0) === 0 && (
            <li className="py-2 text-cream-100/55 text-xs">No rounds yet.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
