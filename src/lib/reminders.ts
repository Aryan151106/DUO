import { create } from 'zustand';
import type { CalendarEvent } from './calendar';
import { formatEventTime } from './calendar';
import { soundManager } from './sound';

export interface ActiveReminderBanner {
  id: string;
  eventId: string;
  title: string;
  timeText: string;
  customMessage?: string;
}

interface ReminderStore {
  activeBanner: ActiveReminderBanner | null;
  permissionStatus: NotificationPermission | 'unsupported';
  dismissBanner: () => void;
  triggerBanner: (banner: ActiveReminderBanner) => void;
  requestPermission: () => Promise<NotificationPermission | 'unsupported'>;
}

export const useReminderStore = create<ReminderStore>((set) => ({
  activeBanner: null,
  permissionStatus:
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'unsupported',

  dismissBanner: () => set({ activeBanner: null }),

  triggerBanner: (banner) => set({ activeBanner: banner }),

  requestPermission: async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      set({ permissionStatus: 'unsupported' });
      return 'unsupported';
    }

    try {
      const perm = await Notification.requestPermission();
      set({ permissionStatus: perm });
      return perm;
    } catch (e) {
      set({ permissionStatus: 'denied' });
      return 'denied';
    }
  },
}));

/**
 * Checks pending reminders against the current time and fires notifications.
 * Guaranteed no duplicate alerts via the sentReminderIds set and sent property.
 */
const sentReminderIds = new Set<string>();

export function checkAndFireDueReminders(
  events: CalendarEvent[],
  currentUserId: string,
  userTimezone: string,
  now: Date,
  onReminderSent?: (eventId: string, reminderId: string) => void
) {
  const nowMs = now.getTime();

  for (const event of events) {
    if (event.deletedAt || !event.reminders) continue;

    for (const reminder of event.reminders) {
      if (reminder.sent || sentReminderIds.has(reminder.id)) continue;

      const remindAtMs = new Date(reminder.remindAt).getTime();
      // If reminder is due (or within 5 minutes past if app just opened)
      if (remindAtMs <= nowMs && nowMs - remindAtMs < 5 * 60 * 1000) {
        // Check if reminder is targeted at this user
        const isTargeted =
          reminder.targetUserIds.includes(currentUserId) ||
          reminder.targetUserIds.includes('both') ||
          (reminder.targetUserIds.includes('me') && event.createdBy === currentUserId) ||
          (reminder.targetUserIds.includes('partner') && event.createdBy !== currentUserId);

        if (!isTargeted) continue;

        // Mark as sent immediately to prevent any duplication
        sentReminderIds.add(reminder.id);
        reminder.sent = true;
        onReminderSent?.(event.id, reminder.id);

        const timeText = formatEventTime(event, userTimezone);
        const title = `Reminder: ${event.title}`;
        const body = reminder.customMessage
          ? `${reminder.customMessage} • ${timeText}`
          : `Starting at ${timeText}`;

        // 1. Play chime sound
        soundManager.playPing();

        // 2. In-app banner
        useReminderStore.getState().triggerBanner({
          id: reminder.id,
          eventId: event.id,
          title: event.title,
          timeText,
          customMessage: reminder.customMessage,
        });

        // 3. Browser / System Push Notification if permission granted
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
          try {
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
              navigator.serviceWorker.ready.then((reg) => {
                reg.showNotification(title, {
                  body,
                  icon: '/pwa-192x192.png',
                  badge: '/logo.svg',
                  tag: reminder.id,
                  data: { eventId: event.id, action: 'open_calendar' },
                });
              });
            } else {
              new Notification(title, {
                body,
                icon: '/logo.svg',
                tag: reminder.id,
              });
            }
          } catch (e) {
            console.warn('Could not fire native notification:', e);
          }
        }
      }
    }
  }
}
