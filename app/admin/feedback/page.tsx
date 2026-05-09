import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { FeedbackRow } from "./feedback-row";

export const dynamic = "force-dynamic";

const STATUSES = ["new", "reviewing", "planned", "in_progress", "shipped", "declined"] as const;

export default async function AdminFeedback({
  searchParams
}: {
  searchParams: Promise<{ status?: string; kind?: string }>;
}) {
  const sp = await searchParams;
  const sb = supabaseAdmin();

  let query = sb
    .from("feedback")
    .select("id, created_at, kind, body, status, admin_notes, profile_id, email, round_id, group_id, user_agent, app_version")
    .order("created_at", { ascending: false })
    .limit(500);
  if (sp.status && (STATUSES as readonly string[]).includes(sp.status)) {
    query = query.eq("status", sp.status);
  }
  if (sp.kind) query = query.eq("kind", sp.kind);
  const { data: rows } = await query;

  const profileIds = Array.from(
    new Set((rows ?? []).map((r: any) => r.profile_id).filter(Boolean))
  );
  const { data: profiles } = await sb
    .from("profiles")
    .select("id, display_name")
    .in("id", profileIds.length > 0 ? profileIds : ["00000000-0000-0000-0000-000000000000"]);
  const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p.display_name]));

  // Counts per status for filter pills.
  const { data: byStatus } = await sb.from("feedback").select("status");
  const statusCounts: Record<string, number> = {};
  for (const r of (byStatus as any[]) ?? []) {
    statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
  }

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="h-eyebrow text-gold-400">Feedback</p>
          <h1 className="h-display text-3xl text-cream-50 mt-1">
            {(rows?.length ?? 0).toLocaleString()} entries
          </h1>
        </div>
        <nav className="flex gap-1 text-xs flex-wrap">
          <Link href="/admin/feedback" className={`btn-ghost ${!sp.status ? "bg-brand-800/70" : ""}`}>
            All
          </Link>
          {STATUSES.map((s) => (
            <Link
              key={s}
              href={`/admin/feedback?status=${s}`}
              className={`btn-ghost ${sp.status === s ? "bg-brand-800/70" : ""}`}
            >
              {s} ({statusCounts[s] ?? 0})
            </Link>
          ))}
        </nav>
      </header>

      <div className="space-y-3">
        {(rows ?? []).map((r: any) => (
          <FeedbackRow
            key={r.id}
            id={r.id}
            kind={r.kind}
            body={r.body}
            status={r.status}
            admin_notes={r.admin_notes}
            email={r.email}
            display_name={profileMap.get(r.profile_id) ?? null}
            created_at={r.created_at}
            round_id={r.round_id}
            group_id={r.group_id}
            user_agent={r.user_agent}
            app_version={r.app_version}
          />
        ))}
        {(rows?.length ?? 0) === 0 && (
          <div className="card p-6 text-center text-cream-100/55 text-sm">
            No feedback yet. Tell users — there's a /feedback link in the app.
          </div>
        )}
      </div>
    </div>
  );
}
