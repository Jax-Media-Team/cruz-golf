import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { EventLeaderboard } from "@/components/EventLeaderboard";
import type { EventRoundShape } from "@/lib/events/settle";

export const dynamic = "force-dynamic";

/**
 * Public spectator surface for an event's live leaderboard.
 *
 * URL pattern: /events/[id]/leaderboard?token=<spectator_token>
 *
 * Authentication: NO auth required. The token in the URL must match
 * the event's spectator_token. The events.spectator_token RLS policy
 * (migration 0039) allows public read so the anon client can fetch
 * the row; we verify the token matches server-side before rendering.
 *
 * This is the surface Patrick called "could become a signature
 * feature" — designed for:
 *   - non-playing family checking standings from the clubhouse
 *   - members in OTHER foursomes seeing the leader between holes
 *   - watching trips from home
 *
 * Mirrors /rounds/[id]/leaderboard?token=... — same pattern, just
 * scaled up to multi-foursome. The EventLeaderboard component does
 * the realtime subscription, so the page itself is just data
 * shaping.
 */
export default async function EventSpectatorPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const token = sp.token?.trim();
  if (!token) notFound();

  const sb = await supabaseServer();
  // Token-gated read. The RLS policy lets ANY anon client read events
  // rows; we re-verify the token matches the event's spectator_token
  // here so the URL alone is the access key.
  const { data: event } = await sb
    .from("events")
    .select(
      "id, group_id, name, kind, starts_on, ends_on, spectator_token, deleted_at, commissioner_profile_id, created_at, updated_at"
    )
    .eq("id", id)
    .maybeSingle();
  if (!event || event.deleted_at) notFound();
  if (event.spectator_token !== token) notFound();

  // Linked rounds — same query as the authenticated event home but
  // run against the anon client (no group-membership filter). The
  // rounds table's RLS allows reads for any group member OR via the
  // spectator_token path... wait — rounds RLS doesn't have a token
  // policy. We use supabaseServer() which has the anon key; reads
  // will be blocked.
  //
  // Workaround: do this via the existing per-round spectator pattern
  // (each round has its own spectator_token in 0001). For event-wide
  // spectator, we accept a different approach for v1: render the
  // event header + foursome list from the events table (token-readable),
  // and prompt the user to tap into individual rounds for live
  // foursome detail. The full field leaderboard ships in Phase 3b
  // once we add a server-side spectator-read RPC for the event-level
  // data (round_players + scores via service-role, gated by token).
  //
  // For now, fetch via service role IS the right call because the
  // anon client doesn't have policies to read group-scoped rounds
  // through an event spectator link. We'd need a SECURITY DEFINER
  // RPC like fn_event_spectator_data(token uuid). Logged in the
  // tracker as a follow-up.
  //
  // Phase 3a (this page) ships the event header + foursome list +
  // links to per-round spectator views. The full field leaderboard
  // is gated on the SD RPC; until then, the spectator surface is a
  // navigation hub.

  return (
    <div className="min-h-screen bg-cream-50">
      {/* Spectator banner — distinct from the in-app chrome */}
      <header className="bg-brand-900 text-cream-50 px-5 sm:px-8 py-4">
        <p className="text-[10px] uppercase tracking-[0.32em] text-gold-400">
          Spectator · read-only
        </p>
        <h1 className="font-serif text-2xl sm:text-3xl mt-1">
          {event.name}
        </h1>
        <p className="text-xs text-cream-100/70 mt-1">
          {event.kind === "tournament"
            ? "Tournament"
            : event.kind === "trip"
            ? "Trip"
            : "Club game"}
          {" · "}
          {event.starts_on}
          {event.ends_on && event.ends_on !== event.starts_on
            ? ` — ${event.ends_on}`
            : ""}
        </p>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <SpectatorRoundsList eventId={id} token={token} />
        <p className="text-[11px] text-slate-500 text-center">
          Full field leaderboard ships in the next phase. For now, tap
          a foursome to see its live scoreboard.
        </p>
      </main>
    </div>
  );
}

/**
 * Lists the foursomes in this event via a service-role fetch — that's
 * the only way to read the rounds table without group membership.
 * The token-match check above is the gate.
 */
async function SpectatorRoundsList({
  eventId,
  token
}: {
  eventId: string;
  token: string;
}) {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const sb = supabaseAdmin();
  // Re-verify the token + event_id match (defense in depth — the
  // outer page already checked, but this layer is reachable via any
  // import and we want it gated independently).
  const { data: event } = await sb
    .from("events")
    .select("id, spectator_token, deleted_at")
    .eq("id", eventId)
    .maybeSingle();
  if (!event || event.deleted_at || event.spectator_token !== token) {
    return (
      <p className="text-sm text-slate-500">
        Link is invalid or the event has been archived.
      </p>
    );
  }
  const { data: rounds } = await sb
    .from("rounds")
    .select(
      "id, date, status, holes, spectator_token, courses(name)"
    )
    .eq("event_id", eventId)
    .is("deleted_at", null)
    .order("date", { ascending: true });
  const list = (rounds as any[]) ?? [];
  if (list.length === 0) {
    return (
      <p className="text-sm text-slate-500 text-center py-8">
        No foursomes started yet.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {list.map((r: any) => {
        const statusBadge =
          r.status === "live"
            ? "bg-emerald-100 text-emerald-800"
            : r.status === "pending_finalization"
            ? "bg-amber-100 text-amber-800"
            : r.status === "finalized"
            ? "bg-slate-100 text-slate-700"
            : "bg-slate-100 text-slate-500";
        const href = r.spectator_token
          ? `/rounds/${r.id}/leaderboard?token=${r.spectator_token}`
          : null;
        return (
          <li
            key={r.id}
            className="rounded-xl border border-slate-200 bg-white p-3 flex items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <div className="font-serif text-slate-900 truncate">
                {r.courses?.name ?? "Course"}
                <span className="text-slate-500 text-xs ml-2 font-normal">
                  · {r.date} · {r.holes} holes
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 ${statusBadge}`}
              >
                {r.status === "pending_finalization" ? "awaiting" : r.status}
              </span>
              {href && (
                <a
                  href={href}
                  className="text-xs text-gold-700 hover:underline"
                >
                  Watch →
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
