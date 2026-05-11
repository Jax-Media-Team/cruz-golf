"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { retry } from "@/lib/retry";

// Friendlier error when the RPC fails because the device is offline
// or the network is flaky. Press accept/decline/withdraw are
// non-queueable (the 24h expiry window matters + the RPC has business
// rules like "only side B can accept") so we retry with backoff but
// don't silently queue. If all retries fail, this message is what
// the user sees.
function pressErrorMessage(err: any): string {
  const raw = err?.message ?? String(err);
  const lower = raw.toLowerCase();
  if (
    typeof navigator !== "undefined" &&
    !navigator.onLine
  ) {
    return "You're offline. Try again when you reconnect.";
  }
  if (
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("timeout") ||
    lower.includes("aborted")
  ) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  return raw;
}

/**
 * Manual-press controls on /rounds/[id].
 *
 * Shows three states:
 *   1. "+ Press" affordance (visible to anyone in the round) → opens
 *      a small dialog: pick game, pick start hole, pick stake.
 *   2. Pending presses awaiting THIS user's response → accept/decline
 *      banner.
 *   3. Pending presses opened BY this user → withdraw button.
 *   4. Active (accepted) presses → calm display in the games strip.
 *
 * Tone discipline: statements not exclamations. "Patrick pressed the
 * back, $10, holes 11-18", not "🔥 PRESS!".
 *
 * Auditability: every state change writes to destructive_audit_log
 * via the RPCs (fn_open_press / fn_accept_press / fn_decline_press /
 * fn_withdraw_press). Visible at /admin/audit?kind=press.open etc.
 */

type Game = {
  id: string;
  game_type: string;
  name: string;
  stake_cents: number;
  config: any;
};

type Rp = {
  id: string;
  player_id: string;
  team_id: string | null;
  display_name: string;
  is_me: boolean;
};

export type PressRow = {
  id: string;
  game_id: string | null;
  segment_label: string;
  start_hole: number;
  end_hole: number;
  stake_cents: number;
  side_a_rp_ids: string[];
  side_b_rp_ids: string[];
  opened_by_rp_id: string;
  opened_at: string;
  accepted_at: string | null;
  declined_at: string | null;
  withdrawn_at: string | null;
  status: "pending" | "accepted" | "declined" | "withdrawn" | "expired";
};

const fmtMoney = (cents: number) => "$" + (cents / 100).toFixed(0);

export function PressControls({
  roundId,
  totalHoles,
  rps,
  games,
  presses,
  myRpId,
  isCommissioner
}: {
  roundId: string;
  totalHoles: number;
  rps: Rp[];
  games: Game[];
  presses: PressRow[];
  myRpId: string | null;
  isCommissioner: boolean;
}) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openDialog, setOpenDialog] = useState(false);

  // Realtime: when ANY player on this round opens / accepts / declines /
  // withdraws a press, every other viewer's PressControls re-renders
  // without a manual reload. Mirrors the score-realtime pattern in
  // round-view.tsx — subscribe to postgres_changes on `round_presses`
  // filtered to this round, then router.refresh() on any event so the
  // server-side fetch picks up the new state. router.refresh() is a
  // soft refresh — RSCs re-run, client state is preserved.
  //
  // 60s safety-net refresh covers silent Realtime drops, same as the
  // score channel. The Supabase SDK auto-reconnects the socket, so
  // momentary network blips don't break the feed.
  useEffect(() => {
    let cancelled = false;
    const channel = sb
      .channel(`round-${roundId}-presses`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "round_presses",
          filter: `round_id=eq.${roundId}`
        },
        () => {
          if (cancelled) return;
          router.refresh();
        }
      )
      .subscribe();
    const interval = setInterval(() => {
      if (!cancelled) router.refresh();
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      sb.removeChannel(channel);
    };
    // sb is a stable singleton from supabaseBrowser(); router is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  // Bucket presses by my role so the UI shows the right call-to-action.
  // Hide pending presses older than 24h — backend treats them as
  // expired only when someone tries to act on them, but the UI
  // shouldn't keep showing stale "awaiting response" rows.
  const { mine, awaitingMe, accepted } = useMemo(() => {
    const out = {
      mine: [] as PressRow[],
      awaitingMe: [] as PressRow[],
      accepted: [] as PressRow[]
    };
    const expiryCutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const p of presses) {
      if (p.status === "accepted") {
        out.accepted.push(p);
      } else if (p.status === "pending") {
        // Hide pending presses opened more than 24h ago — UI-side
        // expiry. The next attempted action will flip the DB row.
        if (new Date(p.opened_at).getTime() < expiryCutoff) continue;
        const onSideA = myRpId && p.side_a_rp_ids.includes(myRpId);
        const onSideB = myRpId && p.side_b_rp_ids.includes(myRpId);
        if (onSideA) out.mine.push(p);
        else if (onSideB || isCommissioner) out.awaitingMe.push(p);
      }
    }
    return out;
  }, [presses, myRpId, isCommissioner]);

  // Press action helper — wraps the RPC in retry+backoff so a flaky
  // network blip doesn't surface as an error. Business-rule failures
  // (wrong side, expired press, etc.) come back as Postgres errors
  // from the RPC and aren't retryable; the retry helper's predicate
  // only retries on network-class errors.
  async function callPressRpc(
    fn: string,
    pressId: string,
    confirmText?: string
  ) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(pressId);
    setErr(null);
    try {
      await retry(
        async () => {
          const { error } = await sb.rpc(fn, { p_press_id: pressId });
          if (error) throw error;
        },
        { attempts: 3, baseMs: 400 }
      );
      router.refresh();
    } catch (e: any) {
      setErr(pressErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const withdraw = (pressId: string) =>
    callPressRpc("fn_withdraw_press", pressId, "Withdraw this press?");
  const accept = (pressId: string) =>
    callPressRpc("fn_accept_press", pressId);
  const decline = (pressId: string) =>
    callPressRpc("fn_decline_press", pressId, "Decline this press?");

  function nameByRp(rpId: string): string {
    return rps.find((r) => r.id === rpId)?.display_name ?? "Player";
  }

  function pressLine(p: PressRow): string {
    const opener = nameByRp(p.opened_by_rp_id);
    const aSide = p.side_a_rp_ids.map(nameByRp).join(" + ");
    const bSide = p.side_b_rp_ids.map(nameByRp).join(" + ");
    return `${opener} pressed ${p.segment_label} · ${fmtMoney(p.stake_cents)} · holes ${p.start_hole}-${p.end_hole} · ${aSide} vs ${bSide}`;
  }

  return (
    <div className="space-y-2">
      {/* Awaiting-my-response banner — most urgent. */}
      {awaitingMe.map((p) => (
        <div
          key={p.id}
          className="card p-4 border border-amber-400/40 bg-amber-500/5 flex items-start justify-between gap-3 flex-wrap"
        >
          <div className="min-w-0">
            <p className="h-eyebrow text-amber-300">Press requested</p>
            <p className="text-sm text-cream-50 mt-0.5">{pressLine(p)}</p>
            <p className="text-[11px] text-cream-100/55 mt-0.5">
              Tap accept to lock it in. Decline closes it without a settlement.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => accept(p.id)}
              disabled={busy === p.id}
              className="btn-primary text-xs"
            >
              {busy === p.id ? "…" : "Accept"}
            </button>
            <button
              type="button"
              onClick={() => decline(p.id)}
              disabled={busy === p.id}
              className="btn-ghost text-xs"
            >
              Decline
            </button>
          </div>
        </div>
      ))}

      {/* My pending presses — opener can withdraw. */}
      {mine.map((p) => (
        <div
          key={p.id}
          className="card p-4 border border-cream-100/15 flex items-start justify-between gap-3 flex-wrap"
        >
          <div className="min-w-0">
            <p className="h-eyebrow text-cream-100/55">Press pending</p>
            <p className="text-sm text-cream-50 mt-0.5">{pressLine(p)}</p>
            <p className="text-[11px] text-cream-100/55 mt-0.5">
              Awaiting acceptance from the other side. You can withdraw
              until they tap accept.
            </p>
          </div>
          <button
            type="button"
            onClick={() => withdraw(p.id)}
            disabled={busy === p.id}
            className="btn-ghost text-xs text-red-300 shrink-0"
          >
            {busy === p.id ? "…" : "Withdraw"}
          </button>
        </div>
      ))}

      {/* Accepted presses — calm display, no actions. */}
      {accepted.map((p) => (
        <div key={p.id} className="surface rounded-lg px-3 py-2 text-xs flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" aria-hidden="true" />
          <span className="text-cream-50 truncate flex-1">{pressLine(p)}</span>
          <span className="text-cream-100/55 shrink-0">accepted</span>
        </div>
      ))}

      {/* Open-press affordance — anyone in the round can open. */}
      {myRpId && !openDialog && (
        <button
          type="button"
          onClick={() => setOpenDialog(true)}
          className="btn-ghost text-xs"
          title="Open a manual press"
        >
          + Press
        </button>
      )}

      {openDialog && myRpId && (
        <OpenPressDialog
          roundId={roundId}
          totalHoles={totalHoles}
          myRpId={myRpId}
          rps={rps}
          games={games}
          onClose={() => setOpenDialog(false)}
          onOpened={() => {
            setOpenDialog(false);
            router.refresh();
          }}
        />
      )}

      {err && <p className="text-xs text-red-300">{err}</p>}
    </div>
  );
}

function OpenPressDialog({
  roundId,
  totalHoles,
  myRpId,
  rps,
  games,
  onClose,
  onOpened
}: {
  roundId: string;
  totalHoles: number;
  myRpId: string;
  rps: Rp[];
  games: Game[];
  onClose: () => void;
  onOpened: () => void;
}) {
  const sb = supabaseBrowser();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const myTeamId = rps.find((r) => r.id === myRpId)?.team_id ?? null;

  // Default sides: my team vs everyone else (or me solo vs everyone else
  // if no teams set). Commissioner can override before submit.
  const defaultSideA = useMemo(() => {
    if (myTeamId) return rps.filter((r) => r.team_id === myTeamId).map((r) => r.id);
    return [myRpId];
  }, [rps, myRpId, myTeamId]);
  const defaultSideB = useMemo(() => {
    return rps.filter((r) => !defaultSideA.includes(r.id)).map((r) => r.id);
  }, [rps, defaultSideA]);

  // Picker state. Game defaults to the first one (Nassau if it exists).
  const defaultGame =
    games.find((g) => g.game_type === "nassau") ??
    games.find((g) =>
      [
        "best_ball_gross",
        "best_ball_net",
        "aggregate_gross",
        "aggregate_net"
      ].includes(g.game_type)
    ) ??
    games[0];
  const [gameId, setGameId] = useState<string>(defaultGame?.id ?? "");
  const [segmentLabel, setSegmentLabel] = useState<string>(
    suggestSegmentLabel(defaultGame, totalHoles)
  );
  const [startHole, setStartHole] = useState<number>(1);
  const [endHole, setEndHole] = useState<number>(totalHoles);
  const [stakeDollars, setStakeDollars] = useState<number>(
    Math.max(5, Math.round((defaultGame?.stake_cents ?? 1000) / 100))
  );

  function suggestSegmentLabel(g: Game | undefined, holes: number): string {
    if (!g) return "Manual press";
    if (g.game_type === "nassau") {
      // Default to "back" if we're past hole 9, otherwise "front".
      return holes === 9 ? "Nassau 9" : "Nassau back";
    }
    return `${g.name}`;
  }

  function pickGame(id: string) {
    setGameId(id);
    const g = games.find((x) => x.id === id);
    setSegmentLabel(suggestSegmentLabel(g, totalHoles));
    if (g?.stake_cents) setStakeDollars(Math.max(5, Math.round(g.stake_cents / 100)));
    // Adjust default hole range based on segment.
    if (g?.game_type === "nassau" && totalHoles === 18) {
      setStartHole(10);
      setEndHole(18);
    } else {
      setStartHole(1);
      setEndHole(totalHoles);
    }
  }

  function pickSegment(label: string) {
    setSegmentLabel(label);
    if (label.includes("front")) {
      setStartHole(1);
      setEndHole(9);
    } else if (label.includes("back")) {
      setStartHole(10);
      setEndHole(18);
    } else if (label.includes("overall")) {
      setStartHole(1);
      setEndHole(18);
    }
  }

  async function submit() {
    if (defaultSideA.length === 0 || defaultSideB.length === 0) {
      setErr("Need at least one player on each side.");
      return;
    }
    if (endHole - startHole + 1 < 3) {
      setErr("A press must cover at least 3 holes.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await retry(
        async () => {
          const { error } = await sb.rpc("fn_open_press", {
            p_round_id: roundId,
            p_game_id: gameId || null,
            p_segment_label: segmentLabel,
            p_start_hole: startHole,
            p_end_hole: endHole,
            p_stake_cents: Math.round(stakeDollars * 100),
            p_side_a_rp_ids: defaultSideA,
            p_side_b_rp_ids: defaultSideB
          });
          if (error) throw error;
        },
        { attempts: 3, baseMs: 400 }
      );
      onOpened();
    } catch (e: any) {
      setErr(pressErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const isNassau = games.find((g) => g.id === gameId)?.game_type === "nassau";

  return (
    <div className="card p-4 border border-gold-500/40 bg-brand-900/40 space-y-3">
      <div className="flex items-center justify-between">
        <p className="h-eyebrow text-gold-400">Open a press</p>
        <button onClick={onClose} className="btn-ghost text-xs">
          Cancel
        </button>
      </div>

      {games.length > 1 && (
        <div>
          <label className="label text-xs">Attach to game</label>
          <select
            className="input text-sm"
            value={gameId}
            onChange={(e) => pickGame(e.target.value)}
          >
            <option value="">— round-level —</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {isNassau && totalHoles === 18 && (
        <div>
          <label className="label text-xs">Segment</label>
          <div className="grid grid-cols-3 gap-1">
            {(["Nassau front", "Nassau back", "Nassau overall"] as const).map(
              (label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => pickSegment(label)}
                  className={`btn-ghost text-xs ${
                    segmentLabel === label ? "bg-gold-500/20 text-gold-400" : ""
                  }`}
                >
                  {label.replace("Nassau ", "")}
                </button>
              )
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label text-xs">Start hole</label>
          <input
            type="number"
            className="input text-sm"
            min={1}
            max={totalHoles - 2}
            value={startHole}
            onChange={(e) => setStartHole(parseInt(e.target.value, 10) || 1)}
          />
        </div>
        <div>
          <label className="label text-xs">End hole</label>
          <input
            type="number"
            className="input text-sm"
            min={startHole + 2}
            max={totalHoles}
            value={endHole}
            onChange={(e) => setEndHole(parseInt(e.target.value, 10) || totalHoles)}
          />
        </div>
      </div>

      <div>
        <label className="label text-xs">Stake (USD)</label>
        <input
          type="number"
          className="input text-sm"
          min={1}
          step={1}
          value={stakeDollars}
          onChange={(e) => setStakeDollars(parseInt(e.target.value, 10) || 0)}
        />
      </div>

      <div className="text-[11px] text-cream-100/55 leading-snug space-y-1">
        <p>
          Sides default to your team vs everyone else
          {defaultSideA.length === 1 &&
            defaultSideB.length > 1 &&
            ` (you alone vs ${defaultSideB.length} others — heads up, this is a 1-vs-${defaultSideB.length} press)`}
          {defaultSideA.length === 1 &&
            defaultSideB.length === 1 &&
            " (1-vs-1)"}
          {defaultSideA.length > 1 && ` (${defaultSideA.length}-vs-${defaultSideB.length})`}.
        </p>
        <p>The other side has 24h to accept; it auto-expires after that.</p>
        {defaultSideA.length === 1 && defaultSideB.length > 1 && (
          <p className="text-amber-300">
            If you meant a 1-vs-1, set up teams on the round before pressing.
          </p>
        )}
      </div>

      {err && <p className="text-xs text-red-300">{err}</p>}

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="btn-primary text-sm"
        >
          {busy ? "Opening…" : "Open press"}
        </button>
      </div>
    </div>
  );
}
