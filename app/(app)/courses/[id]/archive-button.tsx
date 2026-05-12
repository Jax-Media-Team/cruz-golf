"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";

/**
 * Commissioner / Platform-admin Archive / Restore for a course.
 *
 * Archive is soft (sets deleted_at). Hidden from /courses by default;
 * still queryable for round history. Restore reverses it.
 *
 * No hard delete in this UI — preserves round history. If a course
 * absolutely must be hard-deleted, do it through Supabase or admin tools.
 */
export function CourseArchiveButton({
  courseId,
  isArchived
}: {
  courseId: string;
  isArchived: boolean;
}) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function archive() {
    if (!confirm("Archive this course? It'll disappear from your courses list but rounds/stats stay intact. You can restore it from /courses?archived=1.")) return;
    setBusy(true);
    setErr(null);
    const { error } = await sb.rpc("fn_archive_course", { p_course_id: courseId });
    setBusy(false);
    if (error) {
      setErr(friendlyAuthError(error));
      return;
    }
    router.push("/courses");
    router.refresh();
  }

  async function restore() {
    setBusy(true);
    setErr(null);
    const { error } = await sb.rpc("fn_restore_course", { p_course_id: courseId });
    setBusy(false);
    if (error) {
      setErr(friendlyAuthError(error));
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      {isArchived ? (
        <button onClick={restore} disabled={busy} className="btn-secondary text-xs">
          {busy ? "Restoring…" : "♻ Restore course"}
        </button>
      ) : (
        <button onClick={archive} disabled={busy} className="btn-ghost text-xs text-red-300">
          {busy ? "Archiving…" : "🗑 Archive course"}
        </button>
      )}
      {err && <span className="text-xs text-red-300">{err}</span>}
    </div>
  );
}
