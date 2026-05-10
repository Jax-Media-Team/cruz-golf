import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { RoundsList } from "./rounds-list";

export default async function DashboardPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/dashboard");

  // Get the user's first group (if any) so we can show context-aware onboarding state.
  const { data: groups } = await sb.from("groups").select("id, name").limit(1);
  // No group yet -> the signup bootstrap didn't complete (likely email
  // confirmation flow). Send to the onboarding finisher.
  if ((groups?.length ?? 0) === 0) redirect("/onboarding");
  const groupId = groups?.[0]?.id;
  const groupName = groups?.[0]?.name;

  // Defensive: filter archived rounds via deleted_at, falling back to
  // unfiltered if migration 0021 isn't applied yet (so the dashboard
  // never goes blank because of a missing column).
  async function fetchRounds() {
    const filtered = await sb
      .from("rounds")
      .select("id, date, status, courses(name)")
      .is("deleted_at", null)
      .order("date", { ascending: false })
      .limit(10);
    if (!filtered.error) return filtered;
    return await sb
      .from("rounds")
      .select("id, date, status, courses(name)")
      .order("date", { ascending: false })
      .limit(10);
  }

  const [
    { count: courseCount },
    { count: playerCount },
    { data: rounds }
  ] = await Promise.all([
    sb.from("courses").select("id", { count: "exact", head: true }).eq("group_id", groupId ?? "").is("deleted_at", null),
    sb.from("players").select("id", { count: "exact", head: true }).eq("group_id", groupId ?? "").is("deleted_at", null),
    fetchRounds()
  ]);

  // Platform-admin nav surface: also unlocks the Admin quick-link below.
  let isPlatformAdmin = false;
  try {
    const { data } = await sb.rpc("fn_is_platform_admin");
    isPlatformAdmin = !!data;
  } catch {
    isPlatformAdmin = false;
  }

  // Newest in-progress round so we can offer a one-tap "Enter scores" link.
  const activeRound = (rounds ?? []).find((r: any) => r.status === "live" || r.status === "draft") as
    | { id: string; date: string; status: string; courses?: { name?: string } | null }
    | undefined;

  const hasCourses = (courseCount ?? 0) > 0;
  const hasPlayers = (playerCount ?? 0) > 0;
  const hasRounds = (rounds?.length ?? 0) > 0;
  const showChecklist = !hasRounds; // Onboarding checklist only when there are no rounds yet.

  const steps = [
    {
      done: hasCourses,
      title: "Add a course",
      body: "We'll quick-add Jacksonville Golf & Country Club for you, or set up your own with rating, slope, and stroke index.",
      href: "/courses",
      cta: hasCourses ? "Manage courses" : "Add your first course"
    },
    {
      done: hasPlayers,
      title: "Add your players",
      body: "Drop your regular crew in. Names and Handicap Indexes are enough — accounts and Venmo handles can come later.",
      href: "/players",
      cta: hasPlayers ? "Manage players" : "Add players"
    },
    {
      done: hasRounds,
      title: "Start your first round",
      body: "Pick the course, the players, and the games. Each player joins on their phone with a 4-digit PIN.",
      href: hasCourses && hasPlayers ? "/rounds/new" : "#",
      cta: hasCourses && hasPlayers ? "Start a round" : "Finish steps above"
    }
  ];

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="h-eyebrow">{groupName ?? "Clubhouse"}</p>
          <h1 className="h-display text-4xl text-cream-50 mt-1">Rounds</h1>
        </div>
        <Link href="/rounds/new" className="btn-primary">New round</Link>
      </header>

      {showChecklist && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="h-eyebrow text-gold-400">Get started</p>
            <p className="text-xs text-cream-100/55">{steps.filter((s) => s.done).length} of {steps.length} done</p>
          </div>
          <ol className="space-y-2">
            {steps.map((step, i) => (
              <li
                key={i}
                className={`card p-4 flex items-start gap-3 ${
                  step.done ? "border border-emerald-400/20 bg-brand-900/40" : ""
                }`}
              >
                <span
                  className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-serif text-sm ${
                    step.done
                      ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40"
                      : "bg-brand-800 text-cream-100/80 ring-1 ring-cream-100/15"
                  }`}
                >
                  {step.done ? "✓" : i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-serif text-lg text-cream-50">{step.title}</div>
                  <p className="text-xs text-cream-100/65 mt-0.5 leading-relaxed">{step.body}</p>
                </div>
                <Link
                  href={step.href}
                  className={`btn text-xs shrink-0 ${
                    step.done
                      ? "bg-brand-800/70 border border-cream-100/15 text-cream-100/85"
                      : i === steps.findIndex((s) => !s.done)
                      ? "bg-cream-100 text-brand-900"
                      : "bg-brand-800/70 border border-cream-100/15 text-cream-100/85"
                  }`}
                >
                  {step.cta} →
                </Link>
              </li>
            ))}
          </ol>
          <p className="text-xs text-cream-100/45 text-center">
            Or <Link href="/demo" className="text-gold-400 underline">tour the demo</Link> first to see it all in action.
          </p>
        </div>
      )}

      {/* Active-round shortcut — one tap to score-entry from the dashboard. */}
      {activeRound && (
        <Link
          href={`/rounds/${activeRound.id}/score-group`}
          className="card card-hover p-4 sm:p-5 flex items-center justify-between gap-3 border border-gold-500/40 bg-brand-900/40 hover:bg-brand-900/70 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl sm:text-3xl">📋</span>
            <div>
              <p className="h-eyebrow text-gold-400">In progress</p>
              <div className="font-serif text-lg sm:text-xl text-cream-50 mt-0.5">
                Enter scores · {activeRound.courses?.name ?? "Round"}
              </div>
              <p className="text-[11px] text-cream-100/55 mt-0.5">
                {activeRound.date} · status {activeRound.status}
              </p>
            </div>
          </div>
          <span className="pill bg-gold-500 text-brand-900 hidden sm:inline-flex">Open scoresheet →</span>
        </Link>
      )}

      {/* Quick links — always-visible nav surface for the side rooms of the app. */}
      <section className="space-y-2">
        <p className="h-eyebrow text-gold-400">Quick links</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Link href="/leaderboards" className="card card-hover p-3 text-center flex flex-col items-center gap-1">
            <span className="text-xl">📊</span>
            <span className="font-serif text-sm text-cream-50">Leaderboards</span>
            <span className="text-[10px] text-cream-100/55">Across all finalized rounds</span>
          </Link>
          <Link href="/records" className="card card-hover p-3 text-center flex flex-col items-center gap-1">
            <span className="text-xl">🏆</span>
            <span className="font-serif text-sm text-cream-50">Records</span>
            <span className="text-[10px] text-cream-100/55">Best gross, biggest wins, milestones</span>
          </Link>
          <Link href="/courses" className="card card-hover p-3 text-center flex flex-col items-center gap-1">
            <span className="text-xl">🗺️</span>
            <span className="font-serif text-sm text-cream-50">Courses</span>
            <span className="text-[10px] text-cream-100/55">Add a course or import a scorecard</span>
          </Link>
          <Link href="/ledger" className="card card-hover p-3 text-center flex flex-col items-center gap-1">
            <span className="text-xl">💵</span>
            <span className="font-serif text-sm text-cream-50">Ledger</span>
            <span className="text-[10px] text-cream-100/55">Who owes whom</span>
          </Link>
          {isPlatformAdmin && (
            <Link
              href="/admin"
              className="card card-hover p-3 text-center flex flex-col items-center gap-1 border border-gold-500/40 sm:col-span-1 col-span-2"
            >
              <span className="text-xl">🛡️</span>
              <span className="font-serif text-sm text-gold-400">Admin</span>
              <span className="text-[10px] text-cream-100/55">Platform-wide users, groups, audits</span>
            </Link>
          )}
        </div>
      </section>

      {hasRounds && (
        <>
          <p className="text-[11px] text-cream-100/45">
            Tip: swipe a round left, or tap the &ldquo;⋯&rdquo;, to delete.
          </p>
          <RoundsList initialRounds={(rounds as any) ?? []} />
        </>
      )}
    </div>
  );
}
