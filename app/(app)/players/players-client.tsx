"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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
  const [query, setQuery] = useState("");
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  const sb = supabaseBrowser();
  const router = useRouter();

  // Sort: logged-in user first, then alphabetical by last name. Archived sink to bottom.
  const sorted = useMemo(() => {
    return [...players].sort((a, b) => {
      const aMe = currentUserId && a.profile_id === currentUserId;
      const bMe = currentUserId && b.profile_id === currentUserId;
      if (aMe && !bMe) return -1;
      if (!aMe && bMe) return 1;
      const aArch = !!a.deleted_at;
      const bArch = !!b.deleted_at;
      if (aArch !== bArch) return aArch ? 1 : -1;
      return lastNameKey(a.display_name).localeCompare(lastNameKey(b.display_name));
    });
  }, [players, currentUserId]);

  // Search filter (matches name, GHIN, email, phone — all case-insensitive).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((p) => {
      const haystack = [
        p.display_name,
        p.ghin_number,
        p.email,
        p.phone
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [sorted, query]);

  // Close overflow menu when you click anywhere else.
  useEffect(() => {
    if (!openMenuFor) return;
    const close = () => setOpenMenuFor(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openMenuFor]);

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
    if (data) setPlayers((p) => [...p, data]);
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

  const totalActive = players.filter((p) => !p.deleted_at).length;
  const totalArchived = players.filter((p) => !!p.deleted_at).length;

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="h-eyebrow">Roster</p>
          <h1 className="h-display text-4xl text-cream-50 mt-1">Players</h1>
          <p className="text-xs text-cream-100/55 mt-1">
            {showArchived ? `${totalArchived} archived · ${totalActive} active` : `${totalActive} player${totalActive === 1 ? "" : "s"}`}
          </p>
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

      {/* Search box — name / GHIN / email / phone */}
      {sorted.length > 4 && (
        <div className="relative">
          <input
            className="input pr-9"
            type="search"
            placeholder="Search players…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search players"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-cream-100/55 hover:text-cream-50 text-sm"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {adding && (
        <div className="card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="label">Name</label>
            <input
              className="input"
              autoFocus
              value={draft.display_name ?? ""}
              onChange={(e) => setDraft({ ...draft, display_name: e.target.value })}
            />
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
            <button className="btn-primary w-full" onClick={add} disabled={!draft.display_name}>
              Save
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {filtered.length === 0 && players.length > 0 && (
          <div className="card p-6 text-center text-cream-100/55 text-sm">
            No players match &ldquo;{query}&rdquo;.
          </div>
        )}
        {players.length === 0 && (
          <div className="card p-6 text-center text-cream-100/65 text-sm">
            No players yet.{" "}
            <button className="text-gold-400 underline" onClick={() => setAdding(true)}>
              Add your first player
            </button>
            .
          </div>
        )}
        {filtered.map((p) => {
          const isMe = !!(currentUserId && p.profile_id === currentUserId);
          const archived = !!p.deleted_at;
          return (
            <PlayerRow
              key={p.id}
              player={p}
              isMe={isMe}
              archived={archived}
              menuOpen={openMenuFor === p.id}
              onToggleMenu={() =>
                setOpenMenuFor((cur) => (cur === p.id ? null : p.id))
              }
              onUpdate={(patch) => update(p, patch)}
              onArchive={() => archive(p)}
              onUnarchive={() => unarchive(p)}
              onHardDelete={() => hardDelete(p)}
            />
          );
        })}
      </div>
    </div>
  );
}

function PlayerRow({
  player: p,
  isMe,
  archived,
  menuOpen,
  onToggleMenu,
  onUpdate,
  onArchive,
  onUnarchive,
  onHardDelete
}: {
  player: Player;
  isMe: boolean;
  archived: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onUpdate: (patch: Partial<Player>) => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onHardDelete: () => void;
}) {
  const hiInputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div
      // When the overflow menu is open, hoist this row's stacking context
      // above its siblings so the dropdown isn't covered by the next card.
      // Without this, sibling cards rendered later in the DOM win and the
      // menu disappears under them on mobile.
      className={`card p-4 relative ${menuOpen ? "z-40" : ""} ${
        archived ? "opacity-60" : ""
      } ${isMe ? "border border-gold-500/30" : ""}`}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap">
        {/* Identity column */}
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate text-cream-50 flex items-center gap-2 flex-wrap">
            <Link href={`/players/${p.id}/stats`} className="hover:underline">
              {p.display_name}
            </Link>
            {isMe && (
              <span className="pill bg-gold-500 text-brand-900 text-[10px] px-2 py-0.5">You</span>
            )}
            {p.is_guest && <span className="pill-draft text-[10px] px-2 py-0.5">guest</span>}
            {archived && (
              <span className="text-[10px] text-cream-100/55">(archived)</span>
            )}
          </div>
          <div className="text-xs text-cream-100/55 mt-0.5">
            HI {formatHi(p.handicap_index)}
            {p.ghin_number ? ` · GHIN ${p.ghin_number}` : ""}
            {p.email ? ` · ${p.email}` : ""}
          </div>
        </div>

        {/* Actions row — wraps under name on tight phones, sits inline on desktop */}
        <div className="flex items-center gap-2 ml-auto shrink-0">
          <input
            ref={hiInputRef}
            className="input w-20 text-right"
            type="text"
            inputMode="decimal"
            placeholder="+1.4"
            defaultValue={hiInputValue(p.handicap_index)}
            onBlur={(e) => {
              const v = parseHi(e.target.value);
              if (v !== p.handicap_index) onUpdate({ handicap_index: v });
            }}
            aria-label="Handicap Index"
            disabled={archived}
          />
          <Link
            href={`/players/${p.id}/stats`}
            className="btn-ghost text-xs hidden sm:inline-flex"
          >
            Stats
          </Link>
          <div className="relative">
            <button
              type="button"
              className="btn-ghost text-sm px-2 leading-none"
              onClick={(e) => {
                e.stopPropagation();
                onToggleMenu();
              }}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="More actions"
            >
              ⋯
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-full mt-1 z-50 min-w-[12rem] rounded-lg border border-cream-100/15 bg-brand-950 shadow-2xl text-sm overflow-hidden"
                role="menu"
                onClick={(e) => e.stopPropagation()}
              >
                <Link
                  href={`/players/${p.id}/stats`}
                  className="block px-3 py-2 text-cream-50 hover:bg-brand-900 sm:hidden"
                >
                  View stats
                </Link>
                {archived ? (
                  <button
                    type="button"
                    onClick={onUnarchive}
                    className="block w-full text-left px-3 py-2 text-emerald-300 hover:bg-brand-900"
                    role="menuitem"
                  >
                    Unarchive
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={onArchive}
                      className="block w-full text-left px-3 py-2 text-cream-100/85 hover:bg-brand-900"
                      role="menuitem"
                    >
                      Archive
                    </button>
                    <button
                      type="button"
                      onClick={onHardDelete}
                      className="block w-full text-left px-3 py-2 text-red-300 hover:bg-brand-900"
                      role="menuitem"
                    >
                      Delete permanently
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
