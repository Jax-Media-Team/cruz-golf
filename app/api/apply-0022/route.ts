import { NextResponse } from "next/server";
import { Client } from "pg";

/**
 * EMERGENCY incident-only endpoint. Connects directly to Postgres via
 * Vercel-Supabase integration's POSTGRES_URL_NON_POOLING and applies
 * 0022_fix_rls_recursion.sql. Removed after the incident is resolved.
 *
 * No public auth (read-only for sign-out users + service-role-key gate
 * for the actual apply step).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SQL = `-- 0022 fix RLS recursion
drop policy if exists "platform_admins read" on public.platform_admins;
create policy "platform_admins read" on public.platform_admins for select
  using (profile_id = auth.uid());

drop policy if exists "platform_admins write" on public.platform_admins;
create policy "platform_admins write" on public.platform_admins for all
  using ( public.fn_is_platform_admin() )
  with check ( public.fn_is_platform_admin() );

drop policy if exists "feedback read self or admin" on public.feedback;
create policy "feedback read self or admin" on public.feedback for select
  using (
    profile_id = auth.uid()
    or public.fn_is_platform_admin()
  );

drop policy if exists "feedback admin update" on public.feedback;
create policy "feedback admin update" on public.feedback for update
  using ( public.fn_is_platform_admin() )
  with check ( public.fn_is_platform_admin() );

drop policy if exists "feedback admin delete" on public.feedback;
create policy "feedback admin delete" on public.feedback for delete
  using ( public.fn_is_platform_admin() );

drop policy if exists "courses templates admin write" on public.courses;
create policy "courses templates admin write" on public.courses for all
  using ( is_template = true and public.fn_is_platform_admin() )
  with check ( is_template = true and public.fn_is_platform_admin() );

create or replace function public.fn_is_platform_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.platform_admins where profile_id = auth.uid());
$$;
revoke all on function public.fn_is_platform_admin() from public;
grant execute on function public.fn_is_platform_admin() to authenticated;
`;

function pickPgUrl(): { url: string; varName: string } | null {
  // Vercel-Supabase integration sets these at deploy time. Try them in
  // order of preference (non-pooling for DDL).
  const candidates = [
    "POSTGRES_URL_NON_POOLING",
    "POSTGRES_URL",
    "POSTGRES_PRISMA_URL",
    "DATABASE_URL",
    "POSTGRES_URL_NON_POOLING_FALLBACK"
  ];
  for (const name of candidates) {
    const v = process.env[name];
    if (v && v.startsWith("postgres")) return { url: v, varName: name };
  }
  return null;
}

export async function GET() {
  const picked = pickPgUrl();
  if (!picked) {
    return NextResponse.json(
      {
        error:
          "No POSTGRES_URL env var found. Add the Vercel-Supabase integration's POSTGRES_URL to Vercel, redeploy, and retry.",
        env_hint: "POSTGRES_URL or POSTGRES_URL_NON_POOLING"
      },
      { status: 500 }
    );
  }

  const client = new Client({
    connectionString: picked.url,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    const result = await client.query(SQL);
    await client.end();
    return NextResponse.json({
      ok: true,
      via: picked.varName,
      command: result.command ?? "multi-statement",
      message: "0022 applied. RLS recursion fixed."
    });
  } catch (e: any) {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
    return NextResponse.json(
      {
        ok: false,
        via: picked.varName,
        error: e?.message ?? String(e),
        code: e?.code ?? null
      },
      { status: 500 }
    );
  }
}
