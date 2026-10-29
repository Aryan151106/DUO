export type GameType = 'tic-tac-toe' | 'connect-four' | 'chess' | 'guess-from-doodle';

export type GameMode = 'online' | 'local';

export type GameStatus = 'waiting' | 'setup' | 'active' | 'finished' | 'abandoned';

export interface DiscColorOption {
  id: string;
  name: string;
  hex: string;
  border: string;
}

export const C4_COLOR_PALETTE: DiscColorOption[] = [
  { id: 'red', name: 'Ruby Red', hex: '#ff3d5a', border: '#b3152d' },
  { id: 'yellow', name: 'Sunny Yellow', hex: '#ffd23a', border: '#b89205' },
  { id: 'cyan', name: 'Ocean Cyan', hex: '#2bb5d4', border: '#12738a' },
  { id: 'pink', name: 'Bubblegum Pink', hex: '#ff5d8f', border: '#c72859' },
  { id: 'purple', name: 'Cosmic Purple', hex: '#9b5de5', border: '#5f23a6' },
  { id: 'green', name: 'Emerald Green', hex: '#00d59b', border: '#028560' },
];

export interface PlayerChoice {
  role?: string; // 'X' | 'O', 'w' | 'b', 'drawer' | 'guesser'
  color?: string; // hex color for Connect Four
  colorName?: string;
  firstPlayerPreference?: 'me' | 'partner' | 'random';
  isReady: boolean;
}

export interface LobbyState {
  conflict: string | null;
  firstPlayer?: string | null;
  allReady: boolean;
}

export interface PlayerInfo {
  id: string;
  displayName: string;
  avatarUrl?: string;
  role?: string; // e.g. 'X' | 'O', 'r' | 'y', 'w' | 'b', 'drawer' | 'guesser'
  color?: string;
  colorName?: string;
  isReady?: boolean;
  choice?: PlayerChoice;
  isConnected?: boolean;
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
  grid: Array<Array<string | null>>; // 6 rows x 7 columns (supports 'r' | 'y' or hex colors)
  winningCells: Array<[number, number]> | null;
  lastDrop?: [number, number] | null;
  playerColors?: Record<string, string>; // Maps role/playerId -> hex color
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

export interface DoodleStrokeChunk {
  strokeId: string;
  points: Array<{ x: number; y: number }>;
  color: string;
  width: number;
  isNewStroke: boolean;
  isComplete: boolean;
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

export interface GameChatMessage {
  id: string;
  sessionId: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: string;
}

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
  lobbyState?: LobbyState | null;
  result?: GameResult | null;
  chatMessages?: GameChatMessage[];
  actionSeq: number; // Incrementing counter to reject stale or duplicated actions
  createdAt: string;
  updatedAt: string;
  rematchRequestedBy?: string | null;
  rematchMode?: 'keep' | 'change' | null;
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
