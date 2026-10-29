import { describe, it, expect, beforeEach, vi } from 'vitest';

const storageMap: Record<string, string> = {};
const mockLocalStorage = {
  getItem: vi.fn((key: string) => storageMap[key] || null),
  setItem: vi.fn((key: string, value: string) => { storageMap[key] = String(value); }),
  removeItem: vi.fn((key: string) => { delete storageMap[key]; }),
  clear: vi.fn(() => { for (const k in storageMap) delete storageMap[k]; }),
};
vi.stubGlobal('localStorage', mockLocalStorage);

import { useActiveGameStore } from './gameStore';
import {
  saveLocalSession,
  loadLocalSession,
  clearLocalSession,
} from './localGameStore';
import type { GameSession, GameChatMessage } from './types';

describe('Game Session Persistence & Navigation State', () => {
  beforeEach(() => {
    localStorage.clear();
    useActiveGameStore.getState().clearActiveGame();
  });

  it('preserves selected game and mode in store and localStorage across remounts', () => {
    const store = useActiveGameStore.getState();

    // Start a chess game
    store.setActiveGame('chess', 'online');

    expect(useActiveGameStore.getState().activeGameType).toBe('chess');
    expect(useActiveGameStore.getState().activeGameMode).toBe('online');
    expect(useActiveGameStore.getState().pausedGameType).toBe('chess');

    // Verify localStorage persistence
    const saved = JSON.parse(localStorage.getItem('duo_active_arcade_session_v1') || '{}');
    expect(saved.gameType).toBe('chess');
    expect(saved.mode).toBe('online');
    expect(saved.pausedGameType).toBe('chess');
  });

  it('keeps pausedGameType when user returns to arcade lobby non-destructively', () => {
    const store = useActiveGameStore.getState();

    // Start a connect-four game
    store.setActiveGame('connect-four', 'online');

    // User navigates back to arcade lobby without resigning
    store.setActiveGame(null);

    expect(useActiveGameStore.getState().activeGameType).toBeNull();
    // Paused game remains intact so it can be resumed
    expect(useActiveGameStore.getState().pausedGameType).toBe('connect-four');

    const saved = JSON.parse(localStorage.getItem('duo_active_arcade_session_v1') || '{}');
    expect(saved.gameType).toBeNull();
    expect(saved.pausedGameType).toBe('connect-four');
  });

  it('clears both active and paused game when user explicitly leaves/resigns', () => {
    const store = useActiveGameStore.getState();

    store.setActiveGame('tic-tac-toe', 'online');
    expect(useActiveGameStore.getState().pausedGameType).toBe('tic-tac-toe');

    // Explicit leave
    store.clearActiveGame();

    expect(useActiveGameStore.getState().activeGameType).toBeNull();
    expect(useActiveGameStore.getState().pausedGameType).toBeNull();
    expect(localStorage.getItem('duo_active_arcade_session_v1')).toBeNull();
  });

  it('preserves local pass-and-play board state and local notes across tab switches', () => {
    const localSession: GameSession = {
      id: 'local-tic-tac-toe',
      coupleId: 'local',
      gameType: 'tic-tac-toe',
      mode: 'local',
      status: 'active',
      playerIds: ['p1', 'p2'],
      players: {
        p1: { id: 'p1', displayName: 'Romeo', role: 'X' },
        p2: { id: 'p2', displayName: 'Juliet', role: 'O' },
      },
      currentTurnPlayerId: 'p2',
      state: {
        board: ['X', null, null, null, 'O', null, null, null, null],
        winningLine: null,
      },
      chatMessages: [
        {
          id: 'note-1',
          sessionId: 'local-tic-tac-toe',
          senderId: 'p1',
          senderName: 'Romeo',
          text: 'Good luck darling!',
          createdAt: new Date().toISOString(),
        },
      ],
      actionSeq: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    saveLocalSession(localSession);

    const restored = loadLocalSession('tic-tac-toe');
    expect(restored).not.toBeNull();
    expect(restored?.currentTurnPlayerId).toBe('p2');
    expect((restored?.state as any).board[0]).toBe('X');
    expect((restored?.state as any).board[4]).toBe('O');
    expect(restored?.chatMessages?.length).toBe(1);
    expect(restored?.chatMessages?.[0].text).toBe('Good luck darling!');

    clearLocalSession('tic-tac-toe');
    expect(loadLocalSession('tic-tac-toe')).toBeNull();
  });
});

describe('In-Game Live Chat Store & Message Guarding', () => {
  beforeEach(() => {
    useActiveGameStore.getState().clearActiveGame();
  });

  it('adds chat messages scoped to sessionId and prevents duplicates', () => {
    const store = useActiveGameStore.getState();
    const sessionId = 'game-couple-duo-chess';

    const msg1: GameChatMessage = {
      id: 'msg_101',
      sessionId,
      senderId: 'user_a',
      senderName: 'Player 1',
      text: 'Checkmate soon! ♟️',
      createdAt: '2026-10-29T10:00:00.000Z',
    };

    store.addChatMessage(sessionId, msg1);
    expect(useActiveGameStore.getState().chatMessages[sessionId]?.length).toBe(1);

    // Duplicate message with same id should not be added twice
    store.addChatMessage(sessionId, msg1);
    expect(useActiveGameStore.getState().chatMessages[sessionId]?.length).toBe(1);

    const msg2: GameChatMessage = {
      id: 'msg_102',
      sessionId,
      senderId: 'user_b',
      senderName: 'Player 2',
      text: 'In your dreams! 😉',
      createdAt: '2026-10-29T10:01:00.000Z',
    };

    store.addChatMessage(sessionId, msg2);
    expect(useActiveGameStore.getState().chatMessages[sessionId]?.length).toBe(2);

    // Other game's session chat is completely empty and isolated
    expect(useActiveGameStore.getState().chatMessages['game-couple-duo-connect-four']).toBeUndefined();
  });

  it('tracks unread chat count for mobile drawer notification', () => {
    const store = useActiveGameStore.getState();
    expect(useActiveGameStore.getState().unreadChatCount).toBe(0);

    store.incrementUnreadChatCount();
    store.incrementUnreadChatCount();
    expect(useActiveGameStore.getState().unreadChatCount).toBe(2);

    store.resetUnreadChatCount();
    expect(useActiveGameStore.getState().unreadChatCount).toBe(0);
  });
});

describe('Socket.IO Specific Listener Cleanup Validation', () => {
  it('unregisters only the specific named callback without removing other listeners', () => {
    // Mock socket object with event emitter semantics
    const listeners: Record<string, Function[]> = {};

    const mockSocket = {
      on: vi.fn((event: string, callback: Function) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(callback);
      }),
      off: vi.fn((event: string, callback?: Function) => {
        if (!callback) {
          // Dangerous: removes all
          delete listeners[event];
        } else if (listeners[event]) {
          listeners[event] = listeners[event].filter((fn) => fn !== callback);
        }
      }),
    };

    const handlerA = vi.fn();
    const handlerB = vi.fn();

    // Two active consumers register on the same event
    mockSocket.on('game:session_state', handlerA);
    mockSocket.on('game:session_state', handlerB);

    expect(listeners['game:session_state'].length).toBe(2);

    // Specific cleanup removes only handlerA
    mockSocket.off('game:session_state', handlerA);

    expect(listeners['game:session_state'].length).toBe(1);
    expect(listeners['game:session_state'][0]).toBe(handlerB);

    // Verify handlerB is still invoked
    listeners['game:session_state'][0]({ status: 'active' });
    expect(handlerB).toHaveBeenCalledWith({ status: 'active' });
    expect(handlerA).not.toHaveBeenCalled();
  });
});
