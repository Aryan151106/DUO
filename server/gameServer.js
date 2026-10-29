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

/**
 * Evaluates whether current choices between the two players in the lobby conflict.
 */
function evaluateLobbyConflict(session) {
  if (!session.lobbyState) {
    session.lobbyState = { conflict: null, allReady: false };
  }
  const p1 = session.playerIds[0];
  const p2 = session.playerIds[1];
  if (!p1 || !p2) {
    session.lobbyState.conflict = null;
    session.lobbyState.allReady = false;
    return;
  }

  const c1 = session.players[p1]?.choice || {};
  const c2 = session.players[p2]?.choice || {};
  let conflict = null;

  if (session.gameType === 'tic-tac-toe') {
    if (c1.role && c2.role && c1.role === c2.role) {
      conflict = `Both players selected ${c1.role}! One partner must choose ${c1.role === 'X' ? 'O' : 'X'}.`;
    }
  } else if (session.gameType === 'connect-four') {
    const col1 = (c1.color || '#ff3d5a').toLowerCase();
    const col2 = (c2.color || '#ffd23a').toLowerCase();
    if (col1 === col2) {
      conflict = 'Both players selected the same disc color! Please pick different colors.';
    }
  } else if (session.gameType === 'chess') {
    if (c1.role && c2.role && c1.role === c2.role && c1.role !== 'random') {
      conflict = `Both players selected ${c1.role === 'w' ? 'White' : 'Black'}! One partner must choose the other side.`;
    }
  } else if (session.gameType === 'guess-from-doodle') {
    if (c1.role && c2.role && c1.role === c2.role && c1.role === 'drawer') {
      conflict = 'Both players chose to draw first! One partner must choose to guess.';
    }
  }

  session.lobbyState.conflict = conflict;
  session.lobbyState.allReady = Boolean(c1.isReady && c2.isReady && !conflict);
}

/**
 * Initializes authoritative state for the match based on confirmed lobby choices.
 */
function startGameWithChoices(session) {
  const p1 = session.playerIds[0];
  const p2 = session.playerIds[1];
  const c1 = session.players[p1]?.choice || {};
  const c2 = session.players[p2]?.choice || {};

  if (session.gameType === 'tic-tac-toe') {
    const role1 = c1.role || 'X';
    const role2 = role1 === 'X' ? 'O' : 'X';
    session.players[p1].role = role1;
    session.players[p2].role = role2;

    session.state = {
      board: Array(9).fill(null),
      winningLine: null,
    };
    // X moves first
    session.currentTurnPlayerId = session.players[p1].role === 'X' ? p1 : p2;
  } else if (session.gameType === 'connect-four') {
    const color1 = c1.color || '#ff3d5a';
    const color2 = c2.color || (color1 === '#ff3d5a' ? '#ffd23a' : '#ff3d5a');

    session.players[p1].color = color1;
    session.players[p1].colorName = c1.colorName || 'Color 1';
    session.players[p1].role = color1;

    session.players[p2].color = color2;
    session.players[p2].colorName = c2.colorName || 'Color 2';
    session.players[p2].role = color2;

    session.state = {
      grid: Array.from({ length: 6 }, () => Array(7).fill(null)),
      winningCells: null,
      lastDrop: null,
      playerColors: {
        [p1]: color1,
        [p2]: color2,
      },
    };
    // Player 1 drops first
    session.currentTurnPlayerId = p1;
  } else if (session.gameType === 'chess') {
    let side1 = c1.role || 'w';
    let side2 = c2.role || (side1 === 'w' ? 'b' : 'w');

    if (side1 === 'random' || side2 === 'random') {
      const p1IsWhite = Math.random() < 0.5;
      side1 = p1IsWhite ? 'w' : 'b';
      side2 = p1IsWhite ? 'b' : 'w';
    } else if (side1 === side2) {
      side2 = side1 === 'w' ? 'b' : 'w';
    }

    session.players[p1].role = side1;
    session.players[p2].role = side2;

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
    // White moves first
    session.currentTurnPlayerId = session.players[p1].role === 'w' ? p1 : p2;
  } else if (session.gameType === 'guess-from-doodle') {
    let drawerId = p1;
    let guesserId = p2;

    if (c1.role === 'guesser' || c2.role === 'drawer') {
      drawerId = p2;
      guesserId = p1;
    }

    session.players[drawerId].role = 'drawer';
    session.players[guesserId].role = 'guesser';

    const secret = getRandomWord();
    session.secretWord = secret;

    session.state = {
      round: 1,
      totalRounds: 4,
      drawerId,
      guesserId,
      secretWordMasked: maskWord(secret, 0),
      secretWordLength: secret.length,
      revealedHints: 0,
      doodleStrokes: [],
      isGuessed: false,
    };
    session.currentTurnPlayerId = drawerId;
  }
}

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
              secretWord: data.secretWord || null,
            };
            serverSessions.set(sessionId, session);
          }
        } catch (err) {
          console.warn('[GameServer] Error restoring session from Firestore:', err.message);
        }
      }

      const nowIso = new Date().toISOString();

      if (!session || session.status === 'finished' || session.status === 'abandoned') {
        // Initialize fresh game session in setup/lobby state
        let defaultRole = 'X';
        let defaultColor = '#ff3d5a';
        let defaultColorName = 'Ruby Red';

        if (gameType === 'tic-tac-toe') defaultRole = 'X';
        else if (gameType === 'connect-four') defaultRole = '#ff3d5a';
        else if (gameType === 'chess') defaultRole = 'w';
        else if (gameType === 'guess-from-doodle') defaultRole = 'drawer';

        session = {
          id: sessionId,
          coupleId,
          gameType,
          mode: 'online',
          status: 'setup',
          playerIds: [uid],
          players: {
            [uid]: {
              id: uid,
              displayName: displayName || 'Partner 1',
              avatarUrl: avatarUrl || '',
              role: defaultRole,
              color: defaultColor,
              colorName: defaultColorName,
              isConnected: true,
              choice: {
                role: defaultRole,
                color: defaultColor,
                colorName: defaultColorName,
                isReady: false,
              },
            },
          },
          currentTurnPlayerId: null,
          state: {},
          lobbyState: {
            conflict: null,
            allReady: false,
          },
          secretWord: null,
          result: null,
          actionSeq: 1,
          createdAt: nowIso,
          updatedAt: nowIso,
          completedResultRecorded: false,
        };

        serverSessions.set(sessionId, session);
      } else {
        // Session already exists
        if (!session.playerIds.includes(uid) && session.playerIds.length === 1) {
          // Second player joins lobby!
          session.playerIds.push(uid);

          let p2Role = 'O';
          let p2Color = '#ffd23a';
          let p2ColorName = 'Sunny Yellow';

          if (gameType === 'tic-tac-toe') p2Role = 'O';
          else if (gameType === 'connect-four') p2Role = '#ffd23a';
          else if (gameType === 'chess') p2Role = 'b';
          else if (gameType === 'guess-from-doodle') p2Role = 'guesser';

          session.players[uid] = {
            id: uid,
            displayName: displayName || 'Partner 2',
            avatarUrl: avatarUrl || '',
            role: p2Role,
            color: p2Color,
            colorName: p2ColorName,
            isConnected: true,
            choice: {
              role: p2Role,
              color: p2Color,
              colorName: p2ColorName,
              isReady: false,
            },
          };

          evaluateLobbyConflict(session);
          session.updatedAt = nowIso;
        } else if (session.players[uid]) {
          // Reconnecting player
          session.players[uid].displayName = displayName || session.players[uid].displayName;
          session.players[uid].isConnected = true;
        }
      }

      // Persist session to Firestore
      await persistSessionToFirestore(db, coupleId, session);

      // Emit session update to room
      const safeState = getSafeSessionPayload(session);
      io.to(socketRoom).emit('game:session_state', safeState);

      // Send private secret word to drawer if active Doodle Guess
      if (session.status === 'active' && gameType === 'guess-from-doodle' && session.secretWord && session.state.drawerId === uid) {
        socket.emit('game:secret_word', { secretWord: session.secretWord });
      }

      if (typeof callback === 'function') callback({ success: true, session: safeState });
    } catch (err) {
      console.error('[GameServer] game:join error:', err);
      if (typeof callback === 'function') callback({ error: err.message });
    }
  });

  // 2. Select Lobby Option / Role / Color
  socket.on('game:select_choice', async (payload, callback) => {
    try {
      const { sessionId, choice } = payload || {};
      const session = serverSessions.get(sessionId);
      if (!session || !session.playerIds.includes(uid)) {
        if (typeof callback === 'function') callback({ error: 'Session not found' });
        return;
      }
      if (session.status !== 'setup') {
        if (typeof callback === 'function') callback({ error: 'Choices are locked during an active match' });
        return;
      }

      if (!session.players[uid]) return;

      // Update choice and reset ready confirmation so both review the changes
      session.players[uid].choice = {
        ...(session.players[uid].choice || {}),
        ...(choice || {}),
        isReady: false,
      };

      evaluateLobbyConflict(session);

      session.actionSeq = (session.actionSeq || 0) + 1;
      session.updatedAt = new Date().toISOString();

      await persistSessionToFirestore(db, session.coupleId, session);

      const socketRoom = `game_room:${sessionId}`;
      io.to(socketRoom).emit('game:session_state', getSafeSessionPayload(session));

      if (typeof callback === 'function') callback({ success: true, session: getSafeSessionPayload(session) });
    } catch (err) {
      console.error('[GameServer] select_choice error:', err);
      if (typeof callback === 'function') callback({ error: err.message });
    }
  });

  // 3. Confirm Readiness in Lobby
  socket.on('game:confirm_ready', async (payload, callback) => {
    try {
      const { sessionId, isReady } = payload || {};
      const session = serverSessions.get(sessionId);
      if (!session || !session.playerIds.includes(uid)) {
        if (typeof callback === 'function') callback({ error: 'Session not found' });
        return;
      }
      if (session.status !== 'setup') {
        if (typeof callback === 'function') callback({ error: 'Match is already active' });
        return;
      }

      evaluateLobbyConflict(session);

      if (session.lobbyState?.conflict && isReady) {
        if (typeof callback === 'function') callback({ error: session.lobbyState.conflict });
        return;
      }

      if (!session.players[uid].choice) {
        session.players[uid].choice = { isReady: false };
      }
      session.players[uid].choice.isReady = Boolean(isReady);

      const p1 = session.playerIds[0];
      const p2 = session.playerIds[1];
      const p1Ready = Boolean(session.players[p1]?.choice?.isReady);
      const p2Ready = Boolean(session.players[p2]?.choice?.isReady);

      // Start the match if both partners confirmed ready without conflicts
      if (session.playerIds.length === 2 && p1Ready && p2Ready && !session.lobbyState?.conflict) {
        startGameWithChoices(session);
        session.status = 'active';
      }

      session.actionSeq = (session.actionSeq || 0) + 1;
      session.updatedAt = new Date().toISOString();

      await persistSessionToFirestore(db, session.coupleId, session);

      const socketRoom = `game_room:${sessionId}`;
      io.to(socketRoom).emit('game:session_state', getSafeSessionPayload(session));

      // If started and Doodle Guess, emit secret word privately to drawer
      if (session.status === 'active' && session.gameType === 'guess-from-doodle' && session.secretWord) {
        const drawerId = session.state.drawerId;
        const drawerSocket = Array.from(io.sockets.sockets.values()).find((s) => s.data.uid === drawerId);
        if (drawerSocket) {
          drawerSocket.emit('game:secret_word', { secretWord: session.secretWord });
        }
      }

      if (typeof callback === 'function') callback({ success: true, started: session.status === 'active' });
    } catch (err) {
      console.error('[GameServer] confirm_ready error:', err);
      if (typeof callback === 'function') callback({ error: err.message });
    }
  });

  // 4. Authoritative Move Action
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
      const playerColor = session.players[uid]?.color || playerRole;
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

        // Store player's assigned color (hex or code)
        session.state.grid[targetRow][col] = playerColor;
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

        // Track captured piece for animations
        if (moveResult.captured) {
          if (playerRole === 'w') {
            session.state.capturedBlack = [...(session.state.capturedBlack || []), moveResult.captured];
          } else {
            session.state.capturedWhite = [...(session.state.capturedWhite || []), moveResult.captured];
          }
        }

        session.state.fen = nextFen;
        session.state.turn = chess.turn();
        session.state.isCheck = isCheck;
        session.state.isCheckmate = isCheckmate;
        session.state.isDraw = isDrawGame;
        session.state.isStalemate = isStalemate;
        session.state.lastMove = {
          from: moveResult.from,
          to: moveResult.to,
          san: moveResult.san,
          captured: moveResult.captured || null,
        };
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

  // 5. Doodle Guess - Live Stroke Chunk Streaming
  socket.on('game:doodle_stroke_chunk', (payload) => {
    try {
      const { sessionId, chunk } = payload || {};
      const session = serverSessions.get(sessionId);
      if (!session || session.status !== 'active') return;
      if (session.state.drawerId !== uid) return;
      if (!chunk || !Array.isArray(chunk.points)) return;

      // If this finishes the stroke, persist the full stroke for reconnection history
      if (chunk.isComplete && chunk.fullStroke) {
        if (!session.state.doodleStrokes) session.state.doodleStrokes = [];
        if (session.state.doodleStrokes.length < 500) {
          session.state.doodleStrokes.push(chunk.fullStroke);
        }
      }

      const socketRoom = `game_room:${sessionId}`;
      socket.to(socketRoom).emit('game:doodle_stroke_chunk', { chunk });
    } catch (e) {
      console.warn('[GameServer] Stroke chunk error:', e);
    }
  });

  // 6. Doodle Guess - Legacy Stroke Fallback
  socket.on('game:doodle_stroke', (payload) => {
    try {
      const { sessionId, stroke } = payload || {};
      const session = serverSessions.get(sessionId);
      if (!session || session.status !== 'active') return;
      if (session.state.drawerId !== uid) return;
      if (!stroke || !Array.isArray(stroke.points) || stroke.points.length > 500) return;

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

  // 7. Doodle Guess - Clear Canvas
  socket.on('game:doodle_clear', ({ sessionId }) => {
    const session = serverSessions.get(sessionId);
    if (!session || session.state.drawerId !== uid) return;

    session.state.doodleStrokes = [];
    const socketRoom = `game_room:${sessionId}`;
    socket.to(socketRoom).emit('game:doodle_clear');
  });

  // 8. Doodle Guess - Hint Request
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

  // 9. Doodle Guess - Authoritative Guess Submission
  socket.on('game:guess', async (payload, callback) => {
    try {
      const { sessionId, guess } = payload || {};
      const session = serverSessions.get(sessionId);

      if (!session || session.status !== 'active' || !session.secretWord) {
        if (typeof callback === 'function') callback({ error: 'Invalid game session' });
        return;
      }

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

  // 10. Rematch Request (Keep Choices or Change Choices)
  socket.on('game:rematch', async ({ sessionId, mode }, callback) => {
    try {
      const session = serverSessions.get(sessionId);
      if (!session) {
        if (typeof callback === 'function') callback({ error: 'Session not found' });
        return;
      }

      const socketRoom = `game_room:${sessionId}`;
      const rematchMode = mode === 'change' ? 'change' : 'keep';

      if (rematchMode === 'change') {
        // Return session to setup lobby so both partners adjust options and re-ready
        session.status = 'setup';
        session.completedResultRecorded = false;
        session.result = null;
        session.rematchRequestedBy = null;
        session.rematchMode = null;

        for (const pid of session.playerIds) {
          if (session.players[pid]?.choice) {
            session.players[pid].choice.isReady = false;
          }
        }
        evaluateLobbyConflict(session);

        session.actionSeq = (session.actionSeq || 0) + 1;
        session.updatedAt = new Date().toISOString();

        await persistSessionToFirestore(db, session.coupleId, session);

        io.to(socketRoom).emit('game:session_state', getSafeSessionPayload(session));
        io.to(socketRoom).emit('game:rematch_setup');

        if (typeof callback === 'function') callback({ success: true, started: false, mode: 'change' });
        return;
      }

      // If mode is 'keep':
      if (session.rematchRequestedBy && session.rematchRequestedBy !== uid) {
        session.rematchRequestedBy = null;
        session.rematchMode = null;
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
          session.state = {
            grid: Array.from({ length: 6 }, () => Array(7).fill(null)),
            winningCells: null,
            lastDrop: null,
            playerColors: session.state.playerColors || {
              [p1]: session.players[p1].color,
              [p2]: session.players[p2].color,
            },
          };
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

          const drawerSocket = Array.from(io.sockets.sockets.values()).find((s) => s.data.uid === nextDrawer);
          if (drawerSocket) {
            drawerSocket.emit('game:secret_word', { secretWord: newSecret });
          }
        }

        session.actionSeq = (session.actionSeq || 0) + 1;
        session.updatedAt = new Date().toISOString();

        await persistSessionToFirestore(db, session.coupleId, session);

        io.to(socketRoom).emit('game:session_state', getSafeSessionPayload(session));
        io.to(socketRoom).emit('game:rematch_started');

        if (typeof callback === 'function') callback({ success: true, started: true });
      } else {
        session.rematchRequestedBy = uid;
        session.rematchMode = rematchMode;
        io.to(socketRoom).emit('game:rematch_requested', { requestedBy: uid, mode: rematchMode });
        if (typeof callback === 'function') callback({ success: true, requested: true });
      }
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message });
    }
  });

  // 11. Resign / Leave Game
  socket.on('game:leave', async ({ sessionId }, callback) => {
    try {
      const session = serverSessions.get(sessionId);
      if (session) {
        const otherPlayerId = session.playerIds.find((id) => id !== uid);

        if (session.status === 'active' && otherPlayerId && !session.completedResultRecorded) {
          session.status = 'finished';
          session.result = {
            winnerPlayerId: otherPlayerId,
            winnerName: session.players[otherPlayerId]?.displayName || 'Partner',
            outcome: 'resignation',
            completedAt: new Date().toISOString(),
          };
          session.completedResultRecorded = true;
          await recordAuthoritativeOnlineStats(db, admin, session);
        } else if (session.status === 'setup') {
          session.status = 'abandoned';
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

  // 12. Socket Disconnect Hook
  socket.on('disconnect', async () => {
    const sessionId = socket.data.currentGameSessionId;
    if (sessionId) {
      const session = serverSessions.get(sessionId);
      if (session && session.players[uid]) {
        session.players[uid].isConnected = false;
        const socketRoom = `game_room:${sessionId}`;
        socket.to(socketRoom).emit('game:session_state', getSafeSessionPayload(session));
      }
    }
  });
}

/**
 * Filter secret word from payload sent to clients to prevent cheating.
 */
function getSafeSessionPayload(session) {
  const safe = { ...session };
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
          currentData.currentWinStreak = 0;
        } else if (winnerId === pid) {
          currentData.wins = (currentData.wins || 0) + 1;
          const nextStreak = (currentData.currentWinStreak || 0) + 1;
          currentData.currentWinStreak = nextStreak;
          if (nextStreak > (currentData.bestWinStreak || 0)) {
            currentData.bestWinStreak = nextStreak;
          }
        } else {
          currentData.losses = (currentData.losses || 0) + 1;
          currentData.currentWinStreak = 0;
        }

        currentData.updatedAt = new Date().toISOString();
        transaction.set(statDocRef, currentData, { merge: true });
      });
    } catch (err) {
      console.warn(`[GameServer] Error updating stats for player ${pid}:`, err.message);
    }
  }
}
