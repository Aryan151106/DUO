import React, { useEffect } from 'react';
import { useNudgeStore, useAuthStore } from '../../lib/store';
import { soundManager } from '../../lib/sound';
import { broadcastEvent } from '../../lib/supabase';
import { duoDataStore } from '../../lib/dataStore';
import { useQueryClient } from '@tanstack/react-query';
import confetti from 'canvas-confetti';
import { Bell, Flame, CheckCircle, HandMetal, AlertTriangle } from 'lucide-react';

export const NudgeAlarmOverlay: React.FC = () => {
  const { activeNudge, showOverlay, closeNudge } = useNudgeStore();
  const { currentUser, couple } = useAuthStore();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (showOverlay && activeNudge) {
      if (activeNudge.level >= 4) {
        soundManager.startLevel4Alarm();
      } else if (activeNudge.level === 3) {
        soundManager.playUrgentAlert();
      } else {
        soundManager.playPing();
      }
    }
    return () => {
      soundManager.stopLevel4Alarm();
    };
  }, [showOverlay, activeNudge?.level]);

  if (!showOverlay || !activeNudge) return null;

  const isLevel4 = activeNudge.level >= 4;

  const handleDone = () => {
    soundManager.stopLevel4Alarm();
    soundManager.playGentleChime();
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#f43f5e', '#a855f7', '#38bdf8', '#34d399']
    });

    // Update task in store
    const tasks = duoDataStore.getTasks();
    const updated = tasks.map(t =>
      t.id === activeNudge.taskId
        ? { ...t, status: 'done' as const, completed_at: new Date().toISOString() }
        : t
    );
    duoDataStore.saveTasks(updated);

    // Award authoritative score
    const scores = duoDataStore.getScores();
    scores.push({
      id: `score-${Date.now()}`,
      couple_id: couple?.id || 'couple-duo-main',
      user_id: currentUser.id,
      task_id: activeNudge.taskId,
      kind: 'done',
      points: 10,
      day: new Date().toISOString().split('T')[0],
      created_at: new Date().toISOString()
    });
    scores.push({
      id: `score-fast-${Date.now()}`,
      couple_id: couple?.id || 'couple-duo-main',
      user_id: currentUser.id,
      task_id: activeNudge.taskId,
      kind: 'nudge_fast',
      points: 5,
      day: new Date().toISOString().split('T')[0],
      created_at: new Date().toISOString()
    });
    duoDataStore.saveScores(scores);

    // Broadcast resolve
    broadcastEvent('NUDGE_RESOLVED', { taskId: activeNudge.taskId, action: 'done' }, currentUser.id, couple?.id || '');
    broadcastEvent('TASK_MUTATION', { action: 'update', task: updated.find(t => t.id === activeNudge.taskId) }, currentUser.id, couple?.id || '');

    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    queryClient.invalidateQueries({ queryKey: ['scores'] });
    closeNudge();
  };

  const handleDoing = () => {
    soundManager.stopLevel4Alarm();
    const tasks = duoDataStore.getTasks();
    const updated = tasks.map(t =>
      t.id === activeNudge.taskId ? { ...t, status: 'doing' as const } : t
    );
    duoDataStore.saveTasks(updated);

    broadcastEvent('TASK_MUTATION', { action: 'update', task: updated.find(t => t.id === activeNudge.taskId) }, currentUser.id, couple?.id || '');
    broadcastEvent('NUDGE_RESOLVED', { taskId: activeNudge.taskId, action: 'doing' }, currentUser.id, couple?.id || '');

    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    closeNudge();
  };

  const handleMercy = () => {
    soundManager.stopLevel4Alarm();
    soundManager.playPing();
    broadcastEvent('NUDGE_RESOLVED', { taskId: activeNudge.taskId, action: 'mercy' }, currentUser.id, couple?.id || '');
    closeNudge();
  };

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-300 ${
      isLevel4
        ? 'bg-red-950/90 backdrop-blur-md animate-pulse-fast'
        : 'bg-black/75 backdrop-blur-sm'
    }`}>
      <div className={`relative w-full max-w-md rounded-3xl p-6 text-center transition-all ${
        isLevel4
          ? 'bg-[var(--surface)] border-3 border-[var(--urgent)] shadow-[0_4px_0_var(--shadow-color)] animate-nudge-shake'
          : 'bg-[var(--surface)] border-3 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)]'
      }`}>
        {/* Urgent header badge */}
        <div className="flex justify-center mb-3">
          <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-loud tracking-[0.03em] uppercase ${
            isLevel4
              ? 'bg-[var(--urgent)] text-white shadow-[0_2px_0_var(--shadow-color)]'
              : 'bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)]'
          }`}>
            {isLevel4 ? (
              <>
                <Flame className="w-4 h-4 fill-current animate-spin" />
                <span>URGENT ESCALATION SIREN</span>
              </>
            ) : (
              <>
                <Bell className="w-4 h-4" />
                <span>LEVEL {activeNudge.level} REMINDER</span>
              </>
            )}
          </div>
        </div>

        {/* Icon */}
        <div className="flex justify-center my-4">
          <div className={`w-20 h-20 rounded-3xl border-3 border-[var(--border)] shadow-[0_3px_0_var(--shadow-color)] flex items-center justify-center ${
            isLevel4
              ? 'bg-[var(--urgent)] text-white'
              : 'bg-[var(--accent)] text-[var(--text)]'
          }`}>
            {isLevel4 ? (
              <AlertTriangle className="w-10 h-10 animate-bounce" />
            ) : (
              <Bell className="w-9 h-9 animate-bounce" />
            )}
          </div>
        </div>

        {/* Nudge headlines: --font-loud, uppercase, letter-spacing 0.03em */}
        <h2 className="font-loud text-3xl uppercase tracking-[0.03em] text-[var(--text)] mb-2">
          {isLevel4 ? 'URGENT NUDGE!' : 'THINKING OF YOU!'}
        </h2>
        
        {/* Nudge subtext and sender: --font-ui 500 */}
        <p className="font-ui font-medium text-sm text-[var(--text-muted)] mb-4">
          {activeNudge.senderName} nudged you: {isLevel4
            ? "This task is critically overdue! Don't let your partner hang."
            : "A gentle partner reminder to get this done together."}
        </p>

        <div className="bg-[var(--surface-2)] border-2 border-[var(--border)] rounded-2xl p-4 mb-6 text-left shadow-[0_2px_0_var(--shadow-color)]">
          <div className="font-ui text-xs uppercase text-[var(--text-muted)] font-semibold tracking-wide mb-1">
            Task Due:
          </div>
          <div className="font-chunky text-base font-bold text-[var(--text)]">
            {activeNudge.taskTitle}
          </div>
        </div>

        {/* Action Buttons: --font-chunky 700 */}
        <div className="space-y-3">
          <button
            onClick={handleDone}
            className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl bg-[var(--success)] text-white font-chunky font-bold text-base border-2 border-[var(--border)] shadow-[0_3px_0_var(--shadow-color)] active:translate-y-1 active:shadow-none transition-all cursor-pointer"
          >
            <CheckCircle className="w-5 h-5" />
            <span>Done! (+15 pts)</span>
          </button>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handleDoing}
              className="flex items-center justify-center gap-2 py-3 px-3 rounded-2xl bg-[var(--surface-2)] hover:bg-[var(--accent)]/30 text-[var(--text)] font-chunky font-bold text-xs border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none transition-all cursor-pointer"
            >
              <span>Doing right now</span>
            </button>
            <button
              onClick={handleMercy}
              className="flex items-center justify-center gap-2 py-3 px-3 rounded-2xl bg-[var(--surface-2)] hover:bg-[var(--urgent)]/20 text-[var(--text)] font-chunky font-bold text-xs border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none transition-all cursor-pointer"
            >
              <HandMetal className="w-4 h-4 text-[var(--urgent)]" />
              <span>Mercy 🙏</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
