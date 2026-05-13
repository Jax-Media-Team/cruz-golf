import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

// Force dynamic rendering — the admin gate MUST run per-request with
// the user's auth cookie. Without this, Next.js could (in some build
// configs) prerender the layout at build time with no user, and the
// gate would either error or render the "not authorized" 404 for
// everyone. Belt-and-suspenders: all admin pages already declare
// dynamic themselves; this guards the parent layout too.
export const dynamic = "force-dynamic";

/**
 * Admin gate. Anyone hitting /admin/* who isn't a platform admin gets a
 * 404 (not a redirect) so the route is invisible to non-admins. The check
 * uses the SECURITY DEFINER fn_is_platform_admin() RPC.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const sb = await supabaseServer();
  const {
    data: { user }
  } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/admin");

  const { data: isAdmin, error } = await sb.rpc("fn_is_platform_admin");
  if (error || !isAdmin) notFound();

  return (
    // min-h uses both 100vh + 100dvh so the container fills the
    // viewport reliably on iOS Safari.
    // pb adds safe-area-inset-bottom so action buttons near the bottom
    // of admin pages don't fall under the iPhone home indicator —
    // Patrick 2026-05-12: "the admin console still has buttons that
    // are unclickable out of frame." Admin doesn't have the user-
    // facing mobile bottom nav so no 5rem clearance needed, just the
    // safe-area inset.
    <div
      className="min-h-screen min-h-[100dvh] flex flex-col"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <header
        className="sticky top-0 z-10 bg-brand-950/95 backdrop-blur border-b border-cream-100/10"
        // max() floor: Chrome iOS sometimes returns 0 for safe-area-
        // inset-top even with viewport-fit: cover, leaving admin
        // titles under the status bar. Same fix as the user-facing
        // (app)/layout.tsx (Patrick 2026-05-12).
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 12px)" }}
      >
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-4 flex items-center gap-6">
          <Link href="/admin" className="font-serif text-lg text-cream-50">
            Cruz Golf <span className="text-gold-400">/</span> Platform Admin
          </Link>
          <nav className="hidden sm:flex items-center gap-1 text-sm">
            <Link href="/admin" className="btn-ghost">Overview</Link>
            <Link href="/admin/users" className="btn-ghost">Users</Link>
            <Link href="/admin/groups" className="btn-ghost">Groups</Link>
            <Link href="/admin/rounds" className="btn-ghost">Rounds</Link>
            <Link href="/admin/courses" className="btn-ghost">Courses</Link>
            <Link href="/admin/course-library" className="btn-ghost">Library</Link>
            <Link href="/admin/course-audit" className="btn-ghost">Course audit</Link>
            <Link href="/admin/audit" className="btn-ghost">Audit log</Link>
            <Link href="/admin/feedback" className="btn-ghost">Feedback</Link>
            <Link href="/admin/diagnostics" className="btn-ghost">Diagnostics</Link>
          </nav>
          <span className="ml-auto text-xs text-cream-100/55">
            <Link href="/dashboard" className="text-gold-400 underline">← back to app</Link>
          </span>
        </div>
        <nav className="sm:hidden border-t border-cream-100/10 px-3 py-2 flex gap-1 overflow-x-auto text-xs">
          <Link href="/admin" className="btn-ghost shrink-0">Overview</Link>
          <Link href="/admin/users" className="btn-ghost shrink-0">Users</Link>
          <Link href="/admin/groups" className="btn-ghost shrink-0">Groups</Link>
          <Link href="/admin/rounds" className="btn-ghost shrink-0">Rounds</Link>
          <Link href="/admin/courses" className="btn-ghost shrink-0">Courses</Link>
          <Link href="/admin/course-library" className="btn-ghost shrink-0">Library</Link>
          <Link href="/admin/feedback" className="btn-ghost shrink-0">Feedback</Link>
          <Link href="/admin/diagnostics" className="btn-ghost shrink-0">Diagnostics</Link>
        </nav>
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">{children}</main>
    </div>
  );
}
