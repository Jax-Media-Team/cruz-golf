import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";
// Force dynamic rendering. Without this, Next.js 15 can statically
// prerender this server component at build time with no auth cookie
// — every Supabase fetch returns empty under RLS, the page renders
// empty, and the user sees a stale or blank surface. Critical fix
// (Patrick 2026-05-12: 'All my past rounds are empty').
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  // Already bootstrapped? Send them to the dashboard.
  const { data: profile } = await sb.from("profiles").select("id").eq("id", user.id).maybeSingle();
  const { data: groups } = await sb.from("groups").select("id").limit(1);
  if (profile && (groups?.length ?? 0) > 0) redirect("/dashboard");

  const suggestedName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    "";

  return <OnboardingForm email={user.email ?? ""} suggestedName={suggestedName} />;
}
