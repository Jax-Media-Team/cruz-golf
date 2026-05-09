import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { data: isAdmin } = await sb.rpc("fn_is_platform_admin");
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { status?: string; admin_notes?: string };
  const allowedStatuses = ["new", "reviewing", "planned", "in_progress", "shipped", "declined"];
  const patch: Record<string, unknown> = {};
  if (body.status && allowedStatuses.includes(body.status)) {
    patch.status = body.status;
    if (body.status === "shipped" || body.status === "declined") {
      patch.resolved_at = new Date().toISOString();
    }
  }
  if (typeof body.admin_notes === "string") patch.admin_notes = body.admin_notes;
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });

  const admin = supabaseAdmin();
  const { error } = await admin.from("feedback").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
