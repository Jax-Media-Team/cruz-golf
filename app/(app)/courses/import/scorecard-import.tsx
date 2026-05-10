"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PhotoPicker } from "@/components/PhotoPicker";
import {
  validateCourseImport,
  type CourseImportResult,
  type CourseImportTee
} from "@/lib/ocr/course-import";

/**
 * Two-step flow:
 *   1) capture/upload up to 3 photos of the scorecard, send to OCR
 *   2) review the extracted course/tees/pars/SI/yardages and edit before save
 *
 * The review screen is the actual product — OCR is just the first draft.
 * Every cell is editable; nulls are highlighted; we validate before save.
 */
export function ScorecardImportClient({ groupId }: { groupId: string | null }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"capture" | "review">("capture");
  const [previews, setPreviews] = useState<string[]>([]); // data URLs
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<CourseImportResult | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (busy) return; // Don't mutate the queue while OCR is in flight.
    setErr(null);
    const slots = 3 - previews.length;
    if (slots <= 0) {
      setErr("Max 3 photos.");
      return;
    }
    const taken = Array.from(files).slice(0, slots);
    const next: string[] = [];
    for (const f of taken) {
      try {
        const url = await compressToDataUrl(f);
        next.push(url);
      } catch (e: any) {
        setErr(e?.message ?? "Could not read image.");
        return;
      }
    }
    setPreviews((p) => [...p, ...next]);
  }

  async function runOCR() {
    if (previews.length === 0 || busy) return;
    // Snapshot the queue at call time so any subsequent additions don't
    // alter what we send to OCR mid-flight.
    const snapshot = previews.slice();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/course-import-ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrls: snapshot })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `OCR failed (${r.status})`);
      setResult(j as CourseImportResult);
      setPhase("review");
    } catch (e: any) {
      setErr(e?.message ?? "OCR failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <header>
        <p className="h-eyebrow text-gold-400">Course setup</p>
        <h1 className="h-display text-3xl text-cream-50 mt-1">
          Import from a scorecard photo
        </h1>
        <p className="text-sm text-cream-100/65 mt-1">
          Snap a clear photo of the scorecard. We&apos;ll pull out the course
          name, tees, pars, stroke index, and yardages — you review and edit
          everything before save.
        </p>
      </header>

      {phase === "capture" && (
        <CaptureStep
          previews={previews}
          busy={busy}
          err={err}
          onAddFiles={(f) => handleFiles(f)}
          onRemove={(i) =>
            setPreviews((p) => p.filter((_, idx) => idx !== i))
          }
          onRunOCR={runOCR}
        />
      )}

      {phase === "review" && result && (
        <ReviewStep
          initial={result}
          groupId={groupId}
          previews={previews}
          onBack={() => setPhase("capture")}
          onSaved={(courseId) => router.push(`/courses/${courseId}`)}
        />
      )}
    </div>
  );
}

function CaptureStep({
  previews,
  busy,
  err,
  onAddFiles,
  onRemove,
  onRunOCR
}: {
  previews: string[];
  busy: boolean;
  err: string | null;
  onAddFiles: (f: FileList | null) => void;
  onRemove: (i: number) => void;
  onRunOCR: () => void;
  fileRef?: React.MutableRefObject<HTMLInputElement | null>; // legacy — unused
}) {
  return (
    <section className="space-y-3">
      <div className="card p-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {previews.map((src, i) => (
            <div
              key={i}
              className="relative rounded-lg overflow-hidden border border-cream-100/15 aspect-[4/3] bg-brand-900"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`Scorecard ${i + 1}`} className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => onRemove(i)}
                disabled={busy}
                className="absolute top-1 right-1 rounded bg-black/70 text-cream-50 text-xs px-2 py-1 disabled:opacity-50"
                aria-label={`Remove photo ${i + 1}`}
              >
                Remove
              </button>
            </div>
          ))}
          {previews.length < 3 && (
            <PhotoPicker
              onFiles={onAddFiles}
              remaining={3 - previews.length}
              disabled={busy}
            >
              {({ openCamera, openLibrary, disabled }) => (
                <div
                  className="aspect-[4/3] rounded-lg border-2 border-dashed border-cream-100/25 hover:border-gold-500 transition-colors flex flex-col items-center justify-center gap-2 text-cream-100/65 p-3"
                >
                  <span className="text-3xl" aria-hidden="true">📷</span>
                  <span className="text-xs text-cream-100/55">
                    {previews.length === 0 ? "Add a scorecard photo" : "Add another angle"}
                    {" · "}
                    {previews.length}/3
                  </span>
                  <div className="flex flex-wrap gap-2 justify-center">
                    <button
                      type="button"
                      onClick={openCamera}
                      disabled={disabled}
                      className="btn-secondary text-xs"
                    >
                      📸 Take photo
                    </button>
                    <button
                      type="button"
                      onClick={openLibrary}
                      disabled={disabled}
                      className="btn-ghost text-xs"
                    >
                      🖼 Choose from library
                    </button>
                  </div>
                </div>
              )}
            </PhotoPicker>
          )}
        </div>
        <p className="text-xs text-cream-100/55 mt-3">
          Tip: a flat, well-lit photo with the whole card in frame works best.
          Multiple photos help when one shot can&apos;t fit everything (front
          9, back 9, tee block). Saved screenshots and photos texted to you
          work too — use &ldquo;Choose from library.&rdquo;
        </p>
      </div>

      {err && <p className="text-sm text-red-300">{err}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={busy || previews.length === 0}
          onClick={onRunOCR}
        >
          {busy ? "Reading scorecard…" : "Read scorecard →"}
        </button>
        {/* The dashed-area picker above is the canonical entry point —
            no need for a duplicate "Choose photo" button down here per
            the no-duplicate-UI principle. */}
      </div>
    </section>
  );
}

function ReviewStep({
  initial,
  groupId,
  previews,
  onBack,
  onSaved
}: {
  initial: CourseImportResult;
  groupId: string | null;
  previews: string[];
  onBack: () => void;
  onSaved: (courseId: string) => void;
}) {
  const sb = supabaseBrowser();
  const [draft, setDraft] = useState<CourseImportResult>(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const validation = useMemo(() => validateCourseImport(draft), [draft]);

  function setCourse(patch: Partial<CourseImportResult["course"]>) {
    setDraft((d) => ({ ...d, course: { ...d.course, ...patch } }));
  }
  function setPar(idx: number, val: number | null) {
    setDraft((d) => {
      const next = [...d.pars];
      next[idx] = val;
      return { ...d, pars: next };
    });
  }
  function setSI(idx: number, val: number | null) {
    setDraft((d) => {
      const next = [...d.stroke_indexes];
      next[idx] = val;
      return { ...d, stroke_indexes: next };
    });
  }
  function setTee(i: number, patch: Partial<CourseImportTee>) {
    setDraft((d) => {
      const next = [...d.tees];
      next[i] = { ...next[i], ...patch };
      return { ...d, tees: next };
    });
  }
  function setTeeYardage(i: number, holeIdx: number, val: number | null) {
    setDraft((d) => {
      const tees = [...d.tees];
      const yards = [...tees[i].yardages];
      yards[holeIdx] = val;
      tees[i] = { ...tees[i], yardages: yards };
      return { ...d, tees };
    });
  }
  function addTee() {
    setDraft((d) => ({
      ...d,
      tees: [
        ...d.tees,
        {
          name: "",
          gender: null,
          rating: null,
          slope: null,
          total_par: d.pars.reduce<number>((a, b) => a + (b ?? 0), 0) || null,
          front_par: null,
          back_par: null,
          total_yardage: null,
          front_yardage: null,
          back_yardage: null,
          yardages: new Array(d.holes).fill(null)
        }
      ]
    }));
  }
  function removeTee(i: number) {
    setDraft((d) => ({ ...d, tees: d.tees.filter((_, idx) => idx !== i) }));
  }

  async function save() {
    if (!groupId) {
      setErr("No group found — can't save.");
      return;
    }
    if (!validation.ok) return;
    setErr(null);
    setSaving(true);

    // 1) course
    const { data: course, error: ce } = await sb
      .from("courses")
      .insert({
        group_id: groupId,
        name: draft.course.name!,
        city: draft.course.city,
        state: draft.course.state
      })
      .select("id")
      .single();
    if (ce || !course) {
      setSaving(false);
      setErr(ce?.message ?? "Could not create course.");
      return;
    }

    // 2) tees + holes for each tee. Pars/SI are shared across tees.
    for (const t of draft.tees) {
      const { data: teeRow, error: te } = await sb
        .from("course_tees")
        .insert({
          course_id: course.id,
          name: t.name,
          gender: t.gender ?? "men",
          holes: draft.holes,
          rating: t.rating ?? 0,
          slope: t.slope ?? 113,
          par: draft.pars.reduce<number>((a, b) => a + (b ?? 0), 0)
        })
        .select("id")
        .single();
      if (te || !teeRow) {
        setSaving(false);
        setErr(te?.message ?? `Could not save tee "${t.name}".`);
        return;
      }
      const rows = draft.pars.map((p, i) => ({
        tee_id: teeRow.id,
        hole_number: i + 1,
        par: p ?? 4,
        stroke_index: draft.stroke_indexes[i] ?? i + 1,
        yardage: t.yardages[i] ?? null
      }));
      const { error: he } = await sb.from("course_holes").insert(rows);
      if (he) {
        setSaving(false);
        setErr(he.message);
        return;
      }
    }

    setSaving(false);
    onSaved(course.id);
  }

  return (
    <section className="space-y-4">
      {/* Source photos */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {previews.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={src}
            alt={`Source ${i + 1}`}
            className="h-24 rounded border border-cream-100/15 object-cover"
          />
        ))}
        <button type="button" className="btn-ghost text-xs ml-auto" onClick={onBack}>
          ← Re-take photos
        </button>
      </div>

      {draft.notes && (
        <div className="card p-3 text-xs text-cream-100/70 border border-cream-100/15">
          <span className="text-gold-400 font-medium">OCR notes:</span> {draft.notes}
        </div>
      )}

      {/* Course identity */}
      <div className="card p-4 space-y-3">
        <h2 className="font-serif text-lg text-cream-50">Course</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-3">
            <label className="label">Name</label>
            <input
              className="input"
              value={draft.course.name ?? ""}
              onChange={(e) => setCourse({ name: e.target.value })}
              placeholder="Jacksonville Golf & Country Club"
            />
          </div>
          <div>
            <label className="label">City</label>
            <input
              className="input"
              value={draft.course.city ?? ""}
              onChange={(e) => setCourse({ city: e.target.value })}
            />
          </div>
          <div>
            <label className="label">State</label>
            <input
              className="input"
              value={draft.course.state ?? ""}
              onChange={(e) => setCourse({ state: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Holes</label>
            <select
              className="input"
              value={draft.holes}
              onChange={(e) => {
                const h = parseInt(e.target.value, 10) === 9 ? 9 : 18;
                setDraft((d) => ({
                  ...d,
                  holes: h,
                  pars: resizeArr(d.pars, h),
                  stroke_indexes: resizeArr(d.stroke_indexes, h),
                  stroke_indexes_ladies: d.stroke_indexes_ladies
                    ? resizeArr(d.stroke_indexes_ladies, h)
                    : null,
                  tees: d.tees.map((t) => ({ ...t, yardages: resizeArr(t.yardages, h) }))
                }));
              }}
            >
              <option value={18}>18</option>
              <option value={9}>9</option>
            </select>
          </div>
        </div>
      </div>

      {/* Pars + SI */}
      <div className="card p-4 space-y-3">
        <h2 className="font-serif text-lg text-cream-50">Pars & stroke index</h2>
        <ParSITable
          holes={draft.holes}
          pars={draft.pars}
          si={draft.stroke_indexes}
          onPar={setPar}
          onSI={setSI}
        />
      </div>

      {/* Tees */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-lg text-cream-50">Tees</h2>
          <button type="button" className="btn-ghost text-sm" onClick={addTee}>
            + Add tee
          </button>
        </div>
        {draft.tees.length === 0 && (
          <p className="text-xs text-cream-100/55">
            No tees were captured. Add at least one below.
          </p>
        )}
        <div className="space-y-3">
          {draft.tees.map((t, i) => (
            <TeeBlock
              key={i}
              tee={t}
              holes={draft.holes}
              pars={draft.pars}
              onChange={(patch) => setTee(i, patch)}
              onYardage={(holeIdx, val) => setTeeYardage(i, holeIdx, val)}
              onRemove={() => removeTee(i)}
            />
          ))}
        </div>
      </div>

      {/* Validation summary */}
      {(validation.errors.length > 0 || validation.warnings.length > 0) && (
        <div className="card p-4 space-y-2 text-sm border border-cream-100/15">
          {validation.errors.length > 0 && (
            <div>
              <p className="text-red-300 font-medium">Fix before saving</p>
              <ul className="list-disc pl-5 text-red-300/90">
                {validation.errors.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          {validation.warnings.length > 0 && (
            <div>
              <p className="text-amber-300 font-medium">Heads-up</p>
              <ul className="list-disc pl-5 text-amber-200/90">
                {validation.warnings.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {err && <p className="text-sm text-red-300">{err}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={saving || !validation.ok}
          onClick={save}
        >
          {saving ? "Saving…" : "Save course"}
        </button>
        <button type="button" className="btn-ghost" onClick={onBack} disabled={saving}>
          ← Back
        </button>
      </div>
    </section>
  );
}

// ---- subcomponents ----

function ParSITable({
  holes,
  pars,
  si,
  onPar,
  onSI
}: {
  holes: 9 | 18;
  pars: Array<number | null>;
  si: Array<number | null>;
  onPar: (idx: number, v: number | null) => void;
  onSI: (idx: number, v: number | null) => void;
}) {
  const indices = Array.from({ length: holes }, (_, i) => i);
  const totalPar = pars.reduce<number>((a, b) => a + (b ?? 0), 0);
  // Detect SI duplicates so we can highlight them red.
  const siCounts = new Map<number, number>();
  for (const v of si) {
    if (v == null) continue;
    siCounts.set(v, (siCounts.get(v) ?? 0) + 1);
  }
  const isSiDup = (v: number | null) => v != null && (siCounts.get(v) ?? 0) > 1;

  return (
    <div className="overflow-x-auto">
      <table className="text-sm w-full">
        <thead>
          <tr className="text-left text-cream-100/55">
            <th className="py-1 pr-2">Hole</th>
            {indices.map((i) => (
              <th key={i} className="px-1 text-center font-medium">
                {i + 1}
              </th>
            ))}
            <th className="pl-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="py-1 pr-2 text-cream-100/65">Par</td>
            {indices.map((i) => (
              <td key={i} className="px-1">
                <input
                  className={`input w-10 text-center px-1 ${pars[i] == null ? "border-amber-400/50" : ""}`}
                  type="number"
                  min={3}
                  max={6}
                  value={pars[i] ?? ""}
                  onChange={(e) => onPar(i, e.target.value === "" ? null : parseInt(e.target.value, 10))}
                />
              </td>
            ))}
            <td className="pl-2 text-right tabular-nums text-cream-50 font-medium">
              {totalPar}
            </td>
          </tr>
          <tr>
            <td className="py-1 pr-2 text-cream-100/65">SI</td>
            {indices.map((i) => (
              <td key={i} className="px-1">
                <input
                  className={`input w-10 text-center px-1 ${
                    isSiDup(si[i]) || si[i] == null ? "border-amber-400/50" : ""
                  }`}
                  type="number"
                  min={1}
                  max={holes}
                  value={si[i] ?? ""}
                  onChange={(e) => onSI(i, e.target.value === "" ? null : parseInt(e.target.value, 10))}
                />
              </td>
            ))}
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function TeeBlock({
  tee,
  holes,
  pars,
  onChange,
  onYardage,
  onRemove
}: {
  tee: CourseImportTee;
  holes: 9 | 18;
  pars: Array<number | null>;
  onChange: (patch: Partial<CourseImportTee>) => void;
  onYardage: (holeIdx: number, val: number | null) => void;
  onRemove: () => void;
}) {
  const indices = Array.from({ length: holes }, (_, i) => i);
  const totalYards = tee.yardages.reduce<number>((a, b) => a + (b ?? 0), 0);
  const totalPar = pars.reduce<number>((a, b) => a + (b ?? 0), 0);
  return (
    <div className="rounded-lg border border-cream-100/10 p-3 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <div className="sm:col-span-1">
          <label className="label">Name</label>
          <input
            className="input"
            value={tee.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Black"
          />
        </div>
        <div>
          <label className="label">Rating</label>
          <input
            className={`input ${tee.rating == null ? "border-amber-400/50" : ""}`}
            type="number"
            step="0.1"
            value={tee.rating ?? ""}
            onChange={(e) =>
              onChange({ rating: e.target.value === "" ? null : parseFloat(e.target.value) })
            }
            placeholder="72.4"
          />
        </div>
        <div>
          <label className="label">Slope</label>
          <input
            className={`input ${tee.slope == null ? "border-amber-400/50" : ""}`}
            type="number"
            value={tee.slope ?? ""}
            onChange={(e) =>
              onChange({ slope: e.target.value === "" ? null : parseInt(e.target.value, 10) })
            }
            placeholder="132"
          />
        </div>
        <div>
          <label className="label">Gender</label>
          <select
            className="input"
            value={tee.gender ?? ""}
            onChange={(e) =>
              onChange({
                gender: e.target.value === "men" || e.target.value === "women" ? e.target.value : null
              })
            }
          >
            <option value="">—</option>
            <option value="men">Men</option>
            <option value="women">Women</option>
          </select>
        </div>
        <div className="flex items-end">
          <button type="button" className="btn-ghost text-xs text-red-300" onClick={onRemove}>
            Remove tee
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="text-sm w-full">
          <thead>
            <tr className="text-left text-cream-100/55">
              <th className="py-1 pr-2">Yards</th>
              {indices.map((i) => (
                <th key={i} className="px-1 text-center font-medium">
                  {i + 1}
                </th>
              ))}
              <th className="pl-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="py-1 pr-2 text-cream-100/65">{tee.name || "Tee"}</td>
              {indices.map((i) => (
                <td key={i} className="px-1">
                  <input
                    className={`input w-14 text-center px-1 ${tee.yardages[i] == null ? "border-amber-400/40" : ""}`}
                    type="number"
                    min={50}
                    max={800}
                    value={tee.yardages[i] ?? ""}
                    onChange={(e) =>
                      onYardage(i, e.target.value === "" ? null : parseInt(e.target.value, 10))
                    }
                  />
                </td>
              ))}
              <td className="pl-2 text-right tabular-nums text-cream-50 font-medium">
                {totalYards || ""}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-cream-100/45">
        Par {totalPar} {totalYards ? `· ${totalYards} yds` : ""}
      </p>
    </div>
  );
}

// ---- utils ----

function resizeArr<T>(arr: Array<T | null>, n: number): Array<T | null> {
  if (arr.length === n) return arr;
  if (arr.length > n) return arr.slice(0, n);
  return [...arr, ...new Array(n - arr.length).fill(null)];
}

/**
 * Resize+compress a phone photo to ~1600px on the longest edge and JPEG q=0.85.
 * Keeps OCR quality high while staying inside the 4 MB-ish per-image limit.
 */
async function compressToDataUrl(file: File, maxEdge = 1600, quality = 0.85): Promise<string> {
  // We createObjectURL to load the image into an HTMLImageElement so we can
  // measure its natural dimensions, then revoke immediately after — otherwise
  // the blob is held alive for the lifetime of the page (multi-photo imports
  // would otherwise pile up tens of MB of phantom blobs).
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not load image."));
      i.src = objectUrl;
    });

    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported.");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
