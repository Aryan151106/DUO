import { useState, useEffect, useRef, useCallback } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { useAuthStore } from '../store';
import type {
  GameType,
  GameMode,
  GameSession,
  GameStatus,
  PlayerChoice,
  DoodleStroke,
  DoodleStrokeChunk,
  TicTacToeState,
  ConnectFourState,
  ChessState,
  DoodleState,
  GameChatMessage,
} from './types';
import { useActiveGameStore } from './gameStore';
import { getGameSocket } from './gameSocket';
import {
  loadLocalSession,
  saveLocalSession,
  clearLocalSession,
  recordLocalGameResult,
  getLocalPlayerNames,
  saveLocalPlayerNames,
} from './localGameStore';
import { applyTicTacToeMove, createInitialTicTacToeState } from './engines/tictactoe';
import { applyConnectFourMove, createInitialConnectFourState } from './engines/connectFour';
import { applyChessMove, createInitialChessState } from './engines/chessEngine';
import { getRandomWord, maskSecretWord } from './engines/doodleWords';
import confetti from 'canvas-confetti';

function createInitialGameStateForType(type: GameType, p1Id: string, p2Id: string) {
  if (type === 'tic-tac-toe') return createInitialTicTacToeState();
  if (type === 'connect-four') return createInitialConnectFourState();
  if (type === 'chess') return createInitialChessState();
  return {
    round: 1,
    totalRounds: 4,
    drawerId: p1Id,
    guesserId: p2Id,
    secretWordMasked: '____',
    secretWordLength: 4,
    revealedHints: 0,
    doodleStrokes: [],
    isGuessed: false,
  };
}

export function useGameSession(gameType: GameType | null, mode: GameMode) {
  const { currentUser, partnerUser, couple } = useAuthStore();
  const coupleId = couple?.id || 'couple-duo';
  const myUid = auth.currentUser?.uid || currentUser.id || 'p1';
  const partnerUid = partnerUser.id || 'p2';

  const [session, setSession] = useState<GameSession | null>(null);
  const [secretWord, setSecretWord] = useState<string | null>(null);
  const [doodleStrokes, setDoodleStrokes] = useState<DoodleStroke[]>([]);
  const [incomingLiveChunk, setIncomingLiveChunk] = useState<DoodleStrokeChunk | null>(null);
  const [status, setStatus] = useState<GameStatus | 'connecting' | 'reconnecting' | 'error'>('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rematchRequested, setRematchRequested] = useState(false);
  const [rematchMode, setRematchMode] = useState<'keep' | 'change' | null>(null);
  const [localPlayers, setLocalPlayers] = useState(getLocalPlayerNames());

  const socketRef = useRef<any>(null);
  const isOnline = mode === 'online';

  // ─── Local Mode Initialization & Handlers ─────────────────────────────────
  const initLocalSession = useCallback(() => {
    if (!gameType) {
      setSession(null);
      setStatus('setup');
      return;
    }

    const existing = loadLocalSession(gameType);
    if (existing && existing.status !== 'finished') {
      setSession(existing);
      if (Array.isArray(existing.chatMessages)) {
        useActiveGameStore.getState().setChatMessages(existing.id, existing.chatMessages);
      }
      if (gameType === 'guess-from-doodle' && (existing as any).secretWord) {
        setSecretWord((existing as any).secretWord);
      }
      setStatus(existing.status);
      return;
    }

    const pNames = getLocalPlayerNames();
    const p1Id = 'p1';
    const p2Id = 'p2';
    const now = new Date().toISOString();

    let p1Role = 'X';
    let p2Role = 'O';
    let p1Color = '#ff3d5a';
    let p2Color = '#ffd23a';

    if (gameType === 'tic-tac-toe') {
      p1Role = 'X';
      p2Role = 'O';
    } else if (gameType === 'connect-four') {
      p1Role = '#ff3d5a';
      p2Role = '#ffd23a';
    } else if (gameType === 'chess') {
      p1Role = 'w';
      p2Role = 'b';
    } else if (gameType === 'guess-from-doodle') {
      p1Role = 'drawer';
      p2Role = 'guesser';
    }

    const freshSession: GameSession = {
      id: `local-${gameType}`,
      coupleId: 'local',
      gameType,
      mode: 'local',
      status: 'setup',
      playerIds: [p1Id, p2Id],
      players: {
        [p1Id]: {
          id: p1Id,
          displayName: pNames.player1Name,
          role: p1Role,
          color: p1Color,
          colorName: 'Ruby Red',
          choice: {
            role: p1Role,
            color: p1Color,
            colorName: 'Ruby Red',
            isReady: false,
          },
        },
        [p2Id]: {
          id: p2Id,
          displayName: pNames.player2Name,
          role: p2Role,
          color: p2Color,
          colorName: 'Sunny Yellow',
          choice: {
            role: p2Role,
            color: p2Color,
            colorName: 'Sunny Yellow',
            isReady: false,
          },
        },
      },
      currentTurnPlayerId: p1Id,
      state: createInitialGameStateForType(gameType, p1Id, p2Id),
      lobbyState: {
        conflict: null,
        allReady: false,
      },
      actionSeq: 1,
      createdAt: now,
      updatedAt: now,
    };

    setSession(freshSession);
    saveLocalSession(freshSession);
    setStatus('setup');
  }, [gameType]);

  // ─── Online Mode Socket & Firestore Synchronization ───────────────────────
  useEffect(() => {
    if (!gameType) {
      setSession(null);
      setStatus('setup');
      return;
    }

    if (!isOnline) {
      initLocalSession();
      return;
    }

    let isMounted = true;
    setStatus('connecting');
    setErrorMessage(null);

    const sessionId = `game-${coupleId}-${gameType}`.toLowerCase();

    // 1. Listen to Firestore session doc for persistent recovery across navigation/refresh
    const unsubFirestore = onSnapshot(
      doc(db, 'couples', coupleId, 'gameSessions', sessionId),
      (snap) => {
        if (!isMounted) return;
        if (snap.exists()) {
          const data = snap.data() as GameSession;
          setSession((prev) => {
            if (!prev || (data.actionSeq || 0) >= (prev.actionSeq || 0)) {
              return data;
            }
            return prev;
          });
          setStatus(data.status);
          if (Array.isArray(data.chatMessages)) {
            useActiveGameStore.getState().setChatMessages(sessionId, data.chatMessages);
          }
          if (data.gameType === 'guess-from-doodle' && (data.state as DoodleState)?.doodleStrokes) {
            setDoodleStrokes((data.state as DoodleState).doodleStrokes);
          }
        }
      },
      (err) => {
        console.warn('[UseGameSession] Firestore session sync notice:', err.message);
      }
    );

    // 2. Connect via centralized Socket.IO
    let activeSocket: any = null;

    // Define named handlers so that only these exact callbacks are unsubscribed
    const handleSessionState = (updatedSession: GameSession) => {
      if (!isMounted) return;
      setSession(updatedSession);
      setStatus(updatedSession.status);
      if (Array.isArray(updatedSession.chatMessages)) {
        useActiveGameStore.getState().setChatMessages(sessionId, updatedSession.chatMessages);
      }
      if (updatedSession.result) {
        confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } });
      }
    };

    const handleSecretWord = ({ secretWord: word }: { secretWord: string }) => {
      if (!isMounted) return;
      setSecretWord(word);
    };

    const handleStrokeChunk = ({ chunk }: { chunk: DoodleStrokeChunk }) => {
      if (!isMounted) return;
      setIncomingLiveChunk(chunk);
      if (chunk.isComplete && chunk.points?.length > 1) {
        setDoodleStrokes((prev) => [
          ...prev,
          { points: chunk.points, color: chunk.color, width: chunk.width },
        ]);
      }
    };

    const handleStroke = ({ stroke }: { stroke: DoodleStroke }) => {
      if (!isMounted) return;
      setDoodleStrokes((prev) => [...prev, stroke]);
    };

    const handleDoodleClear = () => {
      if (!isMounted) return;
      setDoodleStrokes([]);
    };

    const handleRematchRequested = ({ mode: rMode }: { mode?: 'keep' | 'change' }) => {
      if (!isMounted) return;
      setRematchRequested(true);
      setRematchMode(rMode || 'keep');
    };

    const handleRematchSetup = () => {
      if (!isMounted) return;
      setRematchRequested(false);
      setRematchMode(null);
      setStatus('setup');
      setDoodleStrokes([]);
    };

    const handleRematchStarted = () => {
      if (!isMounted) return;
      setRematchRequested(false);
      setRematchMode(null);
      setDoodleStrokes([]);
    };

    const handlePartnerLeft = () => {
      if (!isMounted) return;
      setStatus('abandoned');
    };

    const handleChatMessage = (message: GameChatMessage) => {
      if (!isMounted) return;
      useActiveGameStore.getState().addChatMessage(sessionId, message);
      if (!useActiveGameStore.getState().isChatOpenMobile && message.senderId !== myUid) {
        useActiveGameStore.getState().incrementUnreadChatCount();
      }
    };

    const joinGameRoom = (socketInstance: any) => {
      if (!isMounted || !socketInstance) return;
      socketInstance.emit(
        'game:join',
        {
          coupleId,
          gameType,
          displayName: currentUser?.displayName || 'Partner',
          avatarUrl: currentUser?.avatarUrl || '',
        },
        (response: any) => {
          if (!isMounted) return;
          if (response?.error) {
            setStatus('error');
            setErrorMessage(response.error);
          } else if (response?.session) {
            setSession(response.session);
            setStatus(response.session.status);
            if (Array.isArray(response.session.chatMessages)) {
              useActiveGameStore.getState().setChatMessages(sessionId, response.session.chatMessages);
            }
          }
        }
      );
    };

    const handleConnect = () => {
      if (!isMounted) return;
      if (activeSocket) {
        joinGameRoom(activeSocket);
      }
    };

    const handleDisconnect = (_reason?: string) => {
      if (!isMounted) return;
      // Do not resign, abandon, or mutate active game on temporary socket disconnection!
      setStatus((prev) => (prev === 'active' || prev === 'setup' ? 'reconnecting' : prev));
    };

    (async () => {
      try {
        const socket = await getGameSocket();
        if (!isMounted || !socket) {
          setStatus('error');
          setErrorMessage('Could not establish Socket.IO server connection. Please check your connection.');
          return;
        }

        activeSocket = socket;
        socketRef.current = socket;

        // Register exact named event listeners
        socket.on('connect', handleConnect);
        socket.on('disconnect', handleDisconnect);
        socket.on('game:session_state', handleSessionState);
        socket.on('game:secret_word', handleSecretWord);
        socket.on('game:doodle_stroke_chunk', handleStrokeChunk);
        socket.on('game:doodle_stroke', handleStroke);
        socket.on('game:doodle_clear', handleDoodleClear);
        socket.on('game:rematch_requested', handleRematchRequested);
        socket.on('game:rematch_setup', handleRematchSetup);
        socket.on('game:rematch_started', handleRematchStarted);
        socket.on('game:partner_left', handlePartnerLeft);
        socket.on('game:chat_message', handleChatMessage);

        // Join online game session room if socket is already connected
        if (socket.connected) {
          joinGameRoom(socket);
        }
      } catch (err: any) {
        if (!isMounted) return;
        setStatus('error');
        setErrorMessage(err?.message || 'Failed to connect to online game');
      }
    })();

    return () => {
      isMounted = false;
      unsubFirestore();
      if (activeSocket) {
        // Remove only the specific named handlers registered above
        activeSocket.off('connect', handleConnect);
        activeSocket.off('disconnect', handleDisconnect);
        activeSocket.off('game:session_state', handleSessionState);
        activeSocket.off('game:secret_word', handleSecretWord);
        activeSocket.off('game:doodle_stroke_chunk', handleStrokeChunk);
        activeSocket.off('game:doodle_stroke', handleStroke);
        activeSocket.off('game:doodle_clear', handleDoodleClear);
        activeSocket.off('game:rematch_requested', handleRematchRequested);
        activeSocket.off('game:rematch_setup', handleRematchSetup);
        activeSocket.off('game:rematch_started', handleRematchStarted);
        activeSocket.off('game:partner_left', handlePartnerLeft);
        activeSocket.off('game:chat_message', handleChatMessage);
      }
    };
  }, [gameType, isOnline, coupleId, myUid, currentUser?.displayName, currentUser?.avatarUrl, initLocalSession]);

  // ─── Select Choice in Lobby ───────────────────────────────────────────────
  const selectChoice = useCallback(
    async (choice: Partial<PlayerChoice>, targetPlayerId?: string) => {
      if (!session) return;

      if (isOnline) {
        if (!socketRef.current) return;
        return new Promise<void>((resolve, reject) => {
          socketRef.current.emit(
            'game:select_choice',
            {
              sessionId: session.id,
              choice,
            },
            (res: any) => {
              if (res?.error) reject(new Error(res.error));
              else resolve();
            }
          );
        });
      } else {
        // Local choice update
        const pId = targetPlayerId || 'p1';
        const p1Id = session.playerIds[0] || 'p1';
        const p2Id = session.playerIds[1] || 'p2';

        const updatedPlayer = {
          ...session.players[pId],
          choice: {
            ...(session.players[pId]?.choice || { isReady: false }),
            ...choice,
            isReady: false,
          },
        };

        const updatedPlayers = {
          ...session.players,
          [pId]: updatedPlayer,
        };

        // Check local conflict
        const c1 = (updatedPlayers[p1Id]?.choice || {}) as Partial<PlayerChoice>;
        const c2 = (updatedPlayers[p2Id]?.choice || {}) as Partial<PlayerChoice>;
        let conflict: string | null = null;

        if (gameType === 'tic-tac-toe') {
          if (c1.role && c2.role && c1.role === c2.role) {
            conflict = `Both players selected ${c1.role}! One partner must choose ${c1.role === 'X' ? 'O' : 'X'}.`;
          }
        } else if (gameType === 'connect-four') {
          const col1 = (c1.color || '#ff3d5a').toLowerCase();
          const col2 = (c2.color || '#ffd23a').toLowerCase();
          if (col1 === col2) {
            conflict = 'Both players selected the same disc color! Please pick different colors.';
          }
        } else if (gameType === 'chess') {
          if (c1.role && c2.role && c1.role === c2.role && c1.role !== 'random') {
            conflict = `Both players selected ${c1.role === 'w' ? 'White' : 'Black'}! One partner must choose the other side.`;
          }
        } else if (gameType === 'guess-from-doodle') {
          if (c1.role && c2.role && c1.role === c2.role && c1.role === 'drawer') {
            conflict = 'Both players chose to draw first! One partner must choose to guess.';
          }
        }

        const nextSession: GameSession = {
          ...session,
          players: updatedPlayers,
          lobbyState: {
            conflict,
            allReady: false,
          },
          updatedAt: new Date().toISOString(),
        };

        setSession(nextSession);
        saveLocalSession(nextSession);
      }
    },
    [session, isOnline, gameType]
  );

  // ─── Confirm Ready in Lobby ───────────────────────────────────────────────
  const confirmReady = useCallback(
    async (isReady: boolean, _targetPlayerId?: string) => {
      if (!session) return;

      if (isOnline) {
        if (!socketRef.current) return;
        return new Promise<void>((resolve, reject) => {
          socketRef.current.emit(
            'game:confirm_ready',
            {
              sessionId: session.id,
              isReady,
            },
            (res: any) => {
              if (res?.error) reject(new Error(res.error));
              else resolve();
            }
          );
        });
      } else {
        // Local pass-and-play start
        const p1Id = session.playerIds[0] || 'p1';
        const p2Id = session.playerIds[1] || 'p2';
        const c1 = (session.players[p1Id]?.choice || {}) as Partial<PlayerChoice>;
        const c2 = (session.players[p2Id]?.choice || {}) as Partial<PlayerChoice>;

        let initialState: any = null;
        let p1Role = c1.role || 'X';
        let p2Role = c2.role || 'O';
        let startingTurn = p1Id;

        if (gameType === 'tic-tac-toe') {
          p1Role = c1.role || 'X';
          p2Role = p1Role === 'X' ? 'O' : 'X';
          initialState = createInitialTicTacToeState();
          startingTurn = p1Role === 'X' ? p1Id : p2Id;
        } else if (gameType === 'connect-four') {
          const col1 = c1.color || '#ff3d5a';
          const col2 = c2.color || '#ffd23a';
          initialState = {
            ...createInitialConnectFourState(),
            playerColors: { [p1Id]: col1, [p2Id]: col2 },
          };
          p1Role = col1;
          p2Role = col2;
          startingTurn = p1Id;
        } else if (gameType === 'chess') {
          let s1 = c1.role || 'w';
          let s2 = c2.role || (s1 === 'w' ? 'b' : 'w');
          if (s1 === 'random' || s2 === 'random') {
            s1 = Math.random() < 0.5 ? 'w' : 'b';
            s2 = s1 === 'w' ? 'b' : 'w';
          }
          p1Role = s1;
          p2Role = s2;
          initialState = createInitialChessState();
          startingTurn = p1Role === 'w' ? p1Id : p2Id;
        } else if (gameType === 'guess-from-doodle') {
          const localSecret = getRandomWord();
          setSecretWord(localSecret);
          const isP1Drawer = c1.role !== 'guesser' && c2.role !== 'drawer';
          const drawerId = isP1Drawer ? p1Id : p2Id;
          const guesserId = isP1Drawer ? p2Id : p1Id;
          initialState = {
            round: 1,
            totalRounds: 4,
            drawerId,
            guesserId,
            secretWordMasked: maskSecretWord(localSecret, 0),
            secretWordLength: localSecret.length,
            revealedHints: 0,
            doodleStrokes: [],
            isGuessed: false,
          };
          p1Role = isP1Drawer ? 'drawer' : 'guesser';
          p2Role = isP1Drawer ? 'guesser' : 'drawer';
          startingTurn = drawerId;
        }

        const startedSession: GameSession = {
          ...session,
          status: 'active',
          players: {
            [p1Id]: { ...session.players[p1Id], role: p1Role },
            [p2Id]: { ...session.players[p2Id], role: p2Role },
          },
          currentTurnPlayerId: startingTurn,
          state: initialState,
          updatedAt: new Date().toISOString(),
        };

        setSession(startedSession);
        saveLocalSession(startedSession);
        setStatus('active');
      }
    },
    [session, isOnline, gameType]
  );

  // ─── Make Move Handler ────────────────────────────────────────────────────
  const makeMove = useCallback(
    async (movePayload: any) => {
      if (!session || session.status !== 'active') return;

      if (isOnline) {
        if (!socketRef.current) return;
        return new Promise<void>((resolve, reject) => {
          socketRef.current.emit(
            'game:move',
            {
              sessionId: session.id,
              actionId: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              ...movePayload,
            },
            (res: any) => {
              if (res?.error) {
                reject(new Error(res.error));
              } else {
                resolve();
              }
            }
          );
        });
      } else {
        // Local Pass-and-Play Move Handling
        const currentTurn = session.currentTurnPlayerId || 'p1';
        const otherPlayer = currentTurn === 'p1' ? 'p2' : 'p1';
        const pRole = session.players[currentTurn]?.role;

        let nextState: any = session.state;
        let winner: any = null;
        let isDraw = false;

        if (gameType === 'tic-tac-toe') {
          const res = applyTicTacToeMove(session.state as TicTacToeState, movePayload.cellIndex, pRole || 'X');
          nextState = res.nextState;
          winner = res.winner ? currentTurn : null;
          isDraw = res.isDraw;
        } else if (gameType === 'connect-four') {
          const res = applyConnectFourMove(session.state as ConnectFourState, movePayload.col, pRole || '#ff3d5a');
          nextState = res.nextState;
          winner = res.winner ? currentTurn : null;
          isDraw = res.isDraw;
        } else if (gameType === 'chess') {
          const res = applyChessMove(session.state as ChessState, movePayload.from, movePayload.to, movePayload.promotion);
          nextState = res.nextState;
          winner = res.winner ? currentTurn : null;
          isDraw = res.isDraw;
        }

        const isOver = !!winner || isDraw;
        const updatedSession: GameSession = {
          ...session,
          state: nextState,
          currentTurnPlayerId: isOver ? currentTurn : otherPlayer,
          status: isOver ? 'finished' : 'active',
          result: isOver
            ? {
                winnerPlayerId: winner,
                winnerName: winner ? session.players[winner]?.displayName || 'Winner' : null,
                outcome: isDraw ? 'draw' : 'win',
                completedAt: new Date().toISOString(),
              }
            : null,
          updatedAt: new Date().toISOString(),
        };

        setSession(updatedSession);
        saveLocalSession(updatedSession);

        if (isOver) {
          recordLocalGameResult(updatedSession, winner, isDraw ? 'draw' : 'win');
          confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } });
        }
      }
    },
    [session, isOnline, gameType]
  );

  // ─── Doodle Guess Actions (Live Chunk Streaming) ──────────────────────────
  const sendStrokeChunk = useCallback(
    (chunk: DoodleStrokeChunk) => {
      if (isOnline && socketRef.current && session) {
        socketRef.current.emit('game:doodle_stroke_chunk', { sessionId: session.id, chunk });
      }
    },
    [isOnline, session]
  );

  const sendStroke = useCallback(
    (stroke: DoodleStroke) => {
      setDoodleStrokes((prev) => [...prev, stroke]);
      if (isOnline && socketRef.current && session) {
        socketRef.current.emit('game:doodle_stroke', { sessionId: session.id, stroke });
      } else if (!isOnline && session) {
        const nextState = {
          ...(session.state as DoodleState),
          doodleStrokes: [...doodleStrokes, stroke],
        };
        const updated = { ...session, state: nextState };
        setSession(updated);
        saveLocalSession(updated);
      }
    },
    [isOnline, session, doodleStrokes]
  );

  const clearDoodle = useCallback(() => {
    setDoodleStrokes([]);
    if (isOnline && socketRef.current && session) {
      socketRef.current.emit('game:doodle_clear', { sessionId: session.id });
    } else if (!isOnline && session) {
      const nextState = { ...(session.state as DoodleState), doodleStrokes: [] };
      const updated = { ...session, state: nextState };
      setSession(updated);
      saveLocalSession(updated);
    }
  }, [isOnline, session]);

  const requestHint = useCallback(() => {
    if (isOnline && socketRef.current && session) {
      socketRef.current.emit('game:doodle_hint', { sessionId: session.id });
    } else if (!isOnline && session && secretWord) {
      const dState = session.state as DoodleState;
      if (dState.revealedHints < secretWord.length - 1) {
        const nextHints = dState.revealedHints + 1;
        const nextState: DoodleState = {
          ...dState,
          revealedHints: nextHints,
          secretWordMasked: maskSecretWord(secretWord, nextHints),
        };
        const updated = { ...session, state: nextState };
        setSession(updated);
        saveLocalSession(updated);
      }
    }
  }, [isOnline, session, secretWord]);

  const submitGuess = useCallback(
    async (guess: string): Promise<{ correct: boolean; word?: string }> => {
      const trimmed = guess.trim().toLowerCase();
      if (!trimmed) return { correct: false };

      if (isOnline) {
        if (!socketRef.current || !session) return { correct: false };
        return new Promise((resolve) => {
          socketRef.current.emit('game:guess', { sessionId: session.id, guess: trimmed }, (res: any) => {
            if (res?.correct) {
              confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } });
              resolve({ correct: true, word: res.word });
            } else {
              resolve({ correct: false });
            }
          });
        });
      } else {
        // Local Guess Checking
        if (!secretWord || !session) return { correct: false };
        const isMatch = trimmed === secretWord.toLowerCase();

        if (isMatch) {
          const dState = session.state as DoodleState;
          const guesserId = dState.guesserId;
          const nextState: DoodleState = {
            ...dState,
            isGuessed: true,
            secretWordMasked: secretWord.toUpperCase(),
          };
          const updated: GameSession = {
            ...session,
            state: nextState,
            status: 'finished',
            result: {
              winnerPlayerId: guesserId,
              winnerName: session.players[guesserId]?.displayName || 'Guesser',
              outcome: 'win',
              completedAt: new Date().toISOString(),
            },
          };
          setSession(updated);
          saveLocalSession(updated);
          recordLocalGameResult(updated, guesserId, 'win');
          confetti({ particleCount: 60, spread: 70, origin: { y: 0.6 } });
          return { correct: true, word: secretWord };
        } else {
          return { correct: false };
        }
      }
    },
    [isOnline, session, secretWord]
  );

  // ─── Rematch & Leave ──────────────────────────────────────────────────────
  const requestRematch = useCallback(
    async (options?: { mode?: 'keep' | 'change' }) => {
      const rMode = options?.mode || 'keep';
      if (isOnline && socketRef.current && session) {
        socketRef.current.emit('game:rematch', { sessionId: session.id, mode: rMode });
      } else if (!isOnline && session) {
        if (rMode === 'change') {
          // Reset to lobby
          const p1Id = session.playerIds[0] || 'p1';
          const p2Id = session.playerIds[1] || 'p2';
          const nextSession: GameSession = {
            ...session,
            status: 'setup',
            result: null,
            players: {
              [p1Id]: { ...session.players[p1Id], choice: { ...(session.players[p1Id]?.choice || { isReady: false }), isReady: false } },
              [p2Id]: { ...session.players[p2Id], choice: { ...(session.players[p2Id]?.choice || { isReady: false }), isReady: false } },
            },
            lobbyState: { conflict: null, allReady: false },
          };
          setSession(nextSession);
          saveLocalSession(nextSession);
          setStatus('setup');
          setDoodleStrokes([]);
        } else {
          // Keep choices, alternate starting player
          if (gameType) clearLocalSession(gameType);
          setDoodleStrokes([]);
          initLocalSession();
        }
      }
    },
    [isOnline, session, gameType, initLocalSession]
  );

  const leaveGame = useCallback(async () => {
    if (isOnline && socketRef.current && session) {
      socketRef.current.emit('game:leave', { sessionId: session.id });
    } else if (!isOnline && gameType) {
      clearLocalSession(gameType);
    }
  }, [isOnline, session, gameType]);

  const sendChatMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !session) return;
      if (trimmed.length > 300) {
        throw new Error('Message cannot exceed 300 characters');
      }

      if (isOnline) {
        if (!socketRef.current || !socketRef.current.connected) {
          throw new Error('Not connected to game server. Please wait for reconnection.');
        }
        return new Promise<void>((resolve, reject) => {
          socketRef.current.emit(
            'game:chat_send',
            { sessionId: session.id, text: trimmed },
            (response: any) => {
              if (response?.error) {
                reject(new Error(response.error));
              } else {
                // Reliably add acknowledged message locally so that if broadcast is delayed/missed, message still appears
                if (response?.message) {
                  useActiveGameStore.getState().addChatMessage(session.id, response.message);
                }
                resolve();
              }
            }
          );
        });
      } else {
        // Local mode pass-and-play chat / notes
        const pNames = getLocalPlayerNames();
        const senderName =
          session.currentTurnPlayerId === 'p2' ? pNames.player2Name : pNames.player1Name;
        const senderId = session.currentTurnPlayerId || 'p1';
        const newMsg: GameChatMessage = {
          id: `local_msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          sessionId: session.id,
          senderId,
          senderName,
          text: trimmed,
          createdAt: new Date().toISOString(),
        };

        const updatedMessages = [...(session.chatMessages || []), newMsg];
        const updatedSession: GameSession = {
          ...session,
          chatMessages: updatedMessages,
        };
        setSession(updatedSession);
        saveLocalSession(updatedSession);
        useActiveGameStore.getState().addChatMessage(session.id, newMsg);
      }
    },
    [isOnline, session]
  );

  const setLocalPlayerNamesConfig = useCallback(
    (p1: string, p2: string) => {
      const cfg = { player1Name: p1 || 'Player 1', player2Name: p2 || 'Player 2' };
      saveLocalPlayerNames(cfg);
      setLocalPlayers(cfg);
      if (!isOnline && session) {
        const updated: GameSession = {
          ...session,
          players: {
            p1: { ...session.players.p1, displayName: cfg.player1Name },
            p2: { ...session.players.p2, displayName: cfg.player2Name },
          },
        };
        setSession(updated);
        saveLocalSession(updated);
      }
    },
    [isOnline, session]
  );

  const activeUserId = isOnline ? myUid : session?.currentTurnPlayerId || 'p1';
  const isMyTurn = isOnline
    ? session?.currentTurnPlayerId === myUid && session?.status === 'active'
    : true; // In pass-and-play, whoever holds device plays current turn
  const myRole = isOnline ? session?.players[myUid]?.role || '' : session?.players.p1?.role || '';
  const partnerRole = isOnline ? session?.players[partnerUid]?.role || '' : session?.players.p2?.role || '';

  return {
    session,
    status,
    errorMessage,
    isMyTurn,
    myRole,
    partnerRole,
    secretWord,
    doodleStrokes,
    incomingLiveChunk,
    rematchRequested,
    rematchMode,
    localPlayers,
    activeUserId,
    myUid,
    makeMove,
    sendStroke,
    sendStrokeChunk,
    clearDoodle,
    requestHint,
    submitGuess,
    selectChoice,
    confirmReady,
    requestRematch,
    leaveGame,
    sendChatMessage,
    setLocalPlayerNamesConfig,
    resetLocalMatch: () => {
      if (gameType) {
        clearLocalSession(gameType);
        setDoodleStrokes([]);
        initLocalSession();
      }
    },
  };
}
