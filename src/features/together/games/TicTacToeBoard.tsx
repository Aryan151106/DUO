import React, { useState } from 'react';
import type { GameSession, TicTacToeState } from '../../../lib/games/types';
import { GoogleIcon } from '../../../components/GoogleIcon';

interface TicTacToeBoardProps {
  session: GameSession;
  isMyTurn: boolean;
  myRole: string;
  onMove: (payload: { cellIndex: number }) => Promise<void>;
  onRematch: () => void;
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
  const state = session.state as TicTacToeState;
  const board = state.board || Array(9).fill(null);
  const winningLine = state.winningLine || [];
  const isFinished = session.status === 'finished';
  const result = session.result;

  const currentTurnPlayer = session.currentTurnPlayerId
    ? session.players[session.currentTurnPlayerId]
    : null;

  const handleCellClick = async (index: number) => {
    if (isFinished || board[index] || !isMyTurn || moving) return;
    setMoving(true);
    try {
      await onMove({ cellIndex: index });
    } catch (e) {
      console.warn('Move failed:', e);
    } finally {
      setMoving(false);
    }
  };

  return (
    <div className="flex flex-col items-center w-full max-w-sm mx-auto space-y-4">
      {/* Turn & Status Header */}
      <div className="w-full text-center">
        {!isFinished ? (
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--arcade-card)] border-[3px] border-[var(--arcade-ink)] rounded-2xl shadow-[3px_3px_0_var(--arcade-ink)] font-bold text-base">
            <span className="text-xl">
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
          <div className="inline-flex flex-col items-center gap-1 px-5 py-3 bg-[var(--arcade-c)] border-[3px] border-[var(--arcade-ink)] rounded-2xl shadow-[4px_4px_0_var(--arcade-ink)]">
            <span className="text-2xl font-black">
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

      {/* 3x3 Grid */}
      <div className="grid grid-cols-3 gap-3 p-3 bg-[var(--arcade-card)] border-[3px] border-[var(--arcade-ink)] rounded-3xl shadow-[5px_5px_0_var(--arcade-ink)] w-full aspect-square">
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
              key={idx}
              type="button"
              disabled={isFinished || !!cell || (!isMyTurn && session.mode === 'online') || moving}
              onClick={() => handleCellClick(idx)}
              className={`aspect-square rounded-2xl border-[3px] border-[var(--arcade-ink)] font-black text-4xl sm:text-5xl flex items-center justify-center transition-all cursor-pointer ${cellColor} ${
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
