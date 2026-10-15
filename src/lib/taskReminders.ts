/**
 * Task Reminders & Partner Notification Engine for Duo.
 * Supports relative offsets, custom times, Quiet Hours, Snooze 10m,
 * Done action, deduplication, and service worker push triggers.
 */
import { create } from 'zustand';
import type { TaskItem } from './dataStore';
import { soundManager } from './sound';
import { isInQuietHours } from './time';

export interface TaskReminder {
  id: string;
  minutesBefore: number; // 0, 5, 15, 30, 60, 1440, etc. -1 for custom
  customRemindAt?: string;
  remindAt: string; // ISO UTC string
  targetUserId: string; // partner ID or 'both'
  alsoRemindCreator?: boolean;
  personalMessage?: string;
  sent?: boolean;
  seen?: boolean;
  snoozedUntil?: string | null;
  status?: 'scheduled' | 'sent' | 'seen' | 'snoozed' | 'done';
}

export interface ActiveTaskBanner {
  id: string;
  taskId: string;
  title: string;
  timeText: string;
  senderName: string;
  personalMessage?: string;
  priority?: 'normal' | 'important' | 'urgent';
}

interface TaskReminderStore {
  activeBanner: ActiveTaskBanner | null;
  dismissBanner: () => void;
  triggerBanner: (banner: ActiveTaskBanner) => void;
  // Nudge cooldowns (10 min cooldown per task)
  lastNudgeTimes: Record<string, number>;
  recordNudge: (taskId: string) => void;
}

export const useTaskReminderStore = create<TaskReminderStore>((set) => ({
  activeBanner: null,
  dismissBanner: () => set({ activeBanner: null }),
  triggerBanner: (banner) => set({ activeBanner: banner }),
  lastNudgeTimes: {},
  recordNudge: (taskId) =>
    set((state) => ({
      lastNudgeTimes: { ...state.lastNudgeTimes, [taskId]: Date.now() },
    })),
}));

/**
 * 10-minute cooldown in ms
 */
export const NUDGE_COOLDOWN_MS = 10 * 60 * 1000;

export function getNudgeRemainingSeconds(taskId: string): number {
  const last = useTaskReminderStore.getState().lastNudgeTimes[taskId] || 0;
  const elapsed = Date.now() - last;
  if (elapsed >= NUDGE_COOLDOWN_MS) return 0;
  return Math.ceil((NUDGE_COOLDOWN_MS - elapsed) / 1000);
}

/**
 * Build reminder schedule list for a task.
 */
export function buildTaskReminders(
  startAt: string | null | undefined,
  taskDate: string,
  minutesList: number[],
  targetUserId: string,
  alsoRemindCreator?: boolean,
  personalMessage?: string,
  customTimeString?: string
): TaskReminder[] {
  const result: TaskReminder[] = [];

  for (const minutes of minutesList) {
    let remindAtDate: Date;

    if (!startAt) {
      // For tasks without start time ("Anytime"), schedule relative to custom time or 9:00 AM on taskDate
      const baseTime = customTimeString ? `${taskDate}T${customTimeString}:00` : `${taskDate}T09:00:00`;
      remindAtDate = new Date(new Date(baseTime).getTime() - minutes * 60000);
    } else {
      remindAtDate = new Date(new Date(startAt).getTime() - minutes * 60000);
    }

    result.push({
      id: `taskrem-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      minutesBefore: minutes,
      remindAt: remindAtDate.toISOString(),
      targetUserId,
      alsoRemindCreator,
      personalMessage: personalMessage?.trim() || undefined,
      sent: false,
      status: 'scheduled',
    });
  }

  // If a custom reminder time was provided
  if (customTimeString && !minutesList.includes(-1)) {
    const customDate = new Date(`${taskDate}T${customTimeString}:00`);
    result.push({
      id: `taskrem-custom-${Date.now()}`,
      minutesBefore: -1,
      customRemindAt: customTimeString,
      remindAt: customDate.toISOString(),
      targetUserId,
      alsoRemindCreator,
      personalMessage: personalMessage?.trim() || undefined,
      sent: false,
      status: 'scheduled',
    });
  }

  // Cap at 3 reminders per task
  return result.slice(0, 3);
}

/**
 * Deduplication cache of fired reminders in this session
 */
const sentTaskReminderIds = new Set<string>();

/**
 * Checks all pending task reminders and fires push/banner notifications.
 */
export function checkAndFireDueTaskReminders(
  tasks: TaskItem[],
  currentUserId: string,
  userTimezone: string,
  now: Date,
  quietHoursStart: string = '23:00',
  quietHoursEnd: string = '07:00',
  partnerName: string = 'Your partner',
  onTaskUpdated?: (updatedTask: TaskItem) => void
) {
  const nowMs = now.getTime();
  const isQuiet = isInQuietHours(quietHoursStart, quietHoursEnd, userTimezone, now);

  for (const task of tasks) {
    // Never remind for completed or deleted tasks
    if (task.status === 'done' || task.deleted_at || !task.reminders) continue;

    // Check if task is snoozed
    if (task.snoozedUntil && new Date(task.snoozedUntil).getTime() > nowMs) {
      continue;
    }

    let modified = false;

    for (const reminder of task.reminders) {
      if (reminder.sent || sentTaskReminderIds.has(reminder.id)) continue;

      const remindAtMs = new Date(reminder.remindAt).getTime();

      // If reminder time has arrived
      if (remindAtMs <= nowMs && nowMs - remindAtMs < 10 * 60 * 1000) {
        // Quiet Hours check: non-urgent reminders wait until quiet hours end
        if (isQuiet && task.priority !== 'urgent') {
          continue;
        }

        // Target check: is this reminder for the current user?
        const isTarget =
          reminder.targetUserId === currentUserId ||
          reminder.targetUserId === 'both' ||
          (reminder.alsoRemindCreator && task.created_by === currentUserId);

        if (!isTarget) continue;

        // Mark as sent immediately to avoid duplicate triggers
        sentTaskReminderIds.add(reminder.id);
        reminder.sent = true;
        reminder.status = 'sent';
        modified = true;

        const timeText = task.startAt
          ? new Intl.DateTimeFormat(undefined, {
              timeZone: userTimezone,
              hour: 'numeric',
              minute: '2-digit',
            }).format(new Date(task.startAt))
          : 'Today';

        const senderDisplayName =
          task.created_by === currentUserId ? 'You' : partnerName;

        const title = `Task for you from ${senderDisplayName}`;
        const body = reminder.personalMessage
          ? `${task.title} • ${reminder.personalMessage} (${timeText})`
          : `${task.title} • ${timeText}`;

        // 1. Play chime if audio is supported
        if (typeof window !== 'undefined' && (typeof AudioContext !== 'undefined' || typeof (window as any).webkitAudioContext !== 'undefined')) {
          try {
            soundManager.playGentleChime();
          } catch {
            // Ignored in test environment
          }
        }

        // 2. Show in-app banner
        useTaskReminderStore.getState().triggerBanner({
          id: reminder.id,
          taskId: task.id,
          title: task.title,
          timeText,
          senderName: senderDisplayName,
          personalMessage: reminder.personalMessage,
          priority: task.priority,
        });

        // 3. System Web Push / Service Worker notification with actions
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
          try {
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
              navigator.serviceWorker.ready.then((reg) => {
                reg.showNotification(title, {
                  body,
                  icon: '/pwa-192x192.png',
                  badge: '/logo.svg',
                  tag: `task-${task.id}`,
                  renotify: true,
                  data: { taskId: task.id, type: 'task_reminder' },
                  actions: [
                    { action: 'done', title: 'Done ✓' },
                    { action: 'snooze', title: 'Snooze 10m' },
                  ],
                } as NotificationOptions & { renotify?: boolean; actions?: Array<{ action: string; title: string }> });
              });
            } else {
              new Notification(title, {
                body,
                icon: '/logo.svg',
                tag: `task-${task.id}`,
              });
            }
          } catch (e) {
            console.warn('Native notification failed:', e);
          }
        }
      }
    }

    if (modified && onTaskUpdated) {
      onTaskUpdated(task);
    }
  }
}
