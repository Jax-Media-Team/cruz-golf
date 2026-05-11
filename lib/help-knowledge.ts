/**
 * Cruz Golf in-app help knowledge base.
 * Plain Q&A pairs the help widget filters with fuzzy matching.
 * Edit this file as features change — it's the single source of truth.
 */

export type HelpEntry = {
  q: string;
  a: string;
  /** Extra search terms — synonyms, related actions. */
  keywords?: string[];
};

export const HELP_ENTRIES: HelpEntry[] = [
  // ── Accounts & access ──
  {
    q: "Do I need to invite people, or can anyone sign up?",
    a: "Anyone with the URL can create an account, but signups land in their own private group. To get into one of your rounds they still need a per-round invite link or the round's 4-digit PIN. Your scores, players, and ledger are not visible to outside accounts.",
    keywords: ["signup", "register", "create account", "open", "private", "invite"]
  },
  {
    q: "How do I invite someone to a round?",
    a: "Open the round → Invites. You can: (1) generate single-use invite links per person — each link works exactly once, or (2) share the round's 4-digit PIN, which players use at /rounds/[id]/join. Or set the round's access mode to \"open_to_group\" so any group member can score without an invite.",
    keywords: ["invite", "share", "pin", "link", "join round", "add player"]
  },
  {
    q: "How does someone join my round?",
    a: "They tap the invite link you sent (it auto-redeems and adds them) or open /rounds/[id]/join and enter the 4-digit PIN. After joining, they confirm wagers if any games have stakes, then they can score.",
    keywords: ["join", "pin", "invite", "redeem"]
  },
  {
    q: "Can I sign in with Google?",
    a: "Yes — both /login and /signup have a \"Continue with Google\" button. Email + password also works.",
    keywords: ["google", "oauth", "sso", "facebook", "login"]
  },

  // ── Scoring ──
  {
    q: "Can one person enter scores for everyone?",
    a: "Yes. From the round page tap \"Score the group.\" Toggle which players are present (defaults to everyone in), then enter each player's score on each hole using ± buttons or the 1–9 chip rail. Auto-advances when every selected player has a score on the current hole.",
    keywords: ["group", "scorekeeper", "scorecard", "everyone", "all players", "golf genius", "shared"]
  },
  {
    q: "How do I score just my own round?",
    a: "Tap your name on the leaderboard, or open /rounds/[id]/score?rp={your_id}. Same ± buttons + chip rail, only for you.",
    keywords: ["solo", "myself", "individual", "own scores"]
  },
  {
    q: "How do I fix a wrong score?",
    a: "Just tap the hole and enter the right number. Scores are upserted, so the correction overwrites the previous entry and the leaderboard updates in realtime.",
    keywords: ["fix", "edit", "correct", "wrong", "mistake", "change"]
  },
  {
    q: "What if I lose connection mid-round?",
    a: "Keep scoring — the app reconnects automatically. When the socket comes back, the leaderboard refetches every player's scores from the database, plus a 60-second safety net catches anything Realtime might silently drop.",
    keywords: ["offline", "disconnect", "wifi", "lose connection", "realtime", "reconnect"]
  },

  // ── Games ──
  {
    q: "What games does Cruz Golf support?",
    a: "Skins (with or without carryover, gross or net), Nassau (with autopress), Best Ball (gross/net), 2-Man Aggregate, 6-6-6 (rotating partners every 6 holes), Wolf, Quota points, pure stroke play (gross + net), Closest-to-Pin, Long Drive, and Custom side bets. Multiple games can run simultaneously on the same round.",
    keywords: ["games", "formats", "skins", "nassau", "best ball", "wolf", "quota", "ctp", "long drive"]
  },
  {
    q: "How do skins carryover work?",
    a: "If no one wins a hole outright (lowest score is tied), that skin carries to the next hole, where the pot doubles. You can disable carryover when creating the game — ties just skip and the skin is voided.",
    keywords: ["skins", "carry", "carryover", "tie", "push"]
  },
  {
    q: "What's 6-6-6?",
    a: "An 18-hole team game where partners rotate every 6 holes — so you team with each other player exactly once. Holes 1–6 with partner A, 7–12 with B, 13–18 with C. Settles like three mini best-ball matches.",
    keywords: ["6-6-6", "six six six", "rotating partners", "round robin"]
  },
  {
    q: "How do I run a member-guest tournament with multiple foursomes?",
    a: "Create an Event from the dashboard (\"+ New event\" link in the Events section, commissioner-only). Pick the kind (tournament / trip / club game), name it, and set the date(s). From the event home page, tap \"+ Add foursome\" to create one round per group of 4 — each foursome gets its own scorer + presses, and the event aggregates standings across them. Real-world examples: 16 players in 4 foursomes for a member-guest, 8 players × 3 days for a golf trip, 12 players in 3 foursomes for Saturday club games. Field-wide games (skins across all 16, net stroke play across the field) ship in a later phase.",
    keywords: ["event", "tournament", "member-guest", "multi-group", "trip", "club game", "foursome", "field", "multiple groups"]
  },
  {
    q: "What's the difference between a round and an event?",
    a: "A round is one foursome playing one course on one day — the basic unit. An event is an optional container that groups multiple rounds (foursomes) under one umbrella. Most rounds will never belong to an event — that's fine. Use events when you need a shared leaderboard across foursomes (member-guest), or a multi-round trip with rolling totals. Presses ALWAYS stay round-scoped (foursome-only) — no real golf-group press crosses foursomes.",
    keywords: ["round vs event", "foursome", "event", "container", "grouping"]
  },
  {
    q: "How do I score a scramble — do all four players have to enter their score?",
    a: "No. Scramble is one shared shot per team, so one scorer entering the team's score works fine. The engine takes the lowest entered score on each hole as the team score. If you tap the same number into all four player rows (group-pad pattern), the math is identical. Best ball and aggregate are different — each player plays their own ball, so every player must record on every hole.",
    keywords: ["scramble", "scramble scoring", "team score", "one scorer", "shared ball"]
  },
  {
    q: "What's the difference between scramble and best ball?",
    a: "Scramble: every team member hits, you pick the best shot, everyone plays the next shot from that spot. One shared score per hole. Best ball: every team member plays their own ball the whole hole — the team's score is the lowest individual score. In the app: scramble lets one scorer enter for the team; best ball requires every player's own card.",
    keywords: ["scramble vs best ball", "shared shot", "individual ball", "team format"]
  },

  // ── Presses ──
  {
    q: "How do I open a manual press?",
    a: "On the live round page, tap \"+ Press.\" Pick which game it attaches to, the stake (defaults to the parent stake), and the hole range (must cover at least 3 holes). Sides default to your team vs everyone else — adjust if you want a different matchup. The other side gets a \"Press requested\" banner and 24 hours to accept.",
    keywords: ["press", "open press", "manual press", "side bet", "double or nothing", "extra wager"]
  },
  {
    q: "Who can accept a press?",
    a: "Any player on the side being pressed (side B) can tap Accept or Decline. Commissioners can also act on behalf of either side. Once accepted, the press is locked in and settles at finalize alongside the parent game.",
    keywords: ["accept press", "decline press", "press response", "press lock"]
  },
  {
    q: "Can I withdraw a press I opened?",
    a: "Yes — until the other side accepts. Tap Withdraw on the pending press row. Once accepted it's binding through finalize; if you really need to cancel after that, the commissioner can unfinalize the round and edit. Every open / accept / decline / withdraw writes to the audit log so disputes have a paper trail.",
    keywords: ["withdraw press", "cancel press", "undo press", "press expired"]
  },
  {
    q: "What's the difference between an auto-press and a manual press?",
    a: "Auto-press fires when one side is 2 down (or whatever trigger you set) with 3+ holes left — no taps needed, configured per game. Manual press is opened explicitly mid-round by tapping \"+ Press\" — full control over hole range, stake, and sides. Both settle the same way at finalize.",
    keywords: ["auto press", "auto-press", "manual press", "press trigger", "automatic"]
  },
  {
    q: "Where does the press notification show up?",
    a: "Three places: (1) the round page itself shows the \"Press requested\" banner with Accept / Decline buttons, (2) the floating round pill in the bottom-right of every other page flips amber and reads \"Press pending\" so you see it from /dashboard or /leaderboards, (3) it's all live — opener / acceptor / commissioner all see state changes in real time without reloading.",
    keywords: ["press notification", "press alert", "press pending", "press realtime"]
  },

  // ── Handicaps ──
  {
    q: "How are handicaps calculated?",
    a: "WHS 2024 formula: Course Handicap = round(HI × Slope/113 + (CR − Par)). Then Playing Handicap = round(Course Handicap × allowance %). Strokes are distributed by stroke index — hardest holes first. Plus handicaps give strokes back on the easiest holes.",
    keywords: ["handicap", "course", "playing", "whs", "slope", "stroke index", "allocation"]
  },
  {
    q: "Why is my net score different from my friend's even though we shot the same?",
    a: "Net = gross minus strokes received on that hole, and strokes-received depends on each player's playing handicap and the hole's stroke index. Two players with the same gross can have different nets if their handicaps differ.",
    keywords: ["net", "strokes", "different", "handicap"]
  },

  // ── Wagers & settlement ──
  {
    q: "How do wagers work?",
    a: "Each game can have a stake amount. Before scoring, every invited player must confirm the wagers (a one-tap \"I'm in\" on /rounds/[id]/wagers). The commissioner sees who's pending. After the round, settlement computes net positions and gives you Venmo deep-links to send/request the right amounts.",
    keywords: ["wager", "stake", "money", "bet", "handshake", "confirm", "venmo"]
  },
  {
    q: "How does settlement decide who pays whom?",
    a: "A minimum-flow algorithm computes net wins/losses, then matches losers to winners with the fewest possible transfers. Instead of 6 separate Venmos in a foursome, you typically get 1–2.",
    keywords: ["settle", "settlement", "pay", "minimum flow", "venmo", "transfers"]
  },
  {
    q: "Where do I send Venmo payments?",
    a: "On the finalize screen, each settlement row has a Venmo button that opens the app with the amount and note prefilled. Players who've added their Venmo handle in their profile get one-tap deep-links.",
    keywords: ["venmo", "pay", "settle", "deep link", "qr code"]
  },

  // ── Round lifecycle ──
  {
    q: "How do I start a round?",
    a: "/rounds/new — pick the course, tees per player, 9 or 18 holes, date. Add games (with stakes if you want). Add players (existing group members or new). The round opens in \"draft\" status — go live when you're ready to score.",
    keywords: ["new round", "create", "start", "begin", "draft"]
  },
  {
    q: "How do I finalize a round?",
    a: "From the round page → Finalize. Confirms all scores are entered, runs settlement, and shows the Smack Talk recap. Once finalized the round becomes read-only.",
    keywords: ["finalize", "end round", "complete", "finish", "lock"]
  },
  {
    q: "What's the spectator link?",
    a: "Each round has a public spectator URL with a random token (no PIN, no scoring). Share it with anyone — family at home, members at the bar — and they see the live leaderboard plus an auto-generated OG image.",
    keywords: ["spectator", "share", "watch", "public", "link", "viewers"]
  },

  // ── Stats & history ──
  {
    q: "Where do I see my stats?",
    a: "/players/[id]/stats — gross/net averages, eagle/birdie/par/bogey distribution, JGCC-specific average, best round. Updates as new rounds are finalized.",
    keywords: ["stats", "statistics", "averages", "history", "scores"]
  },
  {
    q: "What's the season ledger?",
    a: "/ledger — running tally of net wins/losses across every finalized round, per player. The settlement engine writes to it automatically.",
    keywords: ["ledger", "season", "totals", "running tally", "year", "yearly"]
  },

  // ── Demo & testing ──
  {
    q: "How can I try the app without signing up?",
    a: "/demo — fully interactive walkthrough with fake players, a live mid-round leaderboard, and a finalized round with settlement. Zero database, zero auth — pure static fixtures. Works even if Supabase is down.",
    keywords: ["demo", "try", "test", "preview", "fake", "sample"]
  },

  // ── Reliability / errors ──
  {
    q: "I got an error — what does it mean?",
    a: "We translate Supabase/Postgres errors into plain English. \"Server is still warming up\" means the schema cache is reloading — wait 30 seconds. \"Wrong email or password\" is exactly what it says. \"Too many attempts\" means you hit rate limit; wait a minute. If you see \"Something went sideways,\" tell the commissioner with what you were doing.",
    keywords: ["error", "broken", "warming up", "schema cache", "rate limit", "failed"]
  },
  {
    q: "Does Cruz Golf use AI for scoring or recaps?",
    a: "No. Score entry, leaderboard, settlement, and the Smack Talk recap are all pure JavaScript algorithms — no LLM calls. The only AI in the app is this help assistant (when you open it) and optional scorecard photo OCR (only if you upload a photo and an OPENAI_API_KEY is configured).",
    keywords: ["ai", "llm", "openai", "anthropic", "claude", "gpt", "smack talk"]
  },

  // ── PWA / install / offline ──
  {
    q: "Can I install Cruz Golf on my phone?",
    a: "Yes — it's a PWA. On iPhone: Safari → Share → Add to Home Screen. On Android: Chrome menu → Install app. Once installed it launches full-screen without the browser chrome, has its own app icon, and the service worker caches the shell so it opens instantly even on bad service.",
    keywords: ["install", "pwa", "home screen", "app", "iphone", "android", "standalone"]
  },
  {
    q: "What happens if I'm completely offline while scoring?",
    a: "Score entries get queued in localStorage. You'll see an amber \"Offline · scores will sync when you reconnect\" pill at the top. When the device comes back online the queue drains automatically — no scores are lost. If a write fails after retries, the score-status banner gives you Retry / Diagnose / Discard.",
    keywords: ["offline", "no signal", "no wifi", "queue", "pending", "sync", "scores lost"]
  },
  {
    q: "Why does the page sometimes show a 'skeleton' before content loads?",
    a: "That's the loading state — gray cards in roughly the shape of the eventual page. Slow phone networks and PWA cold-start used to paint blank for 1-3 seconds; the skeleton fills that gap so the layout doesn't jump on hydration.",
    keywords: ["loading", "skeleton", "blank page", "slow", "loading state"]
  },

  // ── Course library ──
  {
    q: "What do the course library states mean (verified, community, needs_review, placeholder)?",
    a: "Verified = full data from an official scorecard or USGA source. Community = added by a user, not yet admin-verified. Needs_review = some data present but rating/slope or hole detail is incomplete. Placeholder = name + city only, no tees yet. Only verified + community courses can be cloned into your group; placeholders show a disabled clone button.",
    keywords: ["course library", "verified", "community", "needs review", "placeholder", "verification status"]
  },
  {
    q: "How do I add a course?",
    a: "Three paths: (1) /courses/import — snap a scorecard photo, OCR pulls tees + pars + stroke index, you confirm; (2) clone from the Course library at the bottom of /courses if the course is already there; (3) /courses/new — manual entry, last resort.",
    keywords: ["add course", "new course", "import", "ocr", "scorecard photo", "clone"]
  },
  {
    q: "Can I edit a course after creating it?",
    a: "Yes, on /courses/[id] commissioners can edit tee names, ratings, slope, hole pars, and stroke indexes. Round-level handicap math re-runs on next finalize.",
    keywords: ["edit course", "fix course", "update tees", "wrong rating"]
  },

  // ── Round lifecycle (extended) ──
  {
    q: "What's the difference between live, pending, and finalized rounds?",
    a: "Live = scoring in progress, no settlements yet. Pending finalization = scoring is done but the commissioner hasn't locked it; still editable, no settlements written. Finalized = locked, settlements written, money owed. The flow is draft → live → pending_finalization → finalized. Commissioners can move back: pending → live, or finalized → live via Unfinalize.",
    keywords: ["lifecycle", "draft", "live", "pending", "finalized", "status", "state"]
  },
  {
    q: "How do I unfinalize a round if I need to fix a score?",
    a: "Open the finalized round → \"Unfinalize\" button (commissioner-only). The round flips back to live, settlements are deleted, you fix the score, then re-finalize. The action writes to the audit log so the history isn't quietly altered.",
    keywords: ["unfinalize", "reopen round", "fix after finalize", "edit final score"]
  },
  {
    q: "I deleted a round by accident — can I recover it?",
    a: "Yes. Round deletes are soft — they set deleted_at instead of dropping the row. Open /admin/rounds (platform admin) or the recycle bin on /dashboard (group commissioner) and tap Restore. The same applies to courses.",
    keywords: ["delete round", "restore", "undo delete", "recover", "soft delete", "recycle bin"]
  },

  // ── Active round pill + realtime ──
  {
    q: "What's the floating pill in the bottom-right corner?",
    a: "It's the Active Round Pill — appears whenever there's a live round and you're not already on it. One tap takes you back to scoring. The pill turns amber when there's a press awaiting your response. Dismiss with the × for the current session.",
    keywords: ["pill", "floating", "back to round", "active round pill", "live indicator"]
  },
  {
    q: "How does realtime work — when do I need to refresh?",
    a: "Almost never. The leaderboard, score-group, and press controls all subscribe to Supabase Realtime — scores entered on any phone update everyone's view within a second. Each surface also has a 60-second safety-net refresh in case the socket silently drops, and refetches everything on every reconnect.",
    keywords: ["realtime", "refresh", "update", "live updates", "supabase realtime", "reconnect"]
  },

  // ── Group privacy ──
  {
    q: "Who can see my group's rounds and records?",
    a: "Only members of your group. Cruz Golf is group-private by default — there's no public social feed, no cross-group leaderboards, no strangers in your records. The only way someone outside the group sees your data is if you explicitly share a spectator link.",
    keywords: ["privacy", "private", "public", "visibility", "social", "feed", "stranger"]
  },
  {
    q: "What's the difference between a spectator link and a join PIN?",
    a: "Spectator = read-only public view of one round (no PIN, no scoring, no account needed — anyone with the URL can watch). PIN = lets a player JOIN the round to score themselves. Spectator links are safe to share publicly; PINs should only go to players you want scoring.",
    keywords: ["spectator", "pin", "share", "public", "join", "watch vs play"]
  },

  // ── Admin / observability ──
  {
    q: "How do I see what an admin did to my round?",
    a: "Every destructive op (archive, restore, delete, finalize, unfinalize, mark-pending, resume, press open/accept/decline/withdraw, course verify) writes to /admin/audit. Open the audit log, filter by your round_id or by kind. It's append-only — no admin can edit history through the app.",
    keywords: ["audit", "audit log", "history", "what changed", "who did", "destructive op", "tamper"]
  },
  {
    q: "What's 'admin spectator mode'?",
    a: "Platform admins can view any round via /rounds/[id]/leaderboard?token=...&adminMode=1 — read-only with a gold banner that says \"Watching as admin.\" The server re-verifies admin status (URL flag alone won't grant the banner). It's observability, not impersonation — admins never act as you.",
    keywords: ["admin", "spectator", "watch", "observability", "impersonation", "support"]
  },

  // ── Dashboard signals (clubhouse) ──
  {
    q: "What are those small cards at the top of my dashboard?",
    a: "The Clubhouse Strip — up to 4 living signals from your group history. Live round leader, current win/loss streaks, biggest rivalries, partner chemistry, group lifetime totals, course mastery, hole mastery, recent milestones. They appear only when there's enough history to be meaningful (3+ rounds at a course, 2+ in a row for streaks, etc.) — not artificially manufactured.",
    keywords: ["clubhouse", "strip", "dashboard cards", "streak", "rivalry", "mastery", "signals"]
  }
];
