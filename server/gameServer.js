import { Chess } from 'chess.js';

// Curated words for Doodle Guess (Server Authoritative)
const DOODLE_WORDS = [
  'cat', 'pizza', 'rocket', 'banana', 'octopus', 'castle', 'bicycle', 'umbrella',
  'dinosaur', 'guitar', 'robot', 'volcano', 'snowman', 'pirate', 'spider', 'sandwich',
  'unicorn', 'airplane', 'ghost', 'cactus', 'penguin', 'burger', 'crown', 'dragon',
  'rainbow', 'heart', 'coffee', 'cupcake', 'puppy', 'moon', 'sunflower', 'butterfly',
  'camera', 'ice cream', 'balloon', 'spaceship'
];

function getRandomWord() {
  return DOODLE_WORDS[Math.floor(Math.random() * DOODLE_WORDS.length)];
}

function maskWord(word, revealedCount = 0) {
  return word
    .split('')
    .map((char, index) => {
      if (char === ' ') return ' ';
      return index < revealedCount ? char.toUpperCase() : '_';
    })
    .join(' ');
}

// ─── Pure Rules for Tic-tac-toe ─────────────────────────────────────────────
const TTT_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

function evaluateTicTacToe(board) {
  for (const [a, b, c] of TTT_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line: [a, b, c], isDraw: false };
    }
  }
  const isFull = board.every((c) => c !== null && c !== '');
  return { winner: null, line: null, isDraw: isFull };
}

// ─── Pure Rules for Connect Four ────────────────────────────────────────────
const C4_ROWS = 6;
const C4_COLS = 7;

function evaluateConnectFourWin(grid, r, c) {
  const color = grid[r][c];
  if (!color) return null;
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];

  for (const [dr, dc] of dirs) {
    const seq = [[r, c]];
    for (let s = 1; s <= 3; s++) {
      const nr = r + dr * s;
      const nc = c + dc * s;
      if (nr >= 0 && nr < C4_ROWS && nc >= 0 && nc < C4_COLS && grid[nr][nc] === color) {
        seq.push([nr, nc]);
      } else break;
    }
    for (let s = 1; s <= 3; s++) {
      const nr = r - dr * s;
      const nc = c - dc * s;
      if (nr >= 0 && nr < C4_ROWS && nc >= 0 && nc < C4_COLS && grid[nr][nc] === color) {
        seq.push([nr, nc]);
      } else break;
    }
    if (seq.length >= 4) return seq;
  }
  return null;
}

// In-memory active game sessions: Map<sessionId, SessionData>
const serverSessions = new Map();

export function setupGameSocketHandlers(io, socket, db, admin, isProduction, verifyUserCoupleMembership) {
  const uid = socket.data.uid;

  // 1. Join or Reconnect to a Game Session
  socket.on('game:join', async (payload, callback) => {
    try {
      const { coupleId, gameType, displayName, avatarUrl } = payload || {};
      if (!coupleId || !gameType) {
        if (typeof callback === 'function') callback({ error: 'Missing coupleId or gameType' });
        return;
      }

      // Authoritative couple membership check
      const isMember = await verifyUserCoupleMembership(uid, coupleId);
      if (!isMember) {
        console.warn(`[GameServer] Unauthorized game:join attempt by ${uid} in couple ${coupleId}`);
        if (typeof callback === 'function') callback({ error: 'Unauthorized: Not a couple member' });
        return;
      }

      const sessionId = `game-${coupleId}-${gameType}`.toLowerCase();
      const socketRoom = `game_room:${sessionId}`;

      socket.join(socketRoom);
      socket.data.currentGameSessionId = sessionId;

      let session = serverSessions.get(sessionId);

      // Restore session from Firestore if missing from server memory
      if (!session && db) {
        try {
          const docSnap = await db.collection('couples').doc(coupleId).collection('gameSessions').doc(sessionId).get();
          if (docSnap.exists) {
            const data = docSnap.data();
            session = {
              ...data,
              secretWord: data.secretWord || null, // Recover if present
            };
            serverSessions.set(sessionId, session);
          }
        } catch (err) {
          console.warn('[GameServer] Error restoring session from Firestore:', err.message);
        }
      }

      const nowIso = new Date().toISOString();

      if (!session || session.status === 'finished' || session.status === 'abandoned') {
        // Initialize fresh game session
        let initialState = null;
        let role = '';

        if (gameType === 'tic-tac-toe') {
          initialState = { board: Array(9).fill(null), winningLine: null };
          role = 'X';
        } else if (gameType === 'connect-four') {
          initialState = { grid: Array.from({ length: 6 }, () => Array(7).fill(null)), winningCells: null };
          role = 'r';
        } else if (gameType === 'chess') {
          const chess = new Chess();
          initialState = {
            fen: chess.fen(),
            turn: 'w',
            isCheck: false,
            isCheckmate: false,
            isDraw: false,
            isStalemate: false,
            lastMove: null,
            capturedWhite: [],
            capturedBlack: [],
            moveHistory: [],
          };
          role = 'w';
        } else if (gameType === 'guess-from-doodle') {
          const secret = getRandomWord();
          initialState = {
            round: 1,
            totalRounds: 4,
            drawerId: uid,
            guesserId: '',
            secretWordMasked: maskWord(secret, 0),
            secretWordLength: secret.length,
            revealedHints: 0,
            doodleStrokes: [],
            isGuessed: false,
          };
          role = 'drawer';
        }

        session = {
          id: sessionId,
          coupleId,
          gameType,
          mode: 'online',
          status: 'waiting',
          playerIds: [uid],
          players: {
            [uid]: {
              id: uid,
              displayName: displayName || 'Partner',
              avatarUrl: avatarUrl || '',
              role,
            },
          },
          currentTurnPlayerId: uid,
          state: initialState,
          secretWord: gameType === 'guess-from-doodle' ? getRandomWord() : null,
          result: null,
          actionSeq: 1,
          createdAt: nowIso,
          updatedAt: nowIso,
          completedResultRecorded: false,
        };

        if (gameType === 'guess-from-doodle' && session.secretWord) {
          session.state.secretWordMasked = maskWord(session.secretWord, 0);
          session.state.secretWordLength = session.secretWord.length;
        }

        serverSessions.set(sessionId, session);
      } else {
        // Session already exists
        if (!session.playerIds.includes(uid) && session.playerIds.length === 1) {
          // Second player joins! Start active game!
          session.playerIds.push(uid);

          let secondRole = '';
          if (gameType === 'tic-tac-toe') secondRole = 'O';
          else if (gameType === 'connect-four') secondRole = 'y';
          else if (gameType === 'chess') secondRole = 'b';
          else if (gameType === 'guess-from-doodle') {
            secondRole = 'guesser';
            session.state.guesserId = uid;
          }

          session.players[uid] = {
            id: uid,
            displayName: displayName || 'Partner',
            avatarUrl: avatarUrl || '',
            role: secondRole,
          };

          session.status = 'active';
          session.updatedAt = nowIso;
        } else if (session.players[uid]) {
          // Reconnecting player
          session.players[uid].displayName = displayName || session.players[uid].displayName;
        }
      }

      // Persist session to Firestore (without revealing secret word to guesser)
      await persistSessionToFirestore(db, coupleId, session);

      // Emit session update to room
      const safeState = getSafeSessionPayload(session, uid);
      io.to(socketRoom).emit('game:session_state', safeState);

      // Send private secret word to drawer if Doodle Guess
      if (gameType === 'guess-from-doodle' && session.secretWord && session.state.drawerId === uid) {
        socket.emit('game:secret_word', { secretWord: session.secretWord });
      }

      if (typeof callback === 'function') callback({ success: true, session: safeState });
    } catch (err) {
      console.error('[GameServer] game:join error:', err);
      if (typeof callback === 'function') callback({ error: err.message });
    }
  });

  // 2. Authoritative Move Action
  socket.on('game:move', async (payload, callback) => {
    try {
      const { sessionId, actionType, cellIndex, col, from, to, promotion, actionId } = payload || {};
      const session = serverSessions.get(sessionId);

      if (!session) {
        if (typeof callback === 'function') callback({ error: 'Session not found' });
        return;
      }

      if (session.status !== 'active') {
        if (typeof callback === 'function') callback({ error: 'Game is not active' });
        return;
      }

      if (session.currentTurnPlayerId !== uid) {
        if (typeof callback === 'function') callback({ error: "It is not your turn!" });
        return;
      }

      const otherPlayerId = session.playerIds.find((id) => id !== uid);
      const playerRole = session.players[uid]?.role;
      let moveApplied = false;
      let winnerId = null;
      let isDraw = false;

      // ── A. Tic-tac-toe Move ────────────────────────────────────────────────
      if (session.gameType === 'tic-tac-toe') {
        if (typeof cellIndex !== 'number' || cellIndex < 0 || cellIndex > 8) {
          if (typeof callback === 'function') callback({ error: 'Invalid cell index' });
          return;
        }
        if (session.state.board[cellIndex]) {
          if (typeof callback === 'function') callback({ error: 'Cell already taken' });
          return;
        }

        session.state.board[cellIndex] = playerRole;
        const evalResult = evaluateTicTacToe(session.state.board);

        if (evalResult.winner) {
          winnerId = uid;
          session.state.winningLine = evalResult.line;
          session.status = 'finished';
        } else if (evalResult.isDraw) {
          isDraw = true;
          session.status = 'finished';
        } else {
          session.currentTurnPlayerId = otherPlayerId;
        }
        moveApplied = true;
      }

      // ── B. Connect Four Move ───────────────────────────────────────────────
      else if (session.gameType === 'connect-four') {
        if (typeof col !== 'number' || col < 0 || col >= C4_COLS) {
          if (typeof callback === 'function') callback({ error: 'Invalid column' });
          return;
        }

        let targetRow = -1;
        for (let r = C4_ROWS - 1; r >= 0; r--) {
          if (!session.state.grid[r][col]) {
            targetRow = r;
            break;
          }
        }

        if (targetRow === -1) {
          if (typeof callback === 'function') callback({ error: 'Column is full' });
          return;
        }

        session.state.grid[targetRow][col] = playerRole;
        session.state.lastDrop = [targetRow, col];

        const winSeq = evaluateConnectFourWin(session.state.grid, targetRow, col);
        const isFull = session.state.grid[0].every((cell) => cell !== null);

        if (winSeq) {
          winnerId = uid;
          session.state.winningCells = winSeq;
          session.status = 'finished';
        } else if (isFull) {
          isDraw = true;
          session.status = 'finished';
        } else {
          session.currentTurnPlayerId = otherPlayerId;
        }
        moveApplied = true;
      }

      // ── C. Chess Move ──────────────────────────────────────────────────────
      else if (session.gameType === 'chess') {
        const chess = new Chess(session.state.fen);
        let moveResult;
        try {
          moveResult = chess.move({
            from,
            to,
            promotion: promotion || 'q',
          });
        } catch {
          if (typeof callback === 'function') callback({ error: 'Illegal chess move' });
          return;
        }

        if (!moveResult) {
          if (typeof callback === 'function') callback({ error: 'Illegal chess move' });
          return;
        }

        const nextFen = chess.fen();
        const isCheck = chess.isCheck();
        const isCheckmate = chess.isCheckmate();
        const isDrawGame = chess.isDraw();
        const isStalemate = chess.isStalemate();

        session.state.fen = nextFen;
        session.state.turn = chess.turn();
        session.state.isCheck = isCheck;
        session.state.isCheckmate = isCheckmate;
        session.state.isDraw = isDrawGame;
        session.state.isStalemate = isStalemate;
        session.state.lastMove = { from: moveResult.from, to: moveResult.to, san: moveResult.san };
        session.state.moveHistory = [...(session.state.moveHistory || []), moveResult.san];

        if (isCheckmate) {
          winnerId = uid;
          session.status = 'finished';
        } else if (isDrawGame || isStalemate) {
          isDraw = true;
          session.status = 'finished';
        } else {
          session.currentTurnPlayerId = otherPlayerId;
        }
        moveApplied = true;
      }

      if (moveApplied) {
        session.actionSeq = (session.actionSeq || 0) + 1;
        session.updatedAt = new Date().toISOString();

        if (session.status === 'finished' && !session.completedResultRecorded) {
          session.result = {
            winnerPlayerId: winnerId,
            winnerName: winnerId ? session.players[winnerId]?.displayName || 'Winner' : null,
            outcome: isDraw ? 'draw' : 'win',
            completedAt: new Date().toISOString(),
          };
          session.completedResultRecorded = true;

          // Record authoritative Online stats and streaks in Firestore
          await recordAuthoritativeOnlineStats(db, admin, session);
        }

        // Persist updated session
        await persistSessionToFirestore(db, session.coupleId, session);

        // Broadcast to room
        const socketRoom = `game_room:${sessionId}`;
        io.to(socketRoom).emit('game:session_state', getSafeSessionPayload(session));
        io.to(socketRoom).emit('game:action_applied', { actionId, actionSeq: session.actionSeq });

        if (typeof callback === 'function') callback({ success: true });
      }
    } catch (err) {
      console.error('[GameServer] game:move error:', err);
      if (typeof callback === 'function') callback({ error: err.message });
    }
  });

  // 3. Doodle Guess - Stream Drawing Strokes (Batching & Rate-Limiting)
  socket.on('game:doodle_stroke', (payload) => {
    try {
      const { sessionId, stroke } = payload || {};
      const session = serverSessions.get(sessionId);
      if (!session || session.status !== 'active') return;

      // Only authoritative drawer can send drawing strokes
      if (session.state.drawerId !== uid) return;

      // Validate stroke format and prevent memory bombs
      if (!stroke || !Array.isArray(stroke.points) || stroke.points.length > 300) return;

      if (!session.state.doodleStrokes) session.state.doodleStrokes = [];
      if (session.state.doodleStrokes.length < 500) {
        session.state.doodleStrokes.push(stroke);
      }

      const socketRoom = `game_room:${sessionId}`;
      socket.to(socketRoom).emit('game:doodle_stroke', { stroke });
    } catch (e) {
      console.warn('[GameServer] Stroke error:', e);
    }
  });

  // 4. Doodle Guess - Clear Canvas
  socket.on('game:doodle_clear', ({ sessionId }) => {
    const session = serverSessions.get(sessionId);
    if (!session || session.state.drawerId !== uid) return;

    session.state.doodleStrokes = [];
    const socketRoom = `game_room:${sessionId}`;
    socket.to(socketRoom).emit('game:doodle_clear');
  });

  // 5. Doodle Guess - Hint Request
  socket.on('game:doodle_hint', async ({ sessionId }, callback) => {
    try {
      const session = serverSessions.get(sessionId);
      if (!session || session.status !== 'active' || !session.secretWord) return;

      if (session.state.revealedHints < session.secretWord.length - 1) {
        session.state.revealedHints++;
        session.state.secretWordMasked = maskWord(session.secretWord, session.state.revealedHints);
        session.updatedAt = new Date().toISOString();

        await persistSessionToFirestore(db, session.coupleId, session);

        const socketRoom = `game_room:${sessionId}`;
        io.to(socketRoom).emit('game:session_state', getSafeSessionPayload(session));
      }
      if (typeof callback === 'function') callback({ success: true });
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message });
    }
  });

  // 6. Doodle Guess - Authoritative Guess Submission
  socket.on('game:guess', async (payload, callback) => {
    try {
      const { sessionId, guess } = payload || {};
      const session = serverSessions.get(sessionId);

      if (!session || session.status !== 'active' || !session.secretWord) {
        if (typeof callback === 'function') callback({ error: 'Invalid game session' });
        return;
      }

      // Guesser is the other player
      if (session.state.guesserId && session.state.guesserId !== uid) {
        if (typeof callback === 'function') callback({ error: 'Only the guesser can submit guesses' });
        return;
      }

      const normalizedGuess = (guess || '').trim().toLowerCase();
      const secret = session.secretWord.toLowerCase();
      const isCorrect = normalizedGuess === secret;

      const socketRoom = `game_room:${sessionId}`;

      if (isCorrect) {
        session.state.isGuessed = true;
        session.state.secretWordMasked = session.secretWord.toUpperCase();
        session.status = 'finished';
        session.result = {
          winnerPlayerId: uid,
          winnerName: session.players[uid]?.displayName || 'Guesser',
          outcome: 'win',
          completedAt: new Date().toISOString(),
        };

        if (!session.completedResultRecorded) {
          session.completedResultRecorded = true;
          await recordAuthoritativeOnlineStats(db, admin, session);
        }

        await persistSessionToFirestore(db, session.coupleId, session);

        io.to(socketRoom).emit('game:session_state', getSafeSessionPayload(session));
        io.to(socketRoom).emit('game:guess_result', {
          correct: true,
          guesserId: uid,
          word: session.secretWord,
        });

        if (typeof callback === 'function') callback({ success: true, correct: true, word: session.secretWord });
      } else {
        io.to(socketRoom).emit('game:guess_result', {
          correct: false,
          guesserId: uid,
          guess: normalizedGuess,
        });
        if (typeof callback === 'function') callback({ success: true, correct: false });
      }
    } catch (err) {
      console.error('[GameServer] guess error:', err);
      if (typeof callback === 'function') callback({ error: err.message });
    }
  });

  // 7. Rematch Request
  socket.on('game:rematch', async ({ sessionId }, callback) => {
    try {
      const session = serverSessions.get(sessionId);
      if (!session) {
        if (typeof callback === 'function') callback({ error: 'Session not found' });
        return;
      }

      // If already requested by partner, reset board and start new match
      if (session.rematchRequestedBy && session.rematchRequestedBy !== uid) {
        session.rematchRequestedBy = null;
        session.status = 'active';
        session.completedResultRecorded = false;
        session.result = null;

        const p1 = session.playerIds[0];
        const p2 = session.playerIds[1];

        // Alternate starting player or roles
        if (session.gameType === 'tic-tac-toe') {
          session.state = { board: Array(9).fill(null), winningLine: null };
          session.currentTurnPlayerId = session.currentTurnPlayerId === p1 ? p2 : p1;
        } else if (session.gameType === 'connect-four') {
          session.state = { grid: Array.from({ length: 6 }, () => Array(7).fill(null)), winningCells: null };
          session.currentTurnPlayerId = session.currentTurnPlayerId === p1 ? p2 : p1;
        } else if (session.gameType === 'chess') {
          const chess = new Chess();
          session.state = {
            fen: chess.fen(),
            turn: 'w',
            isCheck: false,
            isCheckmate: false,
            isDraw: false,
            isStalemate: false,
            lastMove: null,
            capturedWhite: [],
            capturedBlack: [],
            moveHistory: [],
          };
          // Swap who plays white vs black
          const tempRole = session.players[p1].role;
          session.players[p1].role = session.players[p2].role;
          session.players[p2].role = tempRole;
          session.currentTurnPlayerId = session.players[p1].role === 'w' ? p1 : p2;
        } else if (session.gameType === 'guess-from-doodle') {
          const newSecret = getRandomWord();
          session.secretWord = newSecret;
          // Swap drawer & guesser
          const oldDrawer = session.state.drawerId;
          const nextDrawer = oldDrawer === p1 ? p2 : p1;
          const nextGuesser = nextDrawer === p1 ? p2 : p1;

          session.state = {
            round: (session.state.round || 1) + 1,
            totalRounds: 4,
            drawerId: nextDrawer,
            guesserId: nextGuesser,
            secretWordMasked: maskWord(newSecret, 0),
            secretWordLength: newSecret.length,
            revealedHints: 0,
            doodleStrokes: [],
            isGuessed: false,
          };
          session.players[nextDrawer].role = 'drawer';
          session.players[nextGuesser].role = 'guesser';
          session.currentTurnPlayerId = nextDrawer;

          // Emit secret word privately to new drawer
          const drawerSocket = Array.from(io.sockets.sockets.values()).find((s) => s.data.uid === nextDrawer);
          if (drawerSocket) {
            drawerSocket.emit('game:secret_word', { secretWord: newSecret });
          }
        }

        session.actionSeq = (session.actionSeq || 0) + 1;
        session.updatedAt = new Date().toISOString();

        await persistSessionToFirestore(db, session.coupleId, session);

        const socketRoom = `game_room:${sessionId}`;
        io.to(socketRoom).emit('game:session_state', getSafeSessionPayload(session));
        io.to(socketRoom).emit('game:rematch_started');

        if (typeof callback === 'function') callback({ success: true, started: true });
      } else {
        session.rematchRequestedBy = uid;
        const socketRoom = `game_room:${sessionId}`;
        io.to(socketRoom).emit('game:rematch_requested', { requestedBy: uid });
        if (typeof callback === 'function') callback({ success: true, requested: true });
      }
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message });
    }
  });

  // 8. Resign / Leave Game
  socket.on('game:leave', async ({ sessionId }, callback) => {
    try {
      const session = serverSessions.get(sessionId);
      if (session) {
        const otherPlayerId = session.playerIds.find((id) => id !== uid);

        if (session.status === 'active' && otherPlayerId && !session.completedResultRecorded) {
          // Leaving an active game counts as resignation
          session.status = 'finished';
          session.result = {
            winnerPlayerId: otherPlayerId,
            winnerName: session.players[otherPlayerId]?.displayName || 'Partner',
            outcome: 'resignation',
            completedAt: new Date().toISOString(),
          };
          session.completedResultRecorded = true;
          await recordAuthoritativeOnlineStats(db, admin, session);
        }

        session.updatedAt = new Date().toISOString();
        await persistSessionToFirestore(db, session.coupleId, session);

        const socketRoom = `game_room:${sessionId}`;
        io.to(socketRoom).emit('game:session_state', getSafeSessionPayload(session));
        io.to(socketRoom).emit('game:partner_left', { leaverId: uid });
      }
      if (typeof callback === 'function') callback({ success: true });
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message });
    }
  });
}

/**
 * Filter secret word from payload sent to clients to prevent cheating.
 */
function getSafeSessionPayload(session, targetUid = null) {
  const safe = { ...session };
  // Never expose raw secretWord in room state
  delete safe.secretWord;
  return safe;
}

/**
 * Persist game session to Firestore for durable recovery across navigation/refresh.
 */
async function persistSessionToFirestore(db, coupleId, session) {
  if (!db || !coupleId || !session) return;
  try {
    const docRef = db.collection('couples').doc(coupleId).collection('gameSessions').doc(session.id);
    const dataToSave = { ...session };
    // Keep secretWord out of Firestore unless game is finished
    if (session.status !== 'finished' && dataToSave.secretWord) {
      delete dataToSave.secretWord;
    }
    await docRef.set(dataToSave, { merge: true });
  } catch (err) {
    console.warn('[GameServer] Firestore persistSession error:', err.message);
  }
}

/**
 * Authoritative recording of win streaks, losses, draws in Firestore.
 * Separate for each game and online mode.
 */
async function recordAuthoritativeOnlineStats(db, admin, session) {
  if (!db || !admin || !session || !session.result) return;
  const { coupleId, gameType, playerIds, result } = session;
  if (!coupleId || !playerIds || playerIds.length < 2) return;

  const winnerId = result.winnerPlayerId;
  const isDraw = result.outcome === 'draw';

  for (const pid of playerIds) {
    try {
      const statDocRef = db.collection('couples').doc(coupleId).collection('gameStats').doc(`${pid}_${gameType}_online`);
      await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(statDocRef);
        const currentData = snap.exists ? snap.data() : {
          playerId: pid,
          gameType,
          mode: 'online',
          wins: 0,
          losses: 0,
          draws: 0,
          currentWinStreak: 0,
          bestWinStreak: 0,
        };

        if (isDraw) {
          currentData.draws = (currentData.draws || 0) + 1;
          currentData.currentWinStreak = 0; // Draw resets streak
        } else if (winnerId === pid) {
          currentData.wins = (currentData.wins || 0) + 1;
          const nextStreak = (currentData.currentWinStreak || 0) + 1;
          currentData.currentWinStreak = nextStreak;
          if (nextStreak > (currentData.bestWinStreak || 0)) {
            currentData.bestWinStreak = nextStreak;
          }
        } else {
          currentData.losses = (currentData.losses || 0) + 1;
          currentData.currentWinStreak = 0; // Loss resets streak
        }

        currentData.updatedAt = new Date().toISOString();
        transaction.set(statDocRef, currentData, { merge: true });
      });
    } catch (err) {
      console.warn(`[GameServer] Error updating stats for player ${pid}:`, err.message);
    }
  }
}
