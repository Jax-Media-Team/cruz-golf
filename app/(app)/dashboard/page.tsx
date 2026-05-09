import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { RoundsList } from "./rounds-list";

export default async function DashboardPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  // Get the user's first group (if any) so we can show context-aware onboarding state.
  const { data: groups } = await sb.from("groups").select("id, name").limit(1);
  // No group yet -> the signup bootstrap didn't complete (likely email
  // confirmation flow). Send to the onboarding finisher.
  if ((groups?.length ?? 0) === 0) redirect("/onboarding");
  const groupId = groups?.[0]?.id;
  const groupName = groups?.[0]?.name;

  const [{ count: courseCount }, { count: playerCount }, { data: rounds }] = await Promise.all([
    sb.from("courses").select("id", { count: "exact", head: true }).eq("group_id", groupId ?? "").is("deleted_at", null),
    sb.from("players").select("id", { count: "exact", head: true }).eq("group_id", groupId ?? "").is("deleted_at", null),
    sb.from("rounds").select("id, date, status, courses(name)").order("date", { ascending: false }).limit(10)
  ]);

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
