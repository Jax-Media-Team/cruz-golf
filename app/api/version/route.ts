import { NextResponse } from "next/server";

/**
 * Returns the current deploy SHA. The client compares this against the
 * value it loaded on first render to detect new deploys without forcing
 * a reload. Cheap and cacheable for ~30s.
 */
export const dynamic = "force-dynamic";
export const runtime = "edge";

export async function GET() {
  const buildId =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.NEXT_PUBLIC_BUILD_ID ??
    "dev";
  return NextResponse.json(
    { buildId, ts: Date.now() },
    {
      headers: {
        // Allow short-lived caching at the edge to keep traffic low. The
        // client only checks every 60s anyway, so even ~30s cache is fine.
        "Cache-Control": "public, max-age=10, s-maxage=30, stale-while-revalidate=60"
      }
    }
  );
}
