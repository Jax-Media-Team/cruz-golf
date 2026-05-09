"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { formatHi, hiInputValue, parseHi } from "@/lib/handicap-format";

type Player = {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  ghin_number: string | null;
  handicap_index: number | null;
  is_guest: boolean;
  profile_id?: string | null;
  deleted_at?: string | null;
};

function lastNameKey(name: string): string {
  // Sort by last token of the name (treats "Patrick Cruz" -> "Cruz Patrick").
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name.toLowerCase();
  const last = parts[parts.length - 1];
  return `${last} ${parts.slice(0, -1).join(" ")}`.toLowerCase();
}

export function PlayersClient({
  initialPlayers,
  groupId,
  currentUserId,
  showArchived
}: {
  initialPlayers: Player[];
  groupId: string | null;
  currentUserId: string | null;
  showArchived: boolean;
}) {
  const [players, setPlayers] = useState(initialPlayers);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<Player>>({});
  const sb = supabaseBrowser();
  const router = useRouter();

  // Sort: logged-in user first, then alphabetical by last name.
  const sorted = useMemo(() => {
    return [...players].sort((a, b) => {
      const aMe = currentUserId && a.profile_id === currentUserId;
      const bMe = currentUserId && b.profile_id === currentUserId;
      if (aMe && !bMe) return -1;
      if (!aMe && bMe) return 1;
      // Archived to bottom
      const aArch = !!a.deleted_at;
      const bArch = !!b.deleted_at;
      if (aArch !== bArch) return aArch ? 1 : -1;
      return lastNameKey(a.display_name).localeCompare(lastNameKey(b.display_name));
    });
  }, [players, currentUserId]);

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

  async function archive(p: Player) {
    if (!confirm(`Archive ${p.display_name}? They'll stay on past rounds and stats but won't show up in your default player list.`)) return;
    const { error } = await sb.from("players").update({ deleted_at: new Date().toISOString() }).eq("id", p.id);
    if (error) return alert(error.message);
    if (showArchived) {
      setPlayers((arr) => arr.map((x) => (x.id === p.id ? { ...x, deleted_at: new Date().toISOString() } : x)));
    } else {
      setPlayers((arr) => arr.filter((x) => x.id !== p.id));
    }
  }

  async function unarchive(p: Player) {
    const { error } = await sb.from("players").update({ deleted_at: null }).eq("id", p.id);
    if (error) return alert(error.message);
    setPlayers((arr) => arr.map((x) => (x.id === p.id ? { ...x, deleted_at: null } : x)));
    router.refresh();
  }

  async function hardDelete(p: Player) {
    if (
      !confirm(
        `Permanently DELETE ${p.display_name}? Only works if they have no past rounds. Otherwise archive them instead.`
      )
    )
      return;
    const { error } = await sb.from("players").delete().eq("id", p.id);
    if (error) {
      // Likely FK violation — they have round_players rows. Fall back to archive.
      alert(`Couldn't delete (probably has round history): ${error.message}\nArchiving instead.`);
      return archive(p);
    }
    setPlayers((arr) => arr.filter((x) => x.id !== p.id));
  }

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="h-eyebrow">Roster</p>
          <h1 className="h-display text-4xl text-cream-50 mt-1">Players</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={showArchived ? "/players" : "/players?archived=1"}
            className="btn-ghost text-xs"
          >
            {showArchived ? "← Active only" : "View archived"}
          </Link>
          <button className="btn-primary" onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "Add player"}
          </button>
        </div>
      </header>

      {adding && (
        <div className="card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="label">Name</label>
            <input className="input" value={draft.display_name ?? ""} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} />
          </div>
          <div>
            <label className="label">Handicap Index</label>
            <input
              className="input"
              type="text"
              inputMode="decimal"
              placeholder="14.0 or +1.4"
              value={hiInputValue(draft.handicap_index)}
              onChange={(e) => setDraft({ ...draft, handicap_index: parseHi(e.target.value) })}
            />
            <p className="text-[10px] text-cream-100/45 mt-0.5">
              Plus index? Type with a +, e.g. <span className="text-gold-400">+1.4</span>
            </p>
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
        {sorted.map((p) => {
          const isMe = !!(currentUserId && p.profile_id === currentUserId);
          const archived = !!p.deleted_at;
          return (
            <div
              key={p.id}
              className={`card p-4 flex items-center justify-between gap-3 ${archived ? "opacity-60" : ""} ${isMe ? "border border-gold-500/30" : ""}`}
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate text-cream-50">
                  {p.display_name}
                  {isMe && <span className="ml-2 pill bg-gold-500 text-brand-900 text-[10px] px-2 py-0.5">You</span>}
                  {p.is_guest && <span className="ml-2 pill-draft text-xs">guest</span>}
                  {archived && <span className="ml-2 text-xs text-cream-100/55">(archived)</span>}
                </div>
                <div className="text-sm text-cream-100/55">
                  HI {formatHi(p.handicap_index)} {p.ghin_number ? `· GHIN ${p.ghin_number}` : ""}
                </div>
              </div>
              <input
                className="input w-24"
                type="text"
                inputMode="decimal"
                placeholder="+1.4"
                defaultValue={hiInputValue(p.handicap_index)}
                onBlur={(e) => {
                  const v = parseHi(e.target.value);
                  if (v !== p.handicap_index) update(p, { handicap_index: v });
                }}
                aria-label="Handicap Index"
              />
              <Link href={`/players/${p.id}/stats`} className="btn-ghost text-sm">Stats</Link>
              {archived ? (
                <button className="btn-ghost text-sm text-emerald-300" onClick={() => unarchive(p)}>
                  Unarchive
                </button>
              ) : (
                <>
                  <button className="btn-ghost text-sm text-cream-100/65" onClick={() => archive(p)}>
                    Archive
                  </button>
                  <button className="btn-ghost text-sm text-red-300" onClick={() => hardDelete(p)}>
                    Delete
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
