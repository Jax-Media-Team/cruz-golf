import { NextResponse } from "next/server";

/**
 * Incident-only: list env variable NAMES (no values) so I can see what
 * connection strings are available. Removed after the incident.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const names = Object.keys(process.env);
  // Filter out obvious system noise; keep anything that mentions postgres,
  // supabase, db, or url so we can find the right env var.
  const interesting = names
    .filter((n) =>
      /postgres|supabase|database|db_url|^pg|^direct/i.test(n)
    )
    .sort();
  return NextResponse.json({
    total_env_vars: names.length,
    interesting,
    has_supabase_service_role_key: typeof process.env.SUPABASE_SERVICE_ROLE_KEY === "string",
    has_supabase_url: typeof process.env.NEXT_PUBLIC_SUPABASE_URL === "string"
  });
}
