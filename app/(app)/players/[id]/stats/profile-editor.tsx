"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

type Initial = {
  display_name: string;
  email: string | null;
  phone: string | null;
  ghin_number: string | null;
  handicap_index: number | null;
  venmo_handle: string | null;
  avatar_url: string | null;
};

export function PlayerProfileEditor({ playerId, initial }: { playerId: string; initial: Initial }) {
  const router = useRouter();
  const sb = supabaseBrowser();
  const [draft, setDraft] = useState<Initial>(initial);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    const { error } = await sb
      .from("players")
      .update({
        display_name: draft.display_name,
        email: draft.email || null,
        phone: draft.phone || null,
        ghin_number: draft.ghin_number || null,
        handicap_index: draft.handicap_index,
        venmo_handle: (draft.venmo_handle ?? "").replace(/^@/, "") || null,
        avatar_url: draft.avatar_url || null
      })
      .eq("id", playerId);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-secondary text-sm">
        Edit profile
      </button>
    );
  }

  return (
    <div className="card p-5 space-y-3">
      <h2 className="font-serif text-xl text-cream-50">Edit profile</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Display name</label>
          <input className="input" value={draft.display_name ?? ""} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} />
        </div>
        <div>
          <label className="label">Handicap Index</label>
          <input
            className="input"
            type="number"
            step="0.1"
            value={draft.handicap_index ?? ""}
            onChange={(e) => setDraft({ ...draft, handicap_index: e.target.value === "" ? null : parseFloat(e.target.value) })}
          />
        </div>
        <div>
          <label className="label">Venmo handle</label>
          <input
            className="input"
            value={draft.venmo_handle ?? ""}
            onChange={(e) => setDraft({ ...draft, venmo_handle: e.target.value })}
            placeholder="@yourhandle"
          />
        </div>
        <div>
          <label className="label">GHIN #</label>
          <input className="input" value={draft.ghin_number ?? ""} onChange={(e) => setDraft({ ...draft, ghin_number: e.target.value })} />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" value={draft.email ?? ""} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" value={draft.phone ?? ""} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Avatar URL <span className="text-cream-100/40 normal-case">(or sign in via Google to auto-fill)</span></label>
          <input className="input" value={draft.avatar_url ?? ""} onChange={(e) => setDraft({ ...draft, avatar_url: e.target.value })} placeholder="https://…" />
        </div>
      </div>
      {err && <p className="text-sm text-red-300">{err}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        <button className="btn-ghost" onClick={() => { setDraft(initial); setOpen(false); setErr(null); }}>Cancel</button>
      </div>
    </div>
  );
}
