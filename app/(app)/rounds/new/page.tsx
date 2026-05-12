"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";
import { courseHandicap, playingHandicap } from "@/lib/handicap";
import { formatHi, hiInputValue, parseHi } from "@/lib/handicap-format";
import { GAME_PACKAGES } from "@/lib/presets/game-packages";
import { GAME_FAMILIES, getFamily, getPreset, type GameFamily } from "@/lib/games/library";
import type { GameType } from "@/lib/types";

// Every concrete game_type referenced by this page. Derived from the
// GAME_FAMILIES catalog so adding a new variant in lib/games/library.ts
// flows here automatically. Order: families first (in catalog order),
// each family's variants × its modes.
//
// Replaced the old flat GAMES array (which had separate "Skins (gross)"
// and "Skins (net)" entries) with a family-grouped picker. The state
// shape is still keyed by concrete GameType — only the rendering
// changed. See lib/games/library.ts for the family/variant/mode model.
const ALL_GAME_TYPES: GameType[] = (() => {
  const out = new Set<GameType>();
  for (const f of GAME_FAMILIES) {
    for (const v of f.variants) {
      if (f.hasMode) {
        out.add(v.resolve("gross"));
        out.add(v.resolve("net"));
      } else {
        out.add(v.resolve(null));
      }
    }
  }
  return [...out];
})();

function isSkins(t: GameType) {
  return t === "skins_gross" || t === "skins_net" || t === "skins_canadian";
}

/** Default config for a freshly-enabled game type. Uses the same defaults
 *  the library-level catalog declares, so the picker UI stays in sync
 *  with the in-round games-editor. */
function defaultConfigFor(t: GameType): Record<string, unknown> {
  const p = getPreset(t);
  return (p?.defaults.config as Record<string, unknown>) ?? {};
}

/** Resolve which concrete game_type a (family, variant, mode) tuple
 *  refers to. Wraps the family.variants[i].resolve callback with a
 *  null-safe path. */
function resolveGameType(
  family: GameFamily,
  variantKey: string,
  mode: "gross" | "net"
): GameType | null {
  const v = family.variants.find((x) => x.key === variantKey);
  if (!v) return null;
  return v.resolve(family.hasMode ? mode : null);
}

/** Inverse: given a concrete game_type, find its family + variant + mode.
 *  Used when a saved preset / package writes a concrete type and we need
 *  to render the picker with the right family selected. */
function findFamilyForType(
  t: GameType
): { family: GameFamily; variantKey: string; mode: "gross" | "net" | null } | null {
  for (const f of GAME_FAMILIES) {
    for (const v of f.variants) {
      if (f.hasMode) {
        if (v.resolve("gross") === t) return { family: f, variantKey: v.key, mode: "gross" };
        if (v.resolve("net") === t) return { family: f, variantKey: v.key, mode: "net" };
      } else {
        if (v.resolve(null) === t) return { family: f, variantKey: v.key, mode: null };
      }
    }
  }
  return null;
}

export default function NewRoundPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // "Start today's round" hero on /dashboard links here with
  // ?fromLast=1. When the flag is set, we auto-apply last round's
  // course + lineup + games on first render — the form lands fully
  // pre-filled so a returning user only has to tap Start. Per Patrick
  // 2026-05-12 product framing: setup welcome > configurability.
  const wantFromLast = searchParams?.get("fromLast") === "1";
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
  // Snapshot of the last round's course + games. Sibling to lastLineup
  // — kept separate so the existing "Re-play with last lineup" button
  // doesn't change behavior (it only applies the lineup; this snapshot
  // drives the full fromLast=1 auto-apply path). Null when there's no
  // history.
  const [lastSnapshot, setLastSnapshot] = useState<{
    courseId: string;
    games: Array<{
      game_type: GameType;
      stake_cents: number;
      allowance_pct: number;
      config: any;
    }>;
  } | null>(null);
  const [autoAppliedFromLast, setAutoAppliedFromLast] = useState(false);
  // True once the initial data load completes. Lets the auto-apply
  // effect distinguish "still loading, keep waiting" from "load
  // finished but there's nothing to re-use" (so the amber notice can
  // render in the latter case instead of leaving the user with a
  // silent blank form).
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [pickedPlayers, setPickedPlayers] = useState<{ id: string; tee_id: string; team_id: string | null }[]>([]);
  const [teamCount, setTeamCount] = useState(0);
  const [games, setGames] = useState<Record<GameType, { enabled: boolean; stake_cents: number; allowance_pct: number; config: any }>>(
    Object.fromEntries(
      ALL_GAME_TYPES.map((t) => [
        t,
        { enabled: false, stake_cents: 1000, allowance_pct: 100, config: defaultConfigFor(t) }
      ])
    ) as any
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Junk side-bets — opt-in at round creation (so the commissioner
  // doesn't have to come back to /rounds/[id]/games to set it up).
  // Default $2 flat per item; mirror DEFAULT_JUNK_CONFIG categories.
  const [junkEnabled, setJunkEnabled] = useState(false);
  const [junkFlatDollars, setJunkFlatDollars] = useState<number>(2);

  // User-saved Quick Start presets.
  const [myPresets, setMyPresets] = useState<any[]>([]);
  // Inline error for preset save / delete — replaces alert() so the
  // installed PWA doesn't pop a native system dialog. Cleared on next
  // successful action.
  const [presetErr, setPresetErr] = useState<string | null>(null);

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
      setPresetErr(`Couldn't save preset: ${error.message}`);
      return;
    }
    setPresetErr(null);
    if (data) setMyPresets((prev) => [data, ...prev]);
  }

  async function deletePreset(id: string) {
    if (!confirm("Delete this preset?")) return;
    const { error } = await sb.from("quick_start_presets").delete().eq("id", id);
    if (error) {
      setPresetErr(`Couldn't delete preset: ${error.message}`);
      return;
    }
    setPresetErr(null);
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

  // Existing live rounds for this group — surfaced as a soft guard
  // at the top of the form so the user doesn't accidentally start a
  // second round while the first is mid-play. Per Patrick 2026-05-12
  // chaos-QA pass: we don't BLOCK creation (some groups legitimately
  // run parallel rounds), but we make the existing one one-tap to
  // resume.
  const [existingLive, setExistingLive] = useState<
    Array<{ id: string; date: string; courseName: string | null }>
  >([]);

  useEffect(() => {
    (async () => {
      const { data: g } = await sb.from("groups").select("id").limit(1);
      const gid = g?.[0]?.id;
      setGroupId(gid ?? null);
      if (!gid) return;

      const [coursesRes, playersRes, recentRoundsRes, userRes, liveRoundsRes] = await Promise.all([
        sb.from("courses").select("id, name, status").eq("group_id", gid).is("deleted_at", null),
        sb.from("players").select("id, display_name, handicap_index, profile_id, default_tee_name").eq("group_id", gid).is("deleted_at", null),
        sb
          .from("rounds")
          .select("id, date, course_id, courses(name), round_players(player_id), round_games(game_type, stake_cents, allowance_pct, config)")
          .eq("group_id", gid)
          .is("deleted_at", null)
          .order("date", { ascending: false })
          .limit(20),
        sb.auth.getUser(),
        sb
          .from("rounds")
          .select("id, date, courses(name)")
          .eq("group_id", gid)
          .eq("status", "live")
          .is("deleted_at", null)
          .order("date", { ascending: false })
          .limit(5)
      ]);

      setExistingLive(
        ((liveRoundsRes.data as any[]) ?? []).map((r) => ({
          id: r.id as string,
          date: r.date as string,
          courseName: (r.courses?.name as string | undefined) ?? null
        }))
      );

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

      // Capture last round's lineup for the quick "use last lineup" button
      // AND the broader snapshot (course + games) for the ?fromLast=1
      // auto-apply path triggered from /dashboard's "Start today's round"
      // hero. The lineup state is left exactly as before so the existing
      // manual button is unchanged.
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
        if (lastRound.course_id) {
          setLastSnapshot({
            courseId: lastRound.course_id as string,
            games: ((lastRound.round_games as any[]) ?? []).map((g) => ({
              game_type: g.game_type as GameType,
              stake_cents: g.stake_cents ?? 0,
              allowance_pct: g.allowance_pct ?? 100,
              config: g.config ?? {}
            }))
          });
        }
      }
      // Signal "load done" even when there's no history, so the
      // auto-apply effect can stop waiting and show its empty-state
      // notice instead of leaving the user on a silent blank form.
      setInitialLoadDone(true);
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

  // Auto-apply from /dashboard's "Start today's round" hero.
  //
  // The flow runs as a small state machine:
  //   1. Wait until lastSnapshot + lastLineup + allPlayers are loaded.
  //   2. Set courseId to the last round's course (triggers tees load).
  //   3. Once tees finish loading for the new course, apply the player
  //      lineup (with each player's preferred tee) AND the last round's
  //      games. Flip autoAppliedFromLast so the effect doesn't fire again
  //      if the user edits state afterwards.
  //
  // Skipped silently when: the URL flag isn't set, no last round exists,
  // or the last round's course has since been archived (drops out of the
  // courses list, courseId can't resolve, user falls through to the
  // normal form).
  useEffect(() => {
    if (!wantFromLast || autoAppliedFromLast) return;
    // If the initial load finished and there's NOTHING to re-use,
    // flip the flag so the amber "couldn't auto-fill" notice shows
    // instead of waiting forever on a silent blank form. The user
    // tapped "Start today's round" expecting some pre-fill, and we
    // owe them a signal that we tried.
    if (initialLoadDone && (!lastSnapshot || !lastLineup)) {
      setAutoAppliedFromLast(true);
      return;
    }
    if (!lastSnapshot || !lastLineup) return;
    if (allPlayers.length === 0) return;
    // Stage 1: set course if not yet set. Bail if the last round's
    // course no longer exists (archived / deleted).
    const courseExists = courses.some((c) => c.id === lastSnapshot.courseId);
    if (!courseExists) {
      // Mark as applied so we don't loop forever; the user falls
      // through to the normal manual form.
      setAutoAppliedFromLast(true);
      return;
    }
    if (courseId !== lastSnapshot.courseId) {
      setCourseId(lastSnapshot.courseId);
      return;
    }
    // Stage 2: tees must be loaded before we can map per-player tees.
    if (tees.length === 0) return;
    // Apply lineup with each player's preferred tee.
    const valid = lastLineup.playerIds.filter((pid) =>
      allPlayers.some((p) => p.id === pid)
    );
    setPickedPlayers(
      valid.map((pid) => ({
        id: pid,
        tee_id: pickTeeForPlayer(pid),
        team_id: null
      }))
    );
    // Apply games from the snapshot. applyPackage handles the
    // disable-all-other-games-first pattern.
    if (lastSnapshot.games.length > 0) {
      applyPackage(lastSnapshot.games);
    }
    setAutoAppliedFromLast(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    wantFromLast,
    autoAppliedFromLast,
    initialLoadDone,
    lastSnapshot,
    lastLineup,
    allPlayers,
    courses,
    courseId,
    tees
  ]);

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
    // Blank HI → scratch (0). Audit P2 #22 — out-of-town buddy
    // without a known index shouldn't be blocked from joining.
    const hi = parseHi(guestDraft.hi) ?? 0;
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
      setErr(error ? friendlyAuthError(error) : "Could not add guest");
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
      setErr(error ? friendlyAuthError(error) : "Could not create round");
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

    // 4) Create games. Game name comes from the catalog preset (which
    //    is the same source the in-round games-editor uses), so the
    //    label "Skins (net)" matches across surfaces.
    const gameRows = (Object.entries(games) as [GameType, any][])
      .filter(([, v]) => v.enabled)
      .map(([type, v]) => ({
        round_id: round.id,
        game_type: type,
        name: getPreset(type)?.label ?? type,
        stake_cents: v.stake_cents,
        allowance_pct: v.allowance_pct,
        config: v.config
      }));
    if (gameRows.length > 0) await sb.from("round_games").insert(gameRows);

    // 5) Junk side-bets — only if the commissioner toggled it on
    //    during creation. Defaults match DEFAULT_JUNK_CONFIG (flat
    //    mode, $2/item, 7 active categories). They can edit any of
    //    this from /rounds/[id]/games after the round is live.
    //    Defensive try/catch so the round still creates if junk's
    //    RPC isn't available (pre-0041 env, network blip).
    if (junkEnabled) {
      const cents = Math.max(0, Math.round(junkFlatDollars * 100));
      try {
        await sb.rpc("fn_set_junk_config", {
          p_round_id: round.id,
          p_active_categories: [
            "birdie",
            "eagle",
            "greenie",
            "sandy",
            "chip_in",
            "poley",
            "pinny"
          ],
          p_mode: "flat",
          p_flat_amount_cents: cents,
          p_base_amount_cents: 200,
          p_escalation_step_cents: 200,
          p_escalation_scope: "per_round",
          p_custom_categories: null
        });
      } catch {
        /* round still proceeds; commissioner can enable junk from
           /rounds/[id]/games */
      }
    }

    setBusy(false);
    router.push(`/rounds/${round.id}`);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <header>
        <p className="h-eyebrow">New</p>
        <h1 className="h-display text-3xl text-cream-50 mt-1">New round</h1>
      </header>

      {/* Soft note when the dashboard's "Start today's round" hero
          successfully pre-filled the form. Reassures the user that
          the lineup + course + games came from their last round and
          they can still change anything below. */}
      {wantFromLast && autoAppliedFromLast && pickedPlayers.length > 0 && (
        <div className="card p-3 border border-emerald-400/30 bg-emerald-500/5 text-xs text-cream-100/85">
          Re-using last round&apos;s course, lineup, and games. Adjust
          anything below before tapping <span className="text-cream-50">Start round</span>.
        </div>
      )}
      {wantFromLast && autoAppliedFromLast && pickedPlayers.length === 0 && (
        <div className="card p-3 border border-amber-400/30 bg-amber-500/5 text-xs text-cream-100/85">
          We tried to re-use your last round but couldn&apos;t auto-fill
          it — the course or players may have changed. Set up the round
          manually below.
        </div>
      )}

      {/* Soft guard against accidentally creating a second live round.
          Per Patrick 2026-05-12 chaos-QA pass: nothing blocks the
          user from creating a parallel round (some groups legitimately
          do A/B rounds), but the existing live round(s) are one tap
          to continue from here, so the user can't pretend they don't
          exist. */}
      {existingLive.length > 0 && (
        <div className="card p-3 border border-amber-400/30 bg-amber-500/5 text-sm space-y-2">
          <div className="font-medium text-cream-50">
            You&apos;ve already got {existingLive.length} live round
            {existingLive.length === 1 ? "" : "s"} going
          </div>
          <ul className="space-y-1">
            {existingLive.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/rounds/${r.id}`}
                  className="text-gold-400 hover:underline inline-flex items-center gap-1.5"
                >
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Continue: {r.courseName ?? "Round"} · {r.date}
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-cream-100/55 leading-snug">
            Starting a new round below creates another. Finalize or
            archive the existing one first if you only meant to play
            once today.
          </p>
        </div>
      )}

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
            {/* Course-data warning — suppressed on verified courses
                even when the audit fires. The audit is for admins,
                not for first-time golfers. A new user picking JGCC
                (verified) and seeing "net handicap math will be off"
                will lose trust in the app on their home course.
                Verified-with-issues is an internal bug — log it
                server-side, don't surface it to the round-creator. */}
            {courseId &&
              courseIssues.errors > 0 &&
              (courses.find((c) => c.id === courseId)?.status !== "verified") && (
                <div className="mt-2 rounded-lg border border-amber-400/40 bg-amber-500/10 p-2.5 text-xs">
                  <div className="font-medium text-amber-200">
                    ⚠ {courseIssues.errors} course data issue
                    {courseIssues.errors === 1 ? "" : "s"} detected
                  </div>
                  <p className="text-amber-100/75 mt-0.5 leading-snug">
                    This course has incomplete data (missing par,
                    duplicate stroke indexes, or missing tee ratings).
                    Net handicap math will be off until it&apos;s
                    fixed.{" "}
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

      {/* Quick start moved above Players (audit P1 #6) so a first-
          timer lands on the preset escape hatch before being asked
          to configure individuals. */}
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

        {presetErr && (
          <div
            className="card p-2.5 border border-red-400/40 bg-red-500/10 flex items-start justify-between gap-2"
            role="status"
            aria-live="polite"
          >
            <p className="text-xs text-red-200 break-words flex-1 min-w-0">
              {presetErr}
            </p>
            <button
              type="button"
              onClick={() => setPresetErr(null)}
              className="text-xs text-red-200/70 hover:text-red-100 shrink-0"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

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
              placeholder="14.0"
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
          {/* Audit P2 #22: guest HI is optional — out-of-town buddy
              shouldn't be blocked from joining because he doesn't know
              his handicap. */}
          <p className="col-span-full text-[11px] text-cream-100/55 -mt-1 leading-snug">
            Leave HI blank if unknown — they&apos;ll play as a scratch (0).
            Plus index? Type with a +, e.g. <span className="text-gold-400">+1.4</span>.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {allPlayers.map((p) => {
            const picked = pickedPlayers.find((x) => x.id === p.id);
            const lp = lastPlayedAt[p.id];
            const hiValue = hiEdits[p.id] ?? hiInputValue(p.handicap_index);
            // Live Course Handicap preview — match the value that will
            // be written to round_players at round-start (line 521).
            // Audit P1 #9: member-member golfers want to verify their
            // strokes BEFORE tee-off, not after the round starts.
            const pickedTee = picked
              ? tees.find((t) => t.id === picked.tee_id)
              : null;
            const previewCH = pickedTee
              ? courseHandicap(
                  p.handicap_index ?? 0,
                  pickedTee.slope,
                  pickedTee.rating,
                  pickedTee.par,
                  holes
                )
              : null;
            const previewPH =
              previewCH != null ? playingHandicap(previewCH, 100) : null;
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
                      {/* Audit P2 #23: group-language matches the rest
                          of the app — "New to this group" was cold. */}
                      {lp ? `Last played ${lp}` : "First round with the crew"}
                    </div>
                  </div>
                  {!picked && (
                    <span className="text-xs text-cream-100/55 tabular-nums">HI {formatHi(p.handicap_index)}</span>
                  )}
                </label>
                {picked && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {previewCH != null && (
                      <p className="col-span-2 text-[11px] text-cream-100/70 leading-snug">
                        Course handicap (CH):{" "}
                        <span className="text-cream-50 font-medium tabular-nums">
                          {previewCH > 0 ? `+${previewCH}` : previewCH}
                        </span>
                        {previewPH != null && previewPH !== previewCH && (
                          <>
                            {" · "}
                            Playing handicap (PH):{" "}
                            <span className="text-cream-50 font-medium tabular-nums">
                              {previewPH > 0 ? `+${previewPH}` : previewPH}
                            </span>
                          </>
                        )}
                      </p>
                    )}
                    <div>
                      <label className="label text-xs">Handicap Index</label>
                      <input
                        className="input text-sm"
                        type="text"
                        inputMode="decimal"
                        value={hiValue}
                        placeholder="14.0"
                        title="Plus index? Type with a +, e.g. +1.4"
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
                      {/* Audit P2 #21: plus-index hint behind an info
                          icon (kept the explainer accessible via the
                          input's title + a small ? glyph) so a
                          first-timer's eye doesn't see "+1.4" as a
                          required input. */}
                      <details className="mt-0.5">
                        <summary className="text-[10px] text-cream-100/45 cursor-pointer select-none hover:text-cream-100/70">
                          ? Plus handicap
                        </summary>
                        <p className="text-[10px] text-cream-100/45 mt-0.5">
                          Type with a +, e.g. <span className="text-gold-400">+1.4</span>
                        </p>
                      </details>
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

      <section className="card p-4 space-y-2">
        <h2 className="font-serif text-xl text-cream-50">Games</h2>
        <p className="text-xs text-cream-100/55">
          Pick a family, then choose Gross / Net inside. Add as many as you
          like — they all run together on the round.{" "}
          <span className="text-cream-100/45">
            You can adjust games + stakes from the round&apos;s &ldquo;Games
            &amp; bets&rdquo; page after it starts, too.
          </span>
        </p>
        {/* Audit P1 #7: collapse the long tail. Show Skins / Nassau /
            Best Ball / Side Bets by default; tuck individual / aggregate
            / scramble / 6-6-6 behind a disclosure so a first-time user
            isn't confronted with 8+ checkboxes. Any family with an
            already-enabled game stays visible so a returning round
            template doesn't appear to "lose" games. */}
        {(() => {
          const featured = new Set([
            "skins",
            "nassau",
            "best_ball",
            "side_bets"
          ]);
          // Mirrors FamilyGameRow's activeEntry resolution — a family
          // is "enabled" if any of its concrete (variant, mode) game
          // types has `enabled: true` in the games map.
          const isEnabledForFamily = (family: GameFamily) =>
            family.variants.some((v) => {
              if (family.hasMode) {
                return (
                  games[v.resolve("gross")]?.enabled ||
                  games[v.resolve("net")]?.enabled
                );
              }
              return games[v.resolve(null)]?.enabled;
            });
          const featuredFamilies = GAME_FAMILIES.filter(
            (f) => featured.has(f.key) || isEnabledForFamily(f)
          );
          const moreFamilies = GAME_FAMILIES.filter(
            (f) => !featured.has(f.key) && !isEnabledForFamily(f)
          );
          return (
            <>
              {featuredFamilies.map((family) => (
                <FamilyGameRow
                  key={family.key}
                  family={family}
                  games={games}
                  setGames={setGames}
                />
              ))}
              {moreFamilies.length > 0 && (
                <details className="pt-1">
                  <summary className="cursor-pointer text-xs uppercase tracking-[0.18em] text-cream-100/55 hover:text-cream-100 py-1.5 select-none">
                    More games · {moreFamilies.length} ▾
                  </summary>
                  <p className="text-[11px] text-cream-100/45 mt-1 mb-1 leading-snug">
                    Less common formats. Pick any of these the same way.
                  </p>
                  {moreFamilies.map((family) => (
                    <FamilyGameRow
                      key={family.key}
                      family={family}
                      games={games}
                      setGames={setGames}
                    />
                  ))}
                </details>
              )}
            </>
          );
        })()}
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

      {/* Teams section — placed after Games so a brand-new user
          doesn't see "Teams" before they've picked a game that needs
          them. Audit P1 #6. The team-game hint surfaces only when a
          team game is enabled. */}
      {(teamGameEnabled || sixSixSixEnabled) && pickedPlayers.length > 0 && (
        <div className="card p-3 border border-gold-500/30 bg-gold-500/5 text-sm">
          <div className="font-medium text-cream-50">
            Team game selected — make sure your teams are set below
          </div>
          <p className="text-xs text-cream-100/65 mt-0.5 leading-snug">
            {sixSixSixEnabled
              ? "6-6-6 needs exactly 4 picked players; partners rotate every 6 holes (no manual team assignment needed)."
              : `2 teams have been auto-shuffled for you. Tap a team chip per player to change it.`}
          </p>
        </div>
      )}

      {/* Audit P2 #20: Teams section only renders when a team game
          is enabled (or the user explicitly bumped teamCount > 0).
          A first-timer playing solo Skins shouldn't see "No teams
          (individual play)..." load-bearing on the form. */}
      {(teamGameEnabled || sixSixSixEnabled || teamCount > 0) && (
        <TeamsSection
          pickedPlayers={pickedPlayers}
          setPickedPlayers={setPickedPlayers}
          allPlayers={allPlayers}
          teamCount={teamCount}
          setTeamCount={setTeamCount}
        />
      )}

      {/* Junk side-bets — opt-in at round creation. Single toggle +
          flat amount, defaults to off. Commissioner can configure
          escalating mode + category toggles from
          /rounds/[id]/games after the round is live. This block
          exists so a commissioner setting up a round doesn't have
          to come back to a separate page to enable junk. */}
      <section className="card p-4 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-serif text-xl text-cream-50">
              Junk side-bets
            </h2>
            <p className="text-xs text-cream-100/55 mt-0.5 leading-snug">
              Birdies, greenies, sandies, chip-ins, poleys, pinnies —
              tap-the-extras tracking that runs alongside the main
              game.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-cream-50 select-none cursor-pointer">
            <input
              type="checkbox"
              className="h-5 w-5 accent-gold-500"
              checked={junkEnabled}
              onChange={(e) => setJunkEnabled(e.target.checked)}
            />
            <span>{junkEnabled ? "On" : "Off"}</span>
          </label>
        </div>
        {junkEnabled && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-cream-100/8">
            <div>
              <label className="label">Amount per item (USD)</label>
              <input
                className="input"
                type="number"
                step="0.50"
                min={0.5}
                value={junkFlatDollars}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!Number.isFinite(v) || v <= 0) return;
                  setJunkFlatDollars(v);
                }}
              />
              <p className="text-[10px] text-cream-100/45 mt-0.5">
                Flat $ per item by default. Switch to escalating from
                the games editor after the round is live if you want
                the pot to grow.
              </p>
            </div>
            <div className="text-[11px] text-cream-100/55 leading-snug self-end">
              <span className="text-cream-100/85">Default categories:</span>{" "}
              Birdie, Eagle,{" "}
              <span title="Greenie — closest to the pin on a par-3 (also called Pinny)">Greenie</span>,{" "}
              <span title="Sandy — par or better after hitting a bunker">Sandy</span>,{" "}
              Chip-in,{" "}
              <span title="Poley — ball ends up touching the flagstick on the green">Poley</span>,{" "}
              <span title="Pinny — closest-to-the-pin on a par-3 (variant of Greenie)">Pinny</span>.
              {" "}Tap <span className="text-cream-100/85">+ Other</span> in
              the live entry strip to record one-offs like &ldquo;Woodie&rdquo;.
            </div>
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

// ---------- Family-grouped game picker row ----------

type GameState = Record<
  GameType,
  { enabled: boolean; stake_cents: number; allowance_pct: number; config: any }
>;

/**
 * One row in the games picker. Renders the family checkbox, a variant
 * selector if the family has multiple variants (Skins → Standard /
 * Canadian; Nassau → Nassau / Match Play; Side bets → CTP / Long drive
 * / Custom), and a Gross / Net toggle when family.hasMode is true.
 *
 * State stays keyed by concrete GameType. Toggling Gross↔Net moves the
 * "enabled" + stake + config from one resolved type to the other so the
 * downstream startRound() insert flow is unchanged.
 */
function FamilyGameRow({
  family,
  games,
  setGames
}: {
  family: GameFamily;
  games: GameState;
  setGames: React.Dispatch<React.SetStateAction<GameState>>;
}) {
  // Pick the currently-enabled (variant, mode) for this family, if any.
  // We use that as the source of truth for "is this family on?" and for
  // the variant + mode controls.
  const activeEntry = (() => {
    for (const v of family.variants) {
      const candidates: Array<{ type: GameType; mode: "gross" | "net" | null }> = family.hasMode
        ? [
            { type: v.resolve("gross"), mode: "gross" },
            { type: v.resolve("net"), mode: "net" }
          ]
        : [{ type: v.resolve(null), mode: null }];
      for (const c of candidates) {
        if (games[c.type]?.enabled) {
          return { variantKey: v.key, mode: c.mode, type: c.type };
        }
      }
    }
    return null;
  })();

  const enabled = activeEntry !== null;
  // Default variant + mode for the first-enable. Resolved live so the
  // variant/mode UI tracks the user's choice across renders.
  const variantKey = activeEntry?.variantKey ?? family.defaultVariant;
  const mode: "gross" | "net" =
    activeEntry?.mode ?? family.defaultMode ?? "net";

  function setEnabled(next: boolean) {
    setGames((s) => {
      const out = { ...s };
      // Disable every concrete type this family resolves to.
      for (const v of family.variants) {
        if (family.hasMode) {
          out[v.resolve("gross")] = { ...out[v.resolve("gross")], enabled: false };
          out[v.resolve("net")] = { ...out[v.resolve("net")], enabled: false };
        } else {
          const t = v.resolve(null);
          out[t] = { ...out[t], enabled: false };
        }
      }
      if (next) {
        const target = resolveGameType(family, variantKey, mode);
        if (target) {
          out[target] = {
            ...out[target],
            enabled: true,
            // Carry through stake from the existing slot if any, else
            // fall back to the catalog default.
            config:
              Object.keys(out[target].config ?? {}).length > 0
                ? out[target].config
                : defaultConfigFor(target)
          };
        }
      }
      return out;
    });
  }

  function setVariant(nextVariant: string) {
    if (!enabled) return;
    const oldType = activeEntry!.type;
    const newType = resolveGameType(family, nextVariant, mode);
    if (!newType || newType === oldType) return;
    setGames((s) => {
      const carry = s[oldType];
      return {
        ...s,
        [oldType]: { ...s[oldType], enabled: false },
        [newType]: {
          ...s[newType],
          enabled: true,
          stake_cents: carry.stake_cents,
          allowance_pct: carry.allowance_pct,
          // Reset config to the new variant's defaults — variants can
          // have very different configs (e.g. Canadian skins requires
          // birdie). Carrying old config could land bad data.
          config: defaultConfigFor(newType)
        }
      };
    });
  }

  function setMode(nextMode: "gross" | "net") {
    if (!enabled || !family.hasMode) return;
    const oldType = activeEntry!.type;
    const newType = resolveGameType(family, variantKey, nextMode);
    if (!newType || newType === oldType) return;
    setGames((s) => {
      const carry = s[oldType];
      return {
        ...s,
        [oldType]: { ...s[oldType], enabled: false },
        [newType]: {
          ...s[newType],
          enabled: true,
          stake_cents: carry.stake_cents,
          allowance_pct: carry.allowance_pct,
          // Same config — gross↔net flip doesn't change config shape.
          config: carry.config
        }
      };
    });
  }

  const activeType = activeEntry?.type;
  const v = activeType ? games[activeType] : null;

  return (
    <div className="border-t border-cream-100/8 first:border-t-0 py-2">
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span className="flex-1">
          <span className="font-medium text-cream-50">{family.label}</span>
          <span className="block text-[11px] text-cream-100/55 mt-0.5">
            {family.short}
          </span>
        </span>
      </label>

      {enabled && (
        <div className="mt-2 pl-6 space-y-3">
          {/* Variant selector — only shown if multiple variants exist. */}
          {family.variants.length > 1 && (
            <div>
              <label className="label text-xs">Variant</label>
              <select
                className="input text-sm"
                value={variantKey}
                onChange={(e) => setVariant(e.target.value)}
              >
                {family.variants.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Gross / Net mode toggle — only if family has it. */}
          {family.hasMode && (
            <div role="group" aria-label="Gross or Net">
              <label className="label text-xs">Mode</label>
              <div className="inline-flex rounded-md border border-cream-100/15 overflow-hidden text-xs">
                {(["gross", "net"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`px-3 py-1.5 ${
                      mode === m
                        ? "bg-gold-500 text-brand-900 font-medium"
                        : "text-cream-100/85 hover:bg-brand-900/60"
                    }`}
                  >
                    {m === "gross" ? "Gross" : "Net"}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-cream-100/55 mt-1">
                {mode === "gross"
                  ? "Lowest raw score wins; no handicap strokes applied."
                  : "Handicap strokes evened out — most member-member play uses net."}
              </p>
            </div>
          )}

          {/* Existing config editor — keyed off the resolved concrete
              game_type so Nassau / Skins / 6-6-6 each get their custom
              editor. */}
          {activeType && v && (
            <GameConfigEditor
              gameType={activeType}
              value={v}
              onChange={(patch) =>
                setGames((s) => ({
                  ...s,
                  [activeType]: { ...s[activeType], ...patch }
                }))
              }
            />
          )}
        </div>
      )}
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
    const front = cfg.front_stake_cents ?? value.stake_cents;
    const back = cfg.back_stake_cents ?? value.stake_cents;
    const overall = cfg.overall_stake_cents ?? value.stake_cents;
    // Three stakes are "split" if any pair differs OR the user has
    // explicitly opened the advanced split UI. Default first-render
    // is single-stake (audit P1 #8: a $5 Nassau is $5, not $5 × 3 = $15).
    const splitEnabled =
      cfg._split_stakes === true ||
      front !== back ||
      back !== overall;
    const totalCents = front + back + overall;
    return (
      <div className="mt-3 pl-6 space-y-3">
        {!splitEnabled ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-end">
            <Money
              label="Stake $"
              cents={front}
              onChange={(c) =>
                setConfig({
                  front_stake_cents: c,
                  back_stake_cents: c,
                  overall_stake_cents: c
                })
              }
            />
            <button
              type="button"
              onClick={() => setConfig({ _split_stakes: true })}
              className="text-[11px] text-cream-100/55 hover:text-cream-100 underline underline-offset-2 self-end pb-2 text-left"
            >
              Advanced: split front / back / overall →
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <Money label="Front $" cents={front} onChange={(c) => setConfig({ front_stake_cents: c })} />
              <Money label="Back $" cents={back} onChange={(c) => setConfig({ back_stake_cents: c })} />
              <Money label="Overall $" cents={overall} onChange={(c) => setConfig({ overall_stake_cents: c })} />
            </div>
            <button
              type="button"
              onClick={() =>
                setConfig({
                  _split_stakes: false,
                  back_stake_cents: front,
                  overall_stake_cents: front
                })
              }
              className="text-[11px] text-cream-100/55 hover:text-cream-100 underline underline-offset-2"
            >
              ← Use one stake for all three
            </button>
          </div>
        )}
        {/* Total-at-risk preview so a $5 Nassau doesn't surprise a
            first-timer as $15. Audit P1 #8. */}
        <p className="text-[11px] text-cream-100/65 leading-snug">
          Total at risk per player:{" "}
          <span className="text-cream-50 font-medium tabular-nums">
            ${(totalCents / 100).toFixed(2)}
          </span>
          {" "}({"front + back + overall"})
        </p>
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
              {/* Audit P2 #24: "commissioner" jargon → "anyone can request". */}
              <option value="manual">Manual (anyone can request mid-round)</option>
            </select>
          </div>
        </div>
      </div>
    );
  }

  if (gameType === "match_play") {
    const cfgMP = value.config ?? {};
    const matchPlayMP = cfgMP.match_play !== false; // default true (it's match play)
    return (
      <div className="mt-3 pl-6 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Money label="Stake $" cents={value.stake_cents} onChange={(c) => onChange({ stake_cents: c })} />
          <div>
            <label className="label text-xs">Format</label>
            <select className="input text-sm" value={matchPlayMP ? "match" : "stroke"} onChange={(e) => setConfig({ match_play: e.target.value === "match" })}>
              <option value="match">Match play</option>
              <option value="stroke">Stroke play</option>
            </select>
          </div>
        </div>
        {matchPlayMP && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label text-xs">Presses</label>
              <select
                className="input text-sm"
                value={cfgMP.presses ?? "none"}
                onChange={(e) => setConfig({ presses: e.target.value })}
              >
                <option value="none">None</option>
                <option value="auto_2_down">Auto-press at 2 down</option>
              </select>
            </div>
          </div>
        )}
        {matchPlayMP && cfgMP.presses === "auto_2_down" && (
          <p className="text-[11px] text-cream-100/55 leading-snug">
            Auto-presses fire when one side goes 2-down with 3+ holes
            left. Capped at 4 presses.
          </p>
        )}
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
            <label className="label text-xs" title="What % of full handicap players play off. 100% = full strokes. 85% = standard for most member-member formats.">
              Hcp Allowance %
            </label>
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
    const cfg666 = value.config ?? {};
    const matchPlay666 = cfg666.match_play !== false; // default true
    return (
      <div className="mt-3 pl-6 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Money label="Stake per segment $" cents={value.stake_cents} onChange={(c) => onChange({ stake_cents: c })} />
          <div>
            <label className="label text-xs">Format</label>
            <select className="input text-sm" value={matchPlay666 ? "match" : "stroke"} onChange={(e) => setConfig({ match_play: e.target.value === "match" })}>
              <option value="match">Match play (best ball, 6 holes)</option>
              <option value="stroke">Stroke play (best-ball total)</option>
            </select>
          </div>
        </div>
        {matchPlay666 && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label text-xs">Presses</label>
              <select
                className="input text-sm"
                value={cfg666.presses ?? "none"}
                onChange={(e) => setConfig({ presses: e.target.value })}
              >
                <option value="none">None</option>
                <option value="auto_2_down">Auto-press at 2 down</option>
              </select>
            </div>
          </div>
        )}
        <p className="text-xs text-cream-100/55 leading-snug">
          Holes 1–6: AB vs CD · 7–12: AC vs BD · 13–18: AD vs BC. 4 players required.
          {matchPlay666 && cfg666.presses === "auto_2_down" && (
            <> Auto-presses fire per segment when a side goes 2-down with 3+ holes left.</>
          )}
        </p>
      </div>
    );
  }

  // Best Ball / Aggregate — same engine supports both stroke (default)
  // and match-play + auto-presses (engine ships in lib/games/team.ts).
  if (
    gameType === "best_ball_gross" ||
    gameType === "best_ball_net" ||
    gameType === "aggregate_gross" ||
    gameType === "aggregate_net"
  ) {
    const cfg = value.config ?? {};
    const matchPlay = cfg.match_play === true;
    return (
      <div className="mt-3 pl-6 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Money
            label="Stake $"
            cents={value.stake_cents}
            onChange={(c) => onChange({ stake_cents: c })}
          />
          <div>
            <label
              className="label text-xs"
              title="What % of full handicap players play off. 100% = full strokes. 85% = standard for most member-member formats."
            >
              Hcp Allowance %
            </label>
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
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label text-xs">Format</label>
            <select
              className="input text-sm"
              value={matchPlay ? "match" : "stroke"}
              onChange={(e) =>
                setConfig({ match_play: e.target.value === "match" })
              }
            >
              <option value="stroke">Stroke (lowest team total wins)</option>
              <option value="match">Match (hole-by-hole)</option>
            </select>
          </div>
          {matchPlay && (
            <div>
              <label className="label text-xs">Presses</label>
              <select
                className="input text-sm"
                value={cfg.presses ?? "none"}
                onChange={(e) => setConfig({ presses: e.target.value })}
              >
                <option value="none">None</option>
                <option value="auto_2_down">Auto-press at 2 down</option>
              </select>
            </div>
          )}
        </div>
        {matchPlay && (
          <p className="text-[11px] text-cream-100/55 leading-snug">
            Match play settles by hole-by-hole wins. Presses (when on)
            open automatically when one team is 2 down with 3+ holes
            left, capped at 4 presses.
          </p>
        )}
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
        <label className="label text-xs" title="What % of full handicap players play off. 100% = full strokes. 85% = standard for most member-member formats.">
              Hcp Allowance %
            </label>
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
            Tap a team chip per player to assign — or hit Random to spin
            pairings up. (Desktop: drag players between buckets below.)
          </p>

          {/* Tap-to-assign — primary mobile path. Each player gets a
              row with team chips (Team 1 / Team 2 / … / —). Universal
              on iPhone Safari where drag-and-drop inside a scrolling
              page is unreliable. */}
          <ul className="space-y-1.5">
            {pickedPlayers.map((p) => {
              const player = allPlayers.find((x) => x.id === p.id);
              return (
                <li
                  key={p.id}
                  className="surface rounded-lg p-2.5 flex items-center justify-between gap-3 flex-wrap"
                >
                  <span className="text-sm text-cream-50 truncate flex-1 min-w-0">
                    {player?.display_name ?? p.id}
                    <span className="text-[11px] text-cream-100/45 ml-1.5">
                      HI {formatHi(player?.handicap_index)}
                    </span>
                  </span>
                  <div className="flex flex-wrap gap-1 shrink-0">
                    {Array.from({ length: teamCount }, (_, i) => {
                      const tid = String(i);
                      const active = p.team_id === tid;
                      return (
                        <button
                          key={tid}
                          type="button"
                          onClick={() => setTeam(p.id, tid)}
                          className={`pill text-[11px] px-2.5 py-1 transition-colors ${
                            active
                              ? "bg-gold-500 text-brand-900"
                              : "bg-brand-900/60 border border-cream-100/15 text-cream-100/85 hover:bg-brand-900"
                          }`}
                          aria-pressed={active}
                        >
                          {active ? "✓ " : ""}Team {i + 1}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setTeam(p.id, null)}
                      className={`pill text-[11px] px-2.5 py-1 transition-colors ${
                        !p.team_id
                          ? "bg-cream-100/15 text-cream-50"
                          : "bg-brand-900/60 border border-cream-100/15 text-cream-100/55 hover:bg-brand-900"
                      }`}
                      aria-pressed={!p.team_id}
                    >
                      {!p.team_id ? "✓ " : ""}—
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Bucket view — visual summary + desktop drag-and-drop
              fallback. Hidden on small screens to avoid duplicating
              the tap-to-assign list on mobile. */}
          <div className="hidden sm:grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
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
