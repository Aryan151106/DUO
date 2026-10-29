import React, { useState } from 'react';
import type { GameType, GameMode } from '../../../lib/games/types';
import { useGameSession } from '../../../lib/games/useGameSession';
import { GameLobby } from './GameLobby';
import { TicTacToeBoard } from './TicTacToeBoard';
import { ConnectFourBoard } from './ConnectFourBoard';
import { ChessBoard } from './ChessBoard';
import { DoodleBoard } from './DoodleBoard';
import { GameStatsModal } from './GameStatsModal';
import { FLOATING_EMOJIS } from '../../../lib/games/arcadeAssets';
import { GoogleIcon } from '../../../components/GoogleIcon';
import '../../../lib/games/arcadeTheme.css';

interface GameCardMeta {
  type: GameType;
  title: string;
  icon: string;
  badge: string;
  description: string;
  tagColor: string;
}

const GAMES_LIST: GameCardMeta[] = [
  {
    type: 'tic-tac-toe',
    title: 'Tic-tac-toe',
    icon: '❌',
    badge: 'Classic Duo',
    description: 'Quick stamps, snappy lines, and goofy celebrations!',
    tagColor: 'bg-[#ff5d8f] text-white',
  },
  {
    type: 'connect-four',
    title: 'Connect Four',
    icon: '🔴',
    badge: 'Gravity Drop',
    description: 'Customizable disc colors, 7-column arcade grid, connect 4 in a row!',
    tagColor: 'bg-[#2bb5d4] text-white',
  },
  {
    type: 'chess',
    title: 'Goofy Chess',
    icon: '♟️',
    badge: 'Grandmaster (or goldfish)',
    description: 'Animated googly-eyed pieces, capture reactions, castling & promotions!',
    tagColor: 'bg-[#ffc233] text-[#2b2140]',
  },
  {
    type: 'guess-from-doodle',
    title: 'Doodle Guess',
    icon: '🖍️',
    badge: 'Live Draw & Guess',
    description: 'Live streaming drawing strokes in real time. Can your partner guess it?',
    tagColor: 'bg-[#a05cff] text-white',
  },
];

export const GamesArea: React.FC = () => {
  const [selectedGame, setSelectedGame] = useState<GameType | null>(null);
  const [selectedMode, setSelectedMode] = useState<GameMode>('online');
  const [isMascotWobbling, setIsMascotWobbling] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isEditingNames, setIsEditingNames] = useState(false);

  // Local names input state
  const [p1Input, setP1Input] = useState('');
  const [p2Input, setP2Input] = useState('');

  // Active game session hook for currently selected game
  const activeSessionHook = useGameSession(selectedGame || 'tic-tac-toe', selectedMode);

  const handleMascotPoke = () => {
    setIsMascotWobbling(true);
    setTimeout(() => setIsMascotWobbling(false), 500);
  };

  const handleOpenEditNames = () => {
    setP1Input(activeSessionHook.localPlayers.player1Name);
    setP2Input(activeSessionHook.localPlayers.player2Name);
    setIsEditingNames(true);
  };

  const handleSaveEditNames = (e: React.FormEvent) => {
    e.preventDefault();
    activeSessionHook.setLocalPlayerNamesConfig(p1Input.trim() || 'Player 1', p2Input.trim() || 'Player 2');
    setIsEditingNames(false);
  };

  return (
    <div
      className={`silly-arcade w-full max-w-5xl lg:max-w-6xl mx-auto ${
        selectedGame ? 'px-1 sm:px-4' : 'px-2.5 sm:px-4'
      } py-1.5 sm:py-4 relative min-h-[600px] min-w-0`}
    >
      {/* Floating game decorations */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden select-none -z-0">
        {FLOATING_EMOJIS.slice(0, 8).map((emoji, i) => (
          <span
            key={i}
            className="arcade-bg-float"
            style={{
              left: `${i * 12 + 4}%`,
              animationDuration: `${12 + (i % 4) * 3}s`,
              animationDelay: `-${i * 2}s`,
            }}
          >
            {emoji}
          </span>
        ))}
      </div>

      {/* Main Container */}
      <div className="relative z-10 space-y-4 sm:space-y-6">
        {/* Arcade Mascot & Title Banner */}
        {!selectedGame ? (
          <div className="text-center space-y-2">
            <div
              onClick={handleMascotPoke}
              className={`arcade-mascot text-5xl sm:text-6xl inline-block cursor-pointer select-none ${
                isMascotWobbling ? 'arcade-wobble' : ''
              }`}
              title="Poke me!"
            >
              🤪
            </div>

            <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-[var(--arcade-ink)] flex items-center justify-center gap-2">
              <span>Silly Arcade</span>
              <span className="text-xl sm:text-2xl">🎮</span>
            </h2>

            <div className="flex items-center justify-center gap-2 pt-1 flex-wrap">
              <button
                type="button"
                onClick={() => setIsStatsOpen(true)}
                className="arcade-btn arcade-btn-pill text-xs sm:text-sm py-1.5 px-4"
              >
                <GoogleIcon name="emoji_events" size={16} />
                <span>Streaks & Records 🏆</span>
              </button>

              {selectedMode === 'local' && (
                <button
                  type="button"
                  onClick={handleOpenEditNames}
                  className="arcade-btn arcade-btn-pill text-xs sm:text-sm py-1.5 px-4 bg-white"
                >
                  <GoogleIcon name="edit" size={16} />
                  <span>Player Names</span>
                </button>
              )}
            </div>
          </div>
        ) : null}

        {/* ── Active Game View (Substantially Larger on Desktop & Phone) ── */}
        {selectedGame ? (
          <div className="arcade-card px-1 py-2 sm:p-6 w-full max-w-full sm:max-w-3xl lg:max-w-4xl mx-auto space-y-2.5 sm:space-y-4 shadow-[3px_3px_0_var(--arcade-ink)] sm:shadow-[7px_7px_0_var(--arcade-ink)] min-w-0">
            {/* Top Bar with Mode Indicator & Exit */}
            <div className="flex items-center justify-between border-b-2 border-[var(--arcade-ink)] pb-2 px-1 gap-1.5 flex-wrap sm:flex-nowrap min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-2xl sm:text-3xl">
                  {GAMES_LIST.find((g) => g.type === selectedGame)?.icon}
                </span>
                <div>
                  <h3 className="font-black text-base sm:text-xl text-[var(--arcade-ink)] leading-tight">
                    {GAMES_LIST.find((g) => g.type === selectedGame)?.title}
                  </h3>
                  <span className="text-[11px] sm:text-xs font-bold text-[var(--arcade-ink)] opacity-75">
                    {selectedMode === 'online' ? '🌐 Online Mode' : '📱 Local Pass-and-Play'}
                  </span>
                </div>
              </div>

              {/* Mini Interactive Mascot */}
              <div className="hidden sm:flex items-center gap-2">
                <div
                  onClick={handleMascotPoke}
                  className={`text-2xl cursor-pointer select-none ${isMascotWobbling ? 'arcade-wobble' : ''}`}
                  title="Poke me!"
                >
                  🤪
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsStatsOpen(true)}
                  className="arcade-btn py-1 px-2.5 text-xs bg-white"
                  title="View Streaks"
                >
                  🏆
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedGame(null)}
                  className="arcade-btn py-1 px-3 text-xs bg-white"
                >
                  All Games
                </button>
              </div>
            </div>

            {/* Waiting / Connecting State for Online */}
            {selectedMode === 'online' && activeSessionHook.status === 'connecting' && (
              <div className="py-12 text-center space-y-3">
                <div className="text-4xl animate-bounce">⏳</div>
                <h4 className="font-extrabold text-lg text-[var(--arcade-ink)]">
                  Connecting to Game Server…
                </h4>
                <p className="text-xs text-[var(--arcade-ink)] opacity-75">
                  Synchronizing room and verifying partner credentials.
                </p>
              </div>
            )}

            {/* Error State */}
            {activeSessionHook.status === 'error' && (
              <div className="py-8 text-center space-y-3 bg-red-100 dark:bg-red-950/40 rounded-2xl border-2 border-red-500 p-4">
                <div className="text-3xl">⚠️</div>
                <h4 className="font-extrabold text-base text-red-700 dark:text-red-300">
                  {activeSessionHook.errorMessage || 'Connection lost'}
                </h4>
                <button
                  type="button"
                  onClick={() => setSelectedGame(null)}
                  className="arcade-btn text-xs py-1.5 px-4"
                >
                  Return to Games Hub
                </button>
              </div>
            )}

            {/* Partner Abandoned State */}
            {activeSessionHook.status === 'abandoned' && (
              <div className="py-8 text-center space-y-3 bg-amber-100 rounded-2xl border-2 border-amber-500 p-4">
                <div className="text-3xl">👋</div>
                <h4 className="font-extrabold text-base text-amber-900">
                  Your partner left the match.
                </h4>
                <button
                  type="button"
                  onClick={() => setSelectedGame(null)}
                  className="arcade-btn text-xs py-1.5 px-4"
                >
                  Return to Games Hub
                </button>
              </div>
            )}

            {/* ── PRE-GAME LOBBY VIEW (Setup / Choice Phase) ── */}
            {activeSessionHook.status === 'setup' && activeSessionHook.session && (
              <GameLobby
                session={activeSessionHook.session}
                isOnline={selectedMode === 'online'}
                myUid={activeSessionHook.myUid}
                onSelectChoice={activeSessionHook.selectChoice}
                onConfirmReady={activeSessionHook.confirmReady}
                onLeave={() => setSelectedGame(null)}
              />
            )}

            {/* ── ACTIVE / FINISHED MATCH VIEW ── */}
            {(activeSessionHook.status === 'active' || activeSessionHook.status === 'finished') &&
              activeSessionHook.session && (
                <>
                  {selectedGame === 'tic-tac-toe' && (
                    <TicTacToeBoard
                      session={activeSessionHook.session}
                      isMyTurn={activeSessionHook.isMyTurn}
                      myRole={activeSessionHook.myRole}
                      onMove={activeSessionHook.makeMove}
                      onRematch={activeSessionHook.requestRematch}
                      onLeave={() => setSelectedGame(null)}
                      rematchRequested={activeSessionHook.rematchRequested}
                    />
                  )}

                  {selectedGame === 'connect-four' && (
                    <ConnectFourBoard
                      session={activeSessionHook.session}
                      isMyTurn={activeSessionHook.isMyTurn}
                      myRole={activeSessionHook.myRole}
                      onMove={activeSessionHook.makeMove}
                      onRematch={activeSessionHook.requestRematch}
                      onLeave={() => setSelectedGame(null)}
                      rematchRequested={activeSessionHook.rematchRequested}
                    />
                  )}

                  {selectedGame === 'chess' && (
                    <ChessBoard
                      session={activeSessionHook.session}
                      isMyTurn={activeSessionHook.isMyTurn}
                      myRole={activeSessionHook.myRole}
                      onMove={activeSessionHook.makeMove}
                      onRematch={activeSessionHook.requestRematch}
                      onLeave={() => setSelectedGame(null)}
                      rematchRequested={activeSessionHook.rematchRequested}
                    />
                  )}

                  {selectedGame === 'guess-from-doodle' && (
                    <DoodleBoard
                      session={activeSessionHook.session}
                      isMyTurn={activeSessionHook.isMyTurn}
                      myRole={activeSessionHook.myRole}
                      secretWord={activeSessionHook.secretWord}
                      doodleStrokes={activeSessionHook.doodleStrokes}
                      incomingLiveChunk={activeSessionHook.incomingLiveChunk}
                      onSendStroke={activeSessionHook.sendStroke}
                      onSendStrokeChunk={activeSessionHook.sendStrokeChunk}
                      onClear={activeSessionHook.clearDoodle}
                      onRequestHint={activeSessionHook.requestHint}
                      onSubmitGuess={activeSessionHook.submitGuess}
                      onRematch={activeSessionHook.requestRematch}
                      onLeave={() => setSelectedGame(null)}
                      rematchRequested={activeSessionHook.rematchRequested}
                    />
                  )}
                </>
              )}
          </div>
        ) : (
          /* ── Games Hub Home Screen ── */
          <div className="space-y-6">
            {/* Mode Switcher Banner */}
            <div className="arcade-card p-4 sm:p-5 text-center space-y-3 bg-[var(--arcade-card)]">
              <h3 className="font-extrabold text-sm sm:text-base text-[var(--arcade-ink)] uppercase tracking-wider">
                Select Play Mode
              </h3>

              <div className="inline-grid grid-cols-2 gap-2 p-1.5 bg-[var(--arcade-bg)] border-[3px] border-[var(--arcade-ink)] rounded-2xl max-w-sm w-full mx-auto shadow-inner">
                <button
                  type="button"
                  onClick={() => setSelectedMode('online')}
                  className={`py-2 px-3 rounded-xl font-black text-xs sm:text-sm border-2 border-[var(--arcade-ink)] transition-transform cursor-pointer ${
                    selectedMode === 'online'
                      ? 'bg-[#2bb5d4] text-white shadow-[2px_2px_0_var(--arcade-ink)] scale-102'
                      : 'bg-transparent text-[var(--arcade-ink)] opacity-70 hover:opacity-100'
                  }`}
                >
                  🌐 Online Duo
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedMode('local')}
                  className={`py-2 px-3 rounded-xl font-black text-xs sm:text-sm border-2 border-[var(--arcade-ink)] transition-transform cursor-pointer ${
                    selectedMode === 'local'
                      ? 'bg-[#ff5d8f] text-white shadow-[2px_2px_0_var(--arcade-ink)] scale-102'
                      : 'bg-transparent text-[var(--arcade-ink)] opacity-70 hover:opacity-100'
                  }`}
                >
                  📱 Local Pass & Play
                </button>
              </div>

              <p className="text-xs sm:text-sm font-semibold text-[var(--arcade-ink)] opacity-80 max-w-md mx-auto">
                {selectedMode === 'online'
                  ? '🌐 Play together in real time from separate devices over the internet with shared pre-game choice lobby!'
                  : `📱 Pass this device back and forth! (${activeSessionHook.localPlayers.player1Name} vs ${activeSessionHook.localPlayers.player2Name}) 100% playable offline.`}
              </p>
            </div>

            {/* 4 Games Grid Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {GAMES_LIST.map((game) => (
                <div
                  key={game.type}
                  className="arcade-card p-4 sm:p-5 flex flex-col justify-between hover:scale-101 active:scale-99 transition-transform"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-4xl p-2.5 bg-[var(--arcade-bg)] border-2 border-[var(--arcade-ink)] rounded-2xl shadow-[2px_2px_0_var(--arcade-ink)]">
                        {game.icon}
                      </span>
                      <span
                        className={`text-[11px] font-black uppercase px-2.5 py-1 rounded-full border border-[var(--arcade-ink)] shadow-xs ${game.tagColor}`}
                      >
                        {game.badge}
                      </span>
                    </div>

                    <div>
                      <h4 className="text-xl sm:text-2xl font-black text-[var(--arcade-ink)]">
                        {game.title}
                      </h4>
                      <p className="text-xs sm:text-sm font-semibold text-[var(--arcade-ink)] opacity-80 mt-1">
                        {game.description}
                      </p>
                    </div>
                  </div>

                  <div className="pt-4 mt-2 border-t border-[var(--arcade-ink)]/20 flex items-center justify-between">
                    <span className="text-xs font-bold text-[var(--arcade-ink)] opacity-70">
                      {selectedMode === 'online' ? '2 Devices • Shared Lobby' : '1 Device • Pass & Play'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedGame(game.type)}
                      className="arcade-btn arcade-btn-pink text-sm py-2 px-5 cursor-pointer"
                    >
                      <span>Play Now</span>
                      <GoogleIcon name="play_arrow" size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Local Player Names Edit Modal */}
      {isEditingNames && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleSaveEditNames}
            className="arcade-card p-5 max-w-sm w-full space-y-4 bg-white"
          >
            <h3 className="font-black text-lg text-[var(--arcade-ink)]">Edit Player Names</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-extrabold uppercase text-[var(--arcade-ink)] opacity-80">
                  Player 1 Name:
                </label>
                <input
                  type="text"
                  value={p1Input}
                  onChange={(e) => setP1Input(e.target.value)}
                  placeholder="Player 1"
                  className="w-full mt-1 p-2 bg-[var(--arcade-bg)] border-2 border-[var(--arcade-ink)] rounded-xl font-bold text-sm"
                  maxLength={20}
                />
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase text-[var(--arcade-ink)] opacity-80">
                  Player 2 Name:
                </label>
                <input
                  type="text"
                  value={p2Input}
                  onChange={(e) => setP2Input(e.target.value)}
                  placeholder="Player 2"
                  className="w-full mt-1 p-2 bg-[var(--arcade-bg)] border-2 border-[var(--arcade-ink)] rounded-xl font-bold text-sm"
                  maxLength={20}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsEditingNames(false)}
                className="arcade-btn py-1.5 px-4 text-xs bg-gray-200"
              >
                Cancel
              </button>
              <button type="submit" className="arcade-btn arcade-btn-blue py-1.5 px-4 text-xs">
                Save Names
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Hall of Fame / Stats Modal */}
      <GameStatsModal isOpen={isStatsOpen} onClose={() => setIsStatsOpen(false)} />
    </div>
  );
};
