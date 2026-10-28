import React, { useState } from 'react';
import { Chess } from 'chess.js';
import type { GameSession, ChessState } from '../../../lib/games/types';
import { getLegalMovesForSquare, isPromotionMove } from '../../../lib/games/engines/chessEngine';
import { GoofyChessPiece } from '../../../lib/games/arcadeAssets';
import { GoogleIcon } from '../../../components/GoogleIcon';

interface ChessBoardProps {
  session: GameSession;
  isMyTurn: boolean;
  myRole: string;
  onMove: (payload: { from: string; to: string; promotion?: string }) => Promise<void>;
  onRematch: () => void;
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

  // Board orientation: White at bottom for player 1 / white player, flipped for black
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

    try {
      await onMove({ from, to, promotion });
    } catch (e) {
      console.warn('Chess move rejected:', e);
    } finally {
      setMoving(false);
    }
  };

  return (
    <div className="flex flex-col items-center w-full max-w-[min(98vw,560px)] mx-auto space-y-2 relative px-0.5 sm:px-0">
      {/* Header Info */}
      <div className="w-full text-center">
        {!isFinished ? (
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--arcade-card)] border-[3px] border-[var(--arcade-ink)] rounded-2xl shadow-[3px_3px_0_var(--arcade-ink)] font-bold text-sm sm:text-base">
            <span
              className={`w-4 h-4 rounded-full border-2 border-[var(--arcade-ink)] inline-block ${
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
              <span className="px-2 py-0.5 bg-[#ff4d4d] text-white rounded-lg text-xs font-black animate-pulse">
                CHECK! 😱
              </span>
            )}
          </div>
        ) : (
          <div className="inline-flex flex-col items-center gap-1 px-5 py-3 bg-[var(--arcade-c)] border-[3px] border-[var(--arcade-ink)] rounded-2xl shadow-[4px_4px_0_var(--arcade-ink)]">
            <span className="text-xl sm:text-2xl font-black">
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
      <div className="flex items-center justify-between w-full px-2 text-xs font-bold text-[var(--arcade-ink)]">
        <div className="flex items-center gap-1 flex-wrap max-w-[200px]">
          {state.capturedBlack?.map((p, i) => (
            <span key={i} className="w-5 h-5 inline-block opacity-80">
              <GoofyChessPiece type={p} isWhite={false} />
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1 flex-wrap max-w-[200px] justify-end">
          {state.capturedWhite?.map((p, i) => (
            <span key={i} className="w-5 h-5 inline-block opacity-80">
              <GoofyChessPiece type={p} isWhite={true} />
            </span>
          ))}
        </div>
      </div>

      {/* 8x8 Chessboard */}
      <div className="relative p-1.5 sm:p-2.5 bg-[#2b2140] border-[3px] sm:border-[4px] border-[var(--arcade-ink)] rounded-2xl shadow-[4px_4px_0_var(--arcade-ink)] sm:shadow-[6px_6px_0_var(--arcade-ink)] w-full aspect-square max-w-[min(98vw,520px)]">
        <div className="grid grid-cols-8 grid-rows-8 w-full h-full border-2 border-[var(--arcade-ink)] rounded-lg overflow-hidden">
          {rows.map((r) =>
            cols.map((c) => {
              const file = String.fromCharCode('a'.charCodeAt(0) + c);
              const rank = (r + 1).toString();
              const squareName = `${file}${rank}`;
              const piece = board[7 - r][c]; // chess.js board uses [0..7] where 0 is rank 8
              const isDark = (r + c) % 2 === 0;
              const isSelected = selectedSquare === squareName;
              const isLegal = legalMoves.some((m) => m.to === squareName);
              const isCheckKing =
                state.isCheck && piece && piece.type === 'k' && piece.color === turn;

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
                    <div className="w-[90%] h-[90%] transition-transform hover:scale-110 active:scale-95">
                      <GoofyChessPiece type={piece.type} isWhite={piece.color === 'w'} />
                    </div>
                  )}

                  {/* Legal move indicator dot */}
                  {isLegal && (
                    <div className="absolute w-3.5 h-3.5 bg-[#2bb5d4] border border-[var(--arcade-ink)] rounded-full opacity-90 shadow pointer-events-none" />
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

      {/* Footer Actions */}
      <div className="flex items-center justify-center gap-3 w-full pt-2">
        {isFinished ? (
          <button
            type="button"
            onClick={onRematch}
            className="arcade-btn arcade-btn-pink text-sm sm:text-base"
          >
            <GoogleIcon name="replay" size={18} />
            <span>{rematchRequested ? 'Partner Ready! Tap for Rematch' : 'Play Again'}</span>
          </button>
        ) : null}

        <button
          type="button"
          onClick={onLeave}
          className="arcade-btn text-sm sm:text-base bg-white dark:bg-gray-800"
        >
          <GoogleIcon name="arrow_back" size={18} />
          <span>Leave</span>
        </button>
      </div>
    </div>
  );
};
