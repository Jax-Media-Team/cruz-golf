"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Invite = {
  id: string;
  intended_for_name: string;
  intended_email: string | null;
  token: string;
  redeemed_at: string | null;
  expires_at: string | null;
  created_at: string;
};

export function InvitesClient({
  roundId,
  initialInvites,
  suggestedNames
}: {
  roundId: string;
  initialInvites: Invite[];
  suggestedNames: string[];
}) {
  const sb = supabaseBrowser();
  const [invites, setInvites] = useState<Invite[]>(initialInvites);
  const [draft, setDraft] = useState<{ name: string; email: string }>({ name: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    if (!draft.name.trim()) return;
    setBusy(true);
    setErr(null);
    const { data, error } = await sb
      .from("round_invites")
      .insert({
        round_id: roundId,
        intended_for_name: draft.name.trim(),
        intended_email: draft.email.trim() || null
      })
      .select("*")
      .single();
    setBusy(false);
    if (error || !data) {
      setErr(error?.message ?? "Could not create invite");
      return;
    }
    setInvites((arr) => [data as Invite, ...arr]);
    setDraft({ name: "", email: "" });
  }

  async function revoke(inv: Invite) {
    if (!confirm(`Revoke invite for ${inv.intended_for_name}?`)) return;
    const { error } = await sb.from("round_invites").delete().eq("id", inv.id);
    if (error) return alert(error.message);
    setInvites((arr) => arr.filter((x) => x.id !== inv.id));
  }

  function urlFor(inv: Invite) {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/rounds/${roundId}/join?invite=${encodeURIComponent(inv.token)}`;
  }

  function copyShare(inv: Invite) {
    const url = urlFor(inv);
    const msg = `Cruz Golf — you're in.\nTap to join the round (one-time link, just for you):\n${url}`;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(msg);
      alert("Invite copied — paste it to them in iMessage / WhatsApp.");
    }
  }

  function smsHref(inv: Invite) {
    const url = urlFor(inv);
    const body = encodeURIComponent(`Cruz Golf — tap to join your round: ${url}`);
    return `sms:?&body=${body}`;
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <h2 className="font-serif text-lg text-cream-50">Create a one-time invite</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Their name</label>
            <input
              className="input"
              list="invite-suggestions"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Jeff"
            />
            <datalist id="invite-suggestions">
              {suggestedNames.map((n) => <option key={n} value={n} />)}
            </datalist>
          </div>
          <div>
            <label className="label">Email <span className="text-cream-100/40 normal-case">(optional, locks invite to that email)</span></label>
            <input
              className="input"
              type="email"
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              placeholder="jeff@example.com"
            />
          </div>
        </div>
        {err && <p className="text-sm text-red-300">{err}</p>}
        <button className="btn-primary" disabled={busy || !draft.name.trim()} onClick={create}>
          {busy ? "Creating…" : "Create invite"}
        </button>
      </div>

      <div className="space-y-2">
        {invites.length === 0 && <p className="text-sm text-cream-100/55">No invites yet.</p>}
        {invites.map((inv) => {
          const used = !!inv.redeemed_at;
          return (
            <div key={inv.id} className={`card p-4 ${used ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-cream-50 truncate">{inv.intended_for_name}</div>
                  <div className="text-xs text-cream-100/55 mt-0.5">
                    {inv.intended_email ? `Locked to ${inv.intended_email}` : "Open to anyone with the link"} ·
                    {used ? " redeemed" : " unused"}
                  </div>
                </div>
                {!used && (
                  <button className="btn-ghost text-xs text-red-300" onClick={() => revoke(inv)}>Revoke</button>
                )}
              </div>
              {!used && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="btn-secondary text-xs" onClick={() => copyShare(inv)}>Copy invite</button>
                  <a className="btn-secondary text-xs" href={smsHref(inv)}>Text it</a>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
