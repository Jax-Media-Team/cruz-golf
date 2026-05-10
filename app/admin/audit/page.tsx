import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/format-date";

export const dynamic = "force-dynamic";

/**
 * Append-only destructive-op audit trail.
 *
 * Reads from `destructive_audit_log` (migration 0027) — every archive,
 * restore, delete, finalize, unfinalize, mark-pending, resume, verify,
 * and template-flag op the platform has seen. Defensive against the
 * table not existing (pre-0027 envs).
 *
 * Filter by:
 *   - kind (round.archive / course.verify / etc.) via ?kind=
 *   - target table (rounds / courses) via ?table=
 */
export default async function AdminAuditPage({
  searchParams
}: {
  searchParams: Promise<{ kind?: string; table?: string }>;
}) {
  const sp = await searchParams;
  const kindFilter = sp.kind?.trim() || null;
  const tableFilter = sp.table?.trim() || null;
  const sb = supabaseAdmin();

  type AuditRow = {
    id: string;
    occurred_at: string;
    actor_profile_id: string | null;
    kind: string;
    target_id: string;
    target_table: string;
    group_id: string | null;
    detail: any;
  };

  let rows: AuditRow[] = [];
  let migrationApplied = true;
  try {
    let q = sb
      .from("destructive_audit_log")
      .select(
        "id, occurred_at, actor_profile_id, kind, target_id, target_table, group_id, detail"
      )
      .order("occurred_at", { ascending: false })
      .limit(200);
    if (kindFilter) q = q.eq("kind", kindFilter);
    if (tableFilter) q = q.eq("target_table", tableFilter);
    const { data, error } = await q;
    if (error) {
      // Table missing → migration 0027 not applied yet.
      migrationApplied = false;
    } else if (data) {
      rows = data as any;
    }
  } catch {
    migrationApplied = false;
  }

  // Resolve actor names — best-effort, batched lookup across all
  // distinct profile IDs so we render readable rows instead of UUIDs.
  const actorIds = [
    ...new Set(rows.map((r) => r.actor_profile_id).filter((x): x is string => !!x))
  ];
  const actorNames = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profiles } = await sb
      .from("profiles")
      .select("id, display_name")
      .in("id", actorIds);
    for (const p of (profiles as any[]) ?? []) {
      actorNames.set(p.id, p.display_name ?? p.id.slice(0, 8));
    }
  }

  // Bucket the distinct kinds + tables seen so we can render filter chips.
  const kindCounts = new Map<string, number>();
  const tableCounts = new Map<string, number>();
  for (const r of rows) {
    kindCounts.set(r.kind, (kindCounts.get(r.kind) ?? 0) + 1);
    tableCounts.set(r.target_table, (tableCounts.get(r.target_table) ?? 0) + 1);
  }

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="h-eyebrow text-gold-400">Trust + recoverability</p>
          <h1 className="h-display text-3xl text-cream-50 mt-1">Audit log</h1>
          <p className="text-sm text-cream-100/65 mt-1">
            Append-only history of every destructive op.{" "}
            {kindFilter || tableFilter
              ? "Filtered."
              : "Most recent 200 events."}
          </p>
        </div>
      </header>

      {!migrationApplied && (
        <div className="card p-5 border border-amber-400/30 bg-amber-500/5">
          <p className="font-serif text-lg text-cream-50">
            Migration 0027 not yet applied
          </p>
          <p className="text-xs text-cream-100/65 mt-1">
            The <code>destructive_audit_log</code> table doesn&apos;t exist
            yet. Apply <code>0027_destructive_audit_log.sql</code> in your
            Supabase SQL editor and this page populates automatically from
            the next lifecycle op.
          </p>
        </div>
      )}

      {migrationApplied && rows.length === 0 && (
        <div className="card p-8 text-center text-cream-100/65 text-sm">
          No audit events yet. Every archive / restore / verify / finalize
          / pending-transition writes a row here automatically.
        </div>
      )}

      {(kindFilter || tableFilter) && (
        <div className="flex items-center gap-2 text-xs">
          {kindFilter && (
            <span className="pill bg-gold-500/15 text-gold-400 ring-1 ring-gold-500/30 px-3 py-1">
              kind = {kindFilter}
            </span>
          )}
          {tableFilter && (
            <span className="pill bg-gold-500/15 text-gold-400 ring-1 ring-gold-500/30 px-3 py-1">
              table = {tableFilter}
            </span>
          )}
          <Link href="/admin/audit" className="btn-ghost text-xs">
            Clear filters
          </Link>
        </div>
      )}

      {rows.length > 0 && (
        <>
          {/* Filter chips — every distinct kind + table in the current
              result set, with counts. Click to filter. */}
          {!kindFilter && !tableFilter && (
            <section className="space-y-2">
              <p className="h-eyebrow text-cream-100/55">Filter by kind</p>
              <div className="flex flex-wrap gap-2">
                {[...kindCounts.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([kind, count]) => (
                    <Link
                      key={kind}
                      href={`/admin/audit?kind=${encodeURIComponent(kind)}`}
                      className="pill bg-cream-100/8 text-cream-100/85 ring-1 ring-cream-100/15 hover:bg-cream-100/15 px-3 py-1 text-xs inline-flex items-center gap-1.5"
                    >
                      <span className="font-mono">{kind}</span>
                      <span className="text-cream-100/55 tabular-nums">{count}</span>
                    </Link>
                  ))}
              </div>
            </section>
          )}

          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-brand-950/50 text-[10px] uppercase tracking-wider text-cream-100/55">
                  <tr>
                    <th className="px-3 py-2 text-left">When</th>
                    <th className="px-3 py-2 text-left">Actor</th>
                    <th className="px-3 py-2 text-left">Kind</th>
                    <th className="px-3 py-2 text-left">Target</th>
                    <th className="px-3 py-2 text-left">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const actor = r.actor_profile_id
                      ? actorNames.get(r.actor_profile_id) ?? r.actor_profile_id.slice(0, 8)
                      : "—";
                    const detailKeys = r.detail ? Object.keys(r.detail) : [];
                    const detailSummary =
                      detailKeys.length > 0
                        ? detailKeys
                            .map((k) => `${k}=${formatDetailValue(r.detail[k])}`)
                            .join(" · ")
                        : "—";
                    const targetHref =
                      r.target_table === "rounds"
                        ? `/admin/rounds/${r.target_id}`
                        : r.target_table === "courses"
                        ? `/admin/course-audit?course=${r.target_id}`
                        : null;
                    return (
                      <tr
                        key={r.id}
                        className="border-t border-cream-100/8 hover:bg-brand-900/30"
                      >
                        <td className="px-3 py-2 text-cream-100/85 tabular-nums whitespace-nowrap text-xs">
                          {formatDateTime(r.occurred_at)}
                        </td>
                        <td className="px-3 py-2 text-cream-50 truncate max-w-[10rem]">
                          {actor}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-cream-50">
                          {r.kind}
                        </td>
                        <td className="px-3 py-2 text-cream-100/85 font-mono text-xs">
                          {targetHref ? (
                            <Link
                              href={targetHref}
                              className="hover:underline"
                              title={r.target_id}
                            >
                              {r.target_table}/{r.target_id.slice(0, 8)}
                            </Link>
                          ) : (
                            <span title={r.target_id}>
                              {r.target_table}/{r.target_id.slice(0, 8)}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-cream-100/65 text-xs">
                          {detailSummary}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function formatDetailValue(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}
