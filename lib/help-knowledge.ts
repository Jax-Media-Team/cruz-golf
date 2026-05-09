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
  }
];
