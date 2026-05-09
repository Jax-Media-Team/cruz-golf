import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function AdminGroupsPage() {
  const sb = supabaseAdmin();

  const [{ data: groups }, { data: members }, { data: rounds }, { data: profiles }] = await Promise.all([
    sb
      .from("groups")
      .select("id, name, owner_id, created_at")
      .order("created_at", { ascending: false }),
    sb.from("group_members").select("group_id, profile_id, role"),
    sb.from("rounds").select("group_id"),
    sb.from("profiles").select("id, display_name")
  ]);

  const memberCount = new Map<string, number>();
  const commCount = new Map<string, number>();
  for (const m of (members ?? []) as any[]) {
    memberCount.set(m.group_id, (memberCount.get(m.group_id) ?? 0) + 1);
    if (m.role === "commissioner") commCount.set(m.group_id, (commCount.get(m.group_id) ?? 0) + 1);
  }
  const roundCount = new Map<string, number>();
  for (const r of (rounds ?? []) as any[]) {
    roundCount.set(r.group_id, (roundCount.get(r.group_id) ?? 0) + 1);
  }
  const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p.display_name]));

  return (
    <div className="space-y-4">
      <header>
        <p className="h-eyebrow text-gold-400">Groups</p>
        <h1 className="h-display text-3xl text-cream-50 mt-1">
          {(groups?.length ?? 0).toLocaleString()} groups
        </h1>
      </header>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-brand-950/50 text-[10px] uppercase tracking-wider text-cream-100/55">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Owner</th>
                <th className="px-3 py-2 text-right">Members</th>
                <th className="px-3 py-2 text-right">Commissioners</th>
                <th className="px-3 py-2 text-right">Rounds</th>
                <th className="px-3 py-2 text-left">Created</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(groups ?? []).map((g: any) => (
                <tr key={g.id} className="border-t border-cream-100/8 hover:bg-brand-900/30">
                  <td className="px-3 py-2 text-cream-50 font-medium">{g.name}</td>
                  <td className="px-3 py-2 text-cream-100/85 text-xs">
                    {profileMap.get(g.owner_id) ?? <span className="font-mono">{g.owner_id?.slice(0, 8)}</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{memberCount.get(g.id) ?? 0}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{commCount.get(g.id) ?? 0}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{roundCount.get(g.id) ?? 0}</td>
                  <td className="px-3 py-2 text-cream-100/65 text-xs tabular-nums">
                    {new Date(g.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/admin/groups/${g.id}`} className="text-xs text-gold-400 underline">
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
              {(groups?.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-cream-100/55 text-sm">
                    No groups yet.
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
