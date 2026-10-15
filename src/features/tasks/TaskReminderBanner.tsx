import React, { useEffect, useRef } from 'react';
import { useTaskReminderStore } from '../../lib/taskReminders';
import { useAuthStore } from '../../lib/store';
import { duoDataStore } from '../../lib/dataStore';
import { updateTask } from '../../lib/firestore';
import { soundManager, soundEffects } from '../../lib/sound';
import { soundEngine } from '../../lib/sounds';
import { broadcastEvent } from '../../lib/supabase';
import confetti from 'canvas-confetti';
import { Bell, Check, Clock, X, AlertTriangle } from 'lucide-react';

export const TaskReminderBanner: React.FC = () => {
  const { activeBanner, dismissBanner } = useTaskReminderStore();
  const { currentUser, couple, isDemoMode } = useAuthStore();
  const alarmStopRef = useRef<(() => void) | null>(null);

  // Play recipient's chosen alarm sound on reminder
  useEffect(() => {
    if (!activeBanner) {
      if (alarmStopRef.current) {
        alarmStopRef.current();
        alarmStopRef.current = null;
      }
      return;
    }

    const settings = soundEngine.getSettings();
    const soundId =
      activeBanner.priority === 'urgent'
        ? settings.urgentTaskAlarmSoundId || 'alarm-bells'
        : settings.taskAlarmSoundId || 'alarm-gentle-rise';

    soundEngine
      .play(soundId, {
        category: 'alarm',
        loop: settings.alarmStyle !== 'once',
      })
      .then((handle) => {
        alarmStopRef.current = handle.stop;
      });

    if (settings.alarmVibration) {
      soundEngine.vibrate([300, 150, 300, 150, 400]);
    }

    return () => {
      if (alarmStopRef.current) {
        alarmStopRef.current();
        alarmStopRef.current = null;
      }
    };
  }, [activeBanner]);

  if (!activeBanner) return null;

  const handleDone = async () => {
    soundManager.playGentleChime();
    confetti({
      particleCount: 50,
      spread: 70,
      origin: { y: 0.3 },
      colors: ['#FF6B6B', '#7C6CF2', '#FFD166'],
    });

    const nowIso = new Date().toISOString();

    if (isDemoMode) {
      const tasks = duoDataStore.getTasks();
      const updated = tasks.map((t) =>
        t.id === activeBanner.taskId
          ? {
              ...t,
              status: 'done' as const,
              completed_at: nowIso,
              completed_by: currentUser.id,
              updated_at: nowIso,
            }
          : t
      );
      duoDataStore.saveTasks(updated);

      // Award points
      const scores = duoDataStore.getScores();
      scores.push({
        id: `sc-${Date.now()}`,
        couple_id: couple?.id || 'couple-duo-main',
        user_id: currentUser.id,
        task_id: activeBanner.taskId,
        kind: 'done',
        points: 10,
        day: nowIso.split('T')[0],
        created_at: nowIso,
      });
      duoDataStore.saveScores(scores);

      broadcastEvent(
        'TASK_MUTATION',
        { action: 'update', task: updated.find((t) => t.id === activeBanner.taskId) },
        currentUser.id,
        couple?.id || ''
      );
    } else if (couple?.id) {
      try {
        await updateTask(couple.id, activeBanner.taskId, {
          status: 'done',
          completedAt: nowIso,
          completedBy: currentUser.id,
        });
      } catch (err) {
        console.error('Failed to complete task from reminder banner:', err);
      }
    }

    handleDismiss();
  };

  const handleSnooze = async () => {
    soundEffects.playPop();
    const snoozeUntilIso = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    if (isDemoMode) {
      const tasks = duoDataStore.getTasks();
      const updated = tasks.map((t) =>
        t.id === activeBanner.taskId ? { ...t, snoozedUntil: snoozeUntilIso } : t
      );
      duoDataStore.saveTasks(updated);
    } else if (couple?.id) {
      try {
        await updateTask(couple.id, activeBanner.taskId, {
          snoozedUntil: snoozeUntilIso,
        });
      } catch (err) {
        console.error('Failed to snooze task:', err);
      }
    }

    handleDismiss();
  };

  const handleDismiss = () => {
    if (alarmStopRef.current) {
      alarmStopRef.current();
      alarmStopRef.current = null;
    }
    dismissBanner();
  };

  const isUrgent = activeBanner.priority === 'urgent';

  return (
    <div
      role="alert"
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-md p-4 rounded-3xl bg-[var(--surface)] text-[var(--text)] border-3 ${
        isUrgent ? 'border-[var(--urgent)]' : 'border-[var(--border)]'
      } shadow-[0_6px_0_var(--shadow-color)] animate-in fade-in slide-in-from-top-4 duration-200`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-9 h-9 rounded-2xl ${
              isUrgent
                ? 'bg-[var(--urgent)] text-white'
                : 'bg-[var(--accent)] text-[var(--text)]'
            } border-2 border-[var(--border)] flex items-center justify-center shrink-0 shadow-xs`}
          >
            {isUrgent ? (
              <AlertTriangle className="w-4 h-4 stroke-[2.5]" />
            ) : (
              <Bell className="w-4 h-4 stroke-[2.5]" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-ui text-xs text-[var(--text-muted)] font-medium">
                Task from {activeBanner.senderName}
              </span>
              {isUrgent && (
                <span className="px-1.5 py-0.2 rounded-md bg-[var(--urgent)] text-white text-[9px] font-chunky font-bold uppercase tracking-wider">
                  Urgent
                </span>
              )}
            </div>
            <h4 className="font-chunky text-sm font-bold text-[var(--text)] truncate">
              {activeBanner.title}
            </h4>
          </div>
        </div>

        <button
          type="button"
          onClick={handleDismiss}
          className="p-1.5 rounded-full hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {activeBanner.personalMessage && (
        <div className="mb-3 px-3 py-1.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-xs font-body text-[var(--text)] italic">
          "{activeBanner.personalMessage}"
        </div>
      )}

      {/* Action Buttons: Done / Snooze 10m / Got it */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t-2 border-[var(--border)]">
        <span className="font-numeric text-xs font-bold text-[var(--text-muted)]">
          ⏰ {activeBanner.timeText}
        </span>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleSnooze}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface)] text-[var(--text)] border-2 border-[var(--border)] font-ui text-xs font-semibold shadow-xs active:translate-y-0.5 cursor-pointer"
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Snooze 10m</span>
          </button>

          <button
            type="button"
            onClick={handleDone}
            className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-xl bg-[var(--success)] text-white border-2 border-[var(--border)] font-chunky text-xs font-bold shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5 stroke-[3]" />
            <span>Done</span>
          </button>
        </div>
      </div>
    </div>
  );
};
