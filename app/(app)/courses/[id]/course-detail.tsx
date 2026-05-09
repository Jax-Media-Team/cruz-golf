"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";

type Hole = { hole_number: number; par: number; stroke_index: number; yardage: number | null };
type Tee = {
  id: string;
  name: string;
  gender: "men" | "women" | "mixed" | null;
  rating: number;
  slope: number;
  par: number;
  holes: 9 | 18;
  course_holes: Hole[];
};

const TEE_PRESETS: Array<{ name: string; gender: "men" | "women" | "mixed"; rating: number; slope: number; tone: string }> = [
  { name: "Black",   gender: "men",   rating: 73.5, slope: 138, tone: "bg-black/70 text-cream-50" },
  { name: "Blue",    gender: "men",   rating: 71.2, slope: 132, tone: "bg-blue-700 text-cream-50" },
  { name: "White",   gender: "men",   rating: 69.5, slope: 126, tone: "bg-white text-brand-900" },
  { name: "Gold",    gender: "men",   rating: 67.8, slope: 121, tone: "bg-gold-500 text-brand-900" },
  { name: "Red",     gender: "women", rating: 71.6, slope: 124, tone: "bg-red-600 text-cream-50" }
];

export function CourseDetail({ courseId, tees: initialTees }: { courseId: string; tees: Tee[] }) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [tees, setTees] = useState<Tee[]>(initialTees);
  const [expandedTee, setExpandedTee] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Tee currently in the Quick Import modal.
  const [importTee, setImportTee] = useState<Tee | null>(null);

  // Update a tee's metadata (name/rating/slope/par/gender). Optimistic.
  async function updateTee(teeId: string, patch: Partial<Tee>) {
    setTees((prev) => prev.map((t) => (t.id === teeId ? { ...t, ...patch } : t)));
    const { error } = await sb.from("course_tees").update(patch).eq("id", teeId);
    if (error) setErr(friendlyAuthError(error));
  }

  /**
   * Bulk-import a tee's hole data by pasting rows from the scorecard.
   * Accepts par row (required), SI row (required), and yardage row (optional)
   * — each as 18 numbers separated by anything non-digit. Validates SI is
   * a permutation of 1..18 before saving.
   */
  async function importTeeRows(
    teeId: string,
    rows: { pars: number[]; sis: number[]; yardages: (number | null)[] }
  ) {
    const updates = rows.pars.map((par, i) => ({
      tee_id: teeId,
      hole_number: i + 1,
      par,
      stroke_index: rows.sis[i],
      yardage: rows.yardages[i] ?? null
    }));
    setBusy(true);
    setErr(null);
    // Use upsert in case some hole rows are missing.
    const { error } = await sb
      .from("course_holes")
      .upsert(updates, { onConflict: "tee_id,hole_number" });
    setBusy(false);
    if (error) {
      setErr(friendlyAuthError(error));
      return;
    }
    setTees((prev) =>
      prev.map((t) =>
        t.id === teeId
          ? {
              ...t,
              course_holes: updates.map((u) => ({
                hole_number: u.hole_number,
                par: u.par,
                stroke_index: u.stroke_index,
                yardage: u.yardage
              }))
            }
          : t
      )
    );
    setImportTee(null);
    router.refresh();
  }

  // Update a single hole (par/stroke_index/yardage) for a tee. Optimistic
  // local update + persisted via course_holes upsert. Stroke index is what
  // the user really cares about — typos here corrupt every net score.
  async function updateHole(teeId: string, holeNumber: number, patch: Partial<Hole>) {
    setTees((prev) =>
      prev.map((t) =>
        t.id === teeId
          ? {
              ...t,
              course_holes: t.course_holes.map((h) =>
                h.hole_number === holeNumber ? { ...h, ...patch } : h
              )
            }
          : t
      )
    );
    const { error } = await sb
      .from("course_holes")
      .update(patch)
      .eq("tee_id", teeId)
      .eq("hole_number", holeNumber);
    if (error) setErr(friendlyAuthError(error));
  }

  // Apply the same per-hole par+SI+yardage values to ALL tees on this course.
  // Most courses share par + stroke index across tees (only yardage differs);
  // when a commissioner fixes a typo on one tee they typically want it
  // mirrored. Yardages are NOT mirrored.
  async function copyParSiToAllTees(sourceTeeId: string) {
    const source = tees.find((t) => t.id === sourceTeeId);
    if (!source) return;
    if (!confirm(`Copy par + stroke index from ${source.name} to every other tee on this course? Yardages are not affected.`)) return;
    setBusy(true);
    setErr(null);
    for (const t of tees) {
      if (t.id === sourceTeeId) continue;
      for (const h of source.course_holes) {
        const { error } = await sb
          .from("course_holes")
          .update({ par: h.par, stroke_index: h.stroke_index })
          .eq("tee_id", t.id)
          .eq("hole_number", h.hole_number);
        if (error) {
          setErr(friendlyAuthError(error));
          setBusy(false);
          return;
        }
      }
    }
    setBusy(false);
    router.refresh();
  }

  // Use the most-recently-added tee's holes as the template for a new tee
  // (par + stroke_index are typically shared across tees on the same course;
  // the user can adjust if their course differs).
  const template = tees[0];

  async function addTee(preset: { name: string; gender: "men" | "women" | "mixed"; rating: number; slope: number }) {
    setErr(null);
    setBusy(true);
    const par = template?.par ?? 72;
    const holes: 9 | 18 = (template?.holes ?? 18) as 9 | 18;

    const { data: t, error: te } = await sb
      .from("course_tees")
      .insert({
        course_id: courseId,
        name: preset.name,
        gender: preset.gender,
        rating: preset.rating,
        slope: preset.slope,
        par,
        holes
      })
      .select("id, name, gender, rating, slope, par, holes")
      .single();
    if (te || !t) {
      setBusy(false);
      setErr(friendlyAuthError(te ?? "Could not add tee"));
      return;
    }

    // Mirror par + stroke_index from the template tee. Yardages start null;
    // user can edit later. If no template exists, fall back to a typical layout.
    const baseHoles: Hole[] =
      template?.course_holes && template.course_holes.length === holes
        ? template.course_holes
        : Array.from({ length: holes }, (_, i) => ({
            hole_number: i + 1,
            par: 4,
            stroke_index: ((i + 1) % holes) + 1,
            yardage: null
          }));

    const rows = baseHoles.map((h) => ({
      tee_id: t.id,
      hole_number: h.hole_number,
      par: h.par,
      stroke_index: h.stroke_index,
      yardage: null as number | null
    }));
    const { error: he } = await sb.from("course_holes").insert(rows);
    if (he) {
      setBusy(false);
      setErr(friendlyAuthError(he));
      return;
    }
    setTees((prev) => [...prev, { ...t, course_holes: rows.map((r) => ({ ...r, yardage: null })) } as Tee]);
    setBusy(false);
    router.refresh();
  }

  async function deleteTee(teeId: string) {
    if (!confirm("Delete this tee box? Existing rounds that used it will keep their data, but new rounds won't be able to pick it.")) return;
    setBusy(true);
    setErr(null);
    const { error } = await sb.from("course_tees").delete().eq("id", teeId);
    setBusy(false);
    if (error) {
      setErr(friendlyAuthError(error));
      return;
    }
    setTees((prev) => prev.filter((t) => t.id !== teeId));
    router.refresh();
  }

  const presetsNotYetAdded = TEE_PRESETS.filter((p) => !tees.some((t) => t.name.toLowerCase() === p.name.toLowerCase()));

  async function clone() {
    setBusy(true);
    setErr(null);
    const { data, error } = await sb.rpc("fn_clone_course", { p_source_course_id: courseId });
    setBusy(false);
    if (error) {
      setErr(friendlyAuthError(error));
      return;
    }
    if (data) router.push(`/courses/${data}`);
  }

  return (
    <>
      <section className="card p-4 space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="font-serif text-xl text-cream-50">Tee boxes</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-cream-100/55">{tees.length} on file</span>
            <button
              type="button"
              onClick={() => {
                if (!confirm("Clone this course (with every tee + hole) into your group?")) return;
                clone();
              }}
              disabled={busy}
              className="btn-secondary text-xs"
            >
              Clone
            </button>
          </div>
        </div>

        {tees.length === 0 ? (
          <p className="text-sm text-cream-100/65">No tees yet — add one below.</p>
        ) : (
          <ul className="space-y-2">
            {tees.map((t) => {
              const expanded = expandedTee === t.id;
              return (
                <li key={t.id} className="surface rounded-xl">
                  {/* Compact summary row */}
                  <div className="px-4 py-3 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setExpandedTee(expanded ? null : t.id)}
                      className="flex-1 min-w-0 text-left"
                      aria-expanded={expanded}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`inline-block w-2.5 h-2.5 rounded-full ${swatchColor(t.name)}`} aria-hidden />
                        <span className="font-medium text-cream-50">{t.name}</span>
                        {t.gender && (
                          <span className="text-[10px] uppercase tracking-wide text-cream-100/45">{t.gender}</span>
                        )}
                        <span className="text-cream-100/40 text-xs ml-auto">{expanded ? "▾" : "▸"}</span>
                      </div>
                      <div className="text-xs text-cream-100/55 mt-0.5 tabular-nums">
                        Rating {t.rating} · Slope {t.slope} · Par {t.par} · {t.course_holes.length} holes
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteTee(t.id)}
                      disabled={busy}
                      className="text-xs text-red-300 hover:text-red-200 shrink-0"
                    >
                      Remove
                    </button>
                  </div>

                  {expanded && (
                    <div className="border-t border-cream-100/8 p-4 space-y-4">
                      {/* Tee metadata (name, rating, slope, gender) */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div>
                          <label className="label text-xs">Name</label>
                          <input
                            className="input text-sm"
                            defaultValue={t.name}
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              if (v && v !== t.name) updateTee(t.id, { name: v });
                            }}
                          />
                        </div>
                        <div>
                          <label className="label text-xs">Rating</label>
                          <input
                            className="input text-sm"
                            type="number"
                            step="0.1"
                            defaultValue={t.rating}
                            onBlur={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!isNaN(v) && v !== t.rating) updateTee(t.id, { rating: v });
                            }}
                          />
                        </div>
                        <div>
                          <label className="label text-xs">Slope</label>
                          <input
                            className="input text-sm"
                            type="number"
                            defaultValue={t.slope}
                            onBlur={(e) => {
                              const v = parseInt(e.target.value);
                              if (!isNaN(v) && v !== t.slope) updateTee(t.id, { slope: v });
                            }}
                          />
                        </div>
                        <div>
                          <label className="label text-xs">Gender</label>
                          <select
                            className="input text-sm"
                            defaultValue={t.gender ?? "men"}
                            onChange={(e) => updateTee(t.id, { gender: e.target.value as any })}
                          >
                            <option value="men">Men</option>
                            <option value="women">Women</option>
                            <option value="mixed">Mixed</option>
                          </select>
                        </div>
                      </div>

                      {/* Hole-by-hole editor — par + stroke index + yardage */}
                      <HoleGrid
                        holes={t.course_holes}
                        onUpdate={(hn, patch) => updateHole(t.id, hn, patch)}
                      />

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setImportTee(t)}
                          disabled={busy}
                          className="btn-secondary text-xs"
                        >
                          📋 Quick import (paste from scorecard)
                        </button>
                        {tees.length > 1 && (
                          <button
                            type="button"
                            onClick={() => copyParSiToAllTees(t.id)}
                            disabled={busy}
                            className="btn-secondary text-xs"
                          >
                            Copy par + SI to every other tee
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {importTee && (
        <QuickImportModal
          tee={importTee}
          onCancel={() => setImportTee(null)}
          onImport={(rows) => importTeeRows(importTee.id, rows)}
          busy={busy}
        />
      )}

      <section className="card p-4 space-y-3">
        <div>
          <h2 className="font-serif text-xl text-cream-50">Add another tee</h2>
          <p className="text-xs text-cream-100/55 mt-0.5">
            Quick-add a typical tee (we&apos;ll mirror par and stroke index from your existing tee), or build a custom one below.
          </p>
        </div>
        {presetsNotYetAdded.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {presetsNotYetAdded.map((p) => (
              <button
                key={p.name}
                type="button"
                disabled={busy}
                onClick={() => addTee(p)}
                className={`rounded-xl px-3 py-2 text-sm font-medium transition-transform active:scale-95 ${p.tone} ${busy ? "opacity-60" : ""}`}
              >
                + {p.name}
                <div className="text-[10px] opacity-80 mt-0.5">
                  {p.rating} / {p.slope}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-cream-100/55">All standard tees added. Use the custom form below for anything else.</p>
        )}

        <CustomTeeForm onAdd={addTee} busy={busy} />
        {err && <p className="text-sm text-red-300">{err}</p>}
      </section>
    </>
  );
}

function CustomTeeForm({
  onAdd,
  busy
}: {
  onAdd: (p: { name: string; gender: "men" | "women" | "mixed"; rating: number; slope: number }) => void;
  busy: boolean;
}) {
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"men" | "women" | "mixed">("men");
  const [rating, setRating] = useState("70.0");
  const [slope, setSlope] = useState("125");

  return (
    <div className="border-t border-cream-100/8 pt-4 grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
      <div className="sm:col-span-2">
        <label className="label text-xs">Custom name</label>
        <input
          className="input text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tournament, Senior, etc."
        />
      </div>
      <div>
        <label className="label text-xs">Gender</label>
        <select className="input text-sm" value={gender} onChange={(e) => setGender(e.target.value as any)}>
          <option value="men">Men</option>
          <option value="women">Women</option>
          <option value="mixed">Mixed</option>
        </select>
      </div>
      <div>
        <label className="label text-xs">Rating</label>
        <input className="input text-sm" type="number" step="0.1" value={rating} onChange={(e) => setRating(e.target.value)} />
      </div>
      <div>
        <label className="label text-xs">Slope</label>
        <input className="input text-sm" type="number" value={slope} onChange={(e) => setSlope(e.target.value)} />
      </div>
      <button
        type="button"
        className="btn-secondary text-sm sm:col-span-5"
        disabled={busy || !name.trim()}
        onClick={() =>
          onAdd({
            name: name.trim(),
            gender,
            rating: parseFloat(rating) || 70,
            slope: parseInt(slope) || 125
          })
        }
      >
        Add custom tee
      </button>
    </div>
  );
}

/**
 * Compact 9- or 18-hole editing grid. Front + back nine separated for readability.
 * Each cell auto-saves on blur (uncontrolled + defaultValue keeps typing smooth
 * without re-render thrash).
 *
 * Stroke index: a duplicate-SI warning under the grid catches the most common
 * data-entry typo (two holes claiming SI 7).
 */
function HoleGrid({
  holes,
  onUpdate
}: {
  holes: Hole[];
  onUpdate: (holeNumber: number, patch: Partial<Hole>) => void;
}) {
  const sorted = [...holes].sort((a, b) => a.hole_number - b.hole_number);
  const front = sorted.slice(0, 9);
  const back = sorted.slice(9, 18);

  // Validation: every SI 1..N should appear exactly once.
  const siCounts = new Map<number, number>();
  for (const h of sorted) siCounts.set(h.stroke_index, (siCounts.get(h.stroke_index) ?? 0) + 1);
  const dupSi = [...siCounts.entries()].filter(([, n]) => n > 1).map(([si]) => si);
  const expectedSiRange = [...Array(sorted.length)].map((_, i) => i + 1);
  const missingSi = expectedSiRange.filter((n) => !siCounts.has(n));

  return (
    <div className="space-y-3">
      <NineGrid label="Front" holes={front} onUpdate={onUpdate} />
      {back.length > 0 && <NineGrid label="Back" holes={back} onUpdate={onUpdate} />}

      {(dupSi.length > 0 || missingSi.length > 0) && (
        <div className="text-[11px] text-amber-300/85 bg-amber-500/10 border border-amber-400/30 rounded-lg px-3 py-2">
          {dupSi.length > 0 && (
            <div>
              ⚠ Stroke index {dupSi.join(", ")} appears more than once. Each SI from 1 to {sorted.length} should appear exactly once.
            </div>
          )}
          {missingSi.length > 0 && <div>⚠ Missing stroke index: {missingSi.join(", ")}.</div>}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 text-[11px] text-cream-100/55">
        <div>Total par: <span className="text-cream-50 tabular-nums">{sorted.reduce((s, h) => s + h.par, 0)}</span></div>
        <div>Yardage: <span className="text-cream-50 tabular-nums">{sorted.reduce((s, h) => s + (h.yardage ?? 0), 0) || "—"}</span></div>
        <div>{sorted.length} holes</div>
      </div>
    </div>
  );
}

function NineGrid({
  label,
  holes,
  onUpdate
}: {
  label: string;
  holes: Hole[];
  onUpdate: (holeNumber: number, patch: Partial<Hole>) => void;
}) {
  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <div className="text-[10px] uppercase tracking-[0.22em] text-cream-100/45 mb-1">{label}</div>
      <table className="text-xs tabular-nums w-full border-separate border-spacing-0">
        <thead>
          <tr className="text-cream-100/55">
            <th className="text-left pr-2 py-1 font-medium">Hole</th>
            {holes.map((h) => (
              <th key={h.hole_number} className="px-1 py-1 text-center font-medium min-w-[44px]">
                {h.hole_number}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="pr-2 py-1 text-cream-100/55">Par</td>
            {holes.map((h) => (
              <td key={h.hole_number} className="px-0.5 py-0.5">
                <input
                  className="input text-xs text-center px-1 py-1 w-full"
                  type="number"
                  min={3}
                  max={6}
                  defaultValue={h.par}
                  onBlur={(e) => {
                    const v = parseInt(e.target.value);
                    if (!isNaN(v) && v !== h.par) onUpdate(h.hole_number, { par: v });
                  }}
                />
              </td>
            ))}
          </tr>
          <tr>
            <td className="pr-2 py-1 text-cream-100/55">SI</td>
            {holes.map((h) => (
              <td key={h.hole_number} className="px-0.5 py-0.5">
                <input
                  className="input text-xs text-center px-1 py-1 w-full"
                  type="number"
                  min={1}
                  max={18}
                  defaultValue={h.stroke_index}
                  onBlur={(e) => {
                    const v = parseInt(e.target.value);
                    if (!isNaN(v) && v !== h.stroke_index) onUpdate(h.hole_number, { stroke_index: v });
                  }}
                />
              </td>
            ))}
          </tr>
          <tr>
            <td className="pr-2 py-1 text-cream-100/55">Yds</td>
            {holes.map((h) => (
              <td key={h.hole_number} className="px-0.5 py-0.5">
                <input
                  className="input text-xs text-center px-1 py-1 w-full"
                  type="number"
                  min={50}
                  defaultValue={h.yardage ?? ""}
                  onBlur={(e) => {
                    const raw = e.target.value;
                    const v = raw === "" ? null : parseInt(raw);
                    if (v == null) onUpdate(h.hole_number, { yardage: null });
                    else if (!isNaN(v) && v !== h.yardage) onUpdate(h.hole_number, { yardage: v });
                  }}
                />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * Modal: paste 18 numbers per row from a paper scorecard.
 *
 * Accepts any non-digit separator (comma, space, tab, newline).
 * Validates SI is a permutation of 1..N before letting the user import.
 */
function QuickImportModal({
  tee,
  onCancel,
  onImport,
  busy
}: {
  tee: { id: string; name: string; holes: number; course_holes: Array<{ hole_number: number; par: number; stroke_index: number; yardage: number | null }> };
  onCancel: () => void;
  onImport: (rows: { pars: number[]; sis: number[]; yardages: (number | null)[] }) => void;
  busy: boolean;
}) {
  const N = tee.holes;
  const sortedExisting = [...tee.course_holes].sort((a, b) => a.hole_number - b.hole_number);
  const [parInput, setParInput] = useState(sortedExisting.map((h) => h.par).join(" "));
  const [siInput, setSiInput] = useState(sortedExisting.map((h) => h.stroke_index).join(" "));
  const [yardageInput, setYardageInput] = useState(
    sortedExisting.map((h) => h.yardage ?? "").join(" ")
  );

  function parseRow(raw: string): number[] {
    return raw
      .split(/[^0-9.\-]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => parseInt(s, 10))
      .filter((n) => !Number.isNaN(n));
  }

  const pars = parseRow(parInput);
  const sis = parseRow(siInput);
  const yardages = parseRow(yardageInput);

  const errors: string[] = [];
  if (pars.length !== N) errors.push(`Need ${N} par values, got ${pars.length}.`);
  if (sis.length !== N) errors.push(`Need ${N} stroke index values, got ${sis.length}.`);
  if (pars.some((p) => p < 3 || p > 6)) errors.push("Par values should be 3, 4, 5, or 6.");
  if (sis.length === N) {
    const expectedSi = Array.from({ length: N }, (_, i) => i + 1);
    const missing = expectedSi.filter((n) => !sis.includes(n));
    const dup = sis.filter((v, i) => sis.indexOf(v) !== i);
    if (missing.length > 0) errors.push(`SI missing: ${missing.join(", ")}`);
    if (dup.length > 0) errors.push(`SI duplicated: ${[...new Set(dup)].join(", ")}`);
  }
  if (yardages.length > 0 && yardages.length !== N) {
    errors.push(`Yardage row must have ${N} numbers (or be blank).`);
  }

  function submit() {
    if (errors.length > 0) return;
    const yardageList: (number | null)[] =
      yardages.length === N ? yardages : new Array(N).fill(null);
    onImport({ pars, sis, yardages: yardageList });
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-brand-950/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onCancel}
    >
      <div
        className="card w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-4 border-b border-cream-100/10 flex items-baseline justify-between gap-3">
          <div>
            <p className="h-eyebrow text-gold-400">Quick import</p>
            <h2 className="font-serif text-xl text-cream-50 mt-0.5">{tee.name} tee · {N} holes</h2>
          </div>
          <button onClick={onCancel} className="btn-ghost text-sm">✕</button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <p className="text-xs text-cream-100/65 leading-relaxed">
            Paste a row from the scorecard for each line. Numbers can be
            separated by spaces, commas, tabs, or newlines — we figure it out.
            Yardage is optional.
          </p>

          <div className="space-y-2">
            <div>
              <label className="label">Par row (18 numbers)</label>
              <textarea
                value={parInput}
                onChange={(e) => setParInput(e.target.value)}
                className="input min-h-[60px] font-mono text-sm"
                placeholder="4 4 5 3 4 4 3 4 5 4 4 5 4 3 4 4 3 5"
              />
              <p className="text-[10px] text-cream-100/45 mt-0.5">
                Detected: {pars.length} {pars.length === N ? "✓" : `(need ${N})`}
              </p>
            </div>
            <div>
              <label className="label">Stroke Index / Handicap row (18 unique 1-{N})</label>
              <textarea
                value={siInput}
                onChange={(e) => setSiInput(e.target.value)}
                className="input min-h-[60px] font-mono text-sm"
                placeholder="7 11 3 13 5 15 9 17 1 8 12 4 14 6 16 10 18 2"
              />
              <p className="text-[10px] text-cream-100/45 mt-0.5">
                Detected: {sis.length} {sis.length === N ? "✓" : `(need ${N})`}
              </p>
            </div>
            <div>
              <label className="label">Yardage row (optional)</label>
              <textarea
                value={yardageInput}
                onChange={(e) => setYardageInput(e.target.value)}
                className="input min-h-[60px] font-mono text-sm"
                placeholder="389 420 510 175 410 425 165 405 510 390 410 525 400 175 415 405 165 510"
              />
              <p className="text-[10px] text-cream-100/45 mt-0.5">
                Detected: {yardages.length}
              </p>
            </div>
          </div>

          {errors.length > 0 && (
            <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-xs space-y-0.5">
              {errors.map((e, i) => <div key={i} className="text-red-200">⚠ {e}</div>)}
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-cream-100/10 flex items-center justify-end gap-2">
          <button onClick={onCancel} className="btn-ghost text-sm">Cancel</button>
          <button
            onClick={submit}
            disabled={busy || errors.length > 0}
            className="btn-primary text-sm"
          >
            {busy ? "Importing…" : "Import"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function swatchColor(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("black")) return "bg-black ring-1 ring-cream-100/30";
  if (n.includes("blue")) return "bg-blue-600";
  if (n.includes("gold") || n.includes("yellow")) return "bg-gold-500";
  if (n.includes("white") || n.includes("silver")) return "bg-cream-50";
  if (n.includes("red") || n.includes("ladies") || n.includes("forward")) return "bg-red-500";
  if (n.includes("green")) return "bg-emerald-500";
  return "bg-cream-100/30";
}
