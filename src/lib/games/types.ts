export type GameType = 'tic-tac-toe' | 'connect-four' | 'chess' | 'guess-from-doodle';

export type GameMode = 'online' | 'local';

export type GameStatus = 'waiting' | 'active' | 'finished' | 'abandoned';

export interface PlayerInfo {
  id: string;
  displayName: string;
  avatarUrl?: string;
  role?: string; // e.g. 'X' | 'O', 'r' | 'y', 'w' | 'b', 'drawer' | 'guesser'
}

export interface GameResult {
  winnerPlayerId: string | null; // null means draw
  winnerName?: string | null;
  outcome: 'win' | 'draw' | 'resignation';
  completedAt: string; // ISO string
  reason?: string;
}

// ─── Individual Game State Schemas ──────────────────────────────────────────

export interface TicTacToeState {
  board: Array<string | null>; // 9 cells
  winningLine: number[] | null;
}

export interface ConnectFourState {
  grid: Array<Array<'r' | 'y' | null>>; // 6 rows x 7 columns
  winningCells: Array<[number, number]> | null;
  lastDrop?: [number, number] | null;
}

export interface ChessState {
  fen: string;
  turn: 'w' | 'b';
  isCheck: boolean;
  isCheckmate: boolean;
  isDraw: boolean;
  isStalemate: boolean;
  lastMove?: { from: string; to: string; san: string } | null;
  capturedWhite: string[]; // pieces captured by black
  capturedBlack: string[]; // pieces captured by white
  moveHistory: string[];
}

export interface DoodleStroke {
  points: Array<{ x: number; y: number }>;
  color: string;
  width: number;
}

export interface DoodleState {
  round: number;
  totalRounds: number;
  drawerId: string;
  guesserId: string;
  secretWordMasked: string; // "_ _ _ _" sent to guesser & public
  secretWordLength: number;
  revealedHints: number;
  doodleStrokes: DoodleStroke[]; // Stored for reconnection restoration
  roundTimeRemaining?: number;
  isGuessed: boolean;
}

export type AnyGameState = TicTacToeState | ConnectFourState | ChessState | DoodleState;

// ─── Game Session Document ──────────────────────────────────────────────────

export interface GameSession {
  id: string;
  coupleId: string;
  gameType: GameType;
  mode: GameMode;
  status: GameStatus;
  playerIds: string[];
  players: Record<string, PlayerInfo>;
  currentTurnPlayerId: string | null;
  state: AnyGameState;
  result?: GameResult | null;
  actionSeq: number; // Incrementing counter to reject stale or duplicated actions
  createdAt: string;
  updatedAt: string;
  rematchRequestedBy?: string | null;
}

// ─── Game Statistics & Winning Streaks ──────────────────────────────────────

export interface GameStats {
  id?: string;
  playerId: string;
  gameType: GameType;
  mode: GameMode;
  wins: number;
  losses: number;
  draws: number;
  currentWinStreak: number;
  bestWinStreak: number;
  updatedAt: string;
}

export interface MatchHistoryItem {
  id: string;
  gameType: GameType;
  mode: GameMode;
  date: string;
  player1Name: string;
  player2Name: string;
  winnerPlayerId: string | null;
  winnerName: string | null;
  outcome: 'win' | 'draw' | 'resignation';
}
