import React, { useState } from 'react';
import { CheckCircle2, Circle, Send, ExternalLink, X, Clock } from 'lucide-react';
import { useAuthStore } from '../../lib/store';
import { soundEffects } from '../../lib/sound';
import { LiveClock } from '../../lib/LiveClock';
import { LiveDate } from '../../lib/LiveDate';
import confetti from 'canvas-confetti';

interface WidgetViewProps {
  isPopout?: boolean;
  onClose?: () => void;
}

export const WidgetView: React.FC<WidgetViewProps> = ({ isPopout = false, onClose }) => {
  const { partnerUser } = useAuthStore();
  const [quickMsg, setQuickMsg] = useState('');
  const [tasks, setTasks] = useState([
    { id: '1', title: 'Pick up flowers 🌸', done: false, time: '5:00 PM' },
    { id: '2', title: 'Review weekend plans ✈️', done: true, time: 'Today' },
    { id: '3', title: 'Call after dinner ✨', done: false, time: '9:30 PM' },
  ]);

  const toggleTask = (id: string) => {
    setTasks(prev =>
      prev.map(t => {
        if (t.id === id) {
          const nextDone = !t.done;
          if (nextDone) {
            soundEffects.playTaskDone();
            confetti({ particleCount: 30, spread: 60, origin: { y: 0.8 } });
          } else {
            soundEffects.playPop();
          }
          return { ...t, done: nextDone };
        }
        return t;
      })
    );
  };

  const handleSendHeart = (_emoji: string) => {
    soundEffects.playHeart();
    confetti({
      particleCount: 25,
      spread: 70,
      colors: ['#FF6B6B', '#FFD166', '#7C6CF2', '#2BB58B'],
    });
  };

  const handleSendQuickNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickMsg.trim()) return;
    soundEffects.playMessageSent();
    setQuickMsg('');
    confetti({ particleCount: 15, spread: 50 });
  };

  const openDedicatedPopout = () => {
    const w = 360;
    const h = 540;
    const left = window.screen.width - w - 40;
    const top = 100;
    window.open(
      `${window.location.origin}/?widget=true`,
      'DuoDesktopWidget',
      `width=${w},height=${h},top=${top},left=${left},resizable=yes,scrollbars=no,status=no`
    );
  };

  return (
    <div className={`w-full max-w-[360px] bg-[var(--surface)] text-[var(--text)] border-3 border-[var(--border)] rounded-3xl shadow-[0_4px_0_var(--shadow-color)] p-4 flex flex-col gap-3 font-body ${isPopout ? 'min-h-screen rounded-none border-none p-5' : ''}`}>
      {/* Top Header */}
      <div className="flex items-center justify-between pb-2 border-b-2 border-[var(--border)]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-[var(--surface-2)] border-2 border-[var(--border)] flex items-center justify-center p-1 text-white shadow-[0_1px_0_var(--shadow-color)]">
            <img src="/logo.svg" alt="AV" className="w-full h-full object-contain" />
          </div>
          <div>
            <span className="text-sm font-logo font-bold text-[var(--text)] block leading-tight">
              AV companion
            </span>
            <span className="font-ui text-[11px] font-semibold text-[var(--text-muted)]">
              Aryan & Vidhi Widget
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {!isPopout && (
            <button
              type="button"
              onClick={openDedicatedPopout}
              title="Pop out standalone desktop window"
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] rounded-xl transition-colors cursor-pointer"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] rounded-xl transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Partner Glance Card with Compact Widget Clock */}
      <div className="p-3.5 bg-[var(--surface-2)] border-2 border-[var(--border)] rounded-2xl relative shadow-[0_2px_0_var(--shadow-color)]">
        <div className="flex items-center gap-3">
          <div className="relative">
            <img
              src={partnerUser.avatarUrl}
              alt={partnerUser.displayName}
              className="w-12 h-12 rounded-2xl object-cover border-2 border-[var(--partner-b)] shadow-xs"
            />
            <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-[var(--success)] border-2 border-[var(--surface)] rounded-full" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <h4 className="font-ui text-sm font-semibold text-[var(--text)] truncate">
                {partnerUser.displayName}
              </h4>
              {/* Compact widget clock & date */}
              <div className="flex flex-col items-end">
                <div className="flex items-center gap-1 font-numeric text-xs font-bold text-[var(--text)] tabular-nums">
                  <Clock className="w-3 h-3 text-[var(--partner-b)]" />
                  <LiveClock timeZone={partnerUser.timezone} showSeconds={true} />
                </div>
                <LiveDate timeZone={partnerUser.timezone} variant="compact" className="text-[10px] text-[var(--text-muted)] font-ui" />
              </div>
            </div>
            
            {/* Widget status: --font-ui 600 */}
            <p className="font-ui text-xs font-semibold text-[var(--partner-a)] truncate mt-1 flex items-center gap-1">
              <span>{partnerUser.moodStatus || 'Thinking of you ❤️'}</span>
            </p>
          </div>
        </div>

        {/* Quick Love Reactions: Widget quick buttons --font-chunky 700 */}
        <div className="mt-3 pt-2.5 border-t-2 border-[var(--border)] flex items-center justify-between">
          <span className="font-ui text-xs font-semibold text-[var(--text-muted)]">Send spark:</span>
          <div className="flex items-center gap-1.5">
            {['❤️', '😘', '🫂', '✨'].map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => handleSendHeart(emoji)}
                className="w-8 h-8 rounded-xl bg-[var(--surface)] hover:bg-[var(--accent)]/30 border-2 border-[var(--border)] shadow-[0_1px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none transition-all text-xs font-chunky font-bold flex items-center justify-center cursor-pointer"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Today's Tasks Glance */}
      <div className="p-3.5 bg-[var(--surface-2)] border-2 border-[var(--border)] rounded-2xl shadow-[0_2px_0_var(--shadow-color)]">
        <div className="flex items-center justify-between mb-2">
          <span className="font-ui text-xs font-semibold text-[var(--text)] uppercase tracking-wider">
            Today's Missions
          </span>
          <span className="font-chunky text-[11px] font-bold text-[var(--partner-a)]">
            {tasks.filter(t => t.done).length}/{tasks.length} done
          </span>
        </div>

        <div className="space-y-1.5">
          {tasks.map((task) => (
            <div
              key={task.id}
              onClick={() => toggleTask(task.id)}
              className={`flex items-center justify-between p-2 rounded-xl text-xs font-chunky font-bold transition-all border cursor-pointer ${
                task.done
                  ? 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)] line-through opacity-70'
                  : 'bg-[var(--surface)] hover:bg-[var(--surface)]/80 border-[var(--border)] text-[var(--text)] shadow-[0_1px_0_var(--shadow-color)]'
              }`}
            >
              <div className="flex items-center gap-2 truncate">
                {task.done ? (
                  <CheckCircle2 className="w-4 h-4 text-[var(--success)] shrink-0" />
                ) : (
                  <Circle className="w-4 h-4 text-[var(--border)] shrink-0" />
                )}
                <span className="truncate">{task.title}</span>
              </div>
              <span className="font-numeric text-[10px] text-[var(--text-muted)] shrink-0 pl-1 tabular-nums">
                {task.time}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Love Note Input */}
      <form onSubmit={handleSendQuickNote} className="relative mt-1">
        <input
          type="text"
          value={quickMsg}
          onChange={(e) => setQuickMsg(e.target.value)}
          placeholder={`Leave a note for ${partnerUser.displayName}...`}
          className="w-full pl-3 pr-10 py-2.5 bg-[var(--surface-2)] border-2 border-[var(--border)] rounded-2xl text-xs font-body text-[var(--text)] placeholder-[var(--text-muted)]/50 focus:outline-none focus:border-[var(--partner-a)] shadow-[0_1px_0_var(--shadow-color)]"
        />
        <button
          type="submit"
          disabled={!quickMsg.trim()}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-[var(--partner-a)] hover:opacity-80 disabled:opacity-30 transition-opacity cursor-pointer font-chunky font-bold"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
