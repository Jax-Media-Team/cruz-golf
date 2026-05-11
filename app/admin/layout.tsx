import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

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
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-10 bg-brand-950/95 backdrop-blur border-b border-cream-100/10">
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
