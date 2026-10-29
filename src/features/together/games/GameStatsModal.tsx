import React, { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../../../lib/firebase';
import { useAuthStore } from '../../../lib/store';
import type { GameType, GameStats, MatchHistoryItem } from '../../../lib/games/types';
import { getAllLocalStats, getLocalMatchHistory } from '../../../lib/games/localGameStore';

interface GameStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const GAME_LABELS: Record<GameType, { title: string; icon: string }> = {
  'tic-tac-toe': { title: 'Tic-tac-toe', icon: '❌' },
  'connect-four': { title: 'Connect Four', icon: '🔴' },
  chess: { title: 'Goofy Chess', icon: '♟️' },
  'guess-from-doodle': { title: 'Doodle Guess', icon: '🖍️' },
};

export const GameStatsModal: React.FC<GameStatsModalProps> = ({ isOpen, onClose }) => {
  const { currentUser, couple } = useAuthStore();
  const coupleId = couple?.id || 'couple-duo';
  const myUid = auth.currentUser?.uid || currentUser.id || 'p1';

  const [activeTab, setActiveTab] = useState<'online' | 'local'>('online');
  const [onlineStats, setOnlineStats] = useState<Record<string, GameStats>>({});
  const [localStats, setLocalStats] = useState<Record<string, GameStats>>({});
  const [localHistory, setLocalHistory] = useState<MatchHistoryItem[]>([]);

  // Load online stats from Firestore
  useEffect(() => {
    if (!coupleId || coupleId.startsWith('demo')) return;

    const unsub = onSnapshot(
      collection(db, 'couples', coupleId, 'gameStats'),
      (snap) => {
        const statsMap: Record<string, GameStats> = {};
        snap.forEach((d) => {
          const data = d.data() as GameStats;
          if (data.playerId === myUid) {
            statsMap[data.gameType] = data;
          }
        });
        setOnlineStats(statsMap);
      },
      (err) => {
        console.warn('[GameStats] Error loading online stats:', err.message);
      }
    );

    return () => unsub();
  }, [coupleId, myUid]);

  // Load local stats from device storage
  useEffect(() => {
    if (isOpen) {
      setLocalStats(getAllLocalStats());
      setLocalHistory(getLocalMatchHistory());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const currentStatsSource = activeTab === 'online' ? onlineStats : localStats;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="arcade-card w-full max-w-lg max-h-[88vh] max-h-[88dvh] flex flex-col overflow-hidden bg-[var(--arcade-card)] border-[4px] border-[var(--arcade-ink)] shadow-[8px_8px_0_var(--arcade-ink)]"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 border-b-[3px] border-[var(--arcade-ink)] bg-[var(--arcade-c)]">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🏆</span>
            <h2 className="text-xl sm:text-2xl font-black text-[#2b2140]">
              Arcade Hall of Fame
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full border-2 border-[var(--arcade-ink)] bg-[var(--arcade-card)] text-[var(--arcade-ink)] flex items-center justify-center font-bold text-lg hover:scale-110 active:scale-95 cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Mode Selector Tabs (Online vs Local Pass-and-Play) */}
        <div className="grid grid-cols-2 p-2 gap-2 bg-[var(--arcade-bg)] border-b-[3px] border-[var(--arcade-ink)]">
          <button
            type="button"
            onClick={() => setActiveTab('online')}
            className={`py-2 rounded-xl font-extrabold text-sm border-2 border-[var(--arcade-ink)] flex items-center justify-center gap-1.5 transition-transform ${
              activeTab === 'online'
                ? 'bg-[#2bb5d4] text-white shadow-[2px_2px_0_var(--arcade-ink)] scale-102'
                : 'bg-[var(--arcade-card)] text-[var(--arcade-ink)] opacity-70 hover:opacity-100'
            }`}
          >
            <span>🌐 Online Duo Records</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('local')}
            className={`py-2 rounded-xl font-extrabold text-sm border-2 border-[var(--arcade-ink)] flex items-center justify-center gap-1.5 transition-transform ${
              activeTab === 'local'
                ? 'bg-[#ff5d8f] text-white shadow-[2px_2px_0_var(--arcade-ink)] scale-102'
                : 'bg-[var(--arcade-card)] text-[var(--arcade-ink)] opacity-70 hover:opacity-100'
            }`}
          >
            <span>📱 Local Pass-and-Play</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(Object.keys(GAME_LABELS) as GameType[]).map((gType) => {
              const label = GAME_LABELS[gType];
              const stat = currentStatsSource[gType] || {
                wins: 0,
                losses: 0,
                draws: 0,
                currentWinStreak: 0,
                bestWinStreak: 0,
              };

              return (
                <div
                  key={gType}
                  className="p-3 bg-[var(--arcade-card)] border-[3px] border-[var(--arcade-ink)] rounded-2xl shadow-[3px_3px_0_var(--arcade-ink)] space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-base flex items-center gap-1 text-[var(--arcade-ink)]">
                      <span>{label.icon}</span>
                      <span>{label.title}</span>
                    </span>
                    <span className="text-xs px-2 py-0.5 bg-[#ffe399] border border-[var(--arcade-ink)] rounded-full font-bold text-[#2b2140]">
                      🔥 Streak: {stat.currentWinStreak}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-1 text-center bg-[var(--arcade-bg)] p-2 rounded-xl border border-[var(--arcade-ink)]">
                    <div>
                      <div className="text-[10px] uppercase font-bold text-green-700">Wins</div>
                      <div className="text-base font-black text-[var(--arcade-ink)]">{stat.wins}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase font-bold text-red-600">Losses</div>
                      <div className="text-base font-black text-[var(--arcade-ink)]">{stat.losses}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase font-bold text-amber-700">Draws</div>
                      <div className="text-base font-black text-[var(--arcade-ink)]">{stat.draws}</div>
                    </div>
                  </div>

                  <div className="text-right text-[11px] font-semibold text-[var(--arcade-ink)] opacity-75">
                    Best Streak: <span className="font-bold">{stat.bestWinStreak} wins</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Match History Table (Local) */}
          {activeTab === 'local' && localHistory.length > 0 && (
            <div className="mt-4 space-y-2">
              <h4 className="font-black text-sm text-[var(--arcade-ink)]">Recent Local Matches</h4>
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {localHistory.slice(0, 15).map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between text-xs p-2 bg-[var(--arcade-bg)] rounded-xl border border-[var(--arcade-ink)] font-semibold"
                  >
                    <span className="flex items-center gap-1">
                      <span>{GAME_LABELS[item.gameType]?.icon}</span>
                      <span>{GAME_LABELS[item.gameType]?.title}</span>
                    </span>
                    <span className="font-bold text-[var(--arcade-ink)]">
                      {item.outcome === 'draw'
                        ? 'Draw 🤝'
                        : `Won by ${item.winnerName || 'Winner'} 🏆`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3 bg-[var(--arcade-bg)] border-t-[3px] border-[var(--arcade-ink)] text-center">
          <button
            type="button"
            onClick={onClose}
            className="arcade-btn arcade-btn-pill text-sm py-2 px-6"
          >
            Back to Arcade
          </button>
        </div>
      </div>
    </div>
  );
};
