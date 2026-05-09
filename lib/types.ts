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
