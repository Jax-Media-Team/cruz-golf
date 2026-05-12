"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";

export type VerificationStatus =
  | "verified"
  | "community"
  | "needs_review"
  | "placeholder";

type Template = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  tee_count: number;
  verification_status?: VerificationStatus;
};

/**
 * Library entry for a cross-group course template. Visual treatment varies
 * by verification status:
 *
 *  - verified:     subtle gold "Verified" pill + Clone button enabled
 *  - community:    "Community" pill + Clone button enabled
 *  - needs_review: amber "Needs review" pill + Clone disabled with hint
 *  - placeholder:  muted "Awaiting scorecard" pill + an "Help us verify"
 *                  link to scorecard import. NEVER cloneable —
 *                  fn_clone_course rejects placeholders server-side too.
 *
 * Tone discipline carries over from clubhouse work — pills are calm,
 * statements not exclamations, no big "VERIFIED!!!" shouts.
 */
export function TemplateCard({ template }: { template: Template }) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const status = template.verification_status ?? "community";
  const isPlaceholder = status === "placeholder";
  const isCloneable = !isPlaceholder && template.tee_count > 0;

  async function clone() {
    setBusy(true);
    setErr(null);
    const { data, error } = await sb.rpc("fn_clone_course", {
      p_source_course_id: template.id
    });
    setBusy(false);
    if (error) {
      setErr(friendlyAuthError(error));
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
    <div className="card p-4 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-cream-50 truncate">
            {template.name}
          </span>
          <VerificationPill status={status} />
        </div>
        <div className="text-xs text-cream-100/55 mt-0.5">
          {[template.city, template.state].filter(Boolean).join(", ")}
          {(template.city || template.state) && !isPlaceholder ? " · " : ""}
          {!isPlaceholder && (
            <>
              {template.tee_count} tee{template.tee_count === 1 ? "" : "s"}
            </>
          )}
          {isPlaceholder && (
            <span>Scorecard data not yet on file</span>
          )}
        </div>
        {err && <p className="text-xs text-red-300 mt-1">{err}</p>}
      </div>
      {isPlaceholder ? (
        <Link
          href="/courses/import"
          className="btn-ghost text-xs whitespace-nowrap"
          title="Snap a photo of this course's scorecard to help us verify it"
        >
          📷 Help verify →
        </Link>
      ) : (
        <button
          type="button"
          onClick={clone}
          disabled={busy || !isCloneable}
          className="btn-secondary text-xs whitespace-nowrap"
          title={
            isCloneable
              ? "Add a copy of this course to your group"
              : "This course is missing tee data — help us add it"
          }
        >
          {busy ? "Cloning…" : "Clone into my group →"}
        </button>
      )}
    </div>
  );
}

function VerificationPill({ status }: { status: VerificationStatus }) {
  switch (status) {
    case "verified":
      return (
        <span className="pill bg-gold-500/15 text-gold-400 text-[10px] px-2 py-0.5 ring-1 ring-gold-500/30">
          Verified
        </span>
      );
    case "community":
      return (
        <span className="pill bg-cream-100/10 text-cream-100/75 text-[10px] px-2 py-0.5 ring-1 ring-cream-100/15">
          Community
        </span>
      );
    case "needs_review":
      return (
        <span className="pill bg-amber-500/15 text-amber-200 text-[10px] px-2 py-0.5 ring-1 ring-amber-400/30">
          Needs review
        </span>
      );
    case "placeholder":
    default:
      return (
        <span className="pill bg-cream-100/8 text-cream-100/55 text-[10px] px-2 py-0.5 ring-1 ring-cream-100/15">
          Awaiting scorecard
        </span>
      );
  }
}
