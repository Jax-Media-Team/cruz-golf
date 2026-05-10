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
  bestProjected,
  fmtMoney,
  type RecordRow
} from "@/lib/records";
import { RecordCard } from "@/components/RecordCard";
import { RecordsScopeNav } from "@/components/RecordsScopeNav";

/**
 * Personal record book — your finalized rounds across every group you're
 * in. Today everyone has exactly one group, so this collapses to "your
 * rounds in your group". When multi-group lands, the records math is
 * unchanged — just expand the loader to merge across groups.
 */
export const dynamic = "force-dynamic";

export default async function PersonalRecordsPage() {
  const sb = await supabaseServer();
  const {
    data: { user }
  } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/records/me");

  const { data: groups } = await sb.from("groups").select("id, name").limit(1);
  if (!groups || groups.length === 0) redirect("/onboarding");
  const group = groups[0];

  const { data: myPlayer } = await sb
    .from("players")
    .select("id, display_name")
    .eq("group_id", group.id)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!myPlayer) {
    return (
      <div className="space-y-4">
        <header>
          <p className="h-eyebrow text-gold-400">{group.name}</p>
          <h1 className="h-display text-3xl text-cream-50 mt-1">Personal record book</h1>
        </header>
        <RecordsScopeNav active="me" myPlayerId={null} />
        <div className="card p-6 sm:p-8 space-y-3 text-center">
          <p className="text-3xl">🤝</p>
          <h2 className="font-serif text-xl text-cream-50">
            Claim your spot in {group.name}
          </h2>
          <p className="text-sm text-cream-100/65 max-w-md mx-auto">
            You&apos;re signed in but not yet linked to a player on the roster.
            Once you claim your name, every round you play gets stitched
            into your personal record book.
          </p>
          <div className="flex flex-wrap gap-2 justify-center pt-2">
            <Link href="/players" className="btn-primary">Claim your name →</Link>
            <Link href="/records" className="btn-ghost text-sm">
              Browse the group book
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const bundle = await loadRecords(sb, group.id, { playerId: myPlayer.id });
  const labelByRound = roundLabelOf(bundle.roundsById);

  // Personal totals + averages.
  const totalRounds = bundle.perfs.length;
  const totalGross = bundle.perfs.reduce((s, p) => s + p.gross, 0);
  const totalHoles = bundle.perfs.reduce((s, p) => s + p.holesCount, 0);
  const totalBirdies = bundle.perfs.reduce((s, p) => s + p.birdies, 0);
  const totalNet = [...bundle.moneyByRp.values()].reduce((s, v) => s + v, 0);
  const avgGross18 = totalHoles
    ? +(totalGross * 18 / totalHoles).toFixed(1)
    : null;
  const avgBirdiesPerRound = totalRounds
    ? +(totalBirdies / totalRounds).toFixed(2)
    : null;
  const best = bestProjected(bundle.perfs, labelByRound);

  // Best round at every course you've played (single best gross per course).
  const bestPerCourse = new Map<string, RecordRow>();
  for (const p of bundle.perfs) {
    if (!p.course) continue;
    const existing = bestPerCourse.get(p.course);
    if (!existing || Number(existing.value) > p.gross) {
      bestPerCourse.set(p.course, {
        name: p.course,
        value: String(p.gross),
        meta: `${p.holesCount} holes · ${p.date}`
      });
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <p className="h-eyebrow text-gold-400">{group.name}</p>
        <h1 className="h-display text-3xl text-cream-50 mt-1">
          {myPlayer.display_name}&apos;s record book
        </h1>
        <p className="text-xs text-cream-100/55 mt-1">
          Your finalized rounds · {totalRounds.toLocaleString()} round
          {totalRounds === 1 ? "" : "s"}
        </p>
      </header>

      <RecordsScopeNav active="me" myPlayerId={myPlayer.id} />

      {totalRounds === 0 ? (
        <div className="card p-6 sm:p-8 space-y-4">
          <div className="text-center space-y-2">
            <p className="text-3xl">📔</p>
            <h2 className="font-serif text-2xl text-cream-50">
              Your personal record book starts with round one
            </h2>
            <p className="text-sm text-cream-100/65 max-w-lg mx-auto">
              Best 18, best 9, biggest cash-in, biggest disaster, lifetime
              net, most birdies in a round, your record at every course you
              play — every round you finish gets logged here forever.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 justify-center">
            <Link href="/rounds/new" className="btn-primary">Start a round</Link>
            <Link href="/records" className="btn-ghost text-sm">
              See your group&apos;s records →
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* Headline stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Rounds" value={totalRounds.toString()} />
            <Stat label="Avg gross / 18" value={avgGross18 ?? "—"} />
            <Stat label="Birdies / round" value={avgBirdiesPerRound ?? "—"} />
            <Stat
              label="Net total"
              value={fmtMoney(totalNet)}
              tone={totalNet > 0 ? "win" : totalNet < 0 ? "loss" : undefined}
            />
          </div>

          {/* Best round hero */}
          {best && (
            <div className="card p-5 border border-emerald-400/30 bg-emerald-500/5">
              <p className="h-eyebrow text-emerald-300">🏆 Personal best</p>
              <div className="font-serif text-4xl text-cream-50 mt-1 tabular-nums">
                {best.value}
              </div>
              <p className="text-xs text-cream-100/65 mt-1">{best.meta}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RecordCard
              title="🏆 Best 18-hole rounds"
              rows={lowestGross18(bundle.perfs, labelByRound)}
              emptyMessage="No 18-hole rounds yet."
            />
            {lowestGross9(bundle.perfs, labelByRound).length > 0 && (
              <RecordCard
                title="🎯 Best 9-hole rounds"
                rows={lowestGross9(bundle.perfs, labelByRound)}
              />
            )}
            <RecordCard
              title="💀 Worst 18-hole rounds"
              rows={highestGross18(bundle.perfs, labelByRound)}
              emptyMessage="No 18-hole rounds yet."
            />
            <RecordCard
              title="🐦 Most birdies in a round"
              rows={mostBirdiesInRound(bundle.perfs, labelByRound)}
              emptyMessage="No birdies yet — keep going."
            />
            <RecordCard
              title="💰 Biggest single-round wins"
              rows={biggestWins(bundle.perfs, bundle.moneyByRp, labelByRound)}
              emptyMessage="No winning rounds yet."
            />
            <RecordCard
              title="🩸 Biggest single-round losses"
              rows={biggestLosses(bundle.perfs, bundle.moneyByRp, labelByRound)}
              emptyMessage="No losing rounds. Lucky you."
            />
          </div>

          {bestPerCourse.size > 0 && (
            <RecordCard
              title="🏌️ Best gross by course"
              rows={[...bestPerCourse.values()].sort(
                (a, b) => Number(a.value) - Number(b.value)
              )}
            />
          )}
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone
}: {
  label: string;
  value: string | number;
  tone?: "win" | "loss";
}) {
  return (
    <div className="card p-3">
      <div className="h-eyebrow text-cream-100/55">{label}</div>
      <div
        className={`font-serif text-2xl mt-1 tabular-nums ${
          tone === "win"
            ? "text-emerald-300"
            : tone === "loss"
            ? "text-red-300"
            : "text-cream-50"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
