"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { courseHandicap, playingHandicap } from "@/lib/handicap";
import { formatHi, hiInputValue, parseHi } from "@/lib/handicap-format";
import { GAME_PACKAGES } from "@/lib/presets/game-packages";
import type { GameType } from "@/lib/types";

const GAMES: { type: GameType; label: string; defaults?: any }[] = [
  { type: "individual_gross", label: "Individual gross" },
  { type: "individual_net", label: "Individual net" },
  { type: "best_ball_gross", label: "2-man best ball (gross)" },
  { type: "best_ball_net", label: "2-man best ball (net)" },
  { type: "aggregate_gross", label: "Team aggregate (gross)" },
  { type: "aggregate_net", label: "Team aggregate (net)" },
  { type: "skins_gross", label: "Skins (gross)", defaults: { skin_value_cents: 100, ties: "split" } },
  { type: "skins_net", label: "Skins (net)", defaults: { skin_value_cents: 100, ties: "split" } },
  { type: "skins_canadian", label: "Canadian skins", defaults: { skin_value_cents: 100, escalation: "linear", ties: "split", require_birdie: true } },
  { type: "nassau", label: "Nassau (front/back/overall)", defaults: { match_play: true, front_stake_cents: 1000, back_stake_cents: 1000, overall_stake_cents: 1000, presses: "none" } },
  { type: "match_play", label: "Match play (overall only)" },
  { type: "six_six_six", label: "6-6-6 (partner rotation, 4 players)", defaults: { match_play: true } },
  { type: "ctp", label: "Closest to the pin" },
  { type: "long_drive", label: "Long drive" },
  { type: "custom", label: "Custom side bet" }
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

  useEffect(() => {
    (async () => {
      const { data: g } = await sb.from("groups").select("id").limit(1);
      const gid = g?.[0]?.id;
      setGroupId(gid ?? null);
      if (!gid) return;

      const [coursesRes, playersRes, recentRoundsRes] = await Promise.all([
        sb.from("courses").select("id, name").eq("group_id", gid).is("deleted_at", null),
        sb.from("players").select("id, display_name, handicap_index").eq("group_id", gid).is("deleted_at", null),
        sb
          .from("rounds")
          .select("id, date, courses(name), round_players(player_id)")
          .eq("group_id", gid)
          .order("date", { ascending: false })
          .limit(20)
      ]);

      setCourses(coursesRes.data ?? []);

      // Build last-played-at map from recent rounds (most recent first).
      const lastSeen: Record<string, string> = {};
      for (const r of (recentRoundsRes.data as any[]) ?? []) {
        for (const rp of r.round_players ?? []) {
          if (!lastSeen[rp.player_id]) lastSeen[rp.player_id] = r.date;
        }
      }
      setLastPlayedAt(lastSeen);

      // Sort players: most-recently-played first, then alpha for the rest.
      const players = (playersRes.data ?? []).slice().sort((a: any, b: any) => {
        const la = lastSeen[a.id] ?? "";
        const lb = lastSeen[b.id] ?? "";
        if (la !== lb) return lb.localeCompare(la);
        return a.display_name.localeCompare(b.display_name);
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

  useEffect(() => {
    if (!courseId) {
      setTees([]);
      return;
    }
    (async () => {
      // Order by rating desc so the harder tees come first — most groups list
      // tees that way (Black/Blue at the top).
      const { data } = await sb
        .from("course_tees")
        .select("id, name, gender, rating, slope, par")
        .eq("course_id", courseId)
        .order("rating", { ascending: false });
      setTees(data ?? []);
    })();
  }, [courseId]);

  function togglePlayer(id: string) {
    setPickedPlayers((arr) => {
      if (arr.find((x) => x.id === id)) return arr.filter((x) => x.id !== id);
      return [...arr, { id, tee_id: tees[0]?.id ?? "", team_id: null }];
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
      { id: data.id, tee_id: tees[0]?.id ?? "", team_id: null }
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

    // 3) Create round_players with computed handicaps.
    const rpRows = pickedPlayers.map((p, i) => {
      const player = allPlayers.find((x) => x.id === p.id);
      const tee = tees.find((x) => x.id === p.tee_id);
      const hi = player?.handicap_index ?? 0;
      const ch = tee ? courseHandicap(hi, tee.slope, tee.rating, tee.par, holes) : 0;
      const ph = playingHandicap(ch, 100);
      const teamIndex = p.team_id ? parseInt(p.team_id) : -1;
      return {
        round_id: round.id,
        player_id: p.id,
        tee_id: p.tee_id,
        handicap_index_used: hi,
        course_handicap: ch,
        playing_handicap: ph,
        team_id: teamIndex >= 0 ? teamIds[teamIndex] ?? null : null,
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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Date</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Holes</label>
            <select className="input" value={holes} onChange={(e) => setHoles(parseInt(e.target.value) as 9 | 18)}>
              <option value={18}>18</option>
              <option value={9}>9</option>
            </select>
          </div>
          <div className="col-span-2">
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
              setPickedPlayers(valid.map((pid) => ({ id: pid, tee_id: tees[0]?.id ?? "", team_id: null })));
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

      <TeamsSection
        pickedPlayers={pickedPlayers}
        setPickedPlayers={setPickedPlayers}
        allPlayers={allPlayers}
        teamCount={teamCount}
        setTeamCount={setTeamCount}
      />

      <section className="card p-4 space-y-3">
        <div className="flex items-end justify-between gap-2">
          <h2 className="font-serif text-xl text-cream-50">Quick start</h2>
          <p className="text-xs text-cream-100/55 hidden sm:block">Pick a package or roll your own below.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {GAME_PACKAGES.map((pkg) => (
            <button
              key={pkg.id}
              type="button"
              onClick={() => {
                setGames((prev) => {
                  // Reset to all-disabled, then enable & populate from package.
                  const next: typeof prev = { ...prev };
                  for (const k of Object.keys(next) as GameType[]) {
                    next[k] = { ...next[k], enabled: false };
                  }
                  for (const g of pkg.games) {
                    next[g.game_type] = {
                      enabled: true,
                      stake_cents: g.stake_cents,
                      allowance_pct: g.allowance_pct,
                      config: g.config
                    };
                  }
                  return next;
                });
              }}
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
    return (
      <div className="mt-3 pl-6 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Money label="Skin value $" cents={cfg.skin_value_cents ?? 100} onChange={(c) => setConfig({ skin_value_cents: c })} />
        <div>
          <label className="label text-xs">Ties</label>
          <select className="input text-sm" value={cfg.ties ?? "split"} onChange={(e) => setConfig({ ties: e.target.value })}>
            <option value="split">Split (default)</option>
            <option value="carry">Carry</option>
            <option value="nullify">Nullify</option>
          </select>
        </div>
        <div>
          <label className="label text-xs">Carry escalation</label>
          <select className="input text-sm" value={cfg.escalation ?? "flat"} onChange={(e) => setConfig({ escalation: e.target.value })}>
            <option value="flat">Flat</option>
            <option value="linear">Linear (×N)</option>
            <option value="double">Double (2^N)</option>
          </select>
        </div>
        {gameType === "skins_canadian" && (
          <div>
            <label className="label text-xs">Birdie validates</label>
            <select className="input text-sm" value={cfg.require_birdie === false ? "off" : "on"} onChange={(e) => setConfig({ require_birdie: e.target.value === "on" })}>
              <option value="on">Yes</option>
              <option value="off">No</option>
            </select>
          </div>
        )}
        <div className={gameType === "skins_canadian" ? "" : "sm:col-span-1"}>
          <label className="label text-xs">Allowance %</label>
          <input className="input text-sm" type="number" value={value.allowance_pct} onChange={(e) => onChange({ allowance_pct: parseInt(e.target.value) || 100 })} />
        </div>
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
        <input className="input text-sm" type="number" value={value.allowance_pct} onChange={(e) => onChange({ allowance_pct: parseInt(e.target.value) || 100 })} />
      </div>
    </div>
  );
}

function Money({ label, cents, onChange }: { label: string; cents: number; onChange: (cents: number) => void }) {
  return (
    <div>
      <label className="label text-xs">{label}</label>
      <input
        className="input text-sm"
        type="number"
        step="0.5"
        min="0"
        value={fromCents(cents)}
        onChange={(e) => onChange(asCents(e.target.value))}
      />
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
            type="number"
            min={0}
            max={6}
            value={teamCount}
            onChange={(e) => setTeamCount(parseInt(e.target.value) || 0)}
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
