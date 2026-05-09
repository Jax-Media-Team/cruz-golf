"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";

const KIND_OPTIONS: Array<{ value: string; label: string; placeholder: string }> = [
  { value: "feature", label: "Feature request", placeholder: "What would make Cruz Golf better for you?" },
  { value: "game", label: "Missing game format", placeholder: "Wolf, Vegas, Hammer, Stableford…" },
  { value: "bug", label: "Bug report", placeholder: "What broke? What were you doing when it broke?" },
  { value: "scoring", label: "Scoring / math issue", placeholder: "What did you expect vs what you got?" },
  { value: "course", label: "Course data issue", placeholder: "Wrong stroke index, missing tee, etc." },
  { value: "other", label: "Other / general feedback", placeholder: "" }
];

export function FeedbackForm({
  userEmail,
  defaultKind,
  defaultRoundId
}: {
  userEmail: string;
  defaultKind: string;
  defaultRoundId: string | null;
}) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [kind, setKind] = useState(defaultKind || "feature");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !body.trim()) return;
    setBusy(true);
    setErr(null);
    const { data: u } = await sb.auth.getUser();
    const { data: groups } = await sb.from("groups").select("id").limit(1);
    const groupId = groups?.[0]?.id ?? null;
    const { error } = await sb.from("feedback").insert({
      profile_id: u.user?.id,
      email: userEmail || null,
      kind,
      body: body.trim(),
      round_id: defaultRoundId,
      group_id: groupId,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      app_version: process.env.NEXT_PUBLIC_BUILD_ID ?? null
    });
    setBusy(false);
    if (error) {
      setErr(friendlyAuthError(error));
      return;
    }
    setBody("");
    setDone(true);
    router.refresh();
  }

  if (done) {
    return (
      <div className="card p-6 text-center space-y-3">
        <div className="mx-auto w-10 h-10 rounded-full bg-emerald-500/15 ring-1 ring-emerald-400/40 flex items-center justify-center text-emerald-300 text-xl">
          ✓
        </div>
        <p className="text-cream-50 font-medium">Sent. Thanks.</p>
        <p className="text-xs text-cream-100/55">
          You can submit another below or come back any time.
        </p>
        <button
          type="button"
          onClick={() => setDone(false)}
          className="btn-secondary text-sm"
        >
          Submit another
        </button>
      </div>
    );
  }

  const opt = KIND_OPTIONS.find((o) => o.value === kind) ?? KIND_OPTIONS[0];

  return (
    <form onSubmit={submit} className="card p-4 space-y-3">
      <div>
        <label className="label">Kind</label>
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Details</label>
        <textarea
          className="input min-h-[120px] resize-y"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={opt.placeholder}
          maxLength={5000}
          required
        />
        <p className="text-[10px] text-cream-100/45 mt-1">{body.length} / 5000</p>
      </div>
      {err && <p className="text-sm text-red-300">{err}</p>}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-cream-100/55">
          Submitting as <span className="text-cream-50">{userEmail}</span>
        </p>
        <button type="submit" className="btn-primary" disabled={busy || !body.trim()}>
          {busy ? "Sending…" : "Send to Cruz Golf"}
        </button>
      </div>
    </form>
  );
}
