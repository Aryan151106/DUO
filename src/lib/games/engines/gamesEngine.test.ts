import { describe, it, expect } from 'vitest';
import {
  createInitialTicTacToeState,
  checkTicTacToeWinner,
  applyTicTacToeMove,
} from './tictactoe';
import {
  createInitialConnectFourState,
  applyConnectFourMove,
} from './connectFour';
import {
  createInitialChessState,
  applyChessMove,
  isPromotionMove,
} from './chessEngine';
import {
  recordLocalGameResult,
} from '../localGameStore';
import type { GameSession } from '../types';

describe('Tic-Tac-Toe Engine', () => {
  it('detects row wins, column wins, and diagonal wins', () => {
    // Row 1 win
    const board = ['X', 'X', 'X', null, 'O', 'O', null, null, null];
    const res = checkTicTacToeWinner(board);
    expect(res.winner).toBe('X');
    expect(res.line).toEqual([0, 1, 2]);
    expect(res.isDraw).toBe(false);
  });

  it('detects a full board draw', () => {
    const drawBoard = ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'];
    const res = checkTicTacToeWinner(drawBoard);
    expect(res.winner).toBe(null);
    expect(res.isDraw).toBe(true);
  });

  it('rejects moves on occupied cells', () => {
    const state = createInitialTicTacToeState();
    const afterFirst = applyTicTacToeMove(state, 4, 'X').nextState;
    expect(() => applyTicTacToeMove(afterFirst, 4, 'O')).toThrow();
  });
});

describe('Connect Four Engine', () => {
  it('drops disc to the lowest row in column', () => {
    let state = createInitialConnectFourState();
    // Drop in col 3 -> lands in row 5
    const step1 = applyConnectFourMove(state, 3, 'r');
    expect(step1.nextState.grid[5][3]).toBe('r');
    expect(step1.nextState.lastDrop).toEqual([5, 3]);

    // Drop second disc in col 3 -> lands in row 4
    const step2 = applyConnectFourMove(step1.nextState, 3, 'y');
    expect(step2.nextState.grid[4][3]).toBe('y');
    expect(step2.nextState.lastDrop).toEqual([4, 3]);
  });

  it('detects 4 in a horizontal row', () => {
    let state = createInitialConnectFourState();
    // Drop 4 red discs in columns 0, 1, 2, 3
    state = applyConnectFourMove(state, 0, 'r').nextState;
    state = applyConnectFourMove(state, 1, 'r').nextState;
    state = applyConnectFourMove(state, 2, 'r').nextState;
    const finalMove = applyConnectFourMove(state, 3, 'r');
    expect(finalMove.winner).toBe('r');
    expect(finalMove.winningCells?.length).toBe(4);
  });

  it('rejects dropping into a full column', () => {
    let state = createInitialConnectFourState();
    const colors: Array<'r' | 'y'> = ['r', 'r', 'y', 'y', 'r', 'y'];
    for (const c of colors) {
      state = applyConnectFourMove(state, 0, c).nextState;
    }
    expect(() => applyConnectFourMove(state, 0, 'r')).toThrow('Column is full');
  });
});

describe('Chess Engine (chess.js)', () => {
  it('initializes standard starting position', () => {
    const state = createInitialChessState();
    expect(state.turn).toBe('w');
    expect(state.isCheck).toBe(false);
  });

  it('applies valid move and switches turn', () => {
    const state = createInitialChessState();
    const res = applyChessMove(state, 'e2', 'e4');
    expect(res.nextState.turn).toBe('b');
    expect(res.nextState.lastMove?.san).toBe('e4');
  });

  it('detects promotion moves', () => {
    // Pawn on rank 7 ready to promote
    const fen = '8/4P3/8/8/8/8/8/k6K w - - 0 1';
    expect(isPromotionMove(fen, 'e7', 'e8')).toBe(true);
    expect(isPromotionMove(fen, 'e7', 'd8')).toBe(false);
  });
});

describe('Local Game Store & Streak Recording', () => {
  it('updates winning streaks, resets on loss or draw', () => {
    const dummySession: GameSession = {
      id: 'local-test',
      coupleId: 'local',
      gameType: 'tic-tac-toe',
      mode: 'local',
      status: 'finished',
      playerIds: ['p1', 'p2'],
      players: {
        p1: { id: 'p1', displayName: 'Aryan', role: 'X' },
        p2: { id: 'p2', displayName: 'Vidhi', role: 'O' },
      },
      currentTurnPlayerId: 'p1',
      state: createInitialTicTacToeState(),
      actionSeq: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // p1 wins match 1
    const res1 = recordLocalGameResult(dummySession, 'p1', 'win');
    expect(res1.p1Stats.wins).toBeGreaterThanOrEqual(1);
    expect(res1.p1Stats.currentWinStreak).toBeGreaterThanOrEqual(1);

    // draw in match 2 -> resets current streak to 0, best streak preserved
    const res2 = recordLocalGameResult(dummySession, null, 'draw');
    expect(res2.p1Stats.currentWinStreak).toBe(0);
    expect(res2.p1Stats.bestWinStreak).toBeGreaterThanOrEqual(1);
  });
});
