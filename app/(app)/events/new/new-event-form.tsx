"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

type Group = { id: string; name: string };

/**
 * Create-event form (Phase 2 of MULTI_GROUP_DESIGN.md).
 *
 * Minimal-by-design: pick a group, pick a kind, name it, dates. The
 * commissioner adds foursomes one-by-one from the event home page.
 * Field-wide games + commissioner-override come in Phase 3.
 *
 * Why no foursome-picker here: trying to lay out 4 foursomes from
 * 16 players in one form is a maze. Real commissioners assign as
 * players RSVP. The event-home "+ Add foursome" flow handles it
 * naturally.
 */
export function NewEventForm({
  allowedGroups,
  allGroups,
  userId
}: {
  allowedGroups: Group[];
  allGroups: Group[];
  userId: string;
}) {
  const router = useRouter();
  const sb = supabaseBrowser();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"tournament" | "trip" | "club_game">(
    "tournament"
  );
  const [startsOn, setStartsOn] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [endsOn, setEndsOn] = useState<string>("");
  const [groupId, setGroupId] = useState<string>(
    allowedGroups[0]?.id ?? allGroups[0]?.id ?? ""
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const userIsCommissionerOfPickedGroup = allowedGroups.some(
    (g) => g.id === groupId
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setErr("Give the event a name.");
      return;
    }
    if (!groupId) {
      setErr("Pick a group.");
      return;
    }
    setBusy(true);
    setErr(null);
    const { data, error } = await sb
      .from("events")
      .insert({
        group_id: groupId,
        name: name.trim(),
        kind,
        starts_on: startsOn,
        ends_on: endsOn || null,
        commissioner_profile_id: userId
      })
      .select("id")
      .single();
    setBusy(false);
    if (error || !data) {
      setErr(
        error?.message ??
          "Couldn't create event — make sure you're a commissioner of the group."
      );
      return;
    }
    router.push(`/events/${data.id}`);
  }

  return (
    <div className="space-y-4 max-w-xl">
      <header>
        <p className="h-eyebrow text-gold-400">Event</p>
        <h1 className="h-display text-3xl text-cream-50 mt-1">
          New event
        </h1>
        <p className="text-sm text-cream-100/65 mt-1 leading-relaxed">
          An event groups multiple foursomes — a member-guest tournament,
          a multi-day trip, a Saturday club game with 3 groups. Each
          foursome plays its own round (own scorer, own presses); the
          event aggregates standings across them.
        </p>
      </header>

      <form onSubmit={submit} className="card p-5 space-y-4">
        <div>
          <label className="label">Name</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Member-Guest 2026"
            required
            autoFocus
          />
        </div>

        <div>
          <label className="label">Kind</label>
          <div className="inline-flex rounded-full border border-cream-100/15 overflow-hidden text-xs">
            {(
              [
                { v: "tournament", label: "Tournament" },
                { v: "trip", label: "Trip" },
                { v: "club_game", label: "Club game" }
              ] as const
            ).map((k) => (
              <button
                key={k.v}
                type="button"
                onClick={() => setKind(k.v)}
                className={`px-3 py-1.5 ${
                  kind === k.v
                    ? "bg-gold-500 text-brand-900"
                    : "bg-brand-900/60 text-cream-100/70"
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-cream-100/55 mt-1.5 leading-snug">
            UI label only — the engine handles all three the same way.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Starts on</label>
            <input
              type="date"
              className="input"
              value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">
              Ends on{" "}
              <span className="text-cream-100/40 normal-case">(optional)</span>
            </label>
            <input
              type="date"
              className="input"
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
            />
            <p className="text-[11px] text-cream-100/55 mt-1">
              For multi-day trips. Leave blank for a one-day event.
            </p>
          </div>
        </div>

        {allowedGroups.length === 0 && allGroups.length > 0 && (
          <div className="card p-3 border border-amber-400/40 bg-amber-500/5 text-xs text-amber-200">
            You&apos;re a member of {allGroups.length} group
            {allGroups.length === 1 ? "" : "s"} but not a commissioner
            of any. Ask a commissioner to set up the event, or get
            commissioner role added in /players.
          </div>
        )}

        {allGroups.length > 1 && (
          <div>
            <label className="label">Group</label>
            <select
              className="input"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            >
              {allGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            {!userIsCommissionerOfPickedGroup && (
              <p className="text-[11px] text-amber-200 mt-1">
                You aren&apos;t a commissioner of this group — the save
                may fail.
              </p>
            )}
          </div>
        )}

        {err && <p className="text-sm text-red-300">{err}</p>}

        <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
          <Link href="/dashboard" className="btn-ghost text-sm">
            ← Back
          </Link>
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || !name.trim()}
          >
            {busy ? "Creating…" : "Create event →"}
          </button>
        </div>
      </form>
    </div>
  );
}
