import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addDays,
  addWeeks,
  addMonths,
  addYears,
  format,
  parseISO,
  isAfter,
} from 'date-fns';

export type EventFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type RecurrenceEndType = 'never' | 'on_date' | 'after_count';

export interface RepeatRule {
  frequency: EventFrequency;
  interval?: number; // e.g. 1
  endType: RecurrenceEndType;
  endDate?: string; // YYYY-MM-DD
  endCount?: number; // e.g. 10
}

export interface EventReminder {
  id: string;
  minutesBefore: number; // 0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080, etc.
  targetUserIds: string[]; // user IDs or ['me', 'partner', 'both']
  customMessage?: string;
  remindAt: string; // ISO UTC string
  sent?: boolean;
}

export interface CalendarEvent {
  id: string;
  spaceId: string;
  title: string;
  startAt: string | null; // ISO UTC timestamp if timed, or null for all-day
  allDay: boolean;
  startDate: string; // YYYY-MM-DD
  timeZone: string; // Creator's IANA timezone (e.g. "America/New_York")
  ownerIds: string[]; // Who it is for: [userA], [userB], or both
  createdBy: string;
  location?: string;
  notes?: string;
  link?: string;
  color: string; // CSS color string or token
  icon?: string; // Emoji
  repeatRule?: RepeatRule;
  exceptions?: string[]; // Array of YYYY-MM-DD dates where recurrence is cancelled or modified
  reminders?: EventReminder[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  deletedAt?: string | null;
}

export interface ExpandedCalendarEvent extends CalendarEvent {
  instanceDate: string; // YYYY-MM-DD
  isRecurringInstance?: boolean;
}

/**
 * Generate 7x5 or 7x6 day grid for Month view, padded with adjacent month days.
 */
export function getMonthViewDays(
  currentDate: Date,
  firstDayOfWeek: 'sunday' | 'monday' = 'sunday'
): Date[] {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const weekStartsOn = firstDayOfWeek === 'monday' ? 1 : 0;

  const startGrid = startOfWeek(monthStart, { weekStartsOn });
  const endGrid = endOfWeek(monthEnd, { weekStartsOn });

  return eachDayOfInterval({ start: startGrid, end: endGrid });
}

/**
 * Generate 7 days for Week view.
 */
export function getWeekViewDays(
  currentDate: Date,
  firstDayOfWeek: 'sunday' | 'monday' = 'sunday'
): Date[] {
  const weekStartsOn = firstDayOfWeek === 'monday' ? 1 : 0;
  const start = startOfWeek(currentDate, { weekStartsOn });
  const end = endOfWeek(currentDate, { weekStartsOn });

  return eachDayOfInterval({ start, end });
}

/**
 * Expand recurring events and filter all events within a date range [rangeStart, rangeEnd].
 */
export function expandEventsForRange(
  events: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date
): ExpandedCalendarEvent[] {
  const result: ExpandedCalendarEvent[] = [];
  const rangeStartStr = format(rangeStart, 'yyyy-MM-dd');
  const rangeEndStr = format(rangeEnd, 'yyyy-MM-dd');

  for (const event of events) {
    if (event.deletedAt) continue;

    if (!event.repeatRule) {
      // Non-recurring event
      if (event.startDate >= rangeStartStr && event.startDate <= rangeEndStr) {
        result.push({
          ...event,
          instanceDate: event.startDate,
          isRecurringInstance: false,
        });
      }
      continue;
    }

    // Recurring event
    const { frequency, interval = 1, endType, endDate, endCount = 100 } = event.repeatRule;
    const exceptions = new Set(event.exceptions || []);
    let currentDate = parseISO(event.startDate);
    let count = 0;
    const maxIterations = 365; // Safety cap

    while (count < endCount && count < maxIterations) {
      const currentStr = format(currentDate, 'yyyy-MM-dd');

      // Check end conditions
      if (endType === 'on_date' && endDate && currentStr > endDate) {
        break;
      }

      if (isAfter(currentDate, rangeEnd)) {
        break;
      }

      if (currentStr >= rangeStartStr && !exceptions.has(currentStr)) {
        result.push({
          ...event,
          instanceDate: currentStr,
          isRecurringInstance: currentStr !== event.startDate,
        });
      }

      count++;

      // Advance by frequency
      if (frequency === 'daily') {
        currentDate = addDays(currentDate, interval);
      } else if (frequency === 'weekly') {
        currentDate = addWeeks(currentDate, interval);
      } else if (frequency === 'monthly') {
        currentDate = addMonths(currentDate, interval);
      } else if (frequency === 'yearly') {
        currentDate = addYears(currentDate, interval);
      } else {
        break;
      }
    }
  }

  // Sort by startAt or allDay first
  return result.sort((a, b) => {
    if (a.instanceDate !== b.instanceDate) {
      return a.instanceDate.localeCompare(b.instanceDate);
    }
    if (a.allDay && !b.allDay) return -1;
    if (!a.allDay && b.allDay) return 1;
    if (a.startAt && b.startAt) {
      return a.startAt.localeCompare(b.startAt);
    }
    return a.title.localeCompare(b.title);
  });
}

/**
 * Format event time in viewer's timezone.
 */
export function formatEventTime(
  event: CalendarEvent | ExpandedCalendarEvent,
  viewerTz: string,
  hour12?: boolean
): string {
  if (event.allDay || !event.startAt) return 'All day';

  try {
    const d = new Date(event.startAt);
    return new Intl.DateTimeFormat(undefined, {
      timeZone: viewerTz,
      hour: 'numeric',
      minute: '2-digit',
      hour12,
    }).format(d);
  } catch (e) {
    return 'Timed';
  }
}

/**
 * Dual Timezone Display:
 * e.g. "Sam's 3:00 PM (your 10:00 AM)" or simply "10:00 AM" if both have same timezone.
 */
export function formatDualTimezone(
  event: CalendarEvent | ExpandedCalendarEvent,
  viewerTz: string,
  partnerName: string,
  partnerTz: string,
  hour12?: boolean
): string {
  if (event.allDay || !event.startAt) return 'All day';

  try {
    const d = new Date(event.startAt);
    const viewerTime = new Intl.DateTimeFormat(undefined, {
      timeZone: viewerTz,
      hour: 'numeric',
      minute: '2-digit',
      hour12,
    }).format(d);

    if (viewerTz === partnerTz) {
      return viewerTime;
    }

    const partnerTime = new Intl.DateTimeFormat(undefined, {
      timeZone: partnerTz,
      hour: 'numeric',
      minute: '2-digit',
      hour12,
    }).format(d);

    return `${partnerName}'s ${partnerTime} (your ${viewerTime})`;
  } catch (e) {
    return 'All day';
  }
}

/**
 * Build reminder schedule list for an event.
 */
export function buildReminders(
  startAt: string | null,
  allDay: boolean,
  startDate: string,
  _timeZone: string,
  minutesList: number[],
  targetUserIds: string[],
  customMessage?: string
): EventReminder[] {
  const result: EventReminder[] = [];

  for (const minutes of minutesList) {
    let remindAtDate: Date;

    if (allDay || !startAt) {
      // For all-day events, schedule reminder relative to 09:00 AM on start date in event timezone
      const local9Am = new Date(`${startDate}T09:00:00`);
      remindAtDate = new Date(local9Am.getTime() - minutes * 60000);
    } else {
      remindAtDate = new Date(new Date(startAt).getTime() - minutes * 60000);
    }

    result.push({
      id: `rem-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      minutesBefore: minutes,
      targetUserIds,
      customMessage: customMessage?.trim() || undefined,
      remindAt: remindAtDate.toISOString(),
      sent: false,
    });
  }

  return result;
}

/**
 * Calculates human-readable countdown string, e.g., "in 2h 15m", "starts in 10m", "tomorrow"
 */
export function getEventCountdown(
  event: CalendarEvent | ExpandedCalendarEvent,
  now: Date = new Date()
): string {
  if (!event.startAt) {
    const todayStr = format(now, 'yyyy-MM-dd');
    if (event.startDate === todayStr) return 'Today (All day)';
    return 'All day';
  }

  const startMs = new Date(event.startAt).getTime();
  const diffMs = startMs - now.getTime();

  if (diffMs <= 0) {
    const pastMinutes = Math.floor(Math.abs(diffMs) / 60000);
    if (pastMinutes < 60) return `Started ${pastMinutes}m ago`;
    return 'Happening now';
  }

  const totalMinutes = Math.floor(diffMs / 60000);
  if (totalMinutes < 60) {
    return `in ${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours < 24) {
    return mins > 0 ? `in ${hours}h ${mins}m` : `in ${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (days === 1) {
    return remHours > 0 ? `in 1d ${remHours}h` : 'tomorrow';
  }
  return `in ${days} days`;
}
