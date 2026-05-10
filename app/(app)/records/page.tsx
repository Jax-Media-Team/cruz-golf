import Link from "next/link";
import { redirect } from "next/navigation";
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
  mostRoundsPlayed,
  seasonNetTop
} from "@/lib/records";
import { RecordCard } from "@/components/RecordCard";
import { RecordsScopeNav } from "@/components/RecordsScopeNav";

/**
 * Group / Friends record book — every finalized round in your group, every
 * member of your group eligible. This is the default landing view; the
 * scope nav at the top lets you switch to Personal or per-Course books.
 */
export const dynamic = "force-dynamic";

export default async function RecordsPage() {
  const sb = await supabaseServer();
  const {
    data: { user }
  } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/records");

  const { data: groups } = await sb.from("groups").select("id, name").limit(1);
  if (!groups || groups.length === 0) redirect("/onboarding");
  const group = groups[0];

  const { data: myPlayer } = await sb
    .from("players")
    .select("id")
    .eq("group_id", group.id)
    .eq("profile_id", user.id)
    .maybeSingle();

  const bundle = await loadRecords(sb, group.id);
  const labelByRound = roundLabelOf(bundle.roundsById);

  // Per-course quick links — courses your group has finalized rounds at.
  const coursesWithRounds = new Map<string, string>();
  for (const r of bundle.rounds) {
    if (r.course) coursesWithRounds.set(r.course, r.id);
  }
  // Group rounds by course_id via a second pass (so we can link to /records/course/[id]).
  const { data: roundCourseRows } = await sb
    .from("rounds")
    .select("id, course_id, courses(name)")
    .eq("group_id", group.id)
    .eq("status", "finalized");
  const courseIdByName = new Map<string, string>();
  for (const r of (roundCourseRows ?? []) as any[]) {
    if (r.course_id && r.courses?.name) courseIdByName.set(r.courses.name, r.course_id);
  }

  const totalRounds = bundle.rounds.length;

  return (
    <div className="space-y-5">
      <header>
        <p className="h-eyebrow text-gold-400">{group.name}</p>
        <h1 className="h-display text-3xl text-cream-50 mt-1">Record book</h1>
        <p className="text-xs text-cream-100/55 mt-1">
          Every finalized round in your group · {totalRounds.toLocaleString()} round
          {totalRounds === 1 ? "" : "s"}
          <span className="ml-3 text-gold-400">
            <Link href="/leaderboards">Season leaderboards →</Link>
          </span>
        </p>
      </header>

      <RecordsScopeNav active="group" myPlayerId={myPlayer?.id ?? null} />

      {totalRounds === 0 ? (
        <div className="card p-8 text-center text-cream-100/65">
          No finalized rounds yet. Records open up once rounds are settled.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RecordCard title="🏆 Lowest gross (18 holes)" rows={lowestGross18(bundle.perfs, labelByRound)} />
            <RecordCard title="💀 Highest gross (18 holes)" rows={highestGross18(bundle.perfs, labelByRound)} />
            <RecordCard title="💰 Biggest single-round win" rows={biggestWins(bundle.perfs, bundle.moneyByRp, labelByRound)} />
            <RecordCard title="🩸 Biggest single-round loss" rows={biggestLosses(bundle.perfs, bundle.moneyByRp, labelByRound)} />
            <RecordCard title="🐦 Most birdies in a round" rows={mostBirdiesInRound(bundle.perfs, labelByRound)} />
            <RecordCard title="📅 Most rounds played" rows={mostRoundsPlayed(bundle.perfs)} />
            {lowestGross9(bundle.perfs, labelByRound).length > 0 && (
              <RecordCard title="🎯 Lowest gross (9 holes)" rows={lowestGross9(bundle.perfs, labelByRound)} />
            )}
            {seasonNetTop(bundle.perfs, bundle.moneyByRp).length > 0 && (
              <RecordCard title="👑 Season net (all rounds)" rows={seasonNetTop(bundle.perfs, bundle.moneyByRp)} />
            )}
          </div>

          {/* Per-course quick links */}
          {courseIdByName.size > 0 && (
            <section className="space-y-2">
              <p className="h-eyebrow text-gold-400">By course</p>
              <p className="text-xs text-cream-100/55">
                Tap a course to see its specific record book.
              </p>
              <div className="flex flex-wrap gap-2">
                {[...courseIdByName.entries()].map(([name, id]) => (
                  <Link
                    key={id}
                    href={`/records/course/${id}`}
                    className="pill bg-brand-900/60 border border-cream-100/15 text-cream-100/85 hover:bg-brand-900 text-xs px-3 py-1.5"
                  >
                    🏌️ {name}
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
