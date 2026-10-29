import React, { useState, useEffect } from 'react';
import type { GameSession, TicTacToeState } from '../../../lib/games/types';
import { GoogleIcon } from '../../../components/GoogleIcon';
import { sfx } from '../../../lib/games/arcadeAudio';

interface TicTacToeBoardProps {
  session: GameSession;
  isMyTurn: boolean;
  myRole: string;
  onMove: (payload: { cellIndex: number }) => Promise<void>;
  onRematch: (options?: { mode?: 'keep' | 'change' }) => void;
  onLeave: () => void;
  rematchRequested: boolean;
}

export const TicTacToeBoard: React.FC<TicTacToeBoardProps> = ({
  session,
  isMyTurn,
  myRole: _myRole,
  onMove,
  onRematch,
  onLeave,
  rematchRequested,
}) => {
  const [moving, setMoving] = useState(false);
  const [boardFlipped, setBoardFlipped] = useState(false);
  const state = session.state as TicTacToeState;
  const board = state.board || Array(9).fill(null);
  const winningLine = state.winningLine || [];
  const isFinished = session.status === 'finished';
  const result = session.result;

  const currentTurnPlayer = session.currentTurnPlayerId
    ? session.players[session.currentTurnPlayerId]
    : null;

  useEffect(() => {
    if (!isFinished) return;
    if (result?.outcome === 'draw') {
      sfx('sad');
      setBoardFlipped(true);
      const timer = setTimeout(() => setBoardFlipped(false), 1100);
      return () => clearTimeout(timer);
    } else if (result?.winnerPlayerId) {
      sfx('win');
    }
  }, [isFinished, result?.outcome, result?.winnerPlayerId]);

  const handleCellClick = async (index: number) => {
    if (isFinished || board[index] || !isMyTurn || moving) return;
    setMoving(true);
    sfx(currentTurnPlayer?.role === 'O' ? 'bonk' : 'pop');
    try {
      await onMove({ cellIndex: index });
    } catch (e) {
      console.warn('Move failed:', e);
    } finally {
      setMoving(false);
    }
  };

  return (
    <div className="flex flex-col items-center w-full max-w-[500px] mx-auto space-y-2.5 sm:space-y-3 min-w-0">
      {/* Turn & Status Header */}
      <div className="w-full text-center min-w-0">
        {!isFinished ? (
          <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-[var(--arcade-card)] border-[3px] border-[var(--arcade-ink)] rounded-2xl shadow-[3px_3px_0_var(--arcade-ink)] font-bold text-xs sm:text-base">
            <span className="text-lg sm:text-xl">
              {currentTurnPlayer?.role === 'X' ? '❌' : '⭕'}
            </span>
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
                ? '🤝 It’s a Draw!'
                : `🎉 ${result?.winnerName || 'Winner'} Wins!`}
            </span>
            <span className="text-xs font-semibold text-[var(--arcade-ink)] opacity-80">
              {session.mode === 'local' ? 'Local Pass-and-Play Match' : 'Online Duo Match'}
            </span>
          </div>
        )}
      </div>

      {/* 3x3 Grid - Maximized & Proportionate on Desktop and Mobile */}
      <div className={`grid grid-cols-3 gap-2 sm:gap-3.5 p-1.5 sm:p-4 bg-[var(--arcade-card)] border-[3px] sm:border-[4px] border-[var(--arcade-ink)] rounded-2xl sm:rounded-3xl shadow-[4px_4px_0_var(--arcade-ink)] sm:shadow-[6px_6px_0_var(--arcade-ink)] w-full aspect-square max-w-[500px] min-w-0 ${boardFlipped ? 'arcade-flip' : ''}`}>
        {board.map((cell, idx) => {
          const isWinningCell = winningLine.includes(idx);
          const cellColor =
            cell === 'X'
              ? 'bg-[#ff5d8f] text-white'
              : cell === 'O'
              ? 'bg-[#2bb5d4] text-white'
              : 'bg-[#fff9e6] dark:bg-[#3b2f66] hover:bg-[#ffe399]';

          return (
            <button
              key={`ttt-${idx}-${cell || 'empty'}`}
              type="button"
              disabled={isFinished || !!cell || (!isMyTurn && session.mode === 'online') || moving}
              onClick={() => handleCellClick(idx)}
              className={`aspect-square rounded-2xl border-[3px] border-[var(--arcade-ink)] font-black text-5xl sm:text-6xl md:text-7xl flex items-center justify-center transition-all cursor-pointer ${cellColor} ${
                cell ? 'arcade-ttt-stamp' : ''
              } ${isWinningCell ? 'arcade-dance ring-4 ring-[#ffc233]' : ''} ${
                !cell && isMyTurn ? 'hover:scale-105 active:scale-95' : ''
              }`}
              aria-label={`Cell ${idx + 1}, ${cell || 'empty'}`}
            >
              {cell}
            </button>
          );
        })}
      </div>

      {/* Footer Actions / Rematch with Options */}
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
              <span>Change Choices ⚙️</span>
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
