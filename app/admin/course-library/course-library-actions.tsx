"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

type Status = "verified" | "community" | "needs_review" | "placeholder";

/**
 * Per-row moderation actions for /admin/course-library.
 *
 * Verified ← → Needs review ← → Community ← → Placeholder
 *
 * Promotion to "verified" requires the course to have at least one tee
 * with at least one hole — we refuse to promote an empty course because
 * users would clone it into broken rounds. The server-side
 * fn_clone_course already refuses placeholder clones, but this client-
 * side gate stops the promotion happening in the first place.
 *
 * The "Drop template flag" action removes is_template=true so the
 * course stops appearing in the library. Useful when a poor-quality
 * community submission slipped through — drop the flag, ask the
 * submitter to refine, re-promote later.
 */
export function CourseLibraryActions({
  courseId,
  currentStatus,
  isTemplate,
  hasData
}: {
  courseId: string;
  currentStatus: string;
  isTemplate: boolean;
  hasData: boolean;
}) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function setStatus(next: Status) {
    if (next === "verified" && !hasData) {
      setErr("Course has no tees / holes — can't promote to verified");
      return;
    }
    setBusy(true);
    setErr(null);
    const { error } = await sb.rpc("fn_set_course_verification", {
      p_course_id: courseId,
      p_status: next
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    router.refresh();
  }

  async function dropTemplateFlag() {
    if (
      !confirm(
        "Remove this course from the public library? It'll stop appearing on /courses for everyone outside its source group. Course history is preserved. You can re-promote later."
      )
    )
      return;
    setBusy(true);
    setErr(null);
    const { error } = await sb.rpc("fn_set_course_template", {
      p_course_id: courseId,
      p_is_template: false
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="inline-flex flex-wrap items-center gap-1 justify-end">
      {currentStatus !== "verified" && (
        <button
          type="button"
          disabled={busy || !hasData}
          onClick={() => setStatus("verified")}
          className="btn-ghost text-[11px] disabled:opacity-50"
          title={
            hasData
              ? "Promote — admin-verified, complete data"
              : "No tees/holes yet; add data before promoting"
          }
        >
          {busy ? "…" : "Verify"}
        </button>
      )}
      {currentStatus !== "needs_review" && (
        <button
          type="button"
          disabled={busy}
          onClick={() => setStatus("needs_review")}
          className="btn-ghost text-[11px]"
          title="Flag for review — surfaces in the Needs review bucket above"
        >
          Flag
        </button>
      )}
      {currentStatus !== "community" && (
        <button
          type="button"
          disabled={busy}
          onClick={() => setStatus("community")}
          className="btn-ghost text-[11px]"
          title="Demote to community — user-submitted, unmoderated"
        >
          Community
        </button>
      )}
      {currentStatus !== "placeholder" && (
        <button
          type="button"
          disabled={busy}
          onClick={() => setStatus("placeholder")}
          className="btn-ghost text-[11px]"
          title="Demote to placeholder — name only, not cloneable"
        >
          Placeholder
        </button>
      )}
      {isTemplate && (
        <button
          type="button"
          disabled={busy}
          onClick={dropTemplateFlag}
          className="btn-ghost text-[11px] text-red-300"
          title="Remove the is_template flag — course leaves the public library"
        >
          Untemplate
        </button>
      )}
      {err && <span className="text-[10px] text-red-300 ml-1">{err}</span>}
    </div>
  );
}
