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

type LinkCandidate = {
  player_id: string;
  player_name: string;
  player_email: string;
  candidate_user_id: string;
  candidate_user_email: string;
};

export function PlayersClient({
  initialPlayers,
  groupId,
  currentUserId,
  showArchived,
  linkCandidates = []
}: {
  initialPlayers: Player[];
  groupId: string | null;
  currentUserId: string | null;
  showArchived: boolean;
  linkCandidates?: LinkCandidate[];
}) {
  const [players, setPlayers] = useState(initialPlayers);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<Player>>({});
  const [query, setQuery] = useState("");
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState<string | null>(null);
  const [linkErr, setLinkErr] = useState<{ id: string; msg: string } | null>(null);
  // Surface action failures (add / update / archive / unarchive / delete)
  // inline instead of via native alert() — alerts feel jarring on the
  // installed PWA, dismissable banner matches the rest of the app.
  const [actionErr, setActionErr] = useState<string | null>(null);
  const sb = supabaseBrowser();
  const router = useRouter();

  // Map player_id -> candidate (first one wins; multiple matches are rare).
  const candidateByPlayer = useMemo(() => {
    const m = new Map<string, LinkCandidate>();
    for (const c of linkCandidates) if (!m.has(c.player_id)) m.set(c.player_id, c);
    return m;
  }, [linkCandidates]);

  async function linkPlayerToProfile(p: Player, c: LinkCandidate) {
    if (!confirm(
      `Link ${p.display_name} to the account ${c.candidate_user_email}? This stops them being a guest and connects their round history to that account.`
    )) return;
    setLinkBusy(p.id);
    setLinkErr(null);
    const { error } = await sb.rpc("fn_link_guest_to_profile", {
      p_guest_player_id: p.id,
      p_profile_id: c.candidate_user_id
    });
    setLinkBusy(null);
    if (error) {
      setLinkErr({ id: p.id, msg: error.message });
      return;
    }
    setPlayers((arr) =>
      arr.map((x) =>
        x.id === p.id ? { ...x, is_guest: false, profile_id: c.candidate_user_id } : x
      )
    );
    router.refresh();
  }

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
    setActionErr(null);
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
      setActionErr(`Couldn't add player: ${error.message}`);
      return;
    }
    if (data) setPlayers((p) => [...p, data]);
    setDraft({});
    setAdding(false);
  }

  async function update(p: Player, patch: Partial<Player>) {
    setActionErr(null);
    const { error } = await sb.from("players").update(patch).eq("id", p.id);
    if (error) {
      setActionErr(`Couldn't update ${p.display_name}: ${error.message}`);
      return;
    }
    setPlayers((arr) => arr.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));
  }

  async function archive(p: Player) {
    if (!confirm(`Archive ${p.display_name}? They'll stay on past rounds and stats but won't show up in your default player list.`)) return;
    setActionErr(null);
    const { error } = await sb.from("players").update({ deleted_at: new Date().toISOString() }).eq("id", p.id);
    if (error) {
      setActionErr(`Couldn't archive ${p.display_name}: ${error.message}`);
      return;
    }
    if (showArchived) {
      setPlayers((arr) => arr.map((x) => (x.id === p.id ? { ...x, deleted_at: new Date().toISOString() } : x)));
    } else {
      setPlayers((arr) => arr.filter((x) => x.id !== p.id));
    }
  }

  async function unarchive(p: Player) {
    setActionErr(null);
    const { error } = await sb.from("players").update({ deleted_at: null }).eq("id", p.id);
    if (error) {
      setActionErr(`Couldn't restore ${p.display_name}: ${error.message}`);
      return;
    }
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
    setActionErr(null);
    const { error } = await sb.from("players").delete().eq("id", p.id);
    if (error) {
      // Likely FK violation — they have round_players rows. Fall back to archive
      // automatically so the user's intent (get this player out of my list) is
      // honored without a confusing second confirmation.
      setActionErr(
        `Couldn't delete ${p.display_name} — they have round history. Archived instead.`
      );
      return archive(p);
    }
    setPlayers((arr) => arr.filter((x) => x.id !== p.id));
  }

  const totalActive = players.filter((p) => !p.deleted_at).length;
  const totalArchived = players.filter((p) => !!p.deleted_at).length;

  return (
    <div className="space-y-4">
      {actionErr && (
        <div
          className="card p-3 border border-red-400/40 bg-red-500/10 flex items-start justify-between gap-3"
          role="status"
          aria-live="polite"
        >
          <p className="text-sm text-red-200 break-words flex-1 min-w-0">
            {actionErr}
          </p>
          <button
            type="button"
            onClick={() => setActionErr(null)}
            className="text-xs text-red-200/70 hover:text-red-100 shrink-0"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
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
        <div className="card p-4 space-y-3">
          <p className="text-[11px] text-cream-100/55">
            <span className="text-cream-50">Required:</span> Full name + Handicap Index. Everything else is optional and never auto-sends invites or messages.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="label">
                Full name <span className="text-red-300 normal-case">*required</span>
              </label>
              <input
                className="input"
                autoFocus
                placeholder="e.g. Jeff Marshall"
                value={draft.display_name ?? ""}
                onChange={(e) => setDraft({ ...draft, display_name: e.target.value })}
              />
            </div>
            <div>
              <label className="label">
                Handicap Index <span className="text-red-300 normal-case">*required</span>
              </label>
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
              <label className="label">
                GHIN # <span className="text-cream-100/45 normal-case">optional</span>
              </label>
              <input className="input" placeholder="optional" value={draft.ghin_number ?? ""} onChange={(e) => setDraft({ ...draft, ghin_number: e.target.value })} />
            </div>
            <div>
              <label className="label">
                Email <span className="text-cream-100/45 normal-case">optional</span>
              </label>
              <input
                className="input"
                type="email"
                placeholder="optional"
                value={draft.email ?? ""}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              />
              <p className="text-[10px] text-cream-100/45 mt-0.5">
                We won&apos;t email anyone. Used to auto-link this player to their
                account if they sign up later.
              </p>
            </div>
            <div>
              <label className="label">
                Phone <span className="text-cream-100/45 normal-case">optional</span>
              </label>
              <input
                className="input"
                type="tel"
                placeholder="optional"
                value={draft.phone ?? ""}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              />
              <p className="text-[10px] text-cream-100/45 mt-0.5">
                We won&apos;t text. Just for your reference.
              </p>
            </div>
            <label className="flex items-center gap-2 sm:col-span-2 text-sm">
              <input type="checkbox" checked={!!draft.is_guest} onChange={(e) => setDraft({ ...draft, is_guest: e.target.checked })} />
              <span>
                Guest (no account, no invite)
                <span className="block text-[10px] text-cream-100/55">
                  Default for someone who&apos;s playing in your group but won&apos;t score on their own phone. They can &ldquo;claim&rdquo; the player later by signing up with the same email.
                </span>
              </span>
            </label>
          </div>
          <div className="flex gap-2">
            <button
              className="btn-primary flex-1"
              onClick={add}
              disabled={!draft.display_name || draft.handicap_index == null}
            >
              Save player
            </button>
            <button
              className="btn-ghost"
              onClick={() => {
                setDraft({});
                setAdding(false);
              }}
            >
              Cancel
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
          <div className="card p-6 sm:p-8 text-center text-cream-100/75 space-y-3">
            <p className="font-serif text-lg text-cream-50">
              Your roster lives here.
            </p>
            <p className="text-xs text-cream-100/65 leading-relaxed max-w-md mx-auto">
              Players unlock the rest of the app — rivalries, partner records,
              career money, hole mastery, per-player stat pages. Add your
              regulars once and they show up on every round invite, every
              leaderboard, every record book.
            </p>
            <div className="pt-1">
              <button
                className="btn-primary text-sm"
                onClick={() => setAdding(true)}
              >
                Add your first player →
              </button>
            </div>
            <p className="text-[11px] text-cream-100/45 leading-snug">
              Tip: add players as guests now; they can claim their account
              later and inherit every round you scored for them.
            </p>
          </div>
        )}
        {filtered.map((p) => {
          const isMe = !!(currentUserId && p.profile_id === currentUserId);
          const archived = !!p.deleted_at;
          const candidate = candidateByPlayer.get(p.id) ?? null;
          const rowLinkBusy = linkBusy === p.id;
          const rowLinkErr = linkErr?.id === p.id ? linkErr.msg : null;
          return (
            <div key={p.id}>
              <PlayerRow
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
              {/* Suggest linking when this guest's email matches a real user. */}
              {candidate && !archived && (
                <div className="card mt-1 p-3 border border-emerald-400/30 bg-emerald-500/5 flex items-center justify-between gap-3">
                  <div className="text-xs text-cream-100/80">
                    <span className="text-cream-50 font-medium">{p.display_name}</span>{" "}
                    looks like the same person as account{" "}
                    <span className="text-cream-50">{candidate.candidate_user_email}</span>
                    . Linking preserves their round history.
                  </div>
                  <button
                    type="button"
                    className="btn-secondary text-xs whitespace-nowrap disabled:opacity-50"
                    disabled={rowLinkBusy}
                    onClick={() => linkPlayerToProfile(p, candidate)}
                  >
                    {rowLinkBusy ? "Linking…" : "🔗 Link to account"}
                  </button>
                </div>
              )}
              {rowLinkErr && (
                <div className="card mt-1 p-2 border border-red-400/40 bg-red-500/10 text-xs text-red-200">
                  {rowLinkErr}
                </div>
              )}
            </div>
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
                    {/* Hard-delete temporarily disabled in the UI (P0
                        safety, 2026-05-10). Use /admin/users → individual
                        user → "Delete permanently" if absolutely needed. */}
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
