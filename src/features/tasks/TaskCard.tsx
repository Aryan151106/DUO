import React, { useState, useEffect } from 'react';
import { duoDataStore } from '../../lib/dataStore';
import type { TaskItem } from '../../lib/dataStore';
import { useAuthStore } from '../../lib/store';
import { soundManager } from '../../lib/sound';
import { broadcastEvent } from '../../lib/supabase';
import { isInQuietHours } from '../../lib/time';
import { useQueryClient } from '@tanstack/react-query';
import confetti from 'canvas-confetti';
import { useTaskStore } from '../../lib/tasksStore';
import { useNotificationStore } from '../../lib/notifications';
import {
  Check,
  Bell,
  Trash2,
  User,
  Flame,
  Image as ImageIcon,
  Clock,
  AlertTriangle,
  Repeat,
} from 'lucide-react';
import { AttachmentPreview } from '../chat/AttachmentPreview';
import {
  useTaskReminderStore,
  getNudgeRemainingSeconds,
} from '../../lib/taskReminders';

interface TaskCardProps {
  task: TaskItem;
  isOverdue?: boolean;
  onOpenDoodlePreview?: (url: string) => void;
}

export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  isOverdue = false,
  onOpenDoodlePreview,
}) => {
  const { currentUser, partnerUser, couple, timeFormat } = useAuthStore();
  const queryClient = useQueryClient();
  const [isNudging, setIsNudging] = useState(false);
  const [nudgeFeedback, setNudgeFeedback] = useState<string | null>(null);
  const [nudgeSecondsLeft, setNudgeSecondsLeft] = useState<number>(0);

  const { recordNudge } = useTaskReminderStore();

  const isAssignedToPartner = task.assigned_to === partnerUser.id;
  const isCreatedByMe = task.created_by === currentUser.id;
  const isDone = task.status === 'done';
  const isDoing = task.status === 'doing';
  const isUrgent = task.priority === 'urgent';

  const ownerColor = isCreatedByMe ? 'var(--partner-a)' : 'var(--partner-b)';

  // Periodically refresh nudge cooldown
  useEffect(() => {
    const updateCooldown = () => {
      setNudgeSecondsLeft(getNudgeRemainingSeconds(task.id));
    };
    updateCooldown();
    const timer = setInterval(updateCooldown, 1000);
    return () => clearInterval(timer);
  }, [task.id]);

  // Format start time & dual timezone
  let startTimeDisplay: string | null = null;
  let dualTimeDisplay: string | null = null;

  if (task.startAt) {
    try {
      const startAtDate = new Date(task.startAt);
      const is12h = timeFormat === '12h' || timeFormat === 'auto';

      const myTime = new Intl.DateTimeFormat(undefined, {
        timeZone: currentUser.timezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: is12h,
      }).format(startAtDate);

      startTimeDisplay = myTime;

      // If viewing task for the other person or creator has different timezone
      if (currentUser.timezone !== partnerUser.timezone) {
        const partnerTime = new Intl.DateTimeFormat(undefined, {
          timeZone: partnerUser.timezone,
          hour: 'numeric',
          minute: '2-digit',
          hour12: is12h,
        }).format(startAtDate);

        dualTimeDisplay = `${myTime} (${partnerUser.displayName}'s ${partnerTime})`;
      }
    } catch {
      startTimeDisplay = null;
    }
  }

  // Reminder status on creator's card
  const latestReminder = task.reminders && task.reminders.length > 0 ? task.reminders[0] : null;
  const reminderStatus = latestReminder
    ? isDone
      ? 'Done'
      : task.snoozedUntil
      ? 'Snoozed'
      : latestReminder.sent
      ? 'Sent'
      : 'Scheduled'
    : null;

  const handleToggleStatus = async () => {
    let newStatus: 'todo' | 'doing' | 'done' = 'todo';
    if (task.status === 'todo') newStatus = 'doing';
    else if (task.status === 'doing') newStatus = 'done';
    else if (task.status === 'done') newStatus = 'todo';

    if (newStatus === 'done') {
      soundManager.playGentleChime();
      confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.7 },
        colors: ['#FF6B6B', '#7C6CF2', '#FFD166'],
      });

      // Award points
      const scores = duoDataStore.getScores();
      scores.push({
        id: `sc-${Date.now()}`,
        couple_id: couple?.id || 'couple-duo-main',
        user_id: currentUser.id,
        task_id: task.id,
        kind: 'done',
        points: 10,
        day: new Date().toISOString().split('T')[0],
        created_at: new Date().toISOString(),
      });
      duoDataStore.saveScores(scores);
    } else {
      soundManager.playPing();
    }

    const isDemo = useAuthStore.getState().isDemoMode;

    if (!isDemo && couple?.id) {
      try {
        await useTaskStore.getState().updateTask(couple.id, task.id, {
          status: newStatus,
          completed_at: newStatus === 'done' ? new Date().toISOString() : null,
          completed_by: newStatus === 'done' ? currentUser.id : null,
        });
      } catch (err) {
        console.error('Failed to update Firestore task via useTaskStore:', err);
      }
    } else {
      const tasks = duoDataStore.getTasks();
      const updated = tasks.map((t) =>
        t.id === task.id
          ? {
              ...t,
              status: newStatus,
              completed_at: newStatus === 'done' ? new Date().toISOString() : null,
              completed_by: newStatus === 'done' ? currentUser.id : null,
              updated_at: new Date().toISOString(),
            }
          : t
      );
      duoDataStore.saveTasks(updated);

      const updatedTask = updated.find((t) => t.id === task.id);
      broadcastEvent(
        'TASK_MUTATION',
        { action: 'update', task: updatedTask },
        currentUser.id,
        couple?.id || ''
      );
    }

    if (task.assigned_to === partnerUser.id) {
      const actionText = newStatus === 'done' ? 'completed your task! 🎉' : `marked your task as ${newStatus}`;
      useNotificationStore.getState().sendNotification({
        coupleId: couple?.id || 'couple-duo-main',
        senderId: currentUser.id,
        senderName: currentUser.displayName,
        type: 'task',
        title: `${currentUser.displayName} ${actionText}`,
        body: `"${task.title}"`,
        deepLink: '/?action=today',
      });
    }

    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    queryClient.invalidateQueries({ queryKey: ['scores'] });
  };

  const handleNudge = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDone || isDoing) return;

    // Check cooldown
    if (nudgeSecondsLeft > 0) {
      const mins = Math.ceil(nudgeSecondsLeft / 60);
      setNudgeFeedback(`Cooldown: wait ${mins}m`);
      setTimeout(() => setNudgeFeedback(null), 2500);
      return;
    }

    const partnerQuiet = isInQuietHours(
      partnerUser.quietHoursStart,
      partnerUser.quietHoursEnd,
      partnerUser.timezone
    );

    if (partnerQuiet && !isUrgent) {
      setNudgeFeedback(`${partnerUser.displayName} is in quiet hours 🌙`);
      setTimeout(() => setNudgeFeedback(null), 3000);
      return;
    }

    setIsNudging(true);
    soundManager.playPing();
    recordNudge(task.id);

    broadcastEvent(
      'NUDGE_TRIGGERED',
      {
        id: `nudge-${Date.now()}`,
        taskId: task.id,
        taskTitle: task.title,
        level: 1,
        level4Count: 0,
      },
      currentUser.id,
      couple?.id || ''
    );

    setNudgeFeedback(`Nudged ${partnerUser.displayName}! 🔔`);
    setTimeout(() => {
      setIsNudging(false);
      setNudgeFeedback(null);
    }, 2500);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const isDemo = useAuthStore.getState().isDemoMode;

    if (!isDemo && couple?.id) {
      try {
        await useTaskStore.getState().deleteTask(couple.id, task.id);
      } catch (err) {
        console.error('Failed to delete Firestore task via useTaskStore:', err);
      }
    } else {
      const tasks = duoDataStore.getTasks();
      const updated = tasks.filter((t) => t.id !== task.id);
      duoDataStore.saveTasks(updated);

      broadcastEvent('TASK_MUTATION', { action: 'delete', task }, currentUser.id, couple?.id || '');
    }

    if (task.assigned_to === partnerUser.id) {
      useNotificationStore.getState().sendNotification({
        coupleId: couple?.id || 'couple-duo-main',
        senderId: currentUser.id,
        senderName: currentUser.displayName,
        type: 'task',
        title: `${currentUser.displayName} deleted a task 🗑️`,
        body: `"${task.title}" was removed`,
        deepLink: '/?action=today',
      });
    }

    queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };

  return (
    <div
      onClick={handleToggleStatus}
      className={`group relative rounded-2xl p-4 sm:p-5 transition-all duration-200 cursor-pointer border-2 shadow-[0_3px_0_var(--shadow-color)] ${
        isDone
          ? 'bg-[var(--surface-2)] border-[var(--border)] opacity-85'
          : isUrgent
          ? 'bg-[var(--surface)] border-[var(--urgent)]'
          : isDoing
          ? 'bg-[var(--surface)] border-[var(--accent)]'
          : 'bg-[var(--surface)] border-[var(--border)] hover:border-[var(--accent)]'
      }`}
    >
      <div className="flex items-start gap-3.5">
        {/* Checkbox button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleToggleStatus();
          }}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2 -mt-1 cursor-pointer shrink-0"
          title={isDone ? 'Mark as todo' : 'Complete task'}
        >
          <div
            className={`w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all ${
              isDone
                ? 'border-[var(--border)] shadow-[0_1px_0_var(--shadow-color)]'
                : 'border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--partner-a)]'
            }`}
            style={{
              backgroundColor: isDone ? ownerColor : undefined,
              borderColor: isDone ? 'var(--border)' : undefined,
            }}
          >
            {isDone && <Check className="w-4 h-4 text-white stroke-[3]" />}
          </div>
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Top Start Time & Overdue Badges */}
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {startTimeDisplay && (
              <span className="inline-flex items-center gap-1 font-numeric text-xs font-bold text-[var(--text)] bg-[var(--surface-2)] px-2.5 py-0.5 rounded-lg border border-[var(--border)]">
                <Clock className="w-3 h-3 text-[var(--accent)]" />
                <span>{startTimeDisplay}</span>
              </span>
            )}

            {isOverdue && !isDone && (
              <span className="inline-flex items-center gap-1 font-ui text-[11px] font-bold text-white bg-[var(--urgent)] px-2 py-0.5 rounded-lg">
                <AlertTriangle className="w-3 h-3" />
                <span>Overdue</span>
              </span>
            )}

            {isUrgent && (
              <span className="px-2 py-0.5 rounded-lg bg-[var(--urgent)] text-white text-[10px] font-chunky font-bold uppercase tracking-wider">
                Urgent
              </span>
            )}

            {task.repeatRule && task.repeatRule !== 'once' && (
              <span className="inline-flex items-center gap-1 font-ui text-[11px] text-[var(--text-muted)] bg-[var(--surface-2)] px-2 py-0.5 rounded-lg border border-[var(--border)] capitalize">
                <Repeat className="w-3 h-3" />
                <span>{task.repeatRule}</span>
              </span>
            )}
          </div>

          {/* Title */}
          <h3
            className={`font-chunky text-[17px] font-bold leading-snug transition-colors ${
              isDone ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text)]'
            }`}
          >
            {task.title}
          </h3>

          {/* Dual timezone hint */}
          {dualTimeDisplay && (
            <div className="text-[11px] font-ui text-[var(--text-muted)] mt-0.5">
              🌍 {dualTimeDisplay}
            </div>
          )}

          {/* Description */}
          {task.description && (
            <p className="font-body font-normal text-xs text-[var(--text-muted)] line-clamp-2 mt-1">
              {task.description}
            </p>
          )}

          {/* Attachments preview chip */}
          {task.attachments && task.attachments.length > 0 && (
            <AttachmentPreview attachments={task.attachments} compactTaskChip />
          )}

          {/* Attached doodle pill */}
          {task.doodle_url && (
            <div
              onClick={(e) => {
                e.stopPropagation();
                onOpenDoodlePreview?.(task.doodle_url!);
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 mt-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-xs font-hand text-[var(--text)] hover:opacity-80 transition-opacity cursor-pointer"
            >
              <ImageIcon className="w-3.5 h-3.5 text-[var(--partner-a)]" />
              <span>Doodle note 🎨</span>
            </div>
          )}

          {/* Badges row: Scope, Reminder Status, In-Progress */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {isAssignedToPartner && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-[var(--partner-b)]/40 bg-[var(--partner-b)]/15 text-[var(--text)] text-[11px] font-ui font-semibold">
                <User className="w-3 h-3 text-[var(--partner-b)]" />
                <span>{partnerUser.displayName || 'Vidhi'}'s task</span>
              </span>
            )}

            {/* Reminder status on creator's card */}
            {isCreatedByMe && reminderStatus && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--surface-2)] border border-[var(--border)] text-[11px] font-ui font-semibold text-[var(--text-muted)]">
                <Bell className="w-3 h-3 text-[var(--accent)]" />
                <span>{reminderStatus}</span>
              </span>
            )}

            {/* Nudge partner button: only for partner's uncompleted tasks */}
            {isAssignedToPartner && !isDone && (
              <button
                type="button"
                onClick={handleNudge}
                disabled={isNudging}
                title={nudgeSecondsLeft > 0 ? `Nudge cooldown (${nudgeSecondsLeft}s)` : `Nudge ${partnerUser.displayName || 'partner'}`}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[var(--accent)] hover:opacity-90 text-[var(--text)] border-2 border-[var(--border)] text-xs font-chunky font-bold cursor-pointer shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none disabled:opacity-60 transition-all shrink-0"
              >
                <Bell className="w-3.5 h-3.5" />
                <span>
                  {nudgeSecondsLeft > 0
                    ? `Nudge (${Math.ceil(nudgeSecondsLeft / 60)}m)`
                    : 'Nudge now'}
                </span>
              </button>
            )}

            {isDoing && (
              <span className="px-2.5 py-0.5 text-[11px] font-chunky font-bold rounded-full bg-[var(--accent)] text-[var(--text)] border border-[var(--border)] shadow-[0_1px_0_var(--shadow-color)]">
                In Progress ⚡
              </span>
            )}
            {isDone && (
              <span className="px-2.5 py-0.5 text-[11px] font-chunky font-bold rounded-full bg-[var(--success)]/20 text-[var(--text)] border border-[var(--success)]/40">
                Done! 🎉
              </span>
            )}
          </div>

          {/* Nudge feedback notification */}
          {nudgeFeedback && (
            <div className="mt-2 text-xs font-loud uppercase tracking-wider text-[var(--urgent)] flex items-center gap-1.5 bg-[var(--urgent)]/10 border border-[var(--urgent)]/30 px-2.5 py-1 rounded-xl">
              <Flame className="w-3.5 h-3.5 text-[var(--urgent)]" />
              <span>{nudgeFeedback}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center shrink-0 -mt-1 -mr-1">
          <button
            onClick={handleDelete}
            className="p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--urgent)] hover:bg-[var(--surface-2)] transition-colors opacity-70 hover:opacity-100 cursor-pointer min-w-[40px] min-h-[40px] flex items-center justify-center"
            title="Delete task"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
