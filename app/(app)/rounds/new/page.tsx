"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { courseHandicap, playingHandicap } from "@/lib/handicap";
import { formatHi, hiInputValue, parseHi } from "@/lib/handicap-format";
import { GAME_PACKAGES } from "@/lib/presets/game-packages";
import type { GameType } from "@/lib/types";

// Games shown in the round-builder UI. Sorted alphabetically by label.
// CTP/Long drive are intentionally hidden for now (the user found them
// cluttering the setup; they'll come back as a separate "side bet" mode).
const GAMES: { type: GameType; label: string; defaults?: any }[] = [
  { type: "aggregate_gross", label: "Aggregate team (gross)" },
  { type: "aggregate_net", label: "Aggregate team (net)" },
  { type: "skins_canadian", label: "Canadian skins", defaults: { skin_mode: "pot", buyin_cents: 2000, escalation: "linear", ties: "carry", require_birdie: true } },
  { type: "custom", label: "Custom side bet" },
  { type: "individual_gross", label: "Individual gross" },
  { type: "individual_net", label: "Individual net" },
  { type: "match_play", label: "Match play (overall only)" },
  { type: "nassau", label: "Nassau (front/back/overall)", defaults: { match_play: true, front_stake_cents: 1000, back_stake_cents: 1000, overall_stake_cents: 1000, presses: "none" } },
  { type: "scramble_gross", label: "Scramble (gross)" },
  { type: "scramble_net", label: "Scramble (net)" },
  { type: "six_six_six", label: "6-6-6 (partner rotation, 4 players)", defaults: { match_play: true } },
  { type: "skins_gross", label: "Skins (gross)", defaults: { skin_mode: "pot", buyin_cents: 2000, ties: "carry", require_birdie: false } },
  { type: "skins_net", label: "Skins (net)", defaults: { skin_mode: "pot", buyin_cents: 2000, ties: "carry", require_birdie: false } },
  { type: "best_ball_gross", label: "Two-man best ball (gross)" },
  { type: "best_ball_net", label: "Two-man best ball (net)" }
];

function isSkins(t: GameType) {
  return t === "skins_gross" || t === "skins_net" || t === "skins_canadian";
}

export default function NewRoundPage() {
  const router = useRouter();
  const sb = supabaseBrowser();
  const [groupId, setGroupId] = useState<string | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [holes, setHoles] = useState<9 | 18>(18);
  const [courses, setCourses] = useState<any[]>([]);
  const [tees, setTees] = useState<any[]>([]);
  const [courseId, setCourseId] = useState<string>("");
  const [allPlayers, setAllPlayers] = useState<any[]>([]);
  const [lastPlayedAt, setLastPlayedAt] = useState<Record<string, string>>({});
  const [hiEdits, setHiEdits] = useState<Record<string, string>>({});
  const [lastLineup, setLastLineup] = useState<{ playerIds: string[]; courseName: string; date: string } | null>(null);
  const [pickedPlayers, setPickedPlayers] = useState<{ id: string; tee_id: string; team_id: string | null }[]>([]);
  const [teamCount, setTeamCount] = useState(0);
  const [games, setGames] = useState<Record<GameType, { enabled: boolean; stake_cents: number; allowance_pct: number; config: any }>>(
    Object.fromEntries(GAMES.map((g) => [g.type, { enabled: false, stake_cents: 1000, allowance_pct: 100, config: g.defaults ?? {} }])) as any
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // User-saved Quick Start presets.
  const [myPresets, setMyPresets] = useState<any[]>([]);

  const hasAnyGameEnabled = Object.values(games).some((v) => v.enabled);

  function applyPackage(pkgGames: Array<{ game_type: GameType; stake_cents: number; allowance_pct: number; config: any }>) {
    setGames((prev) => {
      const next: typeof prev = { ...prev };
      for (const k of Object.keys(next) as GameType[]) next[k] = { ...next[k], enabled: false };
      for (const g of pkgGames) {
        next[g.game_type] = {
          enabled: true,
          stake_cents: g.stake_cents,
          allowance_pct: g.allowance_pct,
          config: g.config
        };
      }
      return next;
    });
  }

  function applyPresetGames(presetGames: any[]) {
    applyPackage(presetGames as any);
  }

  async function savePresetFromCurrentGames() {
    const enabled = (Object.entries(games) as [GameType, any][])
      .filter(([, v]) => v.enabled)
      .map(([type, v]) => ({
        game_type: type,
        stake_cents: v.stake_cents,
        allowance_pct: v.allowance_pct,
        config: v.config
      }));
    if (enabled.length === 0) return;
    const name = prompt("Name this preset (e.g. 'Saturday Skins + Nassau')");
    if (!name?.trim()) return;
    const blurb = prompt("Optional blurb / description (leave blank to skip)") ?? "";
    const { data: u } = await sb.auth.getUser();
    if (!u.user) return;
    const { data, error } = await sb
      .from("quick_start_presets")
      .insert({
        profile_id: u.user.id,
        name: name.trim(),
        blurb: blurb.trim() || null,
        emoji: "⭐",
        games: enabled
      })
      .select("*")
      .single();
    if (error) {
      alert(`Couldn't save preset: ${error.message}`);
      return;
    }
    if (data) setMyPresets((prev) => [data, ...prev]);
  }

  async function deletePreset(id: string) {
    if (!confirm("Delete this preset?")) return;
    const { error } = await sb.from("quick_start_presets").delete().eq("id", id);
    if (error) {
      alert(`Couldn't delete preset: ${error.message}`);
      return;
    }
    setMyPresets((prev) => prev.filter((p) => p.id !== id));
  }

  // Which team-format games are currently enabled?
  const teamGameTypes: GameType[] = [
    "best_ball_gross",
    "best_ball_net",
    "aggregate_gross",
    "aggregate_net",
    "scramble_gross",
    "scramble_net"
  ];
  const teamGameEnabled = teamGameTypes.some((t) => games[t]?.enabled);
  const sixSixSixEnabled = !!games.six_six_six?.enabled;

  // Auto-suggest team setup when a 2-team game is enabled. We only auto-fill
  // when teamCount is still 0 AND no players are already assigned, so we
  // never blow away a user's manual configuration.
  useEffect(() => {
    if (!teamGameEnabled) return;
    if (teamCount > 0) return;
    if (pickedPlayers.length < 2) return;
    if (pickedPlayers.some((p) => p.team_id != null)) return;
    // Default: 2 teams. Auto-shuffle players evenly.
    const desired = 2;
    setTeamCount(desired);
    const order = pickedPlayers.map((p) => p.id);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const assignment = new Map<string, string>();
    order.forEach((pid, i) => assignment.set(pid, String(i % desired)));
    setPickedPlayers((arr) => arr.map((p) => ({ ...p, team_id: assignment.get(p.id) ?? null })));
  }, [teamGameEnabled, teamCount, pickedPlayers]);

  // Load this user's saved Quick Start presets on mount.
  useEffect(() => {
    (async () => {
      const { data: u } = await sb.auth.getUser();
      if (!u.user) return;
      const { data } = await sb
        .from("quick_start_presets")
        .select("*")
        .order("last_used_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      // RLS filters to the user's own. Tolerate the table not existing yet
      // (migration 0016 may not have been run) — silent in that case.
      if (data) setMyPresets(data);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      const { data: g } = await sb.from("groups").select("id").limit(1);
      const gid = g?.[0]?.id;
      setGroupId(gid ?? null);
      if (!gid) return;

      const [coursesRes, playersRes, recentRoundsRes, userRes] = await Promise.all([
        sb.from("courses").select("id, name").eq("group_id", gid).is("deleted_at", null),
        sb.from("players").select("id, display_name, handicap_index, profile_id, default_tee_name").eq("group_id", gid).is("deleted_at", null),
        sb
          .from("rounds")
          .select("id, date, courses(name), round_players(player_id)")
          .eq("group_id", gid)
          .order("date", { ascending: false })
          .limit(20),
        sb.auth.getUser()
      ]);

      setCourses(coursesRes.data ?? []);

      // Build last-played-at map (still useful for the "Re-play with last
      // lineup" button + per-row recency caption).
      const lastSeen: Record<string, string> = {};
      for (const r of (recentRoundsRes.data as any[]) ?? []) {
        for (const rp of r.round_players ?? []) {
          if (!lastSeen[rp.player_id]) lastSeen[rp.player_id] = r.date;
        }
      }
      setLastPlayedAt(lastSeen);

      // Sort: logged-in user first, then alphabetical by last name.
      const myUid = userRes.data.user?.id ?? null;
      const lastNameKey = (name: string) => {
        const parts = name.trim().split(/\s+/);
        if (parts.length <= 1) return name.toLowerCase();
        return `${parts[parts.length - 1]} ${parts.slice(0, -1).join(" ")}`.toLowerCase();
      };
      const players = (playersRes.data ?? []).slice().sort((a: any, b: any) => {
        const aMe = myUid && a.profile_id === myUid;
        const bMe = myUid && b.profile_id === myUid;
        if (aMe && !bMe) return -1;
        if (!aMe && bMe) return 1;
        return lastNameKey(a.display_name).localeCompare(lastNameKey(b.display_name));
      });
      setAllPlayers(players);

      // Capture last round's lineup for the quick "use last lineup" button.
      const lastRound = (recentRoundsRes.data as any[])?.[0];
      if (lastRound) {
        const ids = (lastRound.round_players ?? []).map((rp: any) => rp.player_id);
        if (ids.length > 0) {
          setLastLineup({
            playerIds: ids,
            courseName: lastRound.courses?.name ?? "last round",
            date: lastRound.date
          });
        }
      }
    })();
  }, []);

  // Course-data warnings detected on the picked course (mirrors /admin/course-audit).
  const [courseIssues, setCourseIssues] = useState<{ errors: number; warnings: number }>({
    errors: 0,
    warnings: 0
  });

  useEffect(() => {
    if (!courseId) {
      setTees([]);
      setCourseIssues({ errors: 0, warnings: 0 });
      return;
    }
    (async () => {
      // Order by rating desc — harder tees first.
      const [teesRes, holesRes] = await Promise.all([
        sb
          .from("course_tees")
          .select("id, name, gender, rating, slope, par, holes")
          .eq("course_id", courseId)
          .order("rating", { ascending: false }),
        sb
          .from("course_holes")
          .select("tee_id, hole_number, par, stroke_index")
      ]);
      const loaded = teesRes.data ?? [];
      // Audit: missing rating/slope/par, duplicate stroke indexes per tee
      const teeIds = new Set(loaded.map((t: any) => t.id));
      const holesByTee = new Map<string, any[]>();
      for (const h of (holesRes.data ?? []) as any[]) {
        if (!teeIds.has(h.tee_id)) continue;
        const arr = holesByTee.get(h.tee_id) ?? [];
        arr.push(h);
        holesByTee.set(h.tee_id, arr);
      }
      let errors = 0;
      let warnings = 0;
      for (const t of loaded as any[]) {
        if (!t.rating || !t.slope || !t.par) errors += 1;
        const hs = holesByTee.get(t.id) ?? [];
        if (hs.length !== t.holes) errors += 1;
        const sis = hs.map((h: any) => h.stroke_index);
        const dup = sis.filter((v, i) => sis.indexOf(v) !== i);
        if (dup.length > 0) errors += 1;
        const missing = Array.from({ length: t.holes }, (_, i) => i + 1).filter(
          (n) => !sis.includes(n)
        );
        if (missing.length > 0) errors += 1;
      }
      setCourseIssues({ errors, warnings });
      setTees(loaded);
      // Pick a sensible default tee — NOT the highest-rated (Black) since
      // most players play one tee up. We pick the second-highest-rated tee
      // when there are 2+ tees on file, or the only tee otherwise.
      const fallbackTee = loaded.length >= 2 ? loaded[1].id : loaded[0]?.id;
      // RESET every picked player's tee_id when the course changes — stale
      // UUIDs from a previous course were the root of the "invalid input
      // syntax for type uuid" error. Honor each player's default_tee_name
      // preference when the new course has a matching tee.
      if (fallbackTee) {
        setPickedPlayers((arr) =>
          arr.map((p) => {
            const stillValid = loaded.some((t: any) => t.id === p.tee_id);
            if (stillValid) return p;
            const player = allPlayers.find((pl) => pl.id === p.id);
            const want = (player?.default_tee_name ?? "").trim().toLowerCase();
            const matched = want
              ? loaded.find((t: any) => (t.name ?? "").trim().toLowerCase() === want)
              : null;
            return { ...p, tee_id: matched?.id ?? fallbackTee };
          })
        );
      }
    })();
  }, [courseId]);

  /**
   * Pick the right tee for a player on the current course:
   *   1. If the player has a default_tee_name AND the course has a tee with
   *      that exact name (case-insensitive), use it.
   *   2. Otherwise fall back to second-highest-rated (one tee up from tips).
   */
  function pickTeeForPlayer(playerId: string): string {
    const player = allPlayers.find((p) => p.id === playerId);
    const want = (player?.default_tee_name ?? "").trim().toLowerCase();
    if (want) {
      const match = tees.find((t: any) => (t.name ?? "").trim().toLowerCase() === want);
      if (match) return match.id;
    }
    return (tees.length >= 2 ? tees[1]?.id : tees[0]?.id) ?? "";
  }

  function togglePlayer(id: string) {
    setPickedPlayers((arr) => {
      if (arr.find((x) => x.id === id)) return arr.filter((x) => x.id !== id);
      return [...arr, { id, tee_id: pickTeeForPlayer(id), team_id: null }];
    });
  }

  // Inline guest creation: create a player with is_guest=true on the fly,
  // then auto-pick them for this round.
  const [guestDraft, setGuestDraft] = useState<{ name: string; hi: string }>({ name: "", hi: "" });
  const [guestBusy, setGuestBusy] = useState(false);
  async function addGuest() {
    if (!groupId || !guestDraft.name.trim()) return;
    setGuestBusy(true);
    const hi = parseHi(guestDraft.hi);
    const { data, error } = await sb
      .from("players")
      .insert({
        group_id: groupId,
        display_name: guestDraft.name.trim(),
        handicap_index: hi,
        handicap_index_source: "manual",
        handicap_updated_at: new Date().toISOString(),
        is_guest: true
      })
      .select("id, display_name, handicap_index")
      .single();
    setGuestBusy(false);
    if (error || !data) {
      setErr(error?.message ?? "Could not add guest");
      return;
    }
    setAllPlayers((prev) =>
      [...prev, data].sort((a: any, b: any) => a.display_name.localeCompare(b.display_name))
    );
    setPickedPlayers((arr) => [
      ...arr,
      { id: data.id, tee_id: (tees.length >= 2 ? tees[1]?.id : tees[0]?.id) ?? "", team_id: null }
    ]);
    setGuestDraft({ name: "", hi: "" });
  }

  async function startRound() {
    setBusy(true);
    setErr(null);
    if (!groupId || !courseId || pickedPlayers.length < 2) {
      setBusy(false);
      setErr("Pick a course and at least two players.");
      return;
    }
    // Ensure every picked player has a real tee_id. If they don't (e.g. they
    // were checked before tees loaded, or via "Re-play last lineup"), default
    // to the first available tee. Bail with a clear message if there are no
    // tees on the course at all (Postgres rejects empty-string UUIDs).
    if (tees.length === 0) {
      setBusy(false);
      setErr("This course has no tees set up. Add at least one tee on the course page first.");
      return;
    }
    const fallbackTee = tees[0].id;
    const playersWithTees = pickedPlayers.map((p) => ({
      ...p,
      tee_id: p.tee_id || fallbackTee
    }));
    if (playersWithTees.some((p) => !p.tee_id)) {
      setBusy(false);
      setErr("Couldn't pick a tee for one of the players. Try refreshing the page.");
      return;
    }
    // Sanity check: any team_id we have on a picked player must be a real
    // team index. Anything blank should be null. parseInt("") returns NaN,
    // which the original code mishandled — guard explicitly.
    const sanitized = playersWithTees.map((p) => {
      const idx = p.team_id == null || p.team_id === "" ? null : parseInt(p.team_id);
      return { ...p, _teamIndex: idx != null && Number.isFinite(idx) && idx >= 0 ? idx : -1 };
    });
    // If any team game is enabled, require everyone to be on a team.
    const teamGameEnabled = (Object.entries(games) as [GameType, any][]).some(
      ([type, v]) =>
        v.enabled &&
        ["best_ball_gross", "best_ball_net", "aggregate_gross", "aggregate_net", "scramble_gross", "scramble_net", "six_six_six", "nassau", "match_play"].includes(type)
    );
    if (teamGameEnabled && teamCount > 0 && sanitized.some((p) => p._teamIndex < 0)) {
      setBusy(false);
      setErr("Assign every picked player to a team before starting (drag them onto a team in the Teams section).");
      return;
    }

    // 1) Create round.
    const { data: round, error } = await sb
      .from("rounds")
      .insert({ group_id: groupId, course_id: courseId, date, holes, status: "live" })
      .select("id")
      .single();
    if (error || !round) {
      setBusy(false);
      setErr(error?.message ?? "Could not create round");
      return;
    }

    // 2) Create teams (if any).
    let teamIds: string[] = [];
    if (teamCount > 0) {
      const inserts = Array.from({ length: teamCount }, (_, i) => ({ round_id: round.id, name: `Team ${i + 1}` }));
      const { data: t } = await sb.from("round_teams").insert(inserts).select("id");
      teamIds = t?.map((x) => x.id) ?? [];
    }

    // 3) Create round_players with computed handicaps. We use the sanitized
    // copy so empty tee_ids get backfilled and team indexes are real numbers.
    // Guard: every UUID-bearing field is checked for empty strings before we
    // hand the row to Postgres (which rejects "" for type uuid).
    const guardEmptyUuid = (label: string, v: unknown): string | null => {
      if (typeof v !== "string" || v.length === 0) return label;
      return null;
    };
    for (const [i, p] of sanitized.entries()) {
      const rid = guardEmptyUuid("round_id", round.id);
      const pid = guardEmptyUuid("player_id", p.id);
      const tid = guardEmptyUuid("tee_id", p.tee_id);
      const empties = [rid, pid, tid].filter(Boolean) as string[];
      if (empties.length > 0) {
        setBusy(false);
        setErr(
          `Couldn't start round — player #${i + 1} is missing ${empties.join(", ")}. Refresh the page and try again, or remove and re-add the player.`
        );
        return;
      }
    }

    const rpRows = sanitized.map((p, i) => {
      const player = allPlayers.find((x) => x.id === p.id);
      const tee = tees.find((x) => x.id === p.tee_id);
      const hi = player?.handicap_index ?? 0;
      const ch = tee ? courseHandicap(hi, tee.slope, tee.rating, tee.par, holes) : 0;
      const ph = playingHandicap(ch, 100);
      return {
        round_id: round.id,
        player_id: p.id,
        tee_id: p.tee_id,
        handicap_index_used: hi,
        course_handicap: ch,
        playing_handicap: ph,
        team_id: p._teamIndex >= 0 ? teamIds[p._teamIndex] ?? null : null,
        display_order: i
      };
    });
    const { error: rpe } = await sb.from("round_players").insert(rpRows);
    if (rpe) {
      setBusy(false);
      setErr(rpe.message);
      return;
    }

    // 4) Create games.
    const gameRows = (Object.entries(games) as [GameType, any][])
      .filter(([, v]) => v.enabled)
      .map(([type, v]) => ({
        round_id: round.id,
        game_type: type,
        name: GAMES.find((g) => g.type === type)?.label ?? type,
        stake_cents: v.stake_cents,
        allowance_pct: v.allowance_pct,
        config: v.config
      }));
    if (gameRows.length > 0) await sb.from("round_games").insert(gameRows);

    setBusy(false);
    router.push(`/rounds/${round.id}`);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <header>
        <p className="h-eyebrow">New</p>
        <h1 className="h-display text-3xl text-cream-50 mt-1">New round</h1>
      </header>

      <section className="card p-4 space-y-3">
        <h2 className="font-serif text-xl text-cream-50">Basics</h2>
        {/* Stack date + holes vertically on phones (the type="date" picker
            otherwise overlaps the holes select on small screens). */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="min-w-0">
            <label className="label">Date</label>
            <input className="input w-full" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="min-w-0">
            <label className="label">Holes</label>
            <select className="input w-full" value={holes} onChange={(e) => setHoles(parseInt(e.target.value) as 9 | 18)}>
              <option value={18}>18</option>
              <option value={9}>9</option>
            </select>
          </div>
          <div className="sm:col-span-2 min-w-0">
            <label className="label">Course</label>
            <select className="input" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">Pick a course…</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {courseId && tees.length <= 1 && (
              <p className="text-[11px] text-cream-100/55 mt-1.5">
                Only one tee on file.{" "}
                <a href={`/courses/${courseId}`} className="text-gold-400 underline" target="_blank" rel="noopener noreferrer">
                  Add more tee boxes →
                </a>
              </p>
            )}
            {courseId && courseIssues.errors > 0 && (
              <div className="mt-2 rounded-lg border border-amber-400/40 bg-amber-500/10 p-2.5 text-xs">
                <div className="font-medium text-amber-200">
                  ⚠ {courseIssues.errors} course data issue{courseIssues.errors === 1 ? "" : "s"} detected
                </div>
                <p className="text-amber-100/75 mt-0.5 leading-snug">
                  This course has incomplete data (missing par, duplicate stroke
                  indexes, or missing tee ratings). Net handicap math will be
                  off until it&apos;s fixed.{" "}
                  <a
                    href={`/courses/${courseId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gold-400 underline font-medium"
                  >
                    Fix the course →
                  </a>
                </p>
              </div>
            )}
            {courseId && tees.length > 1 && (
              <p className="text-[11px] text-cream-100/45 mt-1.5">
                {tees.length} tee boxes available · pick per player below
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="card p-4 space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="font-serif text-xl text-cream-50">Players</h2>
          <span className="text-xs text-cream-100/55">
            {pickedPlayers.length} picked
          </span>
        </div>

        {lastLineup && pickedPlayers.length === 0 && (
          <button
            type="button"
            className="w-full text-left rounded-xl border border-gold-500/30 bg-brand-900/40 hover:bg-brand-900/70 p-3 transition-colors"
            onClick={() => {
              const valid = lastLineup.playerIds.filter((pid) => allPlayers.some((p) => p.id === pid));
              setPickedPlayers(valid.map((pid) => ({ id: pid, tee_id: (tees.length >= 2 ? tees[1]?.id : tees[0]?.id) ?? "", team_id: null })));
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-serif text-cream-50">Re-play with last round&apos;s lineup</div>
                <p className="text-xs text-cream-100/65 mt-0.5">
                  {lastLineup.courseName} · {lastLineup.date} · {lastLineup.playerIds.length} players
                </p>
              </div>
              <span className="pill bg-gold-500 text-brand-900 text-xs">Use →</span>
            </div>
          </button>
        )}

        {/* Inline guest creation — for ad-hoc players who aren't in the directory yet */}
        <div className="surface rounded-xl p-3 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_120px_auto] gap-2 items-end">
          <div>
            <label className="label">Add a guest player</label>
            <input
              className="input text-sm"
              placeholder="Name (e.g. Dave)"
              value={guestDraft.name}
              onChange={(e) => setGuestDraft({ ...guestDraft, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">HI</label>
            <input
              className="input text-sm"
              type="text"
              inputMode="decimal"
              placeholder="14.0 or +1.4"
              value={guestDraft.hi}
              onChange={(e) => setGuestDraft({ ...guestDraft, hi: e.target.value })}
            />
          </div>
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={guestBusy || !guestDraft.name.trim()}
            onClick={addGuest}
          >
            {guestBusy ? "Adding…" : "Add guest"}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {allPlayers.map((p) => {
            const picked = pickedPlayers.find((x) => x.id === p.id);
            const lp = lastPlayedAt[p.id];
            const hiValue = hiEdits[p.id] ?? hiInputValue(p.handicap_index);
            return (
              <div
                key={p.id}
                className={`card p-3 transition-colors ${picked ? "ring-2 ring-gold-500/60 bg-brand-800/70" : ""}`}
              >
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={!!picked} onChange={() => togglePlayer(p.id)} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-cream-50 truncate">{p.display_name}</div>
                    <div className="text-xs text-cream-100/55">
                      {lp ? `Last played ${lp}` : "New to this group"}
                    </div>
                  </div>
                  {!picked && (
                    <span className="text-xs text-cream-100/55 tabular-nums">HI {formatHi(p.handicap_index)}</span>
                  )}
                </label>
                {picked && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div>
                      <label className="label text-xs">Handicap Index</label>
                      <input
                        className="input text-sm"
                        type="text"
                        inputMode="decimal"
                        value={hiValue}
                        placeholder="14.0 or +1.4"
                        onChange={(e) => {
                          const v = e.target.value;
                          setHiEdits((prev) => ({ ...prev, [p.id]: v }));
                        }}
                        onBlur={async () => {
                          const raw = hiEdits[p.id];
                          if (raw == null) return;
                          const parsed = parseHi(raw);
                          // Re-render the input as a normalized value (e.g., "+1.4" stays "+1.4",
                          // "1.4" stays "1.4") so the user sees what was actually saved.
                          setHiEdits((prev) => ({ ...prev, [p.id]: hiInputValue(parsed) }));
                          if (parsed === p.handicap_index) return;
                          await sb
                            .from("players")
                            .update({
                              handicap_index: parsed,
                              handicap_index_source: "manual",
                              handicap_updated_at: new Date().toISOString()
                            })
                            .eq("id", p.id);
                          setAllPlayers((prev) =>
                            prev.map((x) => (x.id === p.id ? { ...x, handicap_index: parsed } : x))
                          );
                        }}
                      />
                      <p className="text-[10px] text-cream-100/45 mt-0.5">
                        Plus index? Type with a +, e.g. <span className="text-gold-400">+1.4</span>
                      </p>
                    </div>
                    {tees.length > 0 && (
                      <div>
                        <label className="label text-xs">Tees</label>
                        <select
                          className="input text-sm"
                          value={picked.tee_id}
                          onChange={(e) =>
                            setPickedPlayers((arr) =>
                              arr.map((x) => (x.id === p.id ? { ...x, tee_id: e.target.value } : x))
                            )
                          }
                        >
                          {tees.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name} · {t.rating}/{t.slope}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {(teamGameEnabled || sixSixSixEnabled) && pickedPlayers.length > 0 && (
        <div className="card p-3 border border-gold-500/30 bg-gold-500/5 text-sm">
          <div className="font-medium text-cream-50">
            Team game selected — make sure your teams are set below
          </div>
          <p className="text-xs text-cream-100/65 mt-0.5 leading-snug">
            {sixSixSixEnabled
              ? "6-6-6 needs exactly 4 picked players; partners rotate every 6 holes (no manual team assignment needed)."
              : `2 teams have been auto-shuffled for you. Drag a player onto a different team if you want to change it.`}
          </p>
        </div>
      )}

      <TeamsSection
        pickedPlayers={pickedPlayers}
        setPickedPlayers={setPickedPlayers}
        allPlayers={allPlayers}
        teamCount={teamCount}
        setTeamCount={setTeamCount}
      />

      <section className="card p-4 space-y-3">
        <div className="flex items-end justify-between gap-2 flex-wrap">
          <div>
            <h2 className="font-serif text-xl text-cream-50">Quick start</h2>
            <p className="text-[11px] text-cream-100/55 mt-0.5">
              Pick a starting setup, or load one of your saved presets below.
            </p>
          </div>
          <button
            type="button"
            onClick={savePresetFromCurrentGames}
            disabled={!hasAnyGameEnabled}
            title={
              hasAnyGameEnabled
                ? "Save current games + stakes as a reusable preset"
                : "Enable at least one game first, then save it as a preset."
            }
            className={`btn-secondary text-xs ${
              !hasAnyGameEnabled ? "opacity-40 cursor-not-allowed" : ""
            }`}
          >
            ★ Save current setup
          </button>
        </div>

        {myPresets.length > 0 && (
          <>
            <p className="text-[11px] uppercase tracking-wider text-cream-100/55">My presets</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {myPresets.map((p) => (
                <div key={p.id} className="card card-hover p-3 relative">
                  <button
                    type="button"
                    onClick={() => applyPresetGames(p.games as any[])}
                    className="text-left w-full pr-7"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xl leading-none">{p.emoji ?? "★"}</span>
                      <span className="font-serif text-base text-cream-50 truncate">{p.name}</span>
                    </div>
                    {p.blurb && <p className="text-xs text-cream-100/65 mt-1 truncate">{p.blurb}</p>}
                    <p className="text-[10px] text-cream-100/45 mt-1">
                      {(p.games as any[]).length} game{(p.games as any[]).length === 1 ? "" : "s"}
                      {p.use_count > 0 ? ` · used ${p.use_count}×` : ""}
                    </p>
                  </button>
                  {/* Delete is now always visible (no hover needed) so it
                      works on mobile. Same color as ghost text so it doesn't
                      feel destructive at a glance. */}
                  <button
                    type="button"
                    onClick={() => deletePreset(p.id)}
                    className="absolute top-2 right-2 text-cream-100/40 hover:text-red-300 active:text-red-300 text-sm leading-none px-1"
                    aria-label={`Delete preset ${p.name}`}
                    title="Delete this preset"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <p className="text-[11px] uppercase tracking-wider text-cream-100/55 mt-1">Suggested packages</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {GAME_PACKAGES.map((pkg) => (
            <button
              key={pkg.id}
              type="button"
              onClick={() => applyPackage(pkg.games)}
              className="text-left card card-hover p-3 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-xl leading-none">{pkg.emoji}</span>
                <span className="font-serif text-base text-cream-50">{pkg.label}</span>
              </div>
              <p className="text-xs text-cream-100/65 mt-1">{pkg.blurb}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="card p-4 space-y-2">
        <h2 className="font-serif text-xl text-cream-50">Games</h2>
        {GAMES.map((g) => {
          const v = games[g.type];
          return (
            <div key={g.type} className="border-t border-cream-100/8 first:border-t-0 py-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={v.enabled}
                  onChange={(e) =>
                    setGames((s) => ({ ...s, [g.type]: { ...s[g.type], enabled: e.target.checked } }))
                  }
                />
                <span className="flex-1 font-medium text-cream-50">{g.label}</span>
              </label>
              {v.enabled && (
                <GameConfigEditor
                  gameType={g.type}
                  value={v}
                  onChange={(patch) =>
                    setGames((s) => ({ ...s, [g.type]: { ...s[g.type], ...patch } }))
                  }
                />
              )}
            </div>
          );
        })}
        {/* Second-chance Save Preset button so the user sees it after
            they've actually configured the games, not just at the top
            of Quick Start. */}
        {hasAnyGameEnabled && (
          <div className="flex justify-end pt-2 border-t border-cream-100/8">
            <button
              type="button"
              onClick={savePresetFromCurrentGames}
              className="btn-secondary text-xs"
              title="Save current games + stakes as a reusable preset"
            >
              ★ Save these games as a preset
            </button>
          </div>
        )}
      </section>

      {err && <p className="text-red-300 text-sm">{err}</p>}
      <button className="btn-primary w-full sm:w-auto" disabled={busy} onClick={startRound}>
        {busy ? "Starting…" : "Start round"}
      </button>
    </div>
  );
}

// ---------- Game config editor ----------

function asCents(v: string) {
  const n = parseFloat(v);
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}
const fromCents = (c: number) => (c / 100).toFixed(2);

function GameConfigEditor({
  gameType,
  value,
  onChange
}: {
  gameType: GameType;
  value: { stake_cents: number; allowance_pct: number; config: any };
  onChange: (patch: Partial<{ stake_cents: number; allowance_pct: number; config: any }>) => void;
}) {
  const setConfig = (patch: any) => onChange({ config: { ...value.config, ...patch } });

  if (gameType === "nassau") {
    const cfg = value.config;
    return (
      <div className="mt-3 pl-6 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Money label="Front $" cents={cfg.front_stake_cents ?? value.stake_cents} onChange={(c) => setConfig({ front_stake_cents: c })} />
          <Money label="Back $" cents={cfg.back_stake_cents ?? value.stake_cents} onChange={(c) => setConfig({ back_stake_cents: c })} />
          <Money label="Overall $" cents={cfg.overall_stake_cents ?? value.stake_cents} onChange={(c) => setConfig({ overall_stake_cents: c })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label text-xs">Format</label>
            <select className="input text-sm" value={cfg.match_play === false ? "stroke" : "match"} onChange={(e) => setConfig({ match_play: e.target.value === "match" })}>
              <option value="match">Match play</option>
              <option value="stroke">Stroke play</option>
            </select>
          </div>
          <div>
            <label className="label text-xs">Presses</label>
            <select className="input text-sm" value={cfg.presses ?? "none"} onChange={(e) => setConfig({ presses: e.target.value })}>
              <option value="none">None</option>
              <option value="auto_2_down">Auto-press at 2 down</option>
              <option value="manual">Manual (commissioner adds during round)</option>
            </select>
          </div>
        </div>
      </div>
    );
  }

  if (gameType === "match_play") {
    return (
      <div className="mt-3 pl-6 grid grid-cols-2 gap-2">
        <Money label="Stake $" cents={value.stake_cents} onChange={(c) => onChange({ stake_cents: c })} />
        <div>
          <label className="label text-xs">Format</label>
          <select className="input text-sm" value={value.config.match_play === false ? "stroke" : "match"} onChange={(e) => setConfig({ match_play: e.target.value === "match" })}>
            <option value="match">Match play</option>
            <option value="stroke">Stroke play</option>
          </select>
        </div>
      </div>
    );
  }

  if (isSkins(gameType)) {
    const cfg = value.config;
    const skinMode: "pot" | "fixed" = cfg.skin_mode ?? "pot";
    return (
      <div className="mt-3 pl-6 space-y-3">
        {/* Pricing mode toggle */}
        <div>
          <label className="label text-xs">Pricing</label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <button
              type="button"
              onClick={() => setConfig({ skin_mode: "pot" })}
              className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                skinMode === "pot"
                  ? "border-gold-500/60 bg-gold-500/10"
                  : "border-cream-100/15 bg-brand-900/40"
              }`}
            >
              <div className="text-sm font-medium text-cream-50">Pot</div>
              <div className="text-[11px] text-cream-100/60 mt-0.5">
                Each player buys in. Pot is split equally among the skins won.
              </div>
            </button>
            <button
              type="button"
              onClick={() => setConfig({ skin_mode: "fixed" })}
              className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                skinMode === "fixed"
                  ? "border-gold-500/60 bg-gold-500/10"
                  : "border-cream-100/15 bg-brand-900/40"
              }`}
            >
              <div className="text-sm font-medium text-cream-50">Fixed per skin</div>
              <div className="text-[11px] text-cream-100/60 mt-0.5">
                Same dollar value for every skin won. Optional carry multiplier.
              </div>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {skinMode === "pot" ? (
            <Money
              label="Buy-in / player $"
              cents={cfg.buyin_cents ?? value.stake_cents ?? 2000}
              onChange={(c) => {
                setConfig({ buyin_cents: c });
                // Mirror to stake_cents so the wager-handshake gate uses the right number
                onChange({ stake_cents: c });
              }}
            />
          ) : (
            <Money
              label="Skin value $"
              cents={cfg.skin_value_cents ?? 100}
              onChange={(c) => setConfig({ skin_value_cents: c })}
            />
          )}
          <div>
            <label className="label text-xs">Ties</label>
            <select
              className="input text-sm"
              value={cfg.ties ?? (skinMode === "pot" ? "carry" : "split")}
              onChange={(e) => setConfig({ ties: e.target.value })}
            >
              {skinMode === "pot" ? (
                <>
                  <option value="carry">Carry (no skin awarded)</option>
                  <option value="nullify">Nullify (no skin)</option>
                </>
              ) : (
                <>
                  <option value="split">Split</option>
                  <option value="carry">Carry</option>
                  <option value="nullify">Nullify</option>
                </>
              )}
            </select>
          </div>
          {skinMode === "fixed" && (
            <div>
              <label className="label text-xs">Carry escalation</label>
              <select className="input text-sm" value={cfg.escalation ?? "flat"} onChange={(e) => setConfig({ escalation: e.target.value })}>
                <option value="flat">Flat</option>
                <option value="linear">Linear (×N)</option>
                <option value="double">Double (2^N)</option>
              </select>
            </div>
          )}
          {gameType === "skins_canadian" && (
            <div>
              <label className="label text-xs">Birdie validates</label>
              <select className="input text-sm" value={cfg.require_birdie === false ? "off" : "on"} onChange={(e) => setConfig({ require_birdie: e.target.value === "on" })}>
                <option value="on">Yes</option>
                <option value="off">No</option>
              </select>
            </div>
          )}
          <div>
            <label className="label text-xs">Allowance %</label>
            <input
              className="input text-sm"
              type="text"
              inputMode="numeric"
              defaultValue={value.allowance_pct}
              key={value.allowance_pct}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => {
                const v = parseInt(e.currentTarget.value, 10);
                onChange({ allowance_pct: Number.isFinite(v) ? v : 100 });
              }}
            />
          </div>
        </div>

        {skinMode === "pot" && (
          <p className="text-[11px] text-cream-100/55 leading-snug">
            Example: ${((cfg.buyin_cents ?? value.stake_cents ?? 2000) / 100).toFixed(0)} buy-in × N players = total pot. If 4 skins are won, each is worth pot ÷ 4. If 0 skins are won, the pot returns.
          </p>
        )}
      </div>
    );
  }

  if (gameType === "six_six_six") {
    return (
      <div className="mt-3 pl-6 grid grid-cols-2 gap-2">
        <Money label="Stake per segment $" cents={value.stake_cents} onChange={(c) => onChange({ stake_cents: c })} />
        <div>
          <label className="label text-xs">Format</label>
          <select className="input text-sm" value={value.config.match_play === false ? "stroke" : "match"} onChange={(e) => setConfig({ match_play: e.target.value === "match" })}>
            <option value="match">Match play (best ball, 6 holes)</option>
            <option value="stroke">Stroke play (best-ball total)</option>
          </select>
        </div>
        <p className="col-span-2 text-xs text-cream-100/55">
          Holes 1–6: AB vs CD · 7–12: AC vs BD · 13–18: AD vs BC. 4 players required.
        </p>
      </div>
    );
  }

  if (gameType === "ctp" || gameType === "long_drive") {
    return (
      <div className="mt-3 pl-6 grid grid-cols-2 gap-2">
        <Money label="Stake / hole $" cents={value.stake_cents} onChange={(c) => onChange({ stake_cents: c })} />
        <div>
          <label className="label text-xs">Holes (comma-sep)</label>
          <input
            className="input text-sm"
            value={(value.config.holes ?? []).join(", ")}
            onChange={(e) =>
              setConfig({
                holes: e.target.value
                  .split(",")
                  .map((s) => parseInt(s.trim()))
                  .filter((n) => !isNaN(n) && n >= 1 && n <= 18)
              })
            }
            placeholder={gameType === "ctp" ? "3, 6, 12, 17" : "8"}
          />
        </div>
      </div>
    );
  }

  // Default editor: stake + allowance.
  return (
    <div className="mt-3 pl-6 grid grid-cols-2 gap-2">
      <Money label="Stake $" cents={value.stake_cents} onChange={(c) => onChange({ stake_cents: c })} />
      <div>
        <label className="label text-xs">Allowance %</label>
        <input
              className="input text-sm"
              type="text"
              inputMode="numeric"
              defaultValue={value.allowance_pct}
              key={value.allowance_pct}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => {
                const v = parseInt(e.currentTarget.value, 10);
                onChange({ allowance_pct: Number.isFinite(v) ? v : 100 });
              }}
            />
      </div>
    </div>
  );
}

function Money({ label, cents, onChange }: { label: string; cents: number; onChange: (cents: number) => void }) {
  // Uncontrolled input + onBlur commit. Type-as-text so users can clear and
  // retype freely without React reformatting their cursor mid-edit.
  // Select-on-focus makes "tap to replace" feel native on phones.
  return (
    <div>
      <label className="label text-xs">{label}</label>
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-cream-100/55 text-sm pointer-events-none">$</span>
        <input
          className="input text-sm pl-5"
          type="text"
          inputMode="decimal"
          defaultValue={fromCents(cents)}
          key={cents /* re-mount when external value changes (e.g., preset applied) */}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            const next = asCents(e.target.value);
            if (next !== cents) onChange(next);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
    </div>
  );
}

// ---------- Teams: random shuffle + drag-and-drop ----------

function TeamsSection({
  pickedPlayers,
  setPickedPlayers,
  allPlayers,
  teamCount,
  setTeamCount
}: {
  pickedPlayers: { id: string; tee_id: string; team_id: string | null }[];
  setPickedPlayers: (updater: (prev: { id: string; tee_id: string; team_id: string | null }[]) => { id: string; tee_id: string; team_id: string | null }[]) => void;
  allPlayers: any[];
  teamCount: number;
  setTeamCount: (n: number) => void;
}) {
  function shuffle() {
    const indexes = Array.from({ length: teamCount }, (_, i) => String(i));
    const order = [...pickedPlayers].map((p) => p.id);
    // Fisher-Yates
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const assignment = new Map<string, string>();
    order.forEach((pid, i) => assignment.set(pid, indexes[i % teamCount]));
    setPickedPlayers((arr) => arr.map((p) => ({ ...p, team_id: assignment.get(p.id) ?? null })));
  }

  function setTeam(playerId: string, teamId: string | null) {
    setPickedPlayers((arr) => arr.map((p) => (p.id === playerId ? { ...p, team_id: teamId } : p)));
  }

  function onDragStart(e: React.DragEvent, playerId: string) {
    e.dataTransfer.setData("text/plain", playerId);
    e.dataTransfer.effectAllowed = "move";
  }
  function onDrop(e: React.DragEvent, teamId: string | null) {
    e.preventDefault();
    const pid = e.dataTransfer.getData("text/plain");
    if (pid) setTeam(pid, teamId);
  }
  function allowDrop(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  const buckets: Array<{ id: string; label: string; members: typeof pickedPlayers }> = [];
  buckets.push({
    id: "__none__",
    label: "Unassigned",
    members: pickedPlayers.filter((p) => !p.team_id)
  });
  for (let i = 0; i < teamCount; i++) {
    buckets.push({
      id: String(i),
      label: `Team ${i + 1}`,
      members: pickedPlayers.filter((p) => p.team_id === String(i))
    });
  }

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <h2 className="font-serif text-xl text-cream-50">Teams</h2>
        <div className="flex items-center gap-2">
          <label className="label mb-0 mr-1">Teams</label>
          <input
            className="input w-20"
            type="text"
            inputMode="numeric"
            defaultValue={teamCount}
            key={teamCount}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => {
              const v = parseInt(e.currentTarget.value, 10);
              setTeamCount(Number.isFinite(v) ? Math.max(0, Math.min(6, v)) : 0);
            }}
          />
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={teamCount === 0 || pickedPlayers.length === 0}
            onClick={shuffle}
          >
            🎲 Random pairings
          </button>
        </div>
      </div>

      {teamCount === 0 ? (
        <p className="text-xs text-cream-100/55">No teams (individual play). Bump teams to 2+ for team formats.</p>
      ) : (
        <>
          <p className="text-xs text-cream-100/55">
            Drag a player onto a team. Or hit Random to spin pairings up.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {buckets.map((b) => (
              <div
                key={b.id}
                className={`rounded-xl border-2 border-dashed p-3 min-h-[88px] transition-colors ${b.id === "__none__" ? "border-cream-100/15 bg-brand-950/30" : "border-gold-500/40 bg-brand-900/40"}`}
                onDrop={(e) => onDrop(e, b.id === "__none__" ? null : b.id)}
                onDragOver={allowDrop}
              >
                <div className="text-xs uppercase tracking-wide text-cream-100/60 mb-2">{b.label}</div>
                <div className="space-y-1.5">
                  {b.members.length === 0 && (
                    <div className="text-xs text-cream-100/35 italic">drop a player here</div>
                  )}
                  {b.members.map((p) => {
                    const player = allPlayers.find((x) => x.id === p.id);
                    return (
                      <div
                        key={p.id}
                        draggable
                        onDragStart={(e) => onDragStart(e, p.id)}
                        className="surface rounded-lg px-3 py-1.5 text-sm flex items-center justify-between cursor-grab active:cursor-grabbing"
                      >
                        <span className="text-cream-50 truncate">{player?.display_name ?? p.id}</span>
                        <span className="text-xs text-cream-100/45">HI {formatHi(player?.handicap_index)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
