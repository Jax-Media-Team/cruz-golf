import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const {
    data: { user }
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { data: isAdmin } = await sb.rpc("fn_is_platform_admin");
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Don't let admins revoke the last admin.
  const admin = supabaseAdmin();
  const { count } = await admin.from("platform_admins").select("*", { head: true, count: "exact" });
  if ((count ?? 0) <= 1) {
    return NextResponse.json(
      { error: "Cannot revoke the last platform admin. Grant another admin first." },
      { status: 400 }
    );
  }
  const { error } = await admin.from("platform_admins").delete().eq("profile_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
