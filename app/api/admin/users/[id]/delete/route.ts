import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Permanently delete a user.
 *
 * Removes the auth user, which cascades to profiles (FK) → group_members,
 * platform_admins, etc. Player rows tied to the user via profile_id keep
 * their data (FK is on delete set null) so existing rounds remain
 * historically intact.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const {
    data: { user }
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (user.id === id) {
    return NextResponse.json({ error: "Can't delete your own account from here" }, { status: 400 });
  }
  const { data: isAdmin } = await sb.rpc("fn_is_platform_admin");
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Check we're not deleting the last platform admin.
  const admin = supabaseAdmin();
  const { data: targetAdmin } = await admin
    .from("platform_admins")
    .select("profile_id")
    .eq("profile_id", id)
    .maybeSingle();
  if (targetAdmin) {
    const { count } = await admin
      .from("platform_admins")
      .select("*", { head: true, count: "exact" });
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "Can't delete the last platform admin." },
        { status: 400 }
      );
    }
  }

  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
