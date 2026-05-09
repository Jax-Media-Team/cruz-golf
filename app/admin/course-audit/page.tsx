import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Hole = { hole_number: number; par: number; stroke_index: number; yardage: number | null };
type Tee = {
  id: string;
  name: string;
  rating: number | null;
  slope: number | null;
  par: number | null;
  holes: 9 | 18;
  course_id: string;
  course_holes: Hole[];
};
type Issue = { severity: "error" | "warn"; msg: string };

function auditTee(t: Tee): Issue[] {
  const out: Issue[] = [];
  if (!t.rating) out.push({ severity: "error", msg: "Missing course rating" });
  if (!t.slope) out.push({ severity: "error", msg: "Missing slope" });
  if (!t.par) out.push({ severity: "error", msg: "Missing par" });
  if (t.holes !== 9 && t.holes !== 18) out.push({ severity: "error", msg: `Bad hole count: ${t.holes}` });
  const holes = t.course_holes ?? [];
  if (holes.length !== t.holes) {
    out.push({ severity: "error", msg: `Has ${holes.length} hole rows but tee says ${t.holes} holes` });
  }
  // Stroke index validation: 1..N, no dupes, complete
  const expectedRange = Array.from({ length: t.holes }, (_, i) => i + 1);
  const sis = holes.map((h) => h.stroke_index);
  const dupSi = sis.filter((v, i) => sis.indexOf(v) !== i);
  if (dupSi.length > 0) out.push({ severity: "error", msg: `Duplicate stroke index: ${[...new Set(dupSi)].join(", ")}` });
  const missing = expectedRange.filter((n) => !sis.includes(n));
  if (missing.length > 0) out.push({ severity: "error", msg: `Missing stroke index: ${missing.join(", ")}` });
  const oob = sis.filter((n) => n < 1 || n > t.holes);
  if (oob.length > 0) out.push({ severity: "error", msg: `Out-of-range SI: ${oob.join(", ")}` });

  // Par sanity
  const badPar = holes.filter((h) => h.par < 3 || h.par > 6);
  if (badPar.length > 0) out.push({ severity: "warn", msg: `Suspicious par on hole ${badPar.map((h) => h.hole_number).join(", ")}` });
  const totalPar = holes.reduce((s, h) => s + (h.par ?? 0), 0);
  if (t.par && totalPar !== t.par) {
    out.push({ severity: "warn", msg: `Sum of hole pars (${totalPar}) ≠ tee par (${t.par})` });
  }

  const noYards = holes.filter((h) => h.yardage == null).length;
  if (noYards > 0 && noYards < holes.length) {
    out.push({ severity: "warn", msg: `Missing yardage on ${noYards} hole${noYards === 1 ? "" : "s"}` });
  } else if (noYards === holes.length && holes.length > 0) {
    out.push({ severity: "warn", msg: "No yardages set" });
  }

  return out;
}

export default async function CourseAuditPage() {
  const sb = supabaseAdmin();
  const [{ data: courses }, { data: tees }, { data: holes }, { data: groups }] = await Promise.all([
    sb.from("courses").select("id, name, group_id, deleted_at, city, state").is("deleted_at", null).order("name"),
    sb.from("course_tees").select("id, course_id, name, rating, slope, par, holes"),
    sb.from("course_holes").select("tee_id, hole_number, par, stroke_index, yardage"),
    sb.from("groups").select("id, name")
  ]);

  const holesByTee = new Map<string, Hole[]>();
  for (const h of (holes ?? []) as any[]) {
    const arr = holesByTee.get(h.tee_id) ?? [];
    arr.push(h);
    holesByTee.set(h.tee_id, arr);
  }
  const teesByCourse = new Map<string, Tee[]>();
  for (const t of (tees ?? []) as any[]) {
    const tWithHoles: Tee = { ...t, course_holes: holesByTee.get(t.id) ?? [] };
    const arr = teesByCourse.get(t.course_id) ?? [];
    arr.push(tWithHoles);
    teesByCourse.set(t.course_id, arr);
  }
  const groupName = new Map((groups ?? []).map((g: any) => [g.id, g.name]));

  // Audit + sort: most issues first.
  const audited = (courses ?? []).map((c: any) => {
    const cTees = teesByCourse.get(c.id) ?? [];
    const teeIssues = cTees.map((t) => ({ tee: t, issues: auditTee(t) }));
    const errorCount = teeIssues.reduce(
      (s, ti) => s + ti.issues.filter((i) => i.severity === "error").length,
      0
    );
    const warnCount = teeIssues.reduce(
      (s, ti) => s + ti.issues.filter((i) => i.severity === "warn").length,
      0
    );
    return {
      course: c,
      teeIssues,
      errorCount,
      warnCount,
      noTees: cTees.length === 0
    };
  });
  audited.sort((a, b) => {
    if (a.errorCount !== b.errorCount) return b.errorCount - a.errorCount;
    if (a.warnCount !== b.warnCount) return b.warnCount - a.warnCount;
    return a.course.name.localeCompare(b.course.name);
  });

  const totalErrors = audited.reduce((s, a) => s + a.errorCount, 0);
  const totalWarns = audited.reduce((s, a) => s + a.warnCount, 0);

  return (
    <div className="space-y-4">
      <header>
        <p className="h-eyebrow text-gold-400">Course audit</p>
        <h1 className="h-display text-3xl text-cream-50 mt-1">Course data health</h1>
        <p className="text-sm text-cream-100/65 mt-1">
          {audited.length} courses · <span className="text-red-300 tabular-nums">{totalErrors}</span> errors ·{" "}
          <span className="text-amber-300 tabular-nums">{totalWarns}</span> warnings
        </p>
      </header>

      <div className="space-y-3">
        {audited.map(({ course, teeIssues, errorCount, warnCount, noTees }) => {
          const ok = errorCount === 0 && warnCount === 0 && !noTees;
          return (
            <div
              key={course.id}
              className={`card p-4 ${
                ok
                  ? "border border-emerald-400/20"
                  : errorCount > 0
                  ? "border border-red-400/30"
                  : "border border-amber-400/30"
              }`}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-serif text-lg text-cream-50">
                    {course.name}{" "}
                    <span className="text-xs text-cream-100/45">
                      · {[course.city, course.state].filter(Boolean).join(", ") || "no location"}
                    </span>
                  </div>
                  <p className="text-xs text-cream-100/55">
                    {groupName.get(course.group_id) ?? "(no group)"}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {ok && (
                    <span className="pill bg-emerald-500/15 text-emerald-300 px-2 py-0.5 ring-1 ring-emerald-400/30">
                      Complete
                    </span>
                  )}
                  {errorCount > 0 && (
                    <span className="pill bg-red-500/15 text-red-300 px-2 py-0.5 ring-1 ring-red-400/30">
                      {errorCount} error{errorCount === 1 ? "" : "s"}
                    </span>
                  )}
                  {warnCount > 0 && (
                    <span className="pill bg-amber-500/15 text-amber-300 px-2 py-0.5 ring-1 ring-amber-400/30">
                      {warnCount} warn
                    </span>
                  )}
                  <Link href={`/courses/${course.id}`} className="text-gold-400 underline">
                    Fix →
                  </Link>
                </div>
              </div>

              {noTees && (
                <p className="text-sm text-red-300 mt-2">No tees on file. Round creation will fail.</p>
              )}

              {teeIssues.length > 0 && (
                <ul className="mt-3 space-y-1.5 text-sm">
                  {teeIssues.map(({ tee, issues }) => (
                    <li key={tee.id} className="flex items-start gap-3">
                      <span className="font-medium text-cream-50 w-20 shrink-0 text-xs uppercase tracking-wider">
                        {tee.name}
                      </span>
                      {issues.length === 0 ? (
                        <span className="text-emerald-300 text-xs">complete</span>
                      ) : (
                        <ul className="space-y-0.5 text-xs">
                          {issues.map((i, j) => (
                            <li
                              key={j}
                              className={i.severity === "error" ? "text-red-300" : "text-amber-300"}
                            >
                              {i.severity === "error" ? "❌" : "⚠"} {i.msg}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
