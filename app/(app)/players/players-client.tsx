"use client";
import Link from "next/link";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Player = {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  ghin_number: string | null;
  handicap_index: number | null;
  is_guest: boolean;
};

export function PlayersClient({ initialPlayers, groupId }: { initialPlayers: Player[]; groupId: string | null }) {
  const [players, setPlayers] = useState(initialPlayers);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<Player>>({});
  const sb = supabaseBrowser();

  async function add() {
    if (!groupId || !draft.display_name) return;
    const { data, error } = await sb
      .from("players")
      .insert({
        group_id: groupId,
        display_name: draft.display_name,
        email: draft.email ?? null,
        phone: draft.phone ?? null,
        ghin_number: draft.ghin_number ?? null,
        handicap_index: draft.handicap_index ?? null,
        handicap_index_source: "manual",
        handicap_updated_at: new Date().toISOString(),
        is_guest: !!draft.is_guest
      })
      .select("*")
      .single();
    if (error) {
      alert(error.message);
      return;
    }
    if (data) setPlayers((p) => [...p, data].sort((a, b) => a.display_name.localeCompare(b.display_name)));
    setDraft({});
    setAdding(false);
  }

  async function update(p: Player, patch: Partial<Player>) {
    const { error } = await sb.from("players").update(patch).eq("id", p.id);
    if (error) {
      alert(error.message);
      return;
    }
    setPlayers((arr) => arr.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));
  }

  async function softDelete(p: Player) {
    if (!confirm(`Remove ${p.display_name}? They'll stay on past rounds.`)) return;
    const { error } = await sb.from("players").update({ deleted_at: new Date().toISOString() }).eq("id", p.id);
    if (error) return alert(error.message);
    setPlayers((arr) => arr.filter((x) => x.id !== p.id));
  }

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between">
        <div>
          <p className="h-eyebrow">Roster</p>
          <h1 className="h-display text-4xl text-cream-50 mt-1">Players</h1>
        </div>
        <button className="btn-primary" onClick={() => setAdding((v) => !v)}>
          {adding ? "Cancel" : "Add player"}
        </button>
      </header>

      {adding && (
        <div className="card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="label">Name</label>
            <input className="input" value={draft.display_name ?? ""} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} />
          </div>
          <div>
            <label className="label">Handicap Index</label>
            <input className="input" type="number" step="0.1" value={draft.handicap_index ?? ""} onChange={(e) => setDraft({ ...draft, handicap_index: e.target.value === "" ? null : parseFloat(e.target.value) })} />
          </div>
          <div>
            <label className="label">GHIN #</label>
            <input className="input" value={draft.ghin_number ?? ""} onChange={(e) => setDraft({ ...draft, ghin_number: e.target.value })} />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" value={draft.email ?? ""} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" value={draft.phone ?? ""} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 sm:col-span-2 text-sm">
            <input type="checkbox" checked={!!draft.is_guest} onChange={(e) => setDraft({ ...draft, is_guest: e.target.checked })} />
            Guest (no account)
          </label>
          <div className="sm:col-span-2">
            <button className="btn-primary w-full" onClick={add}>Save</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {players.map((p) => (
          <div key={p.id} className="card p-4 flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate text-cream-50">
                {p.display_name}
                {p.is_guest && <span className="ml-2 pill-draft text-xs">guest</span>}
              </div>
              <div className="text-sm text-cream-100/55">
                HI {p.handicap_index ?? "—"} {p.ghin_number ? `· GHIN ${p.ghin_number}` : ""}
              </div>
            </div>
            <input
              className="input w-24"
              type="number"
              step="0.1"
              defaultValue={p.handicap_index ?? ""}
              onBlur={(e) => {
                const v = e.target.value === "" ? null : parseFloat(e.target.value);
                if (v !== p.handicap_index) update(p, { handicap_index: v });
              }}
              aria-label="Handicap Index"
            />
            <Link href={`/players/${p.id}/stats`} className="btn-ghost text-sm">Stats</Link>
            <button className="btn-ghost text-sm text-red-300" onClick={() => softDelete(p)}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}
