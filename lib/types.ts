export type UUID = string;

export type ScoreCapMode = "none" | "triple_bogey" | "double_bogey_plus";

export type CourseHole = {
  hole_number: number;
  par: number;
  stroke_index: number;
};

export type CourseTee = {
  id: UUID;
  name: string;
  rating: number;
  slope: number;
  par: number;
  holes: CourseHole[];
};

export type RoundPlayer = {
  id: UUID;
  player_id: UUID;
  display_name: string;
  tee_id: UUID;
  tee: CourseTee;
  handicap_index_used: number;
  course_handicap: number;
  playing_handicap: number;
  team_id: UUID | null;
};

export type Score = {
  round_player_id: UUID;
  hole_number: number;
  gross: number | null;
};

export type ManualEntry = {
  round_game_id: UUID;
  hole_number: number | null;
  winner_round_player_id: UUID | null;
  value_cents: number | null;
  note?: string;
};

export type GameType =
  | "individual_gross"
  | "individual_net"
  | "best_ball_gross"
  | "best_ball_net"
  | "aggregate_gross"
  | "aggregate_net"
  | "scramble_gross"
  | "scramble_net"
  | "skins_gross"
  | "skins_net"
  | "skins_canadian"
  | "nassau"
  | "match_play"
  | "six_six_six"
  | "ctp"
  | "long_drive"
  | "custom";

export type RoundGame = {
  id: UUID;
  round_id: UUID;
  game_type: GameType;
  name: string;
  stake_cents: number;
  allowance_pct: number;
  config: Record<string, unknown>;
};

// ---------- Multi-group events (Phase 1 schema lands in 0039) ----------

/**
 * Kind hint for an event. UI/copy only — the engine treats them all
 * the same. New kinds can be added without a DDL migration (text col
 * on the DB side; this union narrows for typed call sites).
 */
export type EventKind = "tournament" | "trip" | "club_game";

/**
 * An Event is an optional container that groups one-or-more Rounds
 * (foursomes). Rounds stay first-class — most rounds will never
 * belong to an event. See docs/MULTI_GROUP_DESIGN.md.
 */
export type GolfEvent = {
  id: UUID;
  group_id: UUID;
  name: string;
  kind: EventKind;
  starts_on: string; // ISO date
  ends_on: string | null;
  spectator_token: UUID;
  commissioner_profile_id: UUID | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Field-wide game on an event — settles across EVERY round in the
 * event. Per-round games stay in `round_games` and settle within
 * their round. The settlement engine for event_games lands in Phase 3
 * (lib/events/settle.ts) — for now this type just enables the schema
 * to be queried + written from typed code.
 */
export type EventGame = {
  id: UUID;
  event_id: UUID;
  game_type: GameType;
  name: string;
  stake_cents: number;
  allowance_pct: number;
  config: Record<string, unknown>;
  display_order: number;
  created_at: string;
};

export type GameInput = {
  game: RoundGame;
  players: RoundPlayer[];
  scores: Score[];
  course: { holes: CourseHole[]; par: number };
  manualEntries?: ManualEntry[];
  startingHole?: number;
  totalHoles?: 9 | 18;
};

export type PlayerDelta = {
  delta_cents: number;
  breakdown: string[];
};

export type GameOutput = {
  perPlayer: Map<UUID, PlayerDelta>;
  perTeam?: Map<UUID, { delta_cents: number }>;
  status: "live" | "final";
  highlights: Array<{ hole: number; label: string }>;
};
