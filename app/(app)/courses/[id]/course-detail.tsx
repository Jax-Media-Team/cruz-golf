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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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

  return (
    <>
      <section className="card p-4 space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="font-serif text-xl text-cream-50">Tee boxes</h2>
          <span className="text-xs text-cream-100/55">{tees.length} on file</span>
        </div>

        {tees.length === 0 ? (
          <p className="text-sm text-cream-100/65">No tees yet — add one below.</p>
        ) : (
          <ul className="space-y-2">
            {tees.map((t) => (
              <li
                key={t.id}
                className="surface rounded-xl px-4 py-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block w-2.5 h-2.5 rounded-full ${swatchColor(t.name)}`}
                      aria-hidden
                    />
                    <span className="font-medium text-cream-50">{t.name}</span>
                    {t.gender && (
                      <span className="text-[10px] uppercase tracking-wide text-cream-100/45">
                        {t.gender}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-cream-100/55 mt-0.5 tabular-nums">
                    Rating {t.rating} · Slope {t.slope} · Par {t.par} · {t.holes} holes
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => deleteTee(t.id)}
                  disabled={busy}
                  className="text-xs text-red-300 hover:text-red-200"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

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
