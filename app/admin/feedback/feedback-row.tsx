"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUSES = ["new", "reviewing", "planned", "in_progress", "shipped", "declined"] as const;
type Status = (typeof STATUSES)[number];

export function FeedbackRow({
  id,
  kind,
  body,
  status,
  admin_notes,
  email,
  display_name,
  created_at,
  round_id,
  group_id,
  user_agent,
  app_version
}: {
  id: string;
  kind: string;
  body: string;
  status: Status;
  admin_notes: string | null;
  email: string | null;
  display_name: string | null;
  created_at: string;
  round_id: string | null;
  group_id: string | null;
  user_agent: string | null;
  app_version: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState(admin_notes ?? "");

  async function update(patch: { status?: Status; admin_notes?: string }) {
    setBusy(true);
    const res = await fetch(`/api/admin/feedback/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch)
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-cream-100/55">
            <span className="uppercase tracking-wider">{kind}</span>
            <span>·</span>
            <span>{display_name ?? email ?? "anonymous"}</span>
            <span>·</span>
            <span className="tabular-nums">{new Date(created_at).toLocaleString()}</span>
          </div>
          <p className="text-cream-50 mt-1 whitespace-pre-wrap text-sm">{body}</p>
        </div>
        <select
          className="input text-xs w-auto"
          value={status}
          onChange={(e) => update({ status: e.target.value as Status })}
          disabled={busy}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace("_", " ")}</option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] text-cream-100/55 hover:text-cream-100"
      >
        {open ? "Hide details" : "More details / admin notes"}
      </button>

      {open && (
        <div className="space-y-2 border-t border-cream-100/8 pt-3">
          <div className="grid grid-cols-2 gap-2 text-[11px] text-cream-100/65">
            <div>
              <div className="text-cream-100/45 uppercase tracking-wider">Round</div>
              <div className="font-mono break-all">{round_id ?? "—"}</div>
            </div>
            <div>
              <div className="text-cream-100/45 uppercase tracking-wider">Group</div>
              <div className="font-mono break-all">{group_id ?? "—"}</div>
            </div>
            <div className="col-span-2">
              <div className="text-cream-100/45 uppercase tracking-wider">Build</div>
              <div className="font-mono break-all">{app_version ?? "—"}</div>
            </div>
            <div className="col-span-2">
              <div className="text-cream-100/45 uppercase tracking-wider">User agent</div>
              <div className="font-mono break-all">{user_agent ?? "—"}</div>
            </div>
          </div>
          <div>
            <label className="label text-xs">Admin notes</label>
            <textarea
              className="input text-sm min-h-[60px]"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => {
                if (notes !== (admin_notes ?? "")) update({ admin_notes: notes });
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
