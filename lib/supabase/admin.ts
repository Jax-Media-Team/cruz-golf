import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client.
 *
 * Bypasses RLS — use ONLY in server-side admin code paths that have
 * already verified the caller is a platform admin via fn_is_platform_admin().
 *
 * Never import this from a "use client" file.
 */
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "supabaseAdmin requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars"
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}
