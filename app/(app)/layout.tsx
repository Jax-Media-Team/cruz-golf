import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { BrandLockup } from "@/components/BrandLockup";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen flex flex-col pb-20 sm:pb-0">
      <header className="sticky top-0 z-10 bg-brand-950/90 backdrop-blur border-b border-cream-100/10">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 flex items-center justify-between gap-4 min-h-[80px] sm:min-h-[112px]">
          <Link
            href="/dashboard"
            className="flex items-center shrink-0"
            aria-label="Cruz Golf — home"
          >
            <span className="hidden sm:inline-flex">
              <BrandLockup iconHeight={120} />
            </span>
            <span className="sm:hidden inline-flex">
              <BrandLockup iconHeight={72} />
            </span>
          </Link>
          <nav className="hidden sm:flex items-center gap-1">
            <Link href="/dashboard" className="btn-ghost text-sm">Rounds</Link>
            <Link href="/players" className="btn-ghost text-sm">Players</Link>
            <Link href="/courses" className="btn-ghost text-sm">Courses</Link>
            <Link href="/ledger" className="btn-ghost text-sm">Ledger</Link>
          </nav>
          <form action="/auth/signout" method="post">
            <button className="btn-ghost text-sm">Sign out</button>
          </form>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">{children}</main>
      <nav className="sm:hidden fixed bottom-0 inset-x-0 bg-brand-950/95 backdrop-blur border-t border-cream-100/10 grid grid-cols-4">
        <TabLink href="/dashboard" label="Rounds" />
        <TabLink href="/players" label="Players" />
        <TabLink href="/courses" label="Courses" />
        <TabLink href="/ledger" label="Ledger" />
      </nav>
    </div>
  );
}

function TabLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="py-3 text-center text-sm font-medium text-cream-100/80">
      {label}
    </Link>
  );
}
