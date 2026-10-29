import React from 'react';
import type { GameSession, PlayerChoice } from '../../../lib/games/types';
import { C4_COLOR_PALETTE } from '../../../lib/games/types';

interface GameLobbyProps {
  session: GameSession;
  isOnline: boolean;
  myUid: string;
  onSelectChoice: (choice: Partial<PlayerChoice>, targetPlayerId?: string) => void;
  onConfirmReady: (ready: boolean, targetPlayerId?: string) => void;
  onLeave: () => void;
}

export const GameLobby: React.FC<GameLobbyProps> = ({
  session,
  isOnline,
  myUid,
  onSelectChoice,
  onConfirmReady,
  onLeave,
}) => {
  const { gameType, players, playerIds, lobbyState } = session;
  const p1Id = playerIds[0] || 'p1';
  const p2Id = playerIds[1] || 'p2';

  const p1 = players[p1Id] || { id: p1Id, displayName: 'Player 1' };
  const p2 = players[p2Id] || { id: p2Id, displayName: isOnline ? 'Waiting for partner…' : 'Player 2' };

  const isP1 = myUid === p1Id;
  const myPlayerId = isOnline ? (isP1 ? p1Id : p2Id) : null;
  const isSecondPlayerPresent = playerIds.length >= 2;

  const myChoice = myPlayerId ? players[myPlayerId]?.choice : null;
  const isMyReady = Boolean(myChoice?.isReady);

  const conflict = lobbyState?.conflict || null;

  // Local start enabled if 2 players present, no conflict
  const isLocalReadyToStart = !isOnline && !conflict;

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4 px-1 sm:px-2">
      {/* Header Banner */}
      <div className="text-center space-y-1">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-[var(--arcade-card)] border-2 border-[var(--arcade-ink)] rounded-full text-xs font-bold text-[var(--arcade-ink)] shadow-[2px_2px_0_var(--arcade-ink)]">
          <span>{isOnline ? '🌐 Shared Pre-Game Lobby' : '📱 Local Pass-and-Play Setup'}</span>
        </div>
        <h3 className="text-2xl sm:text-3xl font-black text-[var(--arcade-ink)]">
          Customize Your Match 🎮
        </h3>
        <p className="text-xs sm:text-sm font-semibold text-[var(--arcade-ink)] opacity-80 max-w-md mx-auto">
          {isOnline
            ? 'Both partners pick their side, color, or role from their own device. Confirm ready to start!'
            : 'Choose options for both players on this device, then confirm to begin!'}
        </p>
      </div>

      {/* Conflict Alert Banner */}
      {conflict && (
        <div className="arcade-shake bg-amber-100 border-[3px] border-amber-600 rounded-2xl p-3 sm:p-4 text-center space-y-1 shadow-[4px_4px_0_var(--arcade-ink)]">
          <div className="flex items-center justify-center gap-2 text-amber-900 font-black text-sm sm:text-base">
            <span className="text-lg">⚠️</span>
            <span>Choice Conflict</span>
          </div>
          <p className="text-xs sm:text-sm font-bold text-amber-800">
            {conflict}
          </p>
        </div>
      )}

      {/* Player Choice Cards (Side by side on desktop, stacked on mobile) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
        {/* Player 1 Card */}
        <PlayerSetupPanel
          player={p1}
          playerId={p1Id}
          gameType={gameType}
          isOnline={isOnline}
          isMe={!isOnline || myUid === p1Id}
          canEdit={!isOnline || myUid === p1Id}
          onSelect={(c) => onSelectChoice(c, p1Id)}
          onReadyToggle={(r) => onConfirmReady(r, p1Id)}
        />

        {/* Player 2 Card */}
        <PlayerSetupPanel
          player={p2}
          playerId={p2Id}
          gameType={gameType}
          isOnline={isOnline}
          isMe={!isOnline || myUid === p2Id}
          canEdit={!isOnline || myUid === p2Id}
          isPending={isOnline && !isSecondPlayerPresent}
          onSelect={(c) => onSelectChoice(c, p2Id)}
          onReadyToggle={(r) => onConfirmReady(r, p2Id)}
        />
      </div>

      {/* Action Bar / Readiness Confirmation */}
      <div className="p-3 sm:p-4 bg-[var(--arcade-card)] border-[3px] border-[var(--arcade-ink)] rounded-2xl shadow-[4px_4px_0_var(--arcade-ink)] flex flex-col sm:flex-row items-center justify-between gap-3">
        <button
          type="button"
          onClick={onLeave}
          className="arcade-btn py-2 px-4 text-xs bg-white w-full sm:w-auto"
        >
          <span>All Games</span>
        </button>

        <div className="text-center sm:text-right w-full sm:w-auto">
          {isOnline ? (
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="text-xs font-bold text-[var(--arcade-ink)]">
                {isSecondPlayerPresent ? (
                  isMyReady ? (
                    <span className="text-emerald-700 font-extrabold">
                      ✓ You are ready! Waiting for partner…
                    </span>
                  ) : conflict ? (
                    <span className="text-amber-700">Resolve choice conflict to ready up</span>
                  ) : (
                    <span>Ready when you are!</span>
                  )
                ) : (
                  <span className="text-blue-700 animate-pulse">
                    Waiting for your partner to join lobby…
                  </span>
                )}
              </div>

              <button
                type="button"
                disabled={!isSecondPlayerPresent || (Boolean(conflict) && !isMyReady)}
                onClick={() => onConfirmReady(!isMyReady, myPlayerId || undefined)}
                className={`arcade-btn py-2.5 px-6 text-sm font-black transition-all w-full sm:w-auto cursor-pointer ${
                  isMyReady
                    ? 'bg-amber-300 text-[var(--arcade-ink)]'
                    : 'arcade-btn-pink'
                }`}
              >
                {isMyReady ? (
                  <span>Change Choice / Unready ↩️</span>
                ) : (
                  <span>I'm Ready! 👍</span>
                )}
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={!isLocalReadyToStart}
              onClick={() => onConfirmReady(true, 'local')}
              className="arcade-btn arcade-btn-pink py-2.5 px-8 text-sm font-black w-full sm:w-auto cursor-pointer"
            >
              <span>Start Match 🚀</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Individual Player Setup Panel Component ────────────────────────────────

interface PlayerSetupPanelProps {
  player: any;
  playerId: string;
  gameType: string;
  isOnline: boolean;
  isMe: boolean;
  canEdit: boolean;
  isPending?: boolean;
  onSelect: (choice: Partial<PlayerChoice>) => void;
  onReadyToggle?: (ready: boolean) => void;
}

const PlayerSetupPanel: React.FC<PlayerSetupPanelProps> = ({
  player,
  playerId: _playerId,
  gameType,
  isOnline,
  isMe,
  canEdit,
  isPending,
  onSelect,
}) => {
  const choice = player.choice || {};
  const isReady = Boolean(choice.isReady);
  const isConnected = player.isConnected !== false;

  if (isPending) {
    return (
      <div className="p-4 sm:p-5 bg-[var(--arcade-bg)] border-[3px] border-dashed border-[var(--arcade-ink)] rounded-2xl flex flex-col items-center justify-center text-center space-y-2 min-h-[220px]">
        <div className="text-3xl animate-bounce">⏳</div>
        <h4 className="font-black text-base text-[var(--arcade-ink)]">Waiting for Partner</h4>
        <p className="text-xs text-[var(--arcade-ink)] opacity-75 max-w-xs">
          Your partner will see this lobby once they open the Games tab on their phone or computer!
        </p>
      </div>
    );
  }

  return (
    <div
      className={`p-3 sm:p-4 bg-[var(--arcade-card)] border-[3px] border-[var(--arcade-ink)] rounded-2xl shadow-[4px_4px_0_var(--arcade-ink)] space-y-3 transition-all ${
        isReady ? 'ring-3 ring-emerald-500' : ''
      }`}
    >
      {/* Player Header */}
      <div className="flex items-center justify-between border-b-2 border-[var(--arcade-ink)]/15 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">👤</span>
          <div>
            <div className="flex items-center gap-1.5">
              <h4 className="font-black text-sm sm:text-base text-[var(--arcade-ink)] leading-tight">
                {player.displayName || 'Partner'}
              </h4>
              {isMe && isOnline && (
                <span className="text-[10px] font-black uppercase px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded">
                  You
                </span>
              )}
            </div>
            <div className="text-[11px] font-bold text-[var(--arcade-ink)] opacity-70 flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full inline-block ${isConnected ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
              <span>{isConnected ? 'Connected' : 'Reconnecting…'}</span>
            </div>
          </div>
        </div>

        {/* Ready Badge */}
        {isOnline && (
          <span
            className={`text-xs font-black px-2.5 py-1 rounded-full border-2 border-[var(--arcade-ink)] shadow-xs ${
              isReady
                ? 'bg-emerald-400 text-emerald-950 animate-pulse'
                : 'bg-amber-100 text-amber-900 opacity-90'
            }`}
          >
            {isReady ? 'READY ✓' : 'Choosing…'}
          </span>
        )}
      </div>

      {/* Game Specific Option Chooser */}
      <div className="space-y-2">
        {/* ── 1. Tic-tac-toe (X or O) ── */}
        {gameType === 'tic-tac-toe' && (
          <div className="space-y-1.5">
            <label className="text-xs font-extrabold uppercase text-[var(--arcade-ink)] opacity-80 block">
              Choose Symbol:
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => onSelect({ role: 'X' })}
                className={`py-2 px-3 rounded-xl border-2 border-[var(--arcade-ink)] font-black text-base sm:text-lg flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  choice.role === 'X'
                    ? 'bg-[#ff5d8f] text-white shadow-[2px_2px_0_var(--arcade-ink)] scale-102'
                    : 'bg-white text-[var(--arcade-ink)] hover:bg-[var(--arcade-bg)]'
                }`}
              >
                <span>❌</span>
                <span>X (First)</span>
              </button>

              <button
                type="button"
                disabled={!canEdit}
                onClick={() => onSelect({ role: 'O' })}
                className={`py-2 px-3 rounded-xl border-2 border-[var(--arcade-ink)] font-black text-base sm:text-lg flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  choice.role === 'O'
                    ? 'bg-[#2bb5d4] text-white shadow-[2px_2px_0_var(--arcade-ink)] scale-102'
                    : 'bg-white text-[var(--arcade-ink)] hover:bg-[var(--arcade-bg)]'
                }`}
              >
                <span>⭕</span>
                <span>O</span>
              </button>
            </div>
            <p className="text-[11px] font-semibold text-[var(--arcade-ink)] opacity-75">
              Rule: Symbol X always makes the opening move.
            </p>
          </div>
        )}

        {/* ── 2. Connect Four (Disc Colors) ── */}
        {gameType === 'connect-four' && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-extrabold uppercase text-[var(--arcade-ink)] opacity-80 block">
                Disc Color:
              </label>
              <span className="text-xs font-black text-[var(--arcade-ink)]">
                {choice.colorName || (choice.color === '#ff3d5a' ? 'Ruby Red' : 'Sunny Yellow')}
              </span>
            </div>

            <div className="grid grid-cols-6 gap-1.5 pt-1">
              {C4_COLOR_PALETTE.map((pal) => {
                const isSelected = (choice.color || '#ff3d5a').toLowerCase() === pal.hex.toLowerCase();
                return (
                  <button
                    key={pal.id}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => onSelect({ color: pal.hex, colorName: pal.name })}
                    className={`aspect-square rounded-full border-[3px] border-[var(--arcade-ink)] flex items-center justify-center transition-all cursor-pointer shadow-[2px_2px_0_var(--arcade-ink)] ${
                      isSelected ? 'ring-4 ring-[var(--arcade-ink)] scale-110' : 'hover:scale-105 active:scale-95'
                    }`}
                    style={{ backgroundColor: pal.hex }}
                    title={pal.name}
                  >
                    {isSelected && <span className="text-xs font-black text-white drop-shadow">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── 3. Chess (White or Black) ── */}
        {gameType === 'chess' && (
          <div className="space-y-1.5">
            <label className="text-xs font-extrabold uppercase text-[var(--arcade-ink)] opacity-80 block">
              Choose Side:
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => onSelect({ role: 'w' })}
                className={`py-2 px-3 rounded-xl border-2 border-[var(--arcade-ink)] font-black text-sm sm:text-base flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  choice.role === 'w'
                    ? 'bg-[#fff4d9] text-[#2b2140] shadow-[2px_2px_0_var(--arcade-ink)] scale-102 ring-2 ring-[#ff5d8f]'
                    : 'bg-white text-[var(--arcade-ink)] hover:bg-[var(--arcade-bg)]'
                }`}
              >
                <span>⚪</span>
                <span>White (First)</span>
              </button>

              <button
                type="button"
                disabled={!canEdit}
                onClick={() => onSelect({ role: 'b' })}
                className={`py-2 px-3 rounded-xl border-2 border-[var(--arcade-ink)] font-black text-sm sm:text-base flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  choice.role === 'b'
                    ? 'bg-[#6a4fb0] text-white shadow-[2px_2px_0_var(--arcade-ink)] scale-102'
                    : 'bg-white text-[var(--arcade-ink)] hover:bg-[var(--arcade-bg)]'
                }`}
              >
                <span>⚫</span>
                <span>Black</span>
              </button>
            </div>
            <p className="text-[11px] font-semibold text-[var(--arcade-ink)] opacity-75">
              Rule: White makes the opening move on the board.
            </p>
          </div>
        )}

        {/* ── 4. Doodle Guess (Draw vs Guess) ── */}
        {gameType === 'guess-from-doodle' && (
          <div className="space-y-1.5">
            <label className="text-xs font-extrabold uppercase text-[var(--arcade-ink)] opacity-80 block">
              Round 1 Role:
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => onSelect({ role: 'drawer' })}
                className={`py-2 px-3 rounded-xl border-2 border-[var(--arcade-ink)] font-black text-sm sm:text-base flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  choice.role === 'drawer'
                    ? 'bg-[#ff5d8f] text-white shadow-[2px_2px_0_var(--arcade-ink)] scale-102'
                    : 'bg-white text-[var(--arcade-ink)] hover:bg-[var(--arcade-bg)]'
                }`}
              >
                <span>🎨</span>
                <span>Draw First</span>
              </button>

              <button
                type="button"
                disabled={!canEdit}
                onClick={() => onSelect({ role: 'guesser' })}
                className={`py-2 px-3 rounded-xl border-2 border-[var(--arcade-ink)] font-black text-sm sm:text-base flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  choice.role === 'guesser'
                    ? 'bg-[#2bb5d4] text-white shadow-[2px_2px_0_var(--arcade-ink)] scale-102'
                    : 'bg-white text-[var(--arcade-ink)] hover:bg-[var(--arcade-bg)]'
                }`}
              >
                <span>🧐</span>
                <span>Guess First</span>
              </button>
            </div>
            <p className="text-[11px] font-semibold text-[var(--arcade-ink)] opacity-75">
              Roles alternate automatically in subsequent rounds!
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
