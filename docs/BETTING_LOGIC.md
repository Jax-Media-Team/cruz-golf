# Betting / Game calculation logic

All money is integer **cents**. Every game implements the same interface:

```ts
type GameInput = {
  game: RoundGame;          // type + config + stake
  players: RoundPlayer[];   // includes playingHandicap, strokeIndex map, team
  scores: Score[];          // gross per (round_player_id, hole_number)
  course: { holes: CourseHole[] };
  manualEntries?: ManualEntry[];
};

type GameOutput = {
  perPlayer: Map<RoundPlayerId, { delta_cents: number, breakdown: string[] }>;
  perTeam?: Map<TeamId, { delta_cents: number }>;
  status: "live" | "final";
  // for the live UI:
  highlights: Array<{ hole: number, label: string }>;
};
```

`delta_cents` is signed — positive means winnings, negative means owed. Sum across all players is always 0 (zero-sum). This invariant is asserted in tests.

## Game catalog

### Individual gross / net
- Lowest score wins the pot.
- Ties split. Three-way tie on a $30 pot → +$10 each, others −$X according to entries.
- Stake is per-player buy-in.

### 2-man best ball gross / net
- Each team's hole score = lower of its two players for that hole.
- Two formats:
  - **Match play best ball**: head-to-head, +1/−1 per hole win, push = no change. Winner of the match wins stake.
  - **Stroke play best ball**: lowest team total over the round wins the pot. (configurable in `game.config.mode`)
- Net version applies per-player strokes BEFORE picking the lower ball. (i.e., compute each player's net per hole, take the lower.)

### Team aggregate gross / net
- Team hole score = sum of all teammates' scores on that hole.
- Lowest aggregate total wins the pot.
- Net = aggregate of net scores.

### Gross skins
- A "skin" is awarded for outright lowest gross on a hole. Tied = no skin.
- Tie behavior is configurable: `push_to_carry | split | nullify`.
- Default: tied skins **carry over** to the next hole; final unclaimed carries are split or returned per `config.unclaimed`.
- Skin value: `config.skin_value_cents`. Total pot = `skin_value × 18` (or 9). If skins are claimed by holes, that's how money flows; if some carry to the end unclaimed, see `unclaimed`.

### Net skins
- Same as gross skins but using net scores.

### Canadian skins (a.k.a. validated / rolling skins)
Configurable rules; defaults match the most common Florida-club flavor:
- **Birdie validation**: a skin only counts if the winning score is a birdie or better (gross or net per `config.net`). If the lowest score is par or worse, no skin awarded — carry.
- **Carryover**: ties carry; non-validated wins carry.
- **Escalation**: skin value can step up after each carry: `config.escalation = "flat" | "linear" | "double"`.
- **Final hole sweep**: if the 18th carries, configurable: `split | winner_takes_all | refund`.

Implemented as a generalized skins engine where flags toggle behavior — see `lib/games/skins.ts`.

### Nassau
- Three matches per round: Front 9, Back 9, Overall 18.
- Each match has its own stake (`config.front_stake_cents`, etc.) and is settled by net stroke-play OR match play (`config.match_play: bool`).
- **Presses**: `config.presses`:
  - `"none"`
  - `"manual"` — commissioner can press from the UI; a press is a new sub-match starting at the next hole, same stake (or `press_stake_cents`).
  - `"auto_2_down"` — auto-press whenever a side goes 2 down with at least 3 holes remaining in the match.
- Presses are cumulative; each settles independently.

### Match play (front/back/overall, single match)
- Two-player or two-team head-to-head.
- Each hole: lower (net or gross) wins +1, tie = push.
- Match ends when "X up with Y to play" makes the result mathematically certain, but for live UI purposes we keep showing through 18.
- Settlement: stake per match.

### Closest to the pin (CTP)
- One entry per par-3 (or per chosen hole). `config.holes: number[]`.
- Pot = `config.pot_per_hole_cents × holes.length`, contributed equally from all players (`stake_cents` is the per-player buy-in into the CTP pot).
- Winner per hole entered manually; `manual_entries` row written.
- No winner declared = pot rolls to next CTP hole, configurable.

### Long drive
- Same model as CTP but tied to a single hole (or holes).

### Custom side bets
- Free-form. `config.label`, `stake_cents`. Winner picked manually.
- Use this for "first sandie", "first 3-putt pays", "snake", etc. without writing new code.

## Settlement

Final settlement runs all games for the round in order, sums `delta_cents` per player, and outputs a **minimum-flow** settlement (the smallest set of "A pays B $X" transfers that zero out balances). Algorithm: greedy — sort positive and negative balances, repeatedly match largest creditor to largest debtor.

Stored in `settlements` table on finalize. Re-finalizing replaces the prior settlement rows for that round.

## Example: skins state machine (simplified)

```ts
let carry = 0;
const events = [];
for (const hole of holes) {
  const winner = pickWinner(hole); // one player, or null on tie
  const isValidated = config.requireBirdie ? scoreIsBirdieOrBetter(hole, winner) : true;
  if (winner && isValidated) {
    const value = baseSkin * (config.escalation === "double" ? 2 ** carry : 1)
      + carry * baseSkin; // simplified
    events.push({ hole, winner, value });
    carry = 0;
  } else {
    carry++;
  }
}
// resolve trailing carry per config.unclaimed
```

Real implementation supports linear, flat, and doubling escalation, and three tie-handling modes; see `lib/games/skins.ts` and the unit tests.

## Invariants (enforced in tests)

- For every game on every input, `Σ delta_cents === 0`.
- Player handicap allowance is applied at handicap-snapshot time (`round_players.playing_handicap`), not re-derived per game. Each game can apply an additional adjustment via `game.allowance_pct` if it differs from the round default.
- Score caps (ESC) are applied for *handicap-related* nets only, never for the gross leaderboard or skins gross.
- A score change re-runs the affected game(s) and emits a fresh standings projection; nothing is cached server-side beyond the latest snapshot.
