import { useState, useEffect, useRef, useCallback } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { useAuthStore } from '../store';
import type {
  GameType,
  GameMode,
  GameSession,
  GameStatus,
  DoodleStroke,
  TicTacToeState,
  ConnectFourState,
  ChessState,
  DoodleState,
} from './types';
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

export function useGameSession(gameType: GameType, mode: GameMode) {
  const { currentUser, partnerUser, couple } = useAuthStore();
  const coupleId = couple?.id || 'couple-duo';
  const myUid = auth.currentUser?.uid || currentUser.id || 'p1';
  const partnerUid = partnerUser.id || 'p2';

  const [session, setSession] = useState<GameSession | null>(null);
  const [secretWord, setSecretWord] = useState<string | null>(null);
  const [doodleStrokes, setDoodleStrokes] = useState<DoodleStroke[]>([]);
  const [status, setStatus] = useState<GameStatus | 'connecting' | 'reconnecting' | 'error'>('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rematchRequested, setRematchRequested] = useState(false);
  const [localPlayers, setLocalPlayers] = useState(getLocalPlayerNames());

  const socketRef = useRef<any>(null);
  const isOnline = mode === 'online';

  // ─── Local Mode Initialization & Handlers ─────────────────────────────────
  const initLocalSession = useCallback(() => {
    const existing = loadLocalSession(gameType);
    if (existing && existing.status !== 'finished') {
      setSession(existing);
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

    let initialState: any = null;
    let p1Role = '';
    let p2Role = '';
    let localSecret: string | null = null;

    if (gameType === 'tic-tac-toe') {
      initialState = createInitialTicTacToeState();
      p1Role = 'X';
      p2Role = 'O';
    } else if (gameType === 'connect-four') {
      initialState = createInitialConnectFourState();
      p1Role = 'r';
      p2Role = 'y';
    } else if (gameType === 'chess') {
      initialState = createInitialChessState();
      p1Role = 'w';
      p2Role = 'b';
    } else if (gameType === 'guess-from-doodle') {
      localSecret = getRandomWord();
      initialState = {
        round: 1,
        totalRounds: 4,
        drawerId: p1Id,
        guesserId: p2Id,
        secretWordMasked: maskSecretWord(localSecret, 0),
        secretWordLength: localSecret.length,
        revealedHints: 0,
        doodleStrokes: [],
        isGuessed: false,
      };
      p1Role = 'drawer';
      p2Role = 'guesser';
      setSecretWord(localSecret);
    }

    const freshSession: GameSession = {
      id: `local-${gameType}`,
      coupleId: 'local',
      gameType,
      mode: 'local',
      status: 'active',
      playerIds: [p1Id, p2Id],
      players: {
        [p1Id]: { id: p1Id, displayName: pNames.player1Name, role: p1Role },
        [p2Id]: { id: p2Id, displayName: pNames.player2Name, role: p2Role },
      },
      currentTurnPlayerId: p1Id,
      state: initialState,
      actionSeq: 1,
      createdAt: now,
      updatedAt: now,
    };

    if (localSecret) {
      (freshSession as any).secretWord = localSecret;
    }

    setSession(freshSession);
    saveLocalSession(freshSession);
    setStatus('active');
  }, [gameType]);

  // ─── Online Mode Socket & Firestore Synchronization ───────────────────────
  useEffect(() => {
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
            // Keep higher actionSeq or update
            if (!prev || (data.actionSeq || 0) >= (prev.actionSeq || 0)) {
              return data;
            }
            return prev;
          });
          setStatus(data.status);
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
    (async () => {
      try {
        const socket = await getGameSocket();
        if (!isMounted || !socket) {
          setStatus('error');
          setErrorMessage('Could not establish Socket.IO server connection. Please check your connection.');
          return;
        }

        socketRef.current = socket;

        // Register event listeners
        socket.on('game:session_state', (updatedSession: GameSession) => {
          if (!isMounted) return;
          setSession(updatedSession);
          setStatus(updatedSession.status);
          if (updatedSession.result) {
            confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } });
          }
        });

        socket.on('game:secret_word', ({ secretWord: word }: { secretWord: string }) => {
          if (!isMounted) return;
          setSecretWord(word);
        });

        socket.on('game:doodle_stroke', ({ stroke }: { stroke: DoodleStroke }) => {
          if (!isMounted) return;
          setDoodleStrokes((prev) => [...prev, stroke]);
        });

        socket.on('game:doodle_clear', () => {
          if (!isMounted) return;
          setDoodleStrokes([]);
        });

        socket.on('game:rematch_requested', () => {
          if (!isMounted) return;
          setRematchRequested(true);
        });

        socket.on('game:rematch_started', () => {
          if (!isMounted) return;
          setRematchRequested(false);
          setDoodleStrokes([]);
        });

        socket.on('game:partner_left', () => {
          if (!isMounted) return;
          setStatus('abandoned');
        });

        // Join online game session room
        socket.emit(
          'game:join',
          {
            coupleId,
            gameType,
            displayName: currentUser.displayName || 'Partner',
            avatarUrl: currentUser.avatarUrl || '',
          },
          (response: any) => {
            if (!isMounted) return;
            if (response?.error) {
              setStatus('error');
              setErrorMessage(response.error);
            } else if (response?.session) {
              setSession(response.session);
              setStatus(response.session.status);
            }
          }
        );
      } catch (err: any) {
        if (!isMounted) return;
        setStatus('error');
        setErrorMessage(err?.message || 'Failed to connect to online game');
      }
    })();

    return () => {
      isMounted = false;
      unsubFirestore();
      if (socketRef.current) {
        socketRef.current.off('game:session_state');
        socketRef.current.off('game:secret_word');
        socketRef.current.off('game:doodle_stroke');
        socketRef.current.off('game:doodle_clear');
        socketRef.current.off('game:rematch_requested');
        socketRef.current.off('game:rematch_started');
        socketRef.current.off('game:partner_left');
      }
    };
  }, [gameType, isOnline, coupleId, myUid, currentUser.displayName, currentUser.avatarUrl, initLocalSession]);

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
          const res = applyConnectFourMove(session.state as ConnectFourState, movePayload.col, (pRole as 'r' | 'y') || 'r');
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

  // ─── Doodle Guess Actions ─────────────────────────────────────────────────
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
  const requestRematch = useCallback(async () => {
    if (isOnline && socketRef.current && session) {
      socketRef.current.emit('game:rematch', { sessionId: session.id });
    } else if (!isOnline) {
      clearLocalSession(gameType);
      setDoodleStrokes([]);
      initLocalSession();
    }
  }, [isOnline, session, gameType, initLocalSession]);

  const leaveGame = useCallback(async () => {
    if (isOnline && socketRef.current && session) {
      socketRef.current.emit('game:leave', { sessionId: session.id });
    } else if (!isOnline) {
      clearLocalSession(gameType);
    }
  }, [isOnline, session, gameType]);

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
    rematchRequested,
    localPlayers,
    activeUserId,
    makeMove,
    sendStroke,
    clearDoodle,
    requestHint,
    submitGuess,
    requestRematch,
    leaveGame,
    setLocalPlayerNamesConfig,
    resetLocalMatch: () => {
      clearLocalSession(gameType);
      setDoodleStrokes([]);
      initLocalSession();
    },
  };
}
