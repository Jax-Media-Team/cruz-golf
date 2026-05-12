import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { UploadView } from "./upload-view";
import { RoundBreadcrumb } from "@/components/RoundBreadcrumb";
// Force dynamic rendering. Without this, Next.js 15 can statically
// prerender this server component at build time with no auth cookie
// — every Supabase fetch returns empty under RLS, the page renders
// empty, and the user sees a stale or blank surface. Critical fix
// (Patrick 2026-05-12: 'All my past rounds are empty').
export const dynamic = "force-dynamic";

export default async function UploadCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: round } = await sb
    .from("rounds")
    .select(
      "id, holes, status, date, courses(name), round_players(id, players(display_name), course_tees(course_holes(hole_number, par))), course_id"
    )
    .eq("id", id)
    .single();
  if (!round) redirect("/dashboard");
  const players = (round.round_players ?? []).map((rp: any) => ({
    round_player_id: rp.id,
    name: rp.players?.display_name ?? "Player"
  }));

  // Per-hole pars — used by the upload review grid to flag scores that
  // are wildly off par as "suspicious" (red ring + funneled into the
  // Review-suspicious bulk action). Falls back to par 4 for any hole
  // we can't resolve so a single missing row doesn't break validation.
  const totalHoles = (round.holes as 9 | 18) ?? 18;
  const firstTee = (round.round_players ?? []).find(
    (rp: any) => (rp.course_tees as any)?.course_holes?.length > 0
  );
  const holeRows = ((firstTee as any)?.course_tees?.course_holes ?? [])
    .slice()
    .sort((a: any, b: any) => a.hole_number - b.hole_number);
  const holePars: number[] = [];
  for (let i = 1; i <= totalHoles; i++) {
    const match = holeRows.find((h: any) => h.hole_number === i);
    holePars.push(match?.par ?? 4);
  }

  return (
    <div className="space-y-3">
      <RoundBreadcrumb
        roundId={id}
        courseName={(round as any).courses?.name ?? null}
        date={(round as any).date}
        status={(round as any).status}
        page="Upload card photo"
      />
      <UploadView
        roundId={id}
        holes={totalHoles}
        players={players}
        holePars={holePars}
      />
    </div>
  );
}
