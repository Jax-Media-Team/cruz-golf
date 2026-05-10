"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

type Template = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  tee_count: number;
};

export function TemplateCard({ template }: { template: Template }) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function clone() {
    setBusy(true);
    setErr(null);
    const { data, error } = await sb.rpc("fn_clone_course", {
      p_source_course_id: template.id
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    if (typeof data === "string") {
      router.push(`/courses/${data}`);
      router.refresh();
    } else {
      router.refresh();
    }
  }

  return (
    <div className="card p-4 flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-cream-50 truncate">
            {template.name}
          </span>
          <span className="pill bg-gold-500/20 text-gold-400 text-[10px] px-2 py-0.5 ring-1 ring-gold-500/40">
            Template
          </span>
        </div>
        <div className="text-xs text-cream-100/55 mt-0.5">
          {[template.city, template.state].filter(Boolean).join(", ")}
          {template.city || template.state ? " · " : ""}
          {template.tee_count} tee{template.tee_count === 1 ? "" : "s"}
        </div>
        {err && <p className="text-xs text-red-300 mt-1">{err}</p>}
      </div>
      <button
        type="button"
        onClick={clone}
        disabled={busy}
        className="btn-secondary text-xs whitespace-nowrap"
      >
        {busy ? "Cloning…" : "Clone into my group →"}
      </button>
    </div>
  );
}
