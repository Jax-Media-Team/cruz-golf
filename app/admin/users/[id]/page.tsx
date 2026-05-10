import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { statusPillFor, type RoundStatus } from "@/components/RoundBreadcrumb";
import { UserActions } from "./user-actions";

export const dynamic = "force-dynamic";

export default async function AdminUserDetail({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = supabaseAdmin();

  const { data: authUser, error: authErr } = await sb.auth.admin.getUserById(id);
  if (authErr || !authUser?.user) notFound();
  const u = authUser.user;

  const [{ data: profile }, { data: admin }, { data: memberships }, { data: roundPlayers }, { data: players }] = await Promise.all([
    sb.from("profiles").select("*").eq("id", id).maybeSingle(),
    sb.from("platform_admins").select("profile_id, granted_at, notes").eq("profile_id", id).maybeSingle(),
    sb.from("group_members").select("group_id, player_id, role, groups(id, name, owner_id)").eq("profile_id", id),
    sb
      .from("round_players")
      .select("round_id, course_handicap, playing_handicap, rounds(id, date, status, spectator_token, courses(name), groups(name)), players!inner(profile_id)")
      .eq("players.profile_id", id)
      .order("round_id", { ascending: false }),
    sb.from("players").select("id, group_id, display_name, is_guest, deleted_at").eq("profile_id", id)
  ]);

  // Bucket the user's rounds for the support workflow: live rounds are
  // the highest-leverage thing an admin needs to spectate when this user
  // pings them ("the round won't finalize", "scores are wrong", etc).
  // Drafts come second; finalized rounds are the long tail.
  type RpRow = {
    round_id: string;
    course_handicap: number | null;
    playing_handicap: number | null;
    rounds: {
      id: string;
      date: string;
      status: string;
      spectator_token: string | null;
      courses: { name: string } | null;
      groups: { name: string } | null;
    } | null;
  };
  const allRps = (roundPlayers ?? []) as unknown as RpRow[];
  const liveRps = allRps.filter((rp) => rp.rounds?.status === "live");
  const pendingRps = allRps.filter((rp) => rp.rounds?.status === "pending_finalization");
  const draftRps = allRps.filter((rp) => rp.rounds?.status === "draft");
  const otherRps = allRps.filter(
    (rp) =>
      rp.rounds &&
      rp.rounds.status !== "live" &&
      rp.rounds.status !== "pending_finalization" &&
      rp.rounds.status !== "draft"
  );

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="h-eyebrow text-gold-400">User</p>
          <h1 className="h-display text-3xl text-cream-50 mt-1">
            {profile?.display_name || u.email || "(unnamed)"}
          </h1>
          <p className="text-sm text-cream-100/60 mt-1 break-all">{u.email}</p>
        </div>
        <Link href="/admin/users" className="btn-ghost text-sm">← All users</Link>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="card p-4 space-y-2">
          <h2 className="font-serif text-lg text-cream-50">Identity</h2>
          <dl className="text-sm space-y-1.5">
            <Row label="Auth user ID" value={u.id} mono />
            <Row label="Display name" value={profile?.display_name ?? "—"} />
            <Row label="Email" value={u.email ?? "—"} />
            <Row label="Email confirmed" value={u.email_confirmed_at ? "yes" : "no"} />
            <Row label="Phone" value={u.phone ?? "—"} />
            <Row label="Provider" value={u.app_metadata?.provider ?? "email"} />
            <Row label="Joined" value={formatDateTime(u.created_at)} />
            <Row label="Last sign-in" value={u.last_sign_in_at ? formatDateTime(u.last_sign_in_at) : "never"} />
            <Row label="Banned until" value={(u as any).banned_until ?? "—"} />
          </dl>
        </div>

        <div className="card p-4 space-y-2">
          <h2 className="font-serif text-lg text-cream-50">Platform role</h2>
          <p className="text-sm">
            {admin ? (
              <span className="pill bg-gold-500 text-brand-900 text-xs px-3 py-1">Platform Admin</span>
            ) : (
              <span className="text-cream-100/65">Regular user</span>
            )}
          </p>
          {admin && (
            <p className="text-xs text-cream-100/55">
              Granted {formatDate(admin.granted_at)}
              {admin.notes ? ` · ${admin.notes}` : ""}
            </p>
          )}
          <UserActions userId={id} email={u.email ?? ""} isAdmin={!!admin} isBanned={!!(u as any).banned_until} />
        </div>
      </section>

      <section className="card p-4">
        <h2 className="font-serif text-lg text-cream-50 mb-2">
          Group memberships ({memberships?.length ?? 0})
        </h2>
        {memberships && memberships.length > 0 ? (
          <ul className="divide-y divide-cream-100/8 text-sm">
            {memberships.map((m: any) => (
              <li key={m.group_id} className="py-2 flex items-center justify-between gap-3">
                <Link href={`/admin/groups/${m.group_id}`} className="text-cream-50 hover:underline">
                  {m.groups?.name ?? "(no name)"}
                </Link>
                <span className="text-xs text-cream-100/65 font-mono">{m.role}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-cream-100/55">Not in any groups.</p>
        )}
      </section>

      <section className="card p-4">
        <h2 className="font-serif text-lg text-cream-50 mb-2">
          Player profile rows ({players?.length ?? 0})
        </h2>
        {players && players.length > 0 ? (
          <ul className="divide-y divide-cream-100/8 text-sm">
            {players.map((p: any) => (
              <li key={p.id} className="py-2 flex items-center justify-between gap-3">
                <span className="text-cream-50">{p.display_name}</span>
                <span className="text-xs text-cream-100/55">
                  {p.is_guest ? "guest · " : ""}
                  {p.deleted_at ? "deleted" : "active"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-cream-100/55">No player rows.</p>
        )}
      </section>

      {/* Live + pending + draft rounds — the support-workflow targets.
          Each row links to /admin/rounds/[id] (full admin detail) AND a
          read-only spectator leaderboard so support can see what the user
          sees without altering anything. */}
      {(liveRps.length > 0 || pendingRps.length > 0 || draftRps.length > 0) && (
        <section className="card p-4 border border-gold-500/30">
          <h2 className="font-serif text-lg text-cream-50 mb-1">
            Active rounds ({liveRps.length + pendingRps.length + draftRps.length})
          </h2>
          <p className="text-[11px] text-cream-100/55 mb-2">
            Live, awaiting finalization, and draft rounds this user is in.
            Spectate is read-only — it won&apos;t mutate anything.
          </p>
          <ul className="divide-y divide-cream-100/8 text-sm">
            {[...liveRps, ...pendingRps, ...draftRps].map((rp) => {
              const r = rp.rounds!;
              const courseName = r.courses?.name ?? "Course";
              const groupName = r.groups?.name ?? "Group";
              return (
                <li
                  key={rp.round_id}
                  className="py-2 flex items-center justify-between gap-3 flex-wrap"
                >
                  <div className="min-w-0">
                    <div className="text-cream-50 truncate">
                      {courseName}
                      <span className="text-cream-100/55 text-xs ml-2">· {r.date}</span>
                    </div>
                    <div className="text-[11px] text-cream-100/55 truncate">
                      {groupName}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {(() => {
                      const pill = statusPillFor(r.status as RoundStatus);
                      return <span className={`${pill.className} text-[10px]`}>{pill.label}</span>;
                    })()}
                    {r.spectator_token && (
                      <Link
                        href={`/rounds/${rp.round_id}/leaderboard?token=${r.spectator_token}&adminMode=1`}
                        className="btn-secondary text-xs"
                        title="Read-only live leaderboard with admin banner"
                      >
                        👀 Spectate
                      </Link>
                    )}
                    <Link
                      href={`/admin/rounds/${rp.round_id}`}
                      className="btn-ghost text-xs"
                    >
                      Inspect →
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card p-4">
        <h2 className="font-serif text-lg text-cream-50 mb-2">
          Rounds played ({allRps.length})
        </h2>
        {allRps.length > 0 ? (
          <ul className="divide-y divide-cream-100/8 text-sm">
            {otherRps.slice(0, 30).map((rp) => (
              <li
                key={rp.round_id}
                className="py-2 flex items-center justify-between gap-3"
              >
                <Link
                  href={`/admin/rounds/${rp.round_id}`}
                  className="text-cream-50 hover:underline"
                >
                  {rp.rounds?.courses?.name ?? "Course"}{" "}
                  <span className="text-cream-100/55 text-xs">
                    · {rp.rounds?.date}
                  </span>
                </Link>
                <span className="text-xs text-cream-100/55 tabular-nums">
                  CH {rp.course_handicap} · PH {rp.playing_handicap}
                </span>
              </li>
            ))}
            {otherRps.length === 0 && (
              <li className="py-2 text-cream-100/55 text-xs">
                Only active rounds (shown above).
              </li>
            )}
          </ul>
        ) : (
          <p className="text-sm text-cream-100/55">No rounds yet.</p>
        )}
      </section>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-cream-100/45 text-xs uppercase tracking-wider w-32 shrink-0">{label}</dt>
      <dd className={`text-cream-50 break-all ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
