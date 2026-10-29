import React, { useState } from 'react';
import type { GameSession, ConnectFourState } from '../../../lib/games/types';
import { C4_COLS, C4_ROWS } from '../../../lib/games/engines/connectFour';
import { GoogleIcon } from '../../../components/GoogleIcon';

interface ConnectFourBoardProps {
  session: GameSession;
  isMyTurn: boolean;
  myRole: string;
  onMove: (payload: { col: number }) => Promise<void>;
  onRematch: (options?: { mode?: 'keep' | 'change' }) => void;
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

  // Resolve color hex from session players or fallback
  const getCellColor = (val: string | null): string => {
    if (!val) return '';
    if (val.startsWith('#')) return val;
    if (state.playerColors && state.playerColors[val]) return state.playerColors[val];
    if (val === 'r') return '#ff3d5a';
    if (val === 'y') return '#ffd23a';
    return '#ff3d5a';
  };

  const currentTurnColor = currentTurnPlayer?.color || (currentTurnPlayer?.role === 'r' ? '#ff3d5a' : '#ffd23a');

  const handleColClick = async (col: number) => {
    if (isFinished || !isMyTurn || moving) return;
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
    <div className="flex flex-col items-center w-full max-w-[600px] mx-auto space-y-2 sm:space-y-3 min-w-0">
      {/* Header */}
      <div className="w-full text-center min-w-0">
        {!isFinished ? (
          <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-[var(--arcade-card)] border-[3px] border-[var(--arcade-ink)] rounded-2xl shadow-[3px_3px_0_var(--arcade-ink)] font-bold text-xs sm:text-base">
            <span
              className="w-4 h-4 sm:w-5 sm:h-5 rounded-full border-2 border-[var(--arcade-ink)] inline-block shadow-xs"
              style={{ backgroundColor: currentTurnColor }}
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
          <div className="inline-flex flex-col items-center gap-1 px-4 sm:px-5 py-2 sm:py-3 bg-[var(--arcade-c)] border-[3px] border-[var(--arcade-ink)] rounded-2xl shadow-[4px_4px_0_var(--arcade-ink)]">
            <span className="text-xl sm:text-2xl font-black">
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

      {/* Column Drop Touch Targets - Aligned Exactly with 7 Columns Below */}
      <div className="grid grid-cols-7 gap-1 sm:gap-2.5 w-full max-w-[600px] px-[9px] sm:px-[21px] min-w-0">
        {Array.from({ length: C4_COLS }).map((_, c) => (
          <button
            key={c}
            type="button"
            disabled={isFinished || (!isMyTurn && session.mode === 'online') || grid[0][c] !== null}
            onClick={() => handleColClick(c)}
            className="w-full py-1.5 sm:py-2.5 bg-[#2bb5d4] hover:bg-[#ffc233] text-white hover:text-[#2b2140] border-2 sm:border-3 border-[var(--arcade-ink)] rounded-lg sm:rounded-xl font-bold flex items-center justify-center transition-all disabled:opacity-30 disabled:pointer-events-none active:scale-95 shadow-[2px_2px_0_var(--arcade-ink)] cursor-pointer"
            aria-label={`Drop disc in column ${c + 1}`}
          >
            <GoogleIcon name="arrow_downward" size={16} />
          </button>
        ))}
      </div>

      {/* 6x7 Arcade Board - Substantially Larger on Desktop while Covering Most Phone Screen */}
      <div
        className={`p-1.5 sm:p-4 bg-[#2455d6] border-[3px] sm:border-[5px] border-[var(--arcade-ink)] rounded-2xl sm:rounded-3xl shadow-[4px_4px_0_var(--arcade-ink)] sm:shadow-[8px_8px_0_var(--arcade-ink)] w-full max-w-[600px] min-w-0 ${
          shaking ? 'arcade-shake' : ''
        }`}
      >
        <div className="grid grid-cols-7 gap-1 sm:gap-2.5">
          {grid.map((row, r) =>
            row.map((cell, c) => {
              const winning = isCellWinning(r, c);
              const isLast = lastDrop && lastDrop[0] === r && lastDrop[1] === c;
              const discColor = getCellColor(cell);

              return (
                <div
                  key={`${r}-${c}`}
                  onClick={() => handleColClick(c)}
                  className="aspect-square bg-[var(--arcade-bg)] dark:bg-[#1c1632] rounded-full border-2 sm:border-3 border-[var(--arcade-ink)] relative overflow-hidden cursor-pointer"
                >
                  {cell && (
                    <div
                      key={`c4-disc-${r}-${c}-${session.actionSeq}`}
                      className={`absolute inset-[7%] rounded-full border-2 border-[var(--arcade-ink)] shadow-inner transition-transform ${
                        isLast ? 'arcade-disc-drop' : ''
                      } ${winning ? 'arcade-dance ring-4 ring-white shadow-lg' : ''}`}
                      style={{ backgroundColor: discColor }}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

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
              <span>{rematchRequested ? 'Partner Ready! Tap Play' : 'Play Again'}</span>
            </button>
            <button
              type="button"
              onClick={() => onRematch({ mode: 'change' })}
              className="arcade-btn py-2 px-4 text-xs sm:text-sm bg-[#ffc233]"
            >
              <span>Change Colors 🎨</span>
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
