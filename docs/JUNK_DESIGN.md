# Junk side-bet system — design + rollout

**Status:** engine shipped, schema + UI not yet applied.
**Origin:** real-world tester feedback (2026-05-11) from a player who
ran a 6-6-6 round and asked for "$2 escalating junk."
**Owner:** product
**Last revised:** 2026-05-11

> "What would make it extremely cool is if you could choose junk
> (birdies, greenies, poleys, pinnies, etc.) and assign an escalating
> dollar amount. Example: we usually play $2 escalating junk.
> Sometimes easy to keep track of and sometimes not. Would be a game
> changer if that could be factored in."

This is the doc Patrick asked for: architect first, ship incrementally.

---

## Product principle (from Patrick)

> Junk should feel like **"tap the extra things that happened on the
> hole."** Not "configure accounting software."

Tactical rules that fall out of this:

1. **Default to disabled.** Don't clutter normal score entry unless
   the commissioner explicitly turned junk on.
2. **One-tap entry.** Player + hole + category. Done. No required
   metadata. Note + custom_label are optional.
3. **Frozen pricing.** Once a junk item is recorded, its dollar amount
   is fixed. Escalating mode escalates the NEXT item's price, never
   reprices history. (Mental model: stock-market fill price, not a
   reconciled ledger.)
4. **Live totals visible without ceremony.** A small "Junk: Pat +$8 ·
   Ben -$4 · Mit +$2 · Kyl -$6" strip on the round page is enough —
   no separate page.
5. **Audit log on edits / deletes.** Same destructive-op log the
   presses use. Disputed junk is settled the same way.

---

## Engine (shipped 2026-05-11, commit a0d77d3+)

Pure-function library at `lib/games/junk.ts` with 26 regression tests
in `tests/junk.test.ts`. Public surface:

```ts
export type JunkCategory =
  | "birdie" | "eagle" | "greenie" | "poley" | "pinnie"
  | "sandy" | "barkie" | "chip_in" | "net_birdie" | "custom";

export type JunkItem = {
  id: string;
  player_id: UUID;          // winner
  hole_number: number;
  category: JunkCategory;
  custom_label?: string;
  amount_cents: number;     // frozen at record time
  created_at: string;
  note?: string;
};

export type JunkConfig = {
  active_categories: JunkCategory[];
  mode: "flat" | "escalating";
  flat_amount_cents?: number;
  base_amount_cents?: number;
  escalation_step_cents?: number;
  escalation_scope?:
    | "per_round"          // default — "the pot grows every junk"
    | "per_category"       // birdies escalate independently of greenies
    | "per_player_per_category"; // each player's repeats only count
  custom_categories?: Array<{ key: string; label: string }>;
};

export const DEFAULT_JUNK_CONFIG: JunkConfig;

export function computeJunkAmount(
  config: JunkConfig,
  priorItems: JunkItem[],
  newCategory: JunkCategory,
  newPlayerId?: UUID
): number;

export function settleJunk(
  items: JunkItem[],
  players: Array<{ id: UUID }>
): JunkSettlement;

export function buildLiveJunkTotals(
  items: JunkItem[],
  players: Array<{ id: UUID }>
): LiveJunkTotals;
```

**Settlement rule (the one we ship today): everyone-pays-the-winner.**
Every junk item the winner gets `amount_cents` from each other
player. With 4 players and a $2 item, winner gets +$6 and each other
player pays -$2. Zero-sum across the round.

A pot-based variant ("everyone pre-funds a pot, junk pays from the
pot") can be added later as a config mode. It's not in the casual
ask.

**Defensive behavior**:
- Items where the winner isn't in the players list are skipped (not
  silently debited).
- Zero-amount items no-op.
- `perItem` array preserves every item (including no-ops) for audit
  + display, but `winner_gain_cents` is 0 for skipped items.

---

## Schema proposal (NOT YET APPLIED — awaiting Patrick's go-ahead)

```sql
-- ===========================================================
-- Migration 00XX_junk_side_bets.sql (DRAFT)
-- ===========================================================

-- Per-round junk config. Optional row — its absence means junk is
-- not enabled on this round. Commissioner-only writes.
create table if not exists round_junk_config (
  round_id uuid primary key references rounds(id) on delete cascade,
  active_categories text[] not null default array[]::text[],
  mode text not null default 'escalating'
    check (mode in ('flat', 'escalating')),
  flat_amount_cents integer,
  base_amount_cents integer,
  escalation_step_cents integer,
  escalation_scope text default 'per_round'
    check (
      escalation_scope is null
      or escalation_scope in
        ('per_round', 'per_category', 'per_player_per_category')
    ),
  custom_categories jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

-- Per-item junk record. One row per junk event.
create table if not exists round_junk_items (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds(id) on delete cascade,
  round_player_id uuid not null references round_players(id) on delete cascade,
  hole_number int not null check (hole_number between 1 and 18),
  category text not null,
  custom_label text,
  -- Frozen at record time via computeJunkAmount(). Never recomputed.
  amount_cents integer not null check (amount_cents >= 0),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  deletion_reason text
);

create index if not exists round_junk_items_round_idx
  on round_junk_items (round_id) where deleted_at is null;
create index if not exists round_junk_items_player_idx
  on round_junk_items (round_player_id) where deleted_at is null;

-- RLS: anyone in the group can read junk items for their group's rounds.
-- Only the commissioner can write/edit/delete junk items (via RPCs
-- below — direct table writes are blocked).
alter table round_junk_items enable row level security;
alter table round_junk_config enable row level security;

-- (READ policy: group_members read junk for their groups.)
-- (WRITE policies: none — go through RPCs.)

-- ===========================================================
-- SECURITY DEFINER RPCs
-- ===========================================================

-- fn_record_junk(round_id, round_player_id, hole_number, category,
--                custom_label, amount_cents, note)
-- - Verifies caller is in the round's group
-- - Computes the amount IF caller passes amount_cents=null
--   (server-side authoritative pricing — prevents client from picking
--   its own number)
-- - Inserts the item
-- - Writes a destructive_audit_log row (kind = "junk.record")
-- - Returns the new row

-- fn_edit_junk(item_id, amount_cents?, note?, category?, hole_number?)
-- - Verifies caller is commissioner OR original recorder
-- - Updates the row
-- - Audit log entry (kind = "junk.edit")

-- fn_remove_junk(item_id, reason)
-- - Soft-delete (sets deleted_at + deleted_by + deletion_reason)
-- - Audit log entry (kind = "junk.remove")
-- - Items don't appear in future settlements

-- fn_set_junk_config(round_id, config_json)
-- - Commissioner-only
-- - Upserts the round_junk_config row
-- - Audit log entry (kind = "junk.config_change")
```

Notes:
- **No hard-deletes.** Soft-delete pattern matches the rest of the
  app. Settlement filters `deleted_at IS NULL`.
- **Server-side pricing.** `fn_record_junk` is authoritative — the
  client doesn't get to pick `amount_cents`. The RPC computes via the
  same logic as `computeJunkAmount()` (which we'll port to a
  Postgres function, or pass through the engine in a Vercel function).
  This stops a malicious client from recording a $1000 birdie.
- **Audit log uses the existing `destructive_audit_log` table.**

---

## UI proposal

### Setup (commissioner)

On `/rounds/[id]/games`, the games-editor gets a new section:

```
┌─ Junk side bets ─────────────────────────────────────┐
│ [✓] Enable junk for this round                      │
│                                                      │
│ Mode:   ( ) Flat  (•) Escalating                    │
│ Base:   $2  Step: $2  Scope: per round              │
│                                                      │
│ Categories:                                          │
│   [✓] Birdie    [✓] Eagle      [✓] Greenie         │
│   [ ] Poley     [ ] Pinnie     [✓] Sandy           │
│   [✓] Chip-in   [ ] Barkie     [ ] Net birdie      │
│   [+ Add custom: e.g. "Woodie", "Wilson special"]   │
└──────────────────────────────────────────────────────┘
```

Defaults match `DEFAULT_JUNK_CONFIG`: $2 escalating, per-round,
birdie + greenie + sandy + chip-in active.

### Entry (any player, during the round)

On `/rounds/[id]` (the round page) when junk is enabled, a "Junk"
tab in the leaderboard (sibling to Gross/Net/Skins/Match/Bets) or a
collapsible section in the round-view:

```
┌─ Junk on hole 7 ─────────────────────────────────────┐
│ Who got it?                                          │
│   [ Pat ]   [ Ben ]   [ Mit ]   [ Kyl ]              │
│ What?                                                │
│   [ Birdie ] [ Greenie ] [ Sandy ] [ Chip-in ]       │
│   [ + Other ]                                        │
│ Live amount: $4 (3rd junk this round, $2 base + $2)  │
│ [ Record →  $4 to Mit ]                              │
└──────────────────────────────────────────────────────┘
```

The 2-tap path: player → category → done. The amount is preview-only
(server is authoritative).

The "Live totals" strip below shows running per-player nets:

```
Junk · 5 items · $32 moved
 Pat +$14 (2 birdies)  ·  Ben -$8  ·  Mit +$6 (1 chip-in)  ·  Kyl -$12
```

### Edit / remove

Tap any item in the live totals strip to:
- See item detail (winner, hole, category, amount, who recorded)
- Edit (commissioner OR original recorder only)
- Remove (commissioner only, requires a reason — same as press
  withdraw)

### Finalize integration

The finalize view's "By game" breakdown gets a "Junk" line:

```
Best Ball (gross) · stroke    Pat/Ben  +$10  / Mit/Kyl  -$10
6-6-6 · auto presses          Pat +$5  · Ben -$10  · Mit +$10  · Kyl -$5
Junk · 5 items · $32 moved    Pat +$14 · Ben -$8  · Mit +$6   · Kyl -$12
                              ─────────────────────────────────────────
                              Pat +$29 · Ben -$28 · Mit +$6   · Kyl -$27
```

Same composition rule as everything else: each game (and junk) emits
per-player deltas, the finalize view sums them, settlement table is
written.

---

## Rollout phases

### Phase 0 — Engine ✓ shipped 2026-05-11

- `lib/games/junk.ts` with full type surface
- `tests/junk.test.ts` covering flat / escalating / multi-item / multi-winner
  / zero-sum / interactions / edit-remove / display helpers
- 26/26 tests passing

No schema, no UI, no API. Just the pure-function math.

### Phase 1 — Schema + write API

- Migration `00XX_junk_side_bets.sql` (paste in chat for Patrick to apply)
- RPCs: `fn_record_junk`, `fn_edit_junk`, `fn_remove_junk`,
  `fn_set_junk_config` (all SECURITY DEFINER, all audit-logged)
- A minimal `/api/junk/*` Next.js route surface (or invoke RPCs directly
  from the round page — RPC pattern matches presses)

### Phase 2 — Setup UI

- Junk config block in `/rounds/[id]/games`
- Default-on suggestion: when commissioner adds a Nassau / 6-6-6 /
  Best Ball / Aggregate game, prompt "Want to add $2 escalating junk
  too? Most groups do."

### Phase 3 — Entry UI

- New "Junk" tab on the round-page leaderboard surface
- Quick-tap entry: player chip → category chip → preview amount →
  Record
- Live totals strip on the round page (always visible when junk is
  enabled)
- Realtime subscription on `round_junk_items` so any player's
  entries appear instantly for everyone watching

### Phase 4 — Finalize integration

- Settlement composes junk into the final per-player money map
- "Junk" line in the finalize "By game" breakdown
- Junk movement counted in clubhouse signals (lifetime money, biggest
  win, etc.) — derived data already rebuilds correctly

### Phase 5 — Admin observability

- `/admin/rounds/[id]` shows the junk log + lifecycle
- `destructive_audit_log` admin filter for `kind=junk.*` already
  works (the filter is open-ended)

---

## Test scenarios (engine — all passing)

| Scenario | Status |
|---|---|
| Flat $2 junk pays $2 regardless of priors | ✓ |
| Escalating $2 → $4 → $6 across mixed categories (per_round) | ✓ |
| Escalating per_category — birdies vs greenies | ✓ |
| Escalating per_player_per_category — each player's repeats only | ✓ |
| Single $2 birdie: 4-player → winner +$6, each loser -$2 | ✓ |
| Zero-sum across mixed escalating amounts | ✓ |
| Multiple items on one hole settle independently | ✓ |
| Two players each win junk on different holes | ✓ |
| perItem audit record for each settlement | ✓ |
| 3-player and 1-player edge cases | ✓ |
| Stranger winner ignored (foursome-scope safe) | ✓ |
| Zero-amount item is a no-op | ✓ |
| Removing an item refunds correctly | ✓ |
| Editing an item's amount changes settlement | ✓ |
| Junk additive on top of 6-6-6 / Nassau / Best Ball deltas | ✓ |
| Combined zero-sum across 3 games + 4 junk items | ✓ |
| Live totals: items per player, category counts, net cents | ✓ |
| Display helpers for category labels + custom labels | ✓ |

---

## Open decisions for Patrick before Phase 1

1. **Settlement convention.** Confirm "everyone pays the winner" is
   the right default. Pot-based + handicap-adjusted variants can
   wait.
2. **Default categories.** Engine currently defaults to birdie +
   greenie + sandy + chip-in. Add eagle? Drop sandy?
3. **Server-side pricing.** Should `fn_record_junk` compute the
   amount and refuse client-supplied values? (Recommended: yes.)
4. **Edit window.** Can junk be edited indefinitely, or only until
   finalize? (Recommended: indefinitely while round is not finalized.)
5. **Multi-foursome rounds (events).** Junk pools across foursomes
   in the same event, or stays foursome-scoped? (Recommended: stays
   foursome-scoped, same as presses.)

When Patrick gives the go-ahead, drop the schema + Phase 2 UI in
one commit, then Phase 3 in the next.
