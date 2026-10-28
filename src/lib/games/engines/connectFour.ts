import type { ConnectFourState } from '../types';

export const C4_ROWS = 6;
export const C4_COLS = 7;

export function createInitialConnectFourState(): ConnectFourState {
  return {
    grid: Array.from({ length: C4_ROWS }, () => Array(C4_COLS).fill(null)),
    winningCells: null,
    lastDrop: null,
  };
}

export function checkConnectFourWin(
  grid: Array<Array<'r' | 'y' | null>>,
  r: number,
  c: number
): Array<[number, number]> | null {
  const color = grid[r][c];
  if (!color) return null;

  const directions: Array<[number, number]> = [
    [0, 1],  // Horizontal
    [1, 0],  // Vertical
    [1, 1],  // Diagonal down-right
    [1, -1], // Diagonal down-left
  ];

  for (const [dr, dc] of directions) {
    const sequence: Array<[number, number]> = [[r, c]];

    // Step positive direction
    for (let step = 1; step <= 3; step++) {
      const nr = r + dr * step;
      const nc = c + dc * step;
      if (nr >= 0 && nr < C4_ROWS && nc >= 0 && nc < C4_COLS && grid[nr][nc] === color) {
        sequence.push([nr, nc]);
      } else {
        break;
      }
    }

    // Step negative direction
    for (let step = 1; step <= 3; step++) {
      const nr = r - dr * step;
      const nc = c - dc * step;
      if (nr >= 0 && nr < C4_ROWS && nc >= 0 && nc < C4_COLS && grid[nr][nc] === color) {
        sequence.push([nr, nc]);
      } else {
        break;
      }
    }

    if (sequence.length >= 4) {
      return sequence;
    }
  }

  return null;
}

export function applyConnectFourMove(
  state: ConnectFourState,
  col: number,
  color: 'r' | 'y'
): {
  nextState: ConnectFourState;
  winner: 'r' | 'y' | null;
  isDraw: boolean;
  winningCells: Array<[number, number]> | null;
} {
  if (col < 0 || col >= C4_COLS) {
    throw new Error('Invalid column');
  }
  if (state.winningCells) {
    throw new Error('Game is already over');
  }

  // Find lowest available row in column
  let targetRow = -1;
  for (let r = C4_ROWS - 1; r >= 0; r--) {
    if (!state.grid[r][col]) {
      targetRow = r;
      break;
    }
  }

  if (targetRow === -1) {
    throw new Error('Column is full');
  }

  const newGrid = state.grid.map((row) => [...row]);
  newGrid[targetRow][col] = color;

  const winningCells = checkConnectFourWin(newGrid, targetRow, col);
  const isFull = newGrid[0].every((cell) => cell !== null);
  const isDraw = !winningCells && isFull;

  return {
    nextState: {
      grid: newGrid,
      winningCells,
      lastDrop: [targetRow, col],
    },
    winner: winningCells ? color : null,
    isDraw,
    winningCells,
  };
}
