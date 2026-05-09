import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { FeedbackForm } from "./feedback-form";

export default async function FeedbackPage({
  searchParams
}: {
  searchParams: Promise<{ kind?: string; round?: string }>;
}) {
  const sp = await searchParams;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/feedback");

  const { data: mine } = await sb
    .from("feedback")
    .select("id, kind, body, status, created_at")
    .eq("profile_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <div className="space-y-6 max-w-2xl">
      <header>
        <p className="h-eyebrow text-gold-400">Feedback</p>
        <h1 className="h-display text-3xl text-cream-50 mt-1">Tell Cruz Golf what you need</h1>
        <p className="text-sm text-cream-100/65 mt-2 leading-relaxed">
          Bug, feature, missing game format, broken course data — anything. The
          team sees every submission and updates status as it gets worked.
        </p>
      </header>

      <FeedbackForm
        userEmail={user.email ?? ""}
        defaultKind={(sp.kind as any) ?? "feature"}
        defaultRoundId={sp.round ?? null}
      />

      {mine && mine.length > 0 && (
        <section className="card p-4">
          <h2 className="font-serif text-lg text-cream-50 mb-2">Your past submissions</h2>
          <ul className="divide-y divide-cream-100/8 text-sm">
            {mine.map((f: any) => (
              <li key={f.id} className="py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-cream-50">
                    <span className="text-[10px] uppercase tracking-wider text-cream-100/55 mr-2">{f.kind}</span>
                    {f.body.slice(0, 80)}{f.body.length > 80 ? "…" : ""}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-cream-100/55">{f.status.replace("_", " ")}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
