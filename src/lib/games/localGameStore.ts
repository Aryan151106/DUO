import type { GameType, GameSession, GameStats, MatchHistoryItem } from './types';

const LOCAL_SESSION_KEY_PREFIX = 'duo_local_game_session_';
const LOCAL_STATS_KEY = 'duo_local_game_stats_v1';
const LOCAL_HISTORY_KEY = 'duo_local_game_history_v1';
const LOCAL_PLAYER_NAMES_KEY = 'duo_local_game_players_v1';

// In-memory fallback if localStorage is disabled, restricted, or unavailable
const memorySessions: Record<string, string> = {};
let memoryStats: string | null = null;
let memoryHistory: string | null = null;
let memoryNames: string | null = null;

export interface LocalPlayerConfig {
  player1Name: string;
  player2Name: string;
}

export function getLocalPlayerNames(): LocalPlayerConfig {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCAL_PLAYER_NAMES_KEY) : memoryNames;
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {}
  if (memoryNames) {
    try { return JSON.parse(memoryNames); } catch {}
  }
  return {
    player1Name: 'Player 1',
    player2Name: 'Player 2',
  };
}

export function saveLocalPlayerNames(config: LocalPlayerConfig): void {
  const serialized = JSON.stringify(config);
  memoryNames = serialized;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOCAL_PLAYER_NAMES_KEY, serialized);
    }
  } catch {}
}

export function saveLocalSession(session: GameSession): void {
  const serialized = JSON.stringify(session);
  memorySessions[session.gameType] = serialized;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`${LOCAL_SESSION_KEY_PREFIX}${session.gameType}`, serialized);
    }
  } catch (err) {
    console.warn('[LocalGameStore] Could not save active session:', err);
  }
}

export function loadLocalSession(gameType: GameType): GameSession | null {
  try {
    const raw = typeof localStorage !== 'undefined'
      ? localStorage.getItem(`${LOCAL_SESSION_KEY_PREFIX}${gameType}`)
      : memorySessions[gameType];
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {}
  if (memorySessions[gameType]) {
    try { return JSON.parse(memorySessions[gameType]); } catch {}
  }
  return null;
}

export function clearLocalSession(gameType: GameType): void {
  delete memorySessions[gameType];
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(`${LOCAL_SESSION_KEY_PREFIX}${gameType}`);
    }
  } catch {}
}

// ─── Local Statistics & Streaks ──────────────────────────────────────────────

export function getLocalStats(gameType: GameType, playerId: string): GameStats {
  const allStats = getAllLocalStats();
  const key = `${gameType}_${playerId}`;
  return (
    allStats[key] || {
      playerId,
      gameType,
      mode: 'local',
      wins: 0,
      losses: 0,
      draws: 0,
      currentWinStreak: 0,
      bestWinStreak: 0,
      updatedAt: new Date().toISOString(),
    }
  );
}

export function getAllLocalStats(): Record<string, GameStats> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCAL_STATS_KEY) : memoryStats;
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {}
  if (memoryStats) {
    try { return JSON.parse(memoryStats); } catch {}
  }
  return {};
}

export function recordLocalGameResult(
  session: GameSession,
  winnerPlayerId: string | null,
  outcome: 'win' | 'draw' | 'resignation'
): { p1Stats: GameStats; p2Stats: GameStats } {
  const allStats = getAllLocalStats();
  const gameType = session.gameType;
  const p1Id = session.playerIds[0] || 'p1';
  const p2Id = session.playerIds[1] || 'p2';

  const p1Key = `${gameType}_${p1Id}`;
  const p2Key = `${gameType}_${p2Id}`;

  const p1 = allStats[p1Key] || {
    playerId: p1Id,
    gameType,
    mode: 'local',
    wins: 0,
    losses: 0,
    draws: 0,
    currentWinStreak: 0,
    bestWinStreak: 0,
    updatedAt: new Date().toISOString(),
  };

  const p2 = allStats[p2Key] || {
    playerId: p2Id,
    gameType,
    mode: 'local',
    wins: 0,
    losses: 0,
    draws: 0,
    currentWinStreak: 0,
    bestWinStreak: 0,
    updatedAt: new Date().toISOString(),
  };

  const now = new Date().toISOString();

  if (outcome === 'draw') {
    p1.draws++;
    p2.draws++;
    p1.currentWinStreak = 0; // Draw resets streak
    p2.currentWinStreak = 0;
  } else if (winnerPlayerId === p1Id) {
    p1.wins++;
    p2.losses++;
    p1.currentWinStreak++;
    if (p1.currentWinStreak > p1.bestWinStreak) {
      p1.bestWinStreak = p1.currentWinStreak;
    }
    p2.currentWinStreak = 0;
  } else if (winnerPlayerId === p2Id) {
    p2.wins++;
    p1.losses++;
    p2.currentWinStreak++;
    if (p2.currentWinStreak > p2.bestWinStreak) {
      p2.bestWinStreak = p2.currentWinStreak;
    }
    p1.currentWinStreak = 0;
  }

  p1.updatedAt = now;
  p2.updatedAt = now;

  allStats[p1Key] = p1;
  allStats[p2Key] = p2;

  const serialized = JSON.stringify(allStats);
  memoryStats = serialized;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOCAL_STATS_KEY, serialized);
    }
  } catch {}

  // Record history log
  recordLocalMatchHistory({
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    gameType,
    mode: 'local',
    date: now,
    player1Name: session.players[p1Id]?.displayName || 'Player 1',
    player2Name: session.players[p2Id]?.displayName || 'Player 2',
    winnerPlayerId,
    winnerName: winnerPlayerId ? session.players[winnerPlayerId]?.displayName || 'Winner' : null,
    outcome,
  });

  return { p1Stats: p1, p2Stats: p2 };
}

export function getLocalMatchHistory(): MatchHistoryItem[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCAL_HISTORY_KEY) : memoryHistory;
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {}
  if (memoryHistory) {
    try { return JSON.parse(memoryHistory); } catch {}
  }
  return [];
}

export function recordLocalMatchHistory(item: MatchHistoryItem): void {
  try {
    const history = getLocalMatchHistory();
    history.unshift(item);
    if (history.length > 50) {
      history.length = 50; // Keep last 50 matches
    }
    const serialized = JSON.stringify(history);
    memoryHistory = serialized;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOCAL_HISTORY_KEY, serialized);
    }
  } catch {}
}
