import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { ScorecardImportClient } from "./scorecard-import";

export const dynamic = "force-dynamic";

export default async function CourseImportPage() {
  const sb = await supabaseServer();
  const {
    data: { user }
  } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/courses/import");

  const { data: groups } = await sb.from("groups").select("id").limit(1);
  const groupId = groups?.[0]?.id ?? null;

  return <ScorecardImportClient groupId={groupId} />;
}
