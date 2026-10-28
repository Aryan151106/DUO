import type { TicTacToeState } from '../types';

export const TTT_WINNING_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export function createInitialTicTacToeState(): TicTacToeState {
  return {
    board: Array(9).fill(null),
    winningLine: null,
  };
}

export function checkTicTacToeWinner(board: Array<string | null>): {
  winner: string | null;
  line: number[] | null;
  isDraw: boolean;
} {
  for (const line of TTT_WINNING_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line, isDraw: false };
    }
  }

  const isFull = board.every((cell) => cell !== null && cell !== '');
  return { winner: null, line: null, isDraw: isFull };
}

export function applyTicTacToeMove(
  state: TicTacToeState,
  cellIndex: number,
  symbol: string
): { nextState: TicTacToeState; winner: string | null; isDraw: boolean; line: number[] | null } {
  if (cellIndex < 0 || cellIndex > 8) {
    throw new Error('Invalid cell index');
  }
  if (state.board[cellIndex]) {
    throw new Error('Cell is already occupied');
  }
  if (state.winningLine) {
    throw new Error('Game is already over');
  }

  const newBoard = [...state.board];
  newBoard[cellIndex] = symbol;

  const { winner, line, isDraw } = checkTicTacToeWinner(newBoard);

  return {
    nextState: {
      board: newBoard,
      winningLine: line,
    },
    winner,
    isDraw,
    line,
  };
}
