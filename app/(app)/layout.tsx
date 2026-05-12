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
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { OfflineIndicator } from "@/components/OfflineIndicator";

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

  // Pick the live round most likely to be "actually in progress."
  // Per Patrick 2026-05-12 chaos-QA pass: a stale empty live round
  // (left over from a week ago) was shadowing today's real round on
  // the floating pill. New ordering:
  //   1. Drop archived (deleted_at not null) and stale (past-dated +
  //      zero scores) live rounds.
  //   2. Prefer rounds dated TODAY.
  //   3. Among today's rounds (or all if none today), pick the one
  //      with the most recent score write — that's the round the user
  //      is most likely walking with.
  //   4. Fall back to newest date.
  // Pulls top 5 live rounds (any group, RLS narrows to the user's
  // own) so the picker has room to choose. Stale rounds still appear
  // on the dashboard rounds list — this is purely about which one
  // anchors the floating pill.
  let activeRound: { id: string; courseName: string | null } | null = null;
  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const live = await sb
      .from("rounds")
      .select("id, date, courses(name)")
      .eq("status", "live")
      .is("deleted_at", null)
      .order("date", { ascending: false })
      .limit(5);
    type LiveRound = {
      id: string;
      date: string;
      courses?: { name?: string } | null;
    };
    let candidates: LiveRound[] = (live.data ?? []) as any;
    if (live.error) {
      // Pre-migration env without deleted_at — retry without the filter.
      const fallback = await sb
        .from("rounds")
        .select("id, date, courses(name)")
        .eq("status", "live")
        .order("date", { ascending: false })
        .limit(5);
      candidates = (fallback.data ?? []) as any;
    }
    if (candidates.length > 0) {
      // Drop stale (past-dated AND zero scores). Cheap N+1: 5 rounds
      // max, single short count query each. Keeps the layout fetch
      // under ~50ms in practice.
      const enriched = await Promise.all(
        candidates.map(async (r) => {
          const { count: scoreCount } = await sb
            .from("scores")
            .select("round_player_id", { count: "exact", head: true })
            .in(
              "round_player_id",
              (
                await sb
                  .from("round_players")
                  .select("id")
                  .eq("round_id", r.id)
              ).data?.map((rp: any) => rp.id) ?? []
            );
          // `lastScoreAt` ordering would be nicer but scores doesn't
          // ship updated_at on every deploy. Score count + date are
          // the reliable signals.
          return {
            ...r,
            score_count: scoreCount ?? 0,
            is_stale: r.date < todayStr && (scoreCount ?? 0) === 0
          };
        })
      );
      const live2 = enriched.filter((r) => !r.is_stale);
      const today = live2.filter((r) => r.date === todayStr);
      const pool = today.length > 0 ? today : live2;
      // Prefer the round with the most score writes (proxy for "most
      // recently active"). Ties broken by newest date.
      pool.sort((a, b) => {
        if (b.score_count !== a.score_count) {
          return b.score_count - a.score_count;
        }
        return b.date.localeCompare(a.date);
      });
      const pick = pool[0] ?? null;
      if (pick) {
        activeRound = {
          id: pick.id,
          courseName: (pick.courses?.name as string | undefined) ?? null
        };
      }
    }
  } catch {
    /* ignore — pill is non-critical */
  }

  // Press-pending count for the viewer on the active round. Surfaced as
  // an amber alert on the floating pill so the user sees an open press
  // even from /dashboard or /leaderboards. Realtime client-side updates
  // live in ActiveRoundPill — this is just the initial server fetch.
  // Defensive try/catch: round_presses ships in 0035; pre-migration
  // envs fall through quietly and the pill stays in its calm green state.
  let pressPendingForMe = 0;
  let myRpIdInActiveRound: string | null = null;
  if (activeRound) {
    try {
      const { data: myRp } = await sb
        .from("round_players")
        .select("id, players!inner(profile_id)")
        .eq("round_id", activeRound.id)
        .eq("players.profile_id", user.id)
        .maybeSingle();
      myRpIdInActiveRound = (myRp as any)?.id ?? null;
      if (myRpIdInActiveRound) {
        // Pending presses where I'm on side B (the side that needs to
        // accept). Filter via contains on the rp-id array.
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count } = await sb
          .from("round_presses")
          .select("id", { count: "exact", head: true })
          .eq("round_id", activeRound.id)
          .eq("status", "pending")
          .gte("opened_at", cutoff)
          .contains("side_b_rp_ids", [myRpIdInActiveRound]);
        pressPendingForMe = count ?? 0;
      }
    } catch {
      /* pre-0035 env or rls quirk — pill stays calm */
    }
  }

  return (
    // pb scales to clear the fixed bottom nav (5rem) + iOS home-indicator
    // safe area when the app is installed as a PWA. sm:pb-0 because the
    // nav is mobile-only.
    <div className="min-h-screen flex flex-col pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-0">
      {/* Sticky header — pt accounts for iOS notched safe area when the
          app runs in installed-PWA mode (Safari status bar overlaps the
          chrome otherwise). */}
      <header className="sticky top-0 z-10 bg-brand-950/90 backdrop-blur border-b border-cream-100/10 pt-[env(safe-area-inset-top)]">
        {/* Tightened header — was min-h-[140px] sm:min-h-[200px] which left
            visible breathing room above and below the icon. Now py-2 with
            slightly trimmed icons reclaims ~40px on mobile, ~80px on
            desktop while keeping the brand mark prominent. */}
        <div className="max-w-6xl mx-auto px-5 sm:px-8 flex items-center justify-between gap-4 py-2 sm:py-3">
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
            <Link href="/dashboard" className="btn-ghost text-sm">Clubhouse</Link>
            <Link href="/leaderboards" className="btn-ghost text-sm">Leaderboards</Link>
            <Link href="/records" className="btn-ghost text-sm">Records</Link>
            <Link href="/players" className="btn-ghost text-sm">Players</Link>
            <Link href="/courses" className="btn-ghost text-sm">Courses</Link>
            <Link href="/ledger" className="btn-ghost text-sm">Ledger</Link>
            {isPlatformAdmin && (
              <Link
                href="/admin"
                className="ml-1 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium bg-gold-500/15 text-gold-400 border border-gold-500/40 hover:bg-gold-500 hover:text-brand-900 transition-colors"
                aria-label="Platform admin panel"
              >
                🛡 Admin
              </Link>
            )}
          </nav>
          <form action="/auth/signout" method="post">
            <button className="btn-ghost text-sm">Sign out</button>
          </form>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">{children}</main>
      {/* Mobile bottom nav — pb scales to keep tap targets clear of the
          iPhone home indicator when installed as a PWA. The 5rem bottom
          padding on the body element above pairs with this so content
          doesn't slide under either the nav or the indicator.
          Tap target sizing: py-3.5 (~14px vertical) + text-[13px] gives
          ~44pt minimum-tappable height per Apple HIG once safe-area is
          accounted for. Labels are short enough to fit on a 360px-wide
          viewport (5 cols = 72px each) without truncation. */}
      <nav
        className="sm:hidden fixed bottom-0 inset-x-0 bg-brand-950/95 backdrop-blur border-t border-cream-100/10 grid grid-cols-5 z-30"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <TabLink href="/dashboard" label="Clubhouse" />
        <TabLink href="/players" label="Players" />
        <TabLink href="/courses" label="Courses" />
        <TabLink href="/leaderboards" label="Boards" />
        <MobileMoreMenu isPlatformAdmin={isPlatformAdmin} />
      </nav>
      <ActiveRoundPill
        roundId={activeRound?.id ?? null}
        courseName={activeRound?.courseName ?? null}
        myRpId={myRpIdInActiveRound}
        initialPendingPressCount={pressPendingForMe}
      />
      <InstallPrompt />
      <HelpButton />
      <UpdateToast />
      <ServiceWorkerRegistration />
      <OfflineIndicator />
    </div>
  );
}

function TabLink({ href, label }: { href: string; label: string }) {
  // py-3.5 + text-[13px] keeps the tap target ≥44pt on iPhone after
  // safe-area-inset-bottom is layered on by the parent nav. The
  // tracking + truncate keep "Clubhouse" / "Leaderboards" abbreviations
  // from wrapping on a 360px viewport.
  return (
    <Link
      href={href}
      className="py-3.5 px-1 text-center text-[13px] font-medium text-cream-100/85 active:bg-brand-900/60 truncate"
    >
      {label}
    </Link>
  );
}
