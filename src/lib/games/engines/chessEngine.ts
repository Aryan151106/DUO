import { Chess } from 'chess.js';
import type { ChessState } from '../types';

export function createInitialChessState(): ChessState {
  const chess = new Chess();
  return {
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
}

export function computeCapturedPieces(fen: string): { capturedWhite: string[]; capturedBlack: string[] } {
  const initialCounts = {
    p: 8, r: 2, n: 2, b: 2, q: 1,
    P: 8, R: 2, N: 2, B: 2, Q: 1,
  };

  const currentCounts: Record<string, number> = {
    p: 0, r: 0, n: 0, b: 0, q: 0,
    P: 0, R: 0, N: 0, B: 0, Q: 0,
  };

  const placement = fen.split(' ')[0];
  for (const char of placement) {
    if (currentCounts[char] !== undefined) {
      currentCounts[char]++;
    }
  }

  const capturedWhite: string[] = []; // Black captured White's pieces
  const capturedBlack: string[] = []; // White captured Black's pieces

  const whitePieces: Array<'P' | 'R' | 'N' | 'B' | 'Q'> = ['P', 'R', 'N', 'B', 'Q'];
  for (const piece of whitePieces) {
    const missing = Math.max(0, initialCounts[piece] - currentCounts[piece]);
    for (let i = 0; i < missing; i++) {
      capturedWhite.push(piece);
    }
  }

  const blackPieces: Array<'p' | 'r' | 'n' | 'b' | 'q'> = ['p', 'r', 'n', 'b', 'q'];
  for (const piece of blackPieces) {
    const missing = Math.max(0, initialCounts[piece] - currentCounts[piece]);
    for (let i = 0; i < missing; i++) {
      capturedBlack.push(piece);
    }
  }

  return { capturedWhite, capturedBlack };
}

export function getLegalMovesForSquare(fen: string, square: string): Array<{ from: string; to: string; promotion?: string }> {
  try {
    const chess = new Chess(fen);
    const moves = chess.moves({ square: square as any, verbose: true });
    return moves.map((m) => ({
      from: m.from,
      to: m.to,
      promotion: m.promotion,
    }));
  } catch {
    return [];
  }
}

export function isPromotionMove(fen: string, from: string, to: string): boolean {
  try {
    const chess = new Chess(fen);
    const moves = chess.moves({ square: from as any, verbose: true });
    return moves.some((m) => m.to === to && !!m.promotion);
  } catch {
    return false;
  }
}

export function applyChessMove(
  state: ChessState,
  from: string,
  to: string,
  promotion: 'q' | 'r' | 'b' | 'n' = 'q'
): {
  nextState: ChessState;
  winner: 'w' | 'b' | null;
  isDraw: boolean;
  capturedPiece: string | null;
} {
  const chess = new Chess(state.fen);

  const moveResult = chess.move({
    from,
    to,
    promotion,
  });

  if (!moveResult) {
    throw new Error('Illegal move');
  }

  const nextFen = chess.fen();
  const { capturedWhite, capturedBlack } = computeCapturedPieces(nextFen);

  const isCheck = chess.isCheck();
  const isCheckmate = chess.isCheckmate();
  const isDraw = chess.isDraw();
  const isStalemate = chess.isStalemate();

  let winner: 'w' | 'b' | null = null;
  if (isCheckmate) {
    // If it's checkmate, the player whose turn it WAS won
    winner = moveResult.color;
  }

  const nextState: ChessState = {
    fen: nextFen,
    turn: chess.turn(),
    isCheck,
    isCheckmate,
    isDraw,
    isStalemate,
    lastMove: {
      from: moveResult.from,
      to: moveResult.to,
      san: moveResult.san,
    },
    capturedWhite,
    capturedBlack,
    moveHistory: [...state.moveHistory, moveResult.san],
  };

  return {
    nextState,
    winner,
    isDraw,
    capturedPiece: moveResult.captured || null,
  };
}
