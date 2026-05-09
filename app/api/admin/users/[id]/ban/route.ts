import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Disable a user by setting a far-future ban_duration. Supabase auth
 * supports setting `ban_duration` on a user — we use 100 years as
 * effective "indefinite". Reversed by the unban route.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const {
    data: { user }
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (user.id === id) {
    return NextResponse.json({ error: "Can't disable your own account" }, { status: 400 });
  }
  const { data: isAdmin } = await sb.rpc("fn_is_platform_admin");
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const admin = supabaseAdmin();
  const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: "876000h" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
