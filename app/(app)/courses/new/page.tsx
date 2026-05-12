"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";

const DEFAULT_PARS = [4, 4, 5, 3, 4, 4, 3, 4, 5, 4, 4, 5, 4, 3, 4, 4, 3, 5];
const DEFAULT_SI = [7, 11, 3, 13, 5, 15, 9, 17, 1, 8, 12, 4, 14, 6, 16, 10, 18, 2];

export default function NewCoursePage() {
  const router = useRouter();
  const sb = supabaseBrowser();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("FL");
  const [tee, setTee] = useState({ name: "Blue", rating: 71.2, slope: 132, par: 72 });
  const [pars, setPars] = useState<number[]>(DEFAULT_PARS);
  const [sis, setSis] = useState<number[]>(DEFAULT_SI);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    setBusy(true);
    const { data: groups } = await sb.from("groups").select("id").limit(1);
    const groupId = groups?.[0]?.id;
    if (!groupId) {
      setBusy(false);
      setErr("No group found.");
      return;
    }
    const { data: course, error } = await sb.from("courses").insert({ group_id: groupId, name, city, state: stateName }).select("id").single();
    if (error || !course) {
      setBusy(false);
      setErr(error ? friendlyAuthError(error) : "Could not save");
      return;
    }
    const { data: t, error: te } = await sb
      .from("course_tees")
      .insert({ course_id: course.id, name: tee.name, holes: 18, rating: tee.rating, slope: tee.slope, par: tee.par })
      .select("id")
      .single();
    if (te || !t) {
      setBusy(false);
      setErr(te ? friendlyAuthError(te) : "Could not save tee");
      return;
    }
    const holesInsert = pars.map((p, i) => ({ tee_id: t.id, hole_number: i + 1, par: p, stroke_index: sis[i] }));
    const { error: he } = await sb.from("course_holes").insert(holesInsert);
    setBusy(false);
    if (he) {
      setErr(he.message);
      return;
    }
    router.push("/courses");
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <header>
        <p className="h-eyebrow">New</p>
        <h1 className="h-display text-3xl text-cream-50 mt-1">Add course</h1>
      </header>
      <div className="card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">City</label>
          <input className="input" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div>
          <label className="label">State</label>
          <input className="input" value={stateName} onChange={(e) => setStateName(e.target.value)} />
        </div>
      </div>

      <div className="card p-4">
        <h2 className="font-serif text-xl text-cream-50 mb-3">First tee</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="label">Name</label>
            <input className="input" value={tee.name} onChange={(e) => setTee({ ...tee, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Rating</label>
            <input className="input" type="number" step="0.1" value={tee.rating} onChange={(e) => setTee({ ...tee, rating: parseFloat(e.target.value) || 0 })} />
          </div>
          <div>
            <label className="label">Slope</label>
            <input className="input" type="number" value={tee.slope} onChange={(e) => setTee({ ...tee, slope: parseInt(e.target.value) || 113 })} />
          </div>
          <div>
            <label className="label">Par</label>
            <input className="input" type="number" value={tee.par} onChange={(e) => setTee({ ...tee, par: parseInt(e.target.value) || 72 })} />
          </div>
        </div>
      </div>

      <div className="card p-4">
        <h2 className="font-serif text-xl text-cream-50 mb-3">Holes</h2>
        <div className="overflow-x-auto">
          <table className="text-sm w-full">
            <thead>
              <tr className="text-left text-cream-100/55">
                <th className="py-1 pr-2">Hole</th>
                {pars.map((_, i) => <th key={i} className="px-1 text-center font-medium">{i + 1}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-1 pr-2">Par</td>
                {pars.map((p, i) => (
                  <td key={i} className="px-1">
                    <input
                      className="input w-12 text-center px-1"
                      value={p}
                      type="number"
                      onChange={(e) => {
                        const next = [...pars];
                        next[i] = parseInt(e.target.value) || 0;
                        setPars(next);
                      }}
                    />
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-1 pr-2">SI</td>
                {sis.map((s, i) => (
                  <td key={i} className="px-1">
                    <input
                      className="input w-12 text-center px-1"
                      value={s}
                      type="number"
                      onChange={(e) => {
                        const next = [...sis];
                        next[i] = parseInt(e.target.value) || 0;
                        setSis(next);
                      }}
                    />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {err && <p className="text-sm text-red-300">{err}</p>}
      <button className="btn-primary w-full sm:w-auto" disabled={busy || !name} onClick={save}>
        {busy ? "Saving…" : "Save course"}
      </button>
    </div>
  );
}
