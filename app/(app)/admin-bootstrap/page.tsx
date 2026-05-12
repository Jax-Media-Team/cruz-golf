import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { ClaimAdmin } from "./claim-admin";
// Force dynamic rendering. Without this, Next.js 15 can statically
// prerender this server component at build time with no auth cookie
// — every Supabase fetch returns empty under RLS, the page renders
// empty, and the user sees a stale or blank surface. Critical fix
// (Patrick 2026-05-12: 'All my past rounds are empty').
export const dynamic = "force-dynamic";

/**
 * One-shot self-bootstrap for the very first platform admin.
 *
 * fn_grant_platform_admin allows ANY authenticated user to grant themselves
 * if no admins exist yet. This page surfaces that flow safely:
 *   - 404 if any platform admin already exists (the page is invisible)
 *   - Show a "claim platform admin" button to the signed-in user
 *   - After claiming, /admin becomes accessible
 */
export default async function AdminBootstrapPage() {
  const sb = await supabaseServer();
  const {
    data: { user }
  } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/admin-bootstrap");

  // If any admin exists, hide this page entirely. Use service-role-free
  // count via the SECURITY DEFINER RPC.
  const { data: hasAny } = await sb.rpc("fn_is_platform_admin");
  if (hasAny) redirect("/admin");

  // Also bail if there's an admin but it's just not us (we won't be able to
  // tell unless we query directly; rely on the grant function to enforce).
  return (
    <div className="max-w-md mx-auto py-10">
      <div className="card p-6 space-y-4">
        <div>
          <p className="h-eyebrow text-gold-400">Platform setup</p>
          <h1 className="h-display text-2xl text-cream-50 mt-1">Claim Platform Admin</h1>
        </div>
        <p className="text-sm text-cream-100/80 leading-relaxed">
          No platform admin exists yet. As the first authenticated user to
          land here, you can promote yourself to <strong className="text-cream-50">Platform Admin</strong>.
          That gives you visibility into every account, group, round, and course on the platform.
        </p>
        <p className="text-xs text-cream-100/55">
          Signed in as <span className="text-cream-50">{user.email}</span>.
        </p>
        <ClaimAdmin email={user.email ?? ""} />
      </div>
    </div>
  );
}
