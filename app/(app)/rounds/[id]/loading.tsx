import { SkeletonCard, SkeletonLine } from "@/components/Skeleton";

/**
 * Round-page skeleton — header + games strip + leaderboard rows.
 *
 * /rounds/[id] is the most-revisited page during play. Score writes
 * trigger router.refresh() on the live-round page so the leaderboard
 * stays current; that re-fetch shouldn't blank the screen, hence this
 * loader giving the user a steady visual instead of a flash.
 */
export default function RoundLoading() {
  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-2">
            <SkeletonLine width="w-48" height="h-3" />
            <SkeletonLine width="w-64 sm:w-80" height="h-8" />
          </div>
          <SkeletonLine width="w-24" height="h-7 rounded-full" />
        </div>
        {/* Games-in-play pills */}
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonLine
              key={i}
              width="w-28"
              height="h-7 rounded-full"
            />
          ))}
        </div>
      </header>

      {/* Score-entry CTA */}
      <SkeletonCard lines={2} className="h-24" />

      {/* Secondary action tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="card p-3 border border-cream-100/10 h-20 animate-pulse"
          />
        ))}
      </div>

      {/* Leaderboard rows */}
      <div className="space-y-2">
        <SkeletonLine width="w-40" height="h-5" />
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} lines={1} />
        ))}
      </div>
    </div>
  );
}
