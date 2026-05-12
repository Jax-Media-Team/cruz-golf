"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";

type Course = { id: string; name: string };

/**
 * Add-foursome button + inline dialog. Creates a NEW round (status =
 * "draft") with `event_id` pre-set to this event's id. The
 * commissioner then opens the round and adds players + games in the
 * normal /rounds/[id] flow.
 *
 * Why not full round-setup in this dialog: the existing /rounds/new
 * page already handles all of that (course tees, player picker,
 * games picker, presets). Replicating it here would duplicate UI.
 * Instead we create a minimal round and hand off — the commissioner
 * lands on the round page and can use the existing affordances
 * (Invites, Edit games, etc.) the same way they would for a
 * standalone round.
 */
export function AddFoursomeButton({
  eventId,
  groupId,
  courses,
  defaultDate
}: {
  eventId: string;
  groupId: string;
  courses: Course[];
  defaultDate: string;
}) {
  const router = useRouter();
  const sb = supabaseBrowser();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [courseId, setCourseId] = useState<string>(courses[0]?.id ?? "");
  const [date, setDate] = useState<string>(defaultDate);
  const [holes, setHoles] = useState<9 | 18>(18);

  async function submit() {
    if (!courseId) {
      setErr("Pick a course.");
      return;
    }
    setBusy(true);
    setErr(null);
    // Direct insert — RLS gates on group membership + commissioner
    // role. Rounds inherit `event_id` so the event home page picks
    // them up via the FK filter.
    const { data, error } = await sb
      .from("rounds")
      .insert({
        group_id: groupId,
        course_id: courseId,
        event_id: eventId,
        date,
        holes,
        status: "draft",
        access_mode: "invitees_only"
      })
      .select("id")
      .single();
    setBusy(false);
    if (error || !data) {
      setErr(error ? friendlyAuthError(error) : "Could not add foursome.");
      return;
    }
    // Land on the round page so the commissioner can add players +
    // games next. The breadcrumb on the round page will show the
    // event_id linkage in Phase 3.
    router.push(`/rounds/${data.id}`);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-primary text-sm"
      >
        + Add foursome
      </button>
    );
  }
  return (
    <div className="card p-4 border border-gold-500/40 bg-brand-900/40 space-y-3 w-full">
      <div className="flex items-center justify-between">
        <p className="h-eyebrow text-gold-400">New foursome</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn-ghost text-xs"
        >
          Cancel
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="sm:col-span-2">
          <label className="label text-xs">Course</label>
          <select
            className="input text-sm"
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
          >
            {courses.length === 0 && (
              <option value="">— no courses in this group —</option>
            )}
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label text-xs">Date</label>
          <input
            type="date"
            className="input text-sm"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </div>
      <div>
        <label className="label text-xs">Holes</label>
        <div className="inline-flex rounded-full border border-cream-100/15 overflow-hidden">
          {[18, 9].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setHoles(n as 9 | 18)}
              className={`px-3 py-1.5 text-xs ${
                holes === n
                  ? "bg-gold-500 text-brand-900"
                  : "bg-brand-900/60 text-cream-100/70"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-cream-100/55 leading-snug">
        We&apos;ll create the round as a draft. After save, you&apos;ll
        land on the round page where you can add players + games +
        invites the normal way. The round will appear on this event
        home automatically.
      </p>
      {err && <p className="text-xs text-red-300">{err}</p>}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="btn-primary text-sm"
        >
          {busy ? "Creating…" : "Create foursome →"}
        </button>
      </div>
    </div>
  );
}
