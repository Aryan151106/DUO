import { create } from 'zustand';
import type { GameType, GameMode, GameChatMessage } from './types';


interface ActiveGameStore {
  activeGameType: GameType | null;
  activeGameMode: GameMode;
  pausedGameType: GameType | null;
  chatMessages: Record<string, GameChatMessage[]>; // keyed by sessionId
  isChatOpenMobile: boolean;
  unreadChatCount: number;

  setActiveGame: (gameType: GameType | null, mode?: GameMode) => void;
  setActiveGameMode: (mode: GameMode) => void;
  clearActiveGame: () => void;

  setChatMessages: (sessionId: string, messages: GameChatMessage[]) => void;
  addChatMessage: (sessionId: string, message: GameChatMessage) => void;
  setChatOpenMobile: (open: boolean) => void;
  resetUnreadChatCount: () => void;
  incrementUnreadChatCount: () => void;
}

const STORAGE_KEY = 'duo_active_arcade_session_v1';

function getInitialState(): { gameType: GameType | null; mode: GameMode; pausedGameType: GameType | null } {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed) {
          const validTypes = ['tic-tac-toe', 'connect-four', 'chess', 'guess-from-doodle'];
          const gameType = validTypes.includes(parsed.gameType) ? parsed.gameType : null;
          const pausedGameType = validTypes.includes(parsed.pausedGameType) ? parsed.pausedGameType : gameType;
          return {
            gameType,
            mode: parsed.mode === 'local' ? 'local' : 'online',
            pausedGameType,
          };
        }
      }
    }
  } catch {}

  return { gameType: null, mode: 'online', pausedGameType: null };
}

function persistState(gameType: GameType | null, mode: GameMode, pausedGameType: GameType | null) {
  try {
    if (typeof localStorage !== 'undefined') {
      if (gameType || pausedGameType) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ gameType, mode, pausedGameType }));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  } catch {}
}

const initial = getInitialState();

export const useActiveGameStore = create<ActiveGameStore>((set, get) => ({
  activeGameType: initial.gameType,
  activeGameMode: initial.mode,
  pausedGameType: initial.pausedGameType,
  chatMessages: {},
  isChatOpenMobile: false,
  unreadChatCount: 0,

  setActiveGame: (gameType, mode) => {
    const nextMode = mode || get().activeGameMode;
    const nextPaused = gameType ? gameType : get().pausedGameType;
    persistState(gameType, nextMode, nextPaused);
    set({
      activeGameType: gameType,
      activeGameMode: nextMode,
      pausedGameType: nextPaused,
      isChatOpenMobile: gameType ? get().isChatOpenMobile : false,
      unreadChatCount: 0,
    });
  },

  setActiveGameMode: (mode) => {
    const currentGame = get().activeGameType;
    const paused = get().pausedGameType;
    persistState(currentGame, mode, paused);
    set({ activeGameMode: mode });
  },

  clearActiveGame: () => {
    persistState(null, get().activeGameMode, null);
    set({
      activeGameType: null,
      pausedGameType: null,
      isChatOpenMobile: false,
      unreadChatCount: 0,
    });
  },

  setChatMessages: (sessionId, messages) => {
    set((state) => {
      const current = state.chatMessages[sessionId];
      if (current === messages) return state;
      if (
        current &&
        current.length === messages.length &&
        current.every((msg, idx) => msg.id === messages[idx]?.id)
      ) {
        return state;
      }
      return {
        chatMessages: {
          ...state.chatMessages,
          [sessionId]: messages,
        },
      };
    });
  },

  addChatMessage: (sessionId, message) => {
    set((state) => {
      const existing = state.chatMessages[sessionId] || [];
      // Prevent duplicate messages if already present by id
      if (existing.some((m) => m.id === message.id)) {
        return state;
      }
      return {
        chatMessages: {
          ...state.chatMessages,
          [sessionId]: [...existing, message],
        },
      };
    });
  },

  setChatOpenMobile: (open) => set({ isChatOpenMobile: open }),
  resetUnreadChatCount: () => set({ unreadChatCount: 0 }),
  incrementUnreadChatCount: () => set((s) => ({ unreadChatCount: s.unreadChatCount + 1 })),
}));
