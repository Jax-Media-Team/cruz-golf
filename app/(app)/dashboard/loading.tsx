import { SkeletonCard, SkeletonLine } from "@/components/Skeleton";

/**
 * Dashboard skeleton — mimics the actual page so the layout doesn't
 * jump when real content arrives:
 *
 *   1. Greeting + group context line at top
 *   2. ClubhouseStrip (capped 4 cards) — small horizontal stat tiles
 *   3. Rounds list — header row + 4 round-card placeholders
 *
 * Server work on /dashboard is heavy (clubhouse engine pulls scores +
 * settlements + rps across the group's history). On a slow phone network
 * the page used to paint blank for 2+ seconds. This loader fills that
 * gap visibly without making promises ("Loading…" text feels apologetic
 * — the skeleton just looks like the page is arriving).
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div className="space-y-2">
        <SkeletonLine width="w-24" height="h-3" />
        <SkeletonLine width="w-48 sm:w-64" height="h-8" />
      </div>

      {/* Clubhouse strip — 4 small cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="card p-3 border border-cream-100/10 space-y-2 h-24 animate-pulse"
          >
            <SkeletonLine width="w-1/2" height="h-2" />
            <SkeletonLine width="w-2/3" height="h-4" />
            <SkeletonLine width="w-1/3" height="h-2" />
          </div>
        ))}
      </div>

      {/* Rounds list header */}
      <div className="flex items-center justify-between">
        <SkeletonLine width="w-32" height="h-5" />
        <SkeletonLine width="w-24" height="h-7" />
      </div>

      {/* Rounds cards */}
      <div className="space-y-2">
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
      </div>
    </div>
  );
}
