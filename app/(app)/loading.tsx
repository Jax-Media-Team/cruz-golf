import { SkeletonCard, SkeletonHeader } from "@/components/Skeleton";

/**
 * Default loading state for every (app) route that doesn't define its
 * own loading.tsx. Replaces the previous "blank page until RSC streams"
 * behavior on slow networks (and on the first paint after a service-
 * worker network-first fallback). Page layout shouldn't jump when real
 * content arrives.
 *
 * Per-route overrides (e.g. /dashboard, /rounds/[id]) live alongside
 * those pages with a shape closer to the eventual content.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />
      <div className="space-y-3">
        <SkeletonCard lines={2} />
        <SkeletonCard lines={3} />
        <SkeletonCard lines={2} />
      </div>
    </div>
  );
}
