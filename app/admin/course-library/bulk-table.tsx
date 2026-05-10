"use client";
import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { CourseLibraryActions } from "./course-library-actions";

export type CourseRow = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  verification_status: string;
  is_template: boolean;
  tee_count: number;
  hole_count: number;
  round_count: number;
};

type Status = "verified" | "community" | "needs_review" | "placeholder";

/**
 * Selectable course-library table with bulk actions.
 *
 * One instance per bucket (verified / needs_review / community /
 * placeholder). Tracks selection state internally; when ≥ 1 row is
 * selected, a sticky inline action bar appears above the table with:
 *
 *   - Verify selected (gated on every selected row having tee data)
 *   - Flag selected
 *   - Demote to community / placeholder
 *   - Untemplate selected
 *   - Clear selection
 *
 * Each action issues parallel RPC calls (fn_set_course_verification or
 * fn_set_course_template) and refreshes after all settle. Errors per
 * row surface in a small inline list at the bottom of the bar.
 */
export function BulkCourseTable({
  label,
  rows,
  tone
}: {
  label: string;
  rows: CourseRow[];
  tone: "gold" | "amber" | "cream" | "muted";
}) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Array<{ id: string; name: string; msg: string }>>([]);

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const someSelected = selected.size > 0;
  const eyebrow =
    tone === "gold"
      ? "text-gold-400"
      : tone === "amber"
      ? "text-amber-300"
      : tone === "cream"
      ? "text-cream-100/85"
      : "text-cream-100/55";

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.id)),
    [rows, selected]
  );
  const allHaveData = selectedRows.every((r) => r.tee_count > 0 && r.hole_count > 0);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((s) => {
      if (s.size === rows.length) return new Set();
      return new Set(rows.map((r) => r.id));
    });
  }

  function clear() {
    setSelected(new Set());
    setErrors([]);
  }

  async function bulkSetStatus(next: Status) {
    if (selected.size === 0) return;
    if (next === "verified" && !allHaveData) {
      setErrors([
        {
          id: "_gate",
          name: "Verify gate",
          msg: "One or more selected courses have no tees/holes — can't promote to verified."
        }
      ]);
      return;
    }
    if (
      !confirm(
        `Set ${selected.size} course${selected.size === 1 ? "" : "s"} to "${next}"?`
      )
    )
      return;
    setBusy(true);
    setErrors([]);
    const results = await Promise.allSettled(
      selectedRows.map((r) =>
        sb
          .rpc("fn_set_course_verification", {
            p_course_id: r.id,
            p_status: next
          })
          .then((res) => ({ row: r, error: res.error }))
      )
    );
    const errs: typeof errors = [];
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.error) {
        errs.push({
          id: r.value.row.id,
          name: r.value.row.name,
          msg: r.value.error.message
        });
      } else if (r.status === "rejected") {
        errs.push({ id: "_unknown", name: "?", msg: String(r.reason) });
      }
    }
    setBusy(false);
    setErrors(errs);
    if (errs.length === 0) clear();
    router.refresh();
  }

  async function bulkUntemplate() {
    if (selected.size === 0) return;
    if (
      !confirm(
        `Remove ${selected.size} course${
          selected.size === 1 ? "" : "s"
        } from the public library? They'll stop appearing for users outside their source group. History preserved.`
      )
    )
      return;
    setBusy(true);
    setErrors([]);
    const results = await Promise.allSettled(
      selectedRows.map((r) =>
        sb
          .rpc("fn_set_course_template", {
            p_course_id: r.id,
            p_is_template: false
          })
          .then((res) => ({ row: r, error: res.error }))
      )
    );
    const errs: typeof errors = [];
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.error) {
        errs.push({
          id: r.value.row.id,
          name: r.value.row.name,
          msg: r.value.error.message
        });
      }
    }
    setBusy(false);
    setErrors(errs);
    if (errs.length === 0) clear();
    router.refresh();
  }

  if (rows.length === 0) return null;

  return (
    <section className="space-y-2">
      <p className={`h-eyebrow ${eyebrow}`}>
        {label} ({rows.length})
      </p>

      {/* Bulk action bar — only visible when something's selected. */}
      {someSelected && (
        <div className="card p-3 border border-gold-500/30 bg-gold-500/5 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-cream-50">
            <span className="font-medium">{selected.size}</span> selected
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <button
              type="button"
              disabled={busy || !allHaveData}
              onClick={() => bulkSetStatus("verified")}
              className="btn-ghost text-xs disabled:opacity-40"
              title={
                allHaveData
                  ? "Promote selected to verified"
                  : "Some selected courses have no tees/holes"
              }
            >
              ✓ Verify
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => bulkSetStatus("needs_review")}
              className="btn-ghost text-xs"
            >
              Flag
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => bulkSetStatus("community")}
              className="btn-ghost text-xs"
            >
              Community
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => bulkSetStatus("placeholder")}
              className="btn-ghost text-xs"
            >
              Placeholder
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={bulkUntemplate}
              className="btn-ghost text-xs text-red-300"
            >
              Untemplate
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={clear}
              className="btn-ghost text-xs"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div className="card p-3 border border-red-400/40 bg-red-500/10 text-xs text-red-200 space-y-1">
          {errors.map((e, i) => (
            <div key={i}>
              {e.name}: {e.msg}
            </div>
          ))}
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-brand-950/50 text-[10px] uppercase tracking-wider text-cream-100/55">
              <tr>
                <th className="px-3 py-2 text-left w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-3 py-2 text-left">Course</th>
                <th className="px-3 py-2 text-left">Location</th>
                <th className="px-3 py-2 text-right">Tees</th>
                <th className="px-3 py-2 text-right">Holes</th>
                <th className="px-3 py-2 text-right">Rounds</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-cream-100/8 hover:bg-brand-900/30"
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      aria-label={`Select ${r.name}`}
                    />
                  </td>
                  <td className="px-3 py-2 text-cream-50">
                    <Link
                      href={`/admin/course-audit?course=${r.id}`}
                      className="hover:underline"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-cream-100/85">
                    {[r.city, r.state].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.tee_count}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.hole_count}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.round_count}</td>
                  <td className="px-3 py-2 text-cream-100/85 capitalize">
                    {r.verification_status.replace(/_/g, " ")}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <CourseLibraryActions
                      courseId={r.id}
                      currentStatus={r.verification_status}
                      isTemplate={r.is_template}
                      hasData={r.tee_count > 0 && r.hole_count > 0}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
