# Admin press-dispute workflow

What to do when a user says "Ben told me he accepted my press but it
didn't settle." Walk-through of the support flow using the surfaces
that are live today.

---

## The setup (hypothetical scenario)

Sunday's foursome played JGCC. Patrick says he opened a $20 press
against Ben on the back 9. Ben says he accepted it. Round was finalized
and Patrick doesn't see the $20 in his ledger. Patrick reaches out:
**"What happened to my press?"**

---

## Step 1 — Open the admin audit log

Navigate to `/admin/audit`.

You'll see the 200 most recent destructive events across the platform.
The page renders filter chips at the top showing every distinct `kind`
with a count — `press.open`, `press.accept`, `press.decline`,
`press.withdraw` are all there alongside the round / course lifecycle
events.

---

## Step 2 — Filter to press events

Tap the `press.open` chip. The list filters to every press that was
ever opened on the platform.

The columns:

| Column | What it shows |
|---|---|
| When | Timestamp of the event |
| Actor | Display name of who triggered it (resolved from `profiles`) |
| Kind | `press.open` / `press.accept` / `press.decline` / `press.withdraw` |
| Target | `press @ rounds/abc12345` — deep-links to the round |
| Detail | jsonb summary: `round_id=... segment_label=... stake_cents=...` |

The Target column showing `press @ rounds/...` instead of the press
UUID is the deep-link improvement from commit 41d3ddd.

---

## Step 3 — Find Patrick's press

Two paths to narrow down:

### Option A — search by date

Sort by "When" descending (default). Scan to Sunday's date. Look for
`press.open` events where the **Actor** is Patrick.

### Option B — search by round

If you know the round ID, you can append `?kind=press.open` to the URL
and filter the table by Patrick's actor or scan the detail column for
the round_id.

Either way, you land on the row that represents the press being opened.

---

## Step 4 — Open the round's audit trail

Click the Target link (`press @ rounds/abc12345`). This deep-links to
`/admin/rounds/abc12345` — the full round inspection page.

There you can see:

- The round's state (live / pending / finalized)
- All players + their scores
- All games on the round (skins, best ball, Nassau, etc.)
- All settlements (the actual money owed)

---

## Step 5 — Trace the press lifecycle

Go back to `/admin/audit` and filter by `kind=press.accept`. Look for
the same `target_id` (the press UUID) — that's the accept event.

If you see:

- **press.open by Patrick** → and **press.accept by Ben** → and the
  round is finalized → the press SHOULD have settled. Check
  `/admin/rounds/abc12345` for the settlement breakdown.

- **press.open by Patrick** but **no press.accept** → Ben never tapped
  Accept on his device. The press was pending at finalize and was
  silently dropped (pre-commit 5f7e78d) OR the user got a warning and
  finalized anyway (post-commit 5f7e78d).

- **press.open by Patrick** + **press.decline by Ben** → Ben declined.
  No money owed.

- **press.open by Patrick** + **press.withdraw by Patrick** → Patrick
  withdrew. No money owed.

---

## Step 6 — Check settlement

On `/admin/rounds/[id]`, look at the settlements section. If the press
was accepted and the round finalized, there should be a settlement line
with the press's label (e.g. "Nassau back · manual press").

If you see the line but the math is wrong → engine bug. Check the
zero-sum invariant: sum of all per-player deltas should be 0.

If you don't see the line at all but the audit log shows both open AND
accept → the round was finalized BEFORE the accept landed. This is the
case where the new warning banner (commit 5f7e78d) helps prevent
recurrence.

---

## Step 7 — Communicate the resolution

Based on what the audit trail shows, you can reply to Patrick with one
of:

| Audit reveals | Reply |
|---|---|
| Ben never accepted | "Ben never tapped accept — the press expired pending. Going forward the round page warns before finalize if any press is unanswered." |
| Ben declined | "Ben declined the press at 2:43pm. No money owed." |
| Press was withdrawn | "You withdrew the press yourself at 3:01pm — likely after Ben hesitated." |
| Accept landed but post-finalize | "The accept arrived after the round was finalized — system dropped it silently. We can unfinalize, re-add the settlement, and re-finalize. (commit 5f7e78d guards against this going forward.)" |
| All looks right | "Press settled correctly — $20 from Ben to you is on the /ledger page. Check your Venmo." |

---

## Pending-press monitoring (proactive)

To catch disputes BEFORE they happen, the `/admin` overview page now
has a **"Pending presses"** panel that lists every pending press across
the platform sorted by age. Anything >12h is amber, >20h is red (auto-
expires at 24h).

If you see a long-pending press in a group you know, you can:

1. Tap the round link to inspect
2. Reach out to the side-B player who hasn't responded yet
3. Or just wait — it auto-expires at 24h

---

## What can't be done from the audit log

The audit log is **append-only**. There's no UPDATE or DELETE policy on
`destructive_audit_log` — even an admin can't edit history through the
API. This is intentional: the audit trail is the trust mechanism.

If you need to *correct* a settlement (e.g. you unfinalized the round
to add the missed press accept), the unfinalize itself writes another
audit row. Anyone reviewing the trail later sees the full history:
press opened → accepted → round finalized → unfinalized by admin →
press settled → re-finalized.

---

## SQL reference (for spelunking)

If the admin UI isn't enough, you can query directly:

```sql
-- All press events on a round, chronological
select kind, occurred_at, actor_profile_id, target_id, detail
  from destructive_audit_log
 where target_table = 'round_presses'
   and detail->>'round_id' = '<round_id>'
 order by occurred_at;

-- All presses on a round + current status
select id, status, segment_label, start_hole, end_hole, stake_cents,
       opened_at, accepted_at, declined_at, withdrawn_at
  from round_presses
 where round_id = '<round_id>'
 order by opened_at;

-- Cross-reference: who accepted what (resolve rp_id → player name)
select rp.id, p.display_name, press.id as press_id, press.status
  from round_presses press
  join round_players rp on rp.id = press.accepted_by_rp_id
  join players p on p.id = rp.player_id
 where press.round_id = '<round_id>';
```

These queries require service-role access (admin Supabase token), not
the user-facing API.
