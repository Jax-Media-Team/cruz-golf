# Screen-by-screen UI plan

Mobile first. Two-column desktop layout only on the dashboard. Default font: system stack with Inter as the preferred display face. Color: neutral slate/zinc with a single accent (default green-700). Cards with 12px radius and subtle border, no heavy shadows.

## Auth
- `/login` — email + password, magic link option.
- `/signup` — email + password + display name + new group name.

## App shell
Fixed bottom tab bar on mobile (Dashboard / Players / Courses / Profile). Top-right: group switcher.

## `/dashboard`
- Today's / next round card at top with "Resume" CTA.
- Past 5 finalized rounds list, each row: course, date, leader, net winner, total at stake.
- "Create round" primary button.

## `/players`
- Search bar + sort.
- List rows: avatar (initial), name, HI, default tee, GHIN badge, guest badge.
- Tap row → drawer: edit fields, "Refresh handicap" (manual prompt by default), delete.
- Plus FAB → add player form.

## `/courses`
- List of courses, each with tee count and last-played date.
- Tap → tee list. Tap a tee → hole table editor.
- Plus FAB → add course wizard:
  - Step 1: name + city/state + (optional) USGA Course ID.
  - Step 2: add tees (name, gender, rating, slope, par).
  - Step 3: enter 18 (or 9) hole pars + stroke indexes (paste-friendly grid).

## `/rounds/new`
Wizard, three steps, accordion on desktop:
1. Basics — course, date, holes (9/18), starting hole.
2. Players & teams — multi-select players, assign tee per player (drop-down), drag-to-make-teams.
3. Games — checkbox list of formats. Each opens an inline drawer for stake / allowance / config.

Sticky footer: "Start round".

## `/rounds/[id]` (live round dashboard)
- Header: course, tees, date, status pill (live).
- Tabs: Leaderboard · Skins · Teams · Bets · Card.
- Leaderboard tab:
  - Toggle: Gross / Net.
  - Table: pos, player, thru, score, vs par.
  - Tap player row → score entry sheet for that player.
- Skins tab: chronological list of holes; each row shows winner or "carry x N".
- Teams tab: scoreboard if any team game is configured.
- Bets tab: live projected payouts; finalize button when round status allows.
- Card tab: full 18-hole scorecard grid for all players, read-only (commissioner can edit inline).

## `/rounds/[id]/score?player=`
Mobile-only big-thumb score entry:
- Top: player name + hole nav (1..18 strip).
- Center: big number with +/− steppers (default = par).
- Side info: SI, par, strokes received this hole.
- Sub-area: optional putts/penalties chips.
- Auto-advances on tap to next hole.

## `/rounds/[id]/leaderboard` (spectator)
- Stripped shell, no nav bar.
- Same Leaderboard / Skins / Bets tabs but read-only.

## `/rounds/[id]/finalize`
- Summary: each game's outcome.
- "Who pays whom" matrix.
- Buttons: Copy summary text · Email PDF (V2) · Edit & re-finalize.

## Component primitives
Built locally in `components/ui/`:
- `Button`, `IconButton`
- `Card`, `CardHeader`, `CardBody`
- `Input`, `Textarea`, `Select`, `Checkbox`, `Toggle`
- `Tabs`, `TabList`, `TabPanel`
- `Sheet` (bottom sheet on mobile, side modal on desktop)
- `Stepper` (numeric increment)
- `Avatar` (initials)
- `Badge` (HI badge, "guest" badge, "live" pill)
- `Table` (responsive, collapses to cards on narrow widths)

No 3rd-party UI lib by default; this keeps bundle small and the look consistent with the brand.
