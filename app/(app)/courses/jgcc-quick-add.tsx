"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";
import {
  JGCC_NAME, JGCC_CITY, JGCC_STATE, JGCC_PARS, JGCC_MENS_SI, JGCC_LADIES_SI,
  JGCC_TEES, JGCC_YARDAGE
} from "@/lib/presets/jgcc";

export function JgccQuickAdd({ groupId }: { groupId: string }) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function add() {
    setBusy(true);
    setErr(null);
    // Idempotency guard: there is no unique constraint on
    // (group_id, name) so a second click here would happily create a
    // second JGCC row, which is exactly what produced the admin
    // course-list duplicates Patrick called out 2026-05-12 ("30
    // courses in admin, almost all JGCC"). Check first — if any alive
    // JGCC already exists for this group, no-op cleanly and just
    // re-render the courses page so the user sees their existing
    // course instead of a phantom new one.
    const { data: existing } = await sb
      .from("courses")
      .select("id")
      .eq("group_id", groupId)
      .eq("name", JGCC_NAME)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      setBusy(false);
      setDone(true);
      router.refresh();
      return;
    }
    const { data: course, error } = await sb
      .from("courses")
      .insert({ group_id: groupId, name: JGCC_NAME, city: JGCC_CITY, state: JGCC_STATE })
      .select("id")
      .single();
    if (error || !course) {
      setBusy(false);
      setErr(error ? friendlyAuthError(error) : "Could not create course");
      return;
    }

    for (const tee of JGCC_TEES) {
      const { data: t, error: te } = await sb
        .from("course_tees")
        .insert({
          course_id: course.id,
          name: tee.label,
          gender: tee.gender,
          holes: 18,
          rating: tee.rating,
          slope: tee.slope,
          par: 72
        })
        .select("id")
        .single();
      if (te || !t) {
        setBusy(false);
        setErr(te?.message ?? `Failed to add ${tee.label}`);
        return;
      }
      const yards = JGCC_YARDAGE[tee.key];
      const si = tee.ladies ? JGCC_LADIES_SI : JGCC_MENS_SI;
      const rows = JGCC_PARS.map((par, i) => ({
        tee_id: t.id,
        hole_number: i + 1,
        par,
        stroke_index: si[i],
        yardage: yards[i]
      }));
      const { error: he } = await sb.from("course_holes").insert(rows);
      if (he) {
        setBusy(false);
        setErr(he.message);
        return;
      }
    }
    setBusy(false);
    setDone(true);
    router.refresh();
  }

  if (done) return null;

  return (
    <div className="card p-5 flex items-center gap-4">
      <div className="text-3xl">🌴</div>
      <div className="flex-1">
        <div className="font-serif text-xl text-cream-50">Add Jacksonville Golf & Country Club</div>
        <p className="text-sm text-cream-100/65">All 5 tees (Black 73.2/138 · Gold 71.8/133 · Silver 70.6/120 · Jade 67.8/117 · Cranberry 70.4/125), exact pars, stroke index, and yardages.</p>
        {err && <p className="text-sm text-red-300 mt-1">{err}</p>}
      </div>
      <button className="btn-primary text-sm" disabled={busy} onClick={add}>
        {busy ? "Adding…" : "Quick add"}
      </button>
    </div>
  );
}
