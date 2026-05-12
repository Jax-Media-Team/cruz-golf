"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";
import { cleanHandle, cleanUrl } from "@/lib/profile-format";

type Initial = {
  display_name: string;
  email: string | null;
  phone: string | null;
  ghin_number: string | null;
  handicap_index: number | null;
  venmo_handle: string | null;
  avatar_url: string | null;
  default_tee_name?: string | null;
  // Social profile fields. All optional, free-form text — surfaced on
  // /players/[id]/stats below the Venmo block. Per Patrick 2026-05-12:
  // group-private personal expression, not discovery. No cross-group
  // bleeding, no public timeline. (Migration 0046.)
  ig_handle?: string | null;
  x_handle?: string | null;
  website_url?: string | null;
  bio_line?: string | null;
};

const TEE_OPTIONS = ["Black", "Blue", "White", "Gold", "Red", "Green", "Tournament", "Senior"];

export function PlayerProfileEditor({ playerId, initial }: { playerId: string; initial: Initial }) {
  const router = useRouter();
  const sb = supabaseBrowser();
  const [draft, setDraft] = useState<Initial>(initial);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // cleanHandle / cleanUrl are now imported from @/lib/profile-format
  // — see that file for the regression-tested btrim-style normalization
  // (matches migration 0046's DB trigger exactly).

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
        venmo_handle: cleanHandle(draft.venmo_handle),
        avatar_url: draft.avatar_url || null,
        default_tee_name: draft.default_tee_name || null,
        ig_handle: cleanHandle(draft.ig_handle),
        x_handle: cleanHandle(draft.x_handle),
        website_url: cleanUrl(draft.website_url),
        bio_line: draft.bio_line?.trim() || null
      })
      .eq("id", playerId);
    setBusy(false);
    if (error) {
      setErr(friendlyAuthError(error));
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
        <div>
          <label className="label">Default tee</label>
          <select
            className="input"
            value={draft.default_tee_name ?? ""}
            onChange={(e) => setDraft({ ...draft, default_tee_name: e.target.value || null })}
          >
            <option value="">— No default —</option>
            {TEE_OPTIONS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <p className="text-[10px] text-cream-100/45 mt-0.5">
            We&apos;ll auto-pick this tee on each course where it exists.
          </p>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Avatar URL <span className="text-cream-100/40 normal-case">(or sign in via Google to auto-fill)</span></label>
          <input className="input" value={draft.avatar_url ?? ""} onChange={(e) => setDraft({ ...draft, avatar_url: e.target.value })} placeholder="https://…" />
        </div>
      </div>

      {/* Social / personal expression. All optional. Surfaced on the
          /players/[id]/stats page below the Venmo block when set.
          Group-private — no public discovery. */}
      <div className="pt-3 border-t border-cream-100/10 space-y-3">
        <div className="flex items-baseline justify-between">
          <p className="h-eyebrow text-cream-100/55">Socials</p>
          <p className="text-[10px] text-cream-100/40">All optional</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Instagram</label>
            <input
              className="input"
              value={draft.ig_handle ?? ""}
              onChange={(e) => setDraft({ ...draft, ig_handle: e.target.value })}
              placeholder="@yourhandle"
            />
          </div>
          <div>
            <label className="label">X (Twitter)</label>
            <input
              className="input"
              value={draft.x_handle ?? ""}
              onChange={(e) => setDraft({ ...draft, x_handle: e.target.value })}
              placeholder="@yourhandle"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Website</label>
            <input
              className="input"
              value={draft.website_url ?? ""}
              onChange={(e) => setDraft({ ...draft, website_url: e.target.value })}
              placeholder="example.com (we&rsquo;ll add https://)"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">One-line bio</label>
            <input
              className="input"
              value={draft.bio_line ?? ""}
              onChange={(e) => setDraft({ ...draft, bio_line: e.target.value })}
              placeholder="e.g. JGCC since 2018 · 8.4 index · all of it for the action on 18"
              maxLength={140}
            />
            <p className="text-[10px] text-cream-100/45 mt-0.5">
              Shows up on your stats page. Max 140 characters.
            </p>
          </div>
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
