import React, { useState } from 'react';
import type { GameSession, ConnectFourState } from '../../../lib/games/types';
import { C4_COLS, C4_ROWS } from '../../../lib/games/engines/connectFour';
import { GoogleIcon } from '../../../components/GoogleIcon';

interface ConnectFourBoardProps {
  session: GameSession;
  isMyTurn: boolean;
  myRole: string;
  onMove: (payload: { col: number }) => Promise<void>;
  onRematch: () => void;
  onLeave: () => void;
  rematchRequested: boolean;
}

export const ConnectFourBoard: React.FC<ConnectFourBoardProps> = ({
  session,
  isMyTurn,
  onMove,
  onRematch,
  onLeave,
  rematchRequested,
}) => {
  const [moving, setMoving] = useState(false);
  const [shaking, setShaking] = useState(false);
  const state = session.state as ConnectFourState;
  const grid = state.grid || Array.from({ length: C4_ROWS }, () => Array(C4_COLS).fill(null));
  const winningCells = state.winningCells || [];
  const lastDrop = state.lastDrop;
  const isFinished = session.status === 'finished';
  const result = session.result;

  const currentTurnPlayer = session.currentTurnPlayerId
    ? session.players[session.currentTurnPlayerId]
    : null;

  const handleColClick = async (col: number) => {
    if (isFinished || !isMyTurn || moving) return;
    // Check if column is already full
    if (grid[0][col] !== null) {
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
      return;
    }

    setMoving(true);
    try {
      await onMove({ col });
    } catch (e) {
      console.warn('Move failed:', e);
    } finally {
      setMoving(false);
    }
  };

  const isCellWinning = (r: number, c: number) => {
    return winningCells.some(([wr, wc]) => wr === r && wc === c);
  };

  return (
    <div className="flex flex-col items-center w-full max-w-md mx-auto space-y-4">
      {/* Header */}
      <div className="w-full text-center">
        {!isFinished ? (
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--arcade-card)] border-[3px] border-[var(--arcade-ink)] rounded-2xl shadow-[3px_3px_0_var(--arcade-ink)] font-bold text-base">
            <span
              className={`w-5 h-5 rounded-full border-2 border-[var(--arcade-ink)] inline-block ${
                currentTurnPlayer?.role === 'r' ? 'bg-[#ff3d5a]' : 'bg-[#ffd23a]'
              }`}
            />
            <span>
              {session.mode === 'online'
                ? isMyTurn
                  ? 'Your Turn!'
                  : `${currentTurnPlayer?.displayName || 'Partner'}'s Turn`
                : `${currentTurnPlayer?.displayName || 'Player'}'s Turn`}
            </span>
          </div>
        ) : (
          <div className="inline-flex flex-col items-center gap-1 px-5 py-3 bg-[var(--arcade-c)] border-[3px] border-[var(--arcade-ink)] rounded-2xl shadow-[4px_4px_0_var(--arcade-ink)]">
            <span className="text-2xl font-black">
              {result?.outcome === 'draw'
                ? '🤷 Board Full — It’s a Draw!'
                : `🎉 ${result?.winnerName || 'Winner'} Connected Four!`}
            </span>
            <span className="text-xs font-semibold opacity-80">
              {session.mode === 'local' ? 'Local Pass-and-Play' : 'Online Duo Match'}
            </span>
          </div>
        )}
      </div>

      {/* Column Drop Touch Targets */}
      <div className="grid grid-cols-7 gap-1.5 w-full max-w-[380px] px-2">
        {Array.from({ length: C4_COLS }).map((_, c) => (
          <button
            key={c}
            type="button"
            disabled={isFinished || (!isMyTurn && session.mode === 'online') || grid[0][c] !== null}
            onClick={() => handleColClick(c)}
            className="w-full py-1.5 bg-[#2bb5d4] hover:bg-[#ffc233] text-white hover:text-[#2b2140] border-2 border-[var(--arcade-ink)] rounded-xl font-bold flex items-center justify-center transition-all disabled:opacity-30 disabled:pointer-events-none active:scale-95 shadow-[2px_2px_0_var(--arcade-ink)] cursor-pointer"
            aria-label={`Drop disc in column ${c + 1}`}
          >
            <GoogleIcon name="arrow_downward" size={16} />
          </button>
        ))}
      </div>

      {/* 6x7 Arcade Board */}
      <div
        className={`p-3 bg-[#2455d6] border-[4px] border-[var(--arcade-ink)] rounded-3xl shadow-[6px_6px_0_var(--arcade-ink)] w-full max-w-[380px] ${
          shaking ? 'arcade-shake' : ''
        }`}
      >
        <div className="grid grid-cols-7 gap-1.5">
          {grid.map((row, r) =>
            row.map((cell, c) => {
              const winning = isCellWinning(r, c);
              const isLast = lastDrop && lastDrop[0] === r && lastDrop[1] === c;

              return (
                <div
                  key={`${r}-${c}`}
                  onClick={() => handleColClick(c)}
                  className="aspect-square bg-[var(--arcade-bg)] dark:bg-[#1c1632] rounded-full border-2 border-[var(--arcade-ink)] relative overflow-hidden cursor-pointer"
                >
                  {cell && (
                    <div
                      className={`absolute inset-[7%] rounded-full border-2 border-[var(--arcade-ink)] shadow-inner transition-transform ${
                        cell === 'r' ? 'bg-[#ff3d5a]' : 'bg-[#ffd23a]'
                      } ${isLast ? 'arcade-disc-drop' : ''} ${
                        winning ? 'arcade-dance ring-4 ring-white shadow-lg' : ''
                      }`}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

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
