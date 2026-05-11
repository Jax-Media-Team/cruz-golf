import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import {
  loadRecords,
  roundLabelOf,
  lowestGross18,
  highestGross18,
  lowestGross9,
  biggestWins,
  biggestLosses,
  mostBirdiesInRound,
  mostRoundsPlayed
} from "@/lib/records";
import { RecordCard } from "@/components/RecordCard";
import { RecordsScopeNav } from "@/components/RecordsScopeNav";

/**
 * Course record book — every finalized round in YOUR group played at this
 * specific course. Privacy: scoped to your group only, never strangers'
 * rounds. The course can be a normal group course OR a clone of a
 * platform template — either way, the records are limited to your group.
 *
 * Future: a "platform-wide course leaderboard" would need an explicit
 * opt-in (e.g. `rounds.share_to_course_records boolean`) before we'd
 * surface other groups' rounds here. Intentionally private for now.
 */
export const dynamic = "force-dynamic";

export default async function CourseRecordsPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: courseId } = await params;
  const sb = await supabaseServer();
  const {
    data: { user }
  } = await sb.auth.getUser();
  if (!user) redirect(`/login?next=/records/course/${courseId}`);

  const { data: groups } = await sb.from("groups").select("id, name").limit(1);
  if (!groups || groups.length === 0) redirect("/onboarding");
  const group = groups[0];

  // Course must exist (and be visible to the user — RLS already gates this).
  const { data: course } = await sb
    .from("courses")
    .select("id, name, city, state, group_id, is_template")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) notFound();

  const { data: myPlayer } = await sb
    .from("players")
    .select("id")
    .eq("group_id", group.id)
    .eq("profile_id", user.id)
    .maybeSingle();

  const bundle = await loadRecords(sb, group.id, { courseId });
  const labelByRound = roundLabelOf(bundle.roundsById);
  const totalRounds = bundle.rounds.length;

  return (
    <div className="space-y-5">
      <header>
        <p className="h-eyebrow text-gold-400">{course.name}</p>
        <h1 className="h-display text-3xl text-cream-50 mt-1">Course record book</h1>
        <p className="text-xs text-cream-100/55 mt-1">
          {[course.city, course.state].filter(Boolean).join(", ") || "Course"} · your
          group only · {totalRounds.toLocaleString()} round{totalRounds === 1 ? "" : "s"}
        </p>
      </header>

      <RecordsScopeNav
        active="course"
        myPlayerId={myPlayer?.id ?? null}
        courseId={course.id}
        courseName={course.name}
      />

      {totalRounds === 0 ? (
        <div className="card p-8 text-center text-cream-100/65 space-y-2">
          <p>No finalized rounds at {course.name} yet.</p>
          <p className="text-xs text-cream-100/55">
            Once your group settles a round here it&apos;ll show up. Want to play here?{" "}
            <Link href={`/courses/${course.id}`} className="text-gold-400 underline">
              Course setup →
            </Link>
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <RecordCard
            title="Course record (18 holes)"
            rows={lowestGross18(bundle.perfs, labelByRound).slice(0, 1)}
            emptyMessage="No 18-hole rounds at this course yet."
          />
          <RecordCard
            title="Course record (9 holes)"
            rows={lowestGross9(bundle.perfs, labelByRound).slice(0, 1)}
            emptyMessage="No 9-hole rounds at this course yet."
          />
          <RecordCard title="Top 18-hole scores" rows={lowestGross18(bundle.perfs, labelByRound)} />
          <RecordCard title="Highest 18-hole gross" rows={highestGross18(bundle.perfs, labelByRound)} />
          <RecordCard
            title="Most birdies in a round here"
            rows={mostBirdiesInRound(bundle.perfs, labelByRound)}
            emptyMessage="No birdies recorded yet."
          />
          <RecordCard title="Most rounds played here" rows={mostRoundsPlayed(bundle.perfs)} />
          <RecordCard
            title="Biggest single-round wins"
            rows={biggestWins(bundle.perfs, bundle.moneyByRp, labelByRound)}
            emptyMessage="No winning rounds yet."
          />
          <RecordCard
            title="Biggest single-round losses"
            rows={biggestLosses(bundle.perfs, bundle.moneyByRp, labelByRound)}
            emptyMessage="No losing rounds yet."
          />
        </div>
      )}

      <p className="text-[11px] text-cream-100/55">
        Course records are scoped to your group&apos;s rounds. Cross-group leaderboards
        will be opt-in when they ship.
      </p>
    </div>
  );
}
