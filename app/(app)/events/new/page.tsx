import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { NewEventForm } from "./new-event-form";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  const sb = await supabaseServer();
  const {
    data: { user }
  } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/events/new");

  // Need a group to create an event for. Most users have one.
  const { data: groups } = await sb
    .from("groups")
    .select("id, name")
    .limit(10);
  if (!groups || groups.length === 0) redirect("/onboarding");

  // Commissioner-check: only commissioners can create events. We don't
  // hard-gate at the page level — RLS handles the write. But we
  // surface a warning if the user isn't a commissioner so they don't
  // hit a confusing RLS error.
  const { data: memberships } = await sb
    .from("group_members")
    .select("group_id, role")
    .eq("profile_id", user.id);
  const commissionerGroupIds = new Set(
    (memberships ?? [])
      .filter((m: any) => m.role === "commissioner")
      .map((m: any) => m.group_id)
  );
  const allowedGroups = (groups as any[]).filter((g) =>
    commissionerGroupIds.has(g.id)
  );

  return (
    <NewEventForm
      allowedGroups={allowedGroups as any[]}
      allGroups={groups as any[]}
      userId={user.id}
    />
  );
}
