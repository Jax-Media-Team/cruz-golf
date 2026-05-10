import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { BrandLockup } from "@/components/BrandLockup";
import { HelpButton } from "@/components/HelpButton";
import { UpdateToast } from "@/components/UpdateToast";
import { MobileMoreMenu } from "@/components/MobileMoreMenu";
import { ActiveRoundPill } from "@/components/ActiveRoundPill";
import { InstallPrompt } from "@/components/InstallPrompt";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    // Preserve the requested path so login can deep-link back. The path
    // header is set by /middleware.ts.
    const h = await headers();
    const path = h.get("x-pathname") ?? "/dashboard";
    const next = encodeURIComponent(path);
    redirect(`/login?next=${next}`);
  }

  // Show the Admin nav item only to platform admins. Wrapped in try/catch
  // so the layout doesn't crash if the migration hasn't run yet.
  let isPlatformAdmin = false;
  try {
    // Cheap idempotent seed: promotes the hardcoded owner email if it's in
    // auth.users but not yet in platform_admins. No-op for everyone else.
    await sb.rpc("fn_seed_owner_admins");
  } catch {
    /* migration may not have shipped to this env yet — ignore */
  }
  try {
    const { data } = await sb.rpc("fn_is_platform_admin");
    isPlatformAdmin = !!data;
  } catch {
    isPlatformAdmin = false;
  }

  // Newest live round (if any) — used by the floating "Back to round" pill.
  // Skip archived rounds (migration 0021 adds rounds.deleted_at). If the
  // column isn't there yet we silently retry without the filter so the
  // pill keeps working pre-migration.
  let activeRound: { id: string; courseName: string | null } | null = null;
  try {
    const filtered = await sb
      .from("rounds")
      .select("id, status, courses(name)")
      .eq("status", "live")
      .is("deleted_at", null)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    let data = filtered.data;
    if (filtered.error) {
      const r = await sb
        .from("rounds")
        .select("id, status, courses(name)")
        .eq("status", "live")
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();
      data = r.data;
    }
    if (data) {
      activeRound = {
        id: data.id as string,
        courseName: ((data as any).courses?.name as string | undefined) ?? null
      };
    }
  } catch {
    /* ignore — pill is non-critical */
  }

  return (
    <div className="min-h-screen flex flex-col pb-20 sm:pb-0">
      <header className="sticky top-0 z-10 bg-brand-950/90 backdrop-blur border-b border-cream-100/10">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 flex items-center justify-between gap-4 min-h-[120px] sm:min-h-[160px]">
          <Link
            href="/dashboard"
            className="flex items-center shrink-0"
            aria-label="Cruz Golf — home"
          >
            <span className="hidden sm:inline-flex">
              <BrandLockup iconHeight={180} />
            </span>
            <span className="sm:hidden inline-flex">
              <BrandLockup iconHeight={108} />
            </span>
          </Link>
          <nav className="hidden sm:flex items-center gap-1">
            <Link href="/dashboard" className="btn-ghost text-sm">Rounds</Link>
            <Link href="/leaderboards" className="btn-ghost text-sm">Leaderboards</Link>
            <Link href="/records" className="btn-ghost text-sm">Records</Link>
            <Link href="/players" className="btn-ghost text-sm">Players</Link>
            <Link href="/courses" className="btn-ghost text-sm">Courses</Link>
            <Link href="/ledger" className="btn-ghost text-sm">Ledger</Link>
            {isPlatformAdmin && (
              <Link href="/admin" className="btn-ghost text-sm text-gold-400">
                Admin
              </Link>
            )}
          </nav>
          <form action="/auth/signout" method="post">
            <button className="btn-ghost text-sm">Sign out</button>
          </form>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">{children}</main>
      <nav className="sm:hidden fixed bottom-0 inset-x-0 bg-brand-950/95 backdrop-blur border-t border-cream-100/10 grid grid-cols-5 z-30">
        <TabLink href="/dashboard" label="Rounds" />
        <TabLink href="/players" label="Players" />
        <TabLink href="/courses" label="Courses" />
        <TabLink href="/leaderboards" label="Boards" />
        <MobileMoreMenu isPlatformAdmin={isPlatformAdmin} />
      </nav>
      <ActiveRoundPill
        roundId={activeRound?.id ?? null}
        courseName={activeRound?.courseName ?? null}
      />
      <InstallPrompt />
      <HelpButton />
      <UpdateToast />
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
