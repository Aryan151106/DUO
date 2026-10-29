import React, { useState, useEffect } from 'react';
import { Chess } from 'chess.js';
import type { GameSession, ChessState } from '../../../lib/games/types';
import { getLegalMovesForSquare, isPromotionMove } from '../../../lib/games/engines/chessEngine';
import {
  GoofyChessPiece,
} from '../../../lib/games/arcadeAssets';
import { GoogleIcon } from '../../../components/GoogleIcon';
import { sfx } from '../../../lib/games/arcadeAudio';

interface ChessBoardProps {
  session: GameSession;
  isMyTurn: boolean;
  myRole: string;
  onMove: (payload: { from: string; to: string; promotion?: string }) => Promise<void>;
  onRematch: (options?: { mode?: 'keep' | 'change' }) => void;
  onLeave: () => void;
  rematchRequested: boolean;
}

export const ChessBoard: React.FC<ChessBoardProps> = ({
  session,
  isMyTurn,
  myRole,
  onMove,
  onRematch,
  onLeave,
  rematchRequested,
}) => {
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [legalMoves, setLegalMoves] = useState<Array<{ from: string; to: string }>>([]);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(null);
  const [ghostPiece, setGhostPiece] = useState<{
    type: string;
    isWhite: boolean;
    square: string;
    dx: number;
  } | null>(null);
  const [boardShaking, setBoardShaking] = useState(false);
  const [boardSpinning, setBoardSpinning] = useState(false);
  const [lastLandedSquare, setLastLandedSquare] = useState<string | null>(null);
  const [kmood, setKmood] = useState<{ w: string; b: string }>({ w: '', b: '' });
  const [moving, setMoving] = useState(false);

  const state = session.state as ChessState;
  const isFinished = session.status === 'finished';
  const result = session.result;

  const chess = React.useMemo(() => new Chess(state.fen), [state.fen]);
  const board = chess.board(); // 8x8 array of Piece | null
  const turn = chess.turn(); // 'w' | 'b'

  const currentTurnPlayer = session.currentTurnPlayerId
    ? session.players[session.currentTurnPlayerId]
    : null;

  // Sound effects on check, checkmate, stalemate
  useEffect(() => {
    if (isFinished) {
      if (state.isCheckmate) {
        sfx('win');
        setBoardSpinning(true);
        const timer = setTimeout(() => setBoardSpinning(false), 1300);
        return () => clearTimeout(timer);
      } else if (state.isStalemate || state.isDraw) {
        sfx('sad');
      }
    } else if (state.isCheck) {
      const timer = setTimeout(() => sfx('alarm'), 500);
      return () => clearTimeout(timer);
    }
  }, [isFinished, state.isCheckmate, state.isStalemate, state.isDraw, state.isCheck]);

  // Board orientation: White at bottom for white player, flipped for black
  const isFlipped = session.mode === 'online' && myRole === 'b';

  const rows = isFlipped ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const cols = isFlipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

  const handleSquareClick = async (squareName: string, piece: any) => {
    if (isFinished || moving || (!isMyTurn && session.mode === 'online')) return;

    // If already selected a square and clicking a legal target square
    if (selectedSquare) {
      const isLegal = legalMoves.some((m) => m.to === squareName);
      if (isLegal) {
        // Check if pawn promotion
        if (isPromotionMove(state.fen, selectedSquare, squareName)) {
          setPendingPromotion({ from: selectedSquare, to: squareName });
          return;
        }

        executeMove(selectedSquare, squareName);
        return;
      }
    }

    // Select piece of current turn's color
    if (piece && piece.color === turn) {
      if (session.mode === 'online' && piece.color !== myRole) {
        return;
      }

      setSelectedSquare(squareName);
      sfx('pop');
      const moves = getLegalMovesForSquare(state.fen, squareName);
      setLegalMoves(moves);
    } else {
      setSelectedSquare(null);
      setLegalMoves([]);
    }
  };

  const executeMove = async (from: string, to: string, promotion: string = 'q') => {
    setMoving(true);
    setSelectedSquare(null);
    setLegalMoves([]);
    setPendingPromotion(null);

    const wasCheck = state.isCheck;
    const moverPiece = chess.get(from as any);
    const targetPiece = chess.get(to as any);

    // Trigger squash landing animation
    setLastLandedSquare(to);
    setTimeout(() => setLastLandedSquare(null), 450);

    // Capture sound & animation or normal drop sound
    if (targetPiece) {
      sfx('bonk');
      const capType = targetPiece.type;
      setTimeout(() => {
        sfx(capType === 'p' ? 'quack' : capType === 'q' ? 'wah' : 'slide');
      }, 150);

      const dx = Math.random() * 240 - 120;
      setGhostPiece({
        type: targetPiece.type,
        isWhite: targetPiece.color === 'w',
        square: to,
        dx,
      });
      setBoardShaking(true);
      setTimeout(() => setBoardShaking(false), 600);
      setTimeout(() => {
        setGhostPiece(null);
      }, 1600);
    } else {
      sfx('plop');
    }

    // King check escape mood reaction
    if (wasCheck && moverPiece) {
      const esc = moverPiece.type === 'k';
      const moverColor = moverPiece.color as 'w' | 'b';
      setKmood((prev) => ({ ...prev, [moverColor]: esc ? 'grin' : 'relief' }));
      sfx(esc ? 'evil' : 'phew');
      setTimeout(() => {
        setKmood((prev) => ({ ...prev, [moverColor]: '' }));
      }, 2600);
    }

    try {
      await onMove({ from, to, promotion });
    } catch (e) {
      console.warn('Chess move rejected:', e);
    } finally {
      setMoving(false);
    }
  };

  return (
    <div className="flex flex-col items-center w-full max-w-[580px] mx-auto space-y-2 sm:space-y-2.5 relative min-w-0">
      {/* Header Info */}
      <div className="w-full text-center min-w-0">
        {!isFinished ? (
          <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-[var(--arcade-card)] border-[3px] border-[var(--arcade-ink)] rounded-2xl shadow-[3px_3px_0_var(--arcade-ink)] font-bold text-xs sm:text-base">
            <span
              className={`w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full border-2 border-[var(--arcade-ink)] inline-block ${
                turn === 'w' ? 'bg-[#fff4d9]' : 'bg-[#6a4fb0]'
              }`}
            />
            <span>
              {session.mode === 'online'
                ? isMyTurn
                  ? 'Your Turn!'
                  : `${currentTurnPlayer?.displayName || 'Partner'}'s Turn`
                : `${turn === 'w' ? 'White' : 'Black'} to Move`}
            </span>
            {state.isCheck && (
              <span className="px-2 py-0.5 bg-[#ff4d4d] text-white rounded-lg text-xs font-black animate-pulse arcade-shake">
                CHECK! 😱
              </span>
            )}
          </div>
        ) : (
          <div className="inline-flex flex-col items-center gap-1 px-4 sm:px-5 py-2 sm:py-3 bg-[var(--arcade-c)] border-[3px] border-[var(--arcade-ink)] rounded-2xl shadow-[4px_4px_0_var(--arcade-ink)]">
            <span className="text-lg sm:text-2xl font-black">
              {state.isCheckmate
                ? `👑 Checkmate! ${result?.winnerName || 'Winner'} Wins!`
                : '🤝 Draw! Stalemate!'}
            </span>
            <span className="text-xs font-semibold opacity-80">
              {session.mode === 'local' ? 'Local Pass-and-Play' : 'Online Duo Match'}
            </span>
          </div>
        )}
      </div>

      {/* Captured Pieces Graveyard Top */}
      <div className="flex items-center justify-between w-full px-1 text-xs font-bold text-[var(--arcade-ink)] min-w-0">
        <div className="flex items-center gap-0.5 sm:gap-1 flex-wrap max-w-[200px] sm:max-w-[240px]">
          {state.capturedBlack?.map((p, i) => (
            <span key={i} className="w-4 h-4 sm:w-6 sm:h-6 inline-block opacity-85">
              <GoofyChessPiece type={p} isWhite={false} />
            </span>
          ))}
        </div>
        <div className="flex items-center gap-0.5 sm:gap-1 flex-wrap max-w-[200px] sm:max-w-[240px] justify-end">
          {state.capturedWhite?.map((p, i) => (
            <span key={i} className="w-4 h-4 sm:w-6 sm:h-6 inline-block opacity-85">
              <GoofyChessPiece type={p} isWhite={true} />
            </span>
          ))}
        </div>
      </div>

      {/* 8x8 Chessboard - Substantially Larger on Desktop while Covering Most Phone Screen */}
      <div
        className={`relative p-1 sm:p-3 bg-[#2b2140] border-[3px] sm:border-[5px] border-[var(--arcade-ink)] rounded-2xl shadow-[4px_4px_0_var(--arcade-ink)] sm:shadow-[8px_8px_0_var(--arcade-ink)] w-full aspect-square max-w-[580px] min-w-0 ${
          boardShaking ? 'arcade-board-shake' : ''
        } ${boardSpinning ? 'arcade-b360' : ''}`}
      >
        <div className="grid grid-cols-8 grid-rows-8 w-full h-full border-2 border-[var(--arcade-ink)] rounded-lg overflow-hidden relative">
          {rows.map((r) =>
            cols.map((c) => {
              const file = String.fromCharCode('a'.charCodeAt(0) + c);
              const rank = (r + 1).toString();
              const squareName = `${file}${rank}`;
              const piece = board[7 - r][c];
              const isDark = (r + c) % 2 === 0;
              const isSelected = selectedSquare === squareName;
              const isLegal = legalMoves.some((m) => m.to === squareName);
              const isCheckKing =
                state.isCheck && piece && piece.type === 'k' && piece.color === turn;
              const hasGhost = ghostPiece && ghostPiece.square === squareName;

              // Compute movement delta if this square is the destination of the last move
              const isLastMoveDestination = state.lastMove?.to === squareName;
              let moveDx = '0%';
              let moveDy = '0%';
              if (isLastMoveDestination && state.lastMove) {
                const fromFile = state.lastMove.from.charCodeAt(0) - 97;
                const fromRank = parseInt(state.lastMove.from[1], 10) - 1;
                const toFile = state.lastMove.to.charCodeAt(0) - 97;
                const toRank = parseInt(state.lastMove.to[1], 10) - 1;

                const fromColIdx = isFlipped ? 7 - fromFile : fromFile;
                const fromRowIdx = isFlipped ? fromRank : 7 - fromRank;

                const toColIdx = isFlipped ? 7 - toFile : toFile;
                const toRowIdx = isFlipped ? toRank : 7 - toRank;

                const deltaCol = fromColIdx - toColIdx;
                const deltaRow = fromRowIdx - toRowIdx;

                moveDx = `${deltaCol * 100}%`;
                moveDy = `${deltaRow * 100}%`;
              }

              // Compute dynamic King mood
              const kingMood =
                piece && piece.type === 'k'
                  ? (kmood[piece.color as 'w' | 'b'] || (isCheckKing ? 'scared' : ''))
                  : '';
              const idleDelay = `${((r * 3 + c * 5) % 9) * 0.55}s`;

              // Ensure clean, prioritized animation on piece without class conflict
              const pieceAnimClass = isSelected
                ? 'arcade-chess-bounce'
                : isLastMoveDestination
                ? 'arcade-piece-moving'
                : lastLandedSquare === squareName
                ? 'arcade-land'
                : kingMood === 'scared'
                ? 'arcade-king-scared'
                : kingMood === 'relief'
                ? 'arcade-king-relief'
                : kingMood === 'grin'
                ? 'arcade-king-grin'
                : isCheckKing
                ? 'arcade-shake'
                : 'arcade-piece-idle';

              return (
                <div
                  key={squareName}
                  onClick={() => handleSquareClick(squareName, piece)}
                  className={`aspect-square relative flex items-center justify-center cursor-pointer transition-colors ${
                    isDark ? 'bg-[var(--arcade-s2)]' : 'bg-[var(--arcade-s1)]'
                  } ${isSelected ? '!bg-[#ffe066] ring-2 ring-yellow-500 z-10' : ''} ${
                    isCheckKing ? '!bg-[#ff5555] animate-pulse' : ''
                  }`}
                >
                  {piece && (
                    <div
                      key={`piece-${piece.color}-${piece.type}-${squareName}-${state.lastMove?.san || ''}-${kingMood}-${isSelected ? 'sel' : 'norm'}`}
                      style={
                        {
                          ...(isLastMoveDestination ? { '--move-dx': moveDx, '--move-dy': moveDy } : {}),
                          '--d': idleDelay,
                        } as React.CSSProperties
                      }
                      className={`arcade-chess-piece ${pieceAnimClass}`}
                    >
                      <GoofyChessPiece
                        type={piece.type}
                        isWhite={piece.color === 'w'}
                        mood={kingMood as any}
                      />
                    </div>
                  )}

                  {/* Ghost Piece Flyaway on Capture */}
                  {hasGhost && (
                    <div
                      className="arcade-ghost w-[85%] h-[85%]"
                      style={{ '--dx': `${ghostPiece.dx}px` } as React.CSSProperties}
                    >
                      <GoofyChessPiece type={ghostPiece.type} isWhite={ghostPiece.isWhite} />
                    </div>
                  )}

                  {/* Legal move indicator dot */}
                  {isLegal && (
                    <div className="absolute w-3.5 h-3.5 sm:w-4 sm:h-4 bg-[#2bb5d4] border border-[var(--arcade-ink)] rounded-full opacity-90 shadow pointer-events-none arcade-move-dot" />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Pawn Promotion Modal Dialog */}
      {pendingPromotion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="arcade-card p-5 max-w-xs w-full text-center space-y-4">
            <h3 className="font-extrabold text-lg text-[var(--arcade-ink)]">
              Promote Your Pawn! 👑
            </h3>
            <p className="text-xs text-[var(--arcade-ink)] opacity-80">
              Pick your piece upgrade:
            </p>
            <div className="grid grid-cols-4 gap-2">
              {[
                { type: 'q', label: 'Queen' },
                { type: 'r', label: 'Rook' },
                { type: 'b', label: 'Bishop' },
                { type: 'n', label: 'Knight' },
              ].map(({ type, label }) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => executeMove(pendingPromotion.from, pendingPromotion.to, type)}
                  className="arcade-btn p-2 flex flex-col items-center justify-center gap-1"
                >
                  <div className="w-8 h-8">
                    <GoofyChessPiece type={type} isWhite={turn === 'w'} />
                  </div>
                  <span className="text-[10px]">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Footer Actions / Rematch Options */}
      <div className="flex items-center justify-center gap-2 sm:gap-3 w-full pt-2 flex-wrap">
        {isFinished ? (
          <>
            <button
              type="button"
              onClick={() => onRematch({ mode: 'keep' })}
              className="arcade-btn arcade-btn-pink text-xs sm:text-sm py-2 px-4"
            >
              <GoogleIcon name="replay" size={16} />
              <span>{rematchRequested ? 'Partner Ready! Tap Play' : 'Play Again (Swap Sides)'}</span>
            </button>
            <button
              type="button"
              onClick={() => onRematch({ mode: 'change' })}
              className="arcade-btn py-2 px-4 text-xs sm:text-sm bg-[#ffc233]"
            >
              <span>Change Sides ♟️</span>
            </button>
          </>
        ) : null}

        <button
          type="button"
          onClick={onLeave}
          className="arcade-btn text-xs sm:text-sm py-2 px-4 bg-white dark:bg-gray-800"
        >
          <GoogleIcon name="arrow_back" size={16} />
          <span>Exit Game</span>
        </button>
      </div>
    </div>
  );
};
