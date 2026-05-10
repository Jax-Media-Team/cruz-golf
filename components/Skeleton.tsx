/**
 * Small skeleton primitives for loading states.
 *
 * Tone discipline: subtle pulse, no spinners, no "Loading…" text. Cards
 * that resemble the eventual content so the layout doesn't jump when
 * real data arrives. Brand colors at low opacity — feels native rather
 * than placeholder-y.
 *
 * Used by app/(app)/loading.tsx and per-route loading.tsx files.
 */

export function SkeletonLine({
  width = "w-full",
  height = "h-4",
  className = ""
}: {
  width?: string;
  height?: string;
  className?: string;
}) {
  return (
    <div
      className={`${width} ${height} rounded bg-cream-100/8 animate-pulse ${className}`}
    />
  );
}

export function SkeletonCard({
  lines = 3,
  className = ""
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div
      className={`card p-4 border border-cream-100/10 space-y-2.5 ${className}`}
    >
      <SkeletonLine width="w-1/3" height="h-3" />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine
          key={i}
          width={i === lines - 1 ? "w-2/3" : "w-full"}
          height="h-3"
        />
      ))}
    </div>
  );
}

export function SkeletonPill({ className = "" }: { className?: string }) {
  return (
    <div
      className={`inline-block h-6 w-20 rounded-full bg-cream-100/8 animate-pulse ${className}`}
    />
  );
}

export function SkeletonHeader() {
  return (
    <div className="space-y-2">
      <SkeletonLine width="w-32" height="h-3" />
      <SkeletonLine width="w-2/3 sm:w-1/2" height="h-7" />
    </div>
  );
}
