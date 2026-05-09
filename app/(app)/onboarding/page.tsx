import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";

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
