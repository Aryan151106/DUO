import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getMonthViewDays,
  getWeekViewDays,
  expandEventsForRange,
  formatEventTime,
  formatDualTimezone,
  buildReminders,
  type CalendarEvent,
} from './calendar';
import { checkAndFireDueReminders } from './reminders';
import { sharedClock } from './useNow';
import { format, parseISO } from 'date-fns';

describe('1. Month and Week range generation', () => {
  it('generates month grid for Sunday start with complete weeks (35 or 42 days)', () => {
    const testDate = new Date(2026, 9, 10); // Oct 2026
    const days = getMonthViewDays(testDate, 'sunday');
    expect(days.length % 7).toBe(0);
    expect(days.length).toBeGreaterThanOrEqual(35);
    // First day should be Sunday (day 0)
    expect(days[0].getDay()).toBe(0);
    // Last day should be Saturday (day 6)
    expect(days[days.length - 1].getDay()).toBe(6);
  });

  it('generates month grid for Monday start with complete weeks', () => {
    const testDate = new Date(2026, 9, 10); // Oct 2026
    const days = getMonthViewDays(testDate, 'monday');
    expect(days.length % 7).toBe(0);
    // First day should be Monday (day 1)
    expect(days[0].getDay()).toBe(1);
    // Last day should be Sunday (day 0)
    expect(days[days.length - 1].getDay()).toBe(0);
  });

  it('generates 7 days for week view', () => {
    const testDate = new Date(2026, 9, 10);
    const daysSunday = getWeekViewDays(testDate, 'sunday');
    expect(daysSunday.length).toBe(7);
    expect(daysSunday[0].getDay()).toBe(0);

    const daysMonday = getWeekViewDays(testDate, 'monday');
    expect(daysMonday.length).toBe(7);
    expect(daysMonday[0].getDay()).toBe(1);
  });
});

describe('2. Timezone conversion and Dual Timezone display', () => {
  it('formats event time in viewer timezone correctly', () => {
    // 2026-10-10T19:00:00.000Z
    const event: CalendarEvent = {
      id: 'test-1',
      spaceId: 'sp-1',
      title: 'Dinner',
      allDay: false,
      startDate: '2026-10-10',
      startAt: '2026-10-10T19:00:00.000Z',
      timeZone: 'UTC',
      ownerIds: ['u1', 'u2'],
      createdBy: 'u1',
      color: 'var(--partner-a)',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      updatedBy: 'u1',
    };

    // In New York (EDT = UTC-4): 19:00 UTC is 15:00 (3:00 PM)
    const nyTime = formatEventTime(event, 'America/New_York', true);
    expect(nyTime.toUpperCase()).toContain('3:00');
    expect(nyTime.toUpperCase()).toContain('PM');

    // In London (BST = UTC+1): 19:00 UTC is 20:00 (8:00 PM)
    const londonTime = formatEventTime(event, 'Europe/London', true);
    expect(londonTime.toUpperCase()).toContain('8:00');
    expect(londonTime.toUpperCase()).toContain('PM');
  });

  it('formats dual timezone display for partners in different timezones', () => {
    const event: CalendarEvent = {
      id: 'test-1',
      spaceId: 'sp-1',
      title: 'Coffee Date',
      allDay: false,
      startDate: '2026-10-10',
      startAt: '2026-10-10T19:00:00.000Z',
      timeZone: 'America/New_York',
      ownerIds: ['alex', 'sam'],
      createdBy: 'alex',
      color: 'var(--partner-a)',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      updatedBy: 'alex',
    };

    const dualStr = formatDualTimezone(
      event,
      'Europe/London', // viewer (your time: 8:00 PM)
      'Sam',
      'America/New_York', // partner (Sam: 3:00 PM)
      true
    );

    expect(dualStr).toContain("Sam's");
    expect(dualStr.toUpperCase()).toContain('3:00 PM');
    expect(dualStr).toContain('your');
    expect(dualStr.toUpperCase()).toContain('8:00 PM');
  });
});

describe('3. Daylight Saving Transitions', () => {
  it('correctly adapts to daylight saving shifts', () => {
    // Summer (EDT UTC-4)
    const summerEvent: CalendarEvent = {
      id: 'summer',
      spaceId: 'sp-1',
      title: 'Summer Event',
      allDay: false,
      startDate: '2026-07-01',
      startAt: '2026-07-01T16:00:00.000Z',
      timeZone: 'UTC',
      ownerIds: ['u1'],
      createdBy: 'u1',
      color: 'var(--accent)',
      createdAt: '',
      updatedAt: '',
      updatedBy: '',
    };

    // Winter (EST UTC-5)
    const winterEvent: CalendarEvent = {
      id: 'winter',
      spaceId: 'sp-1',
      title: 'Winter Event',
      allDay: false,
      startDate: '2026-12-01',
      startAt: '2026-12-01T16:00:00.000Z',
      timeZone: 'UTC',
      ownerIds: ['u1'],
      createdBy: 'u1',
      color: 'var(--accent)',
      createdAt: '',
      updatedAt: '',
      updatedBy: '',
    };

    const summerNy = formatEventTime(summerEvent, 'America/New_York', true);
    const winterNy = formatEventTime(winterEvent, 'America/New_York', true);

    // In July (EDT), 16:00 UTC is 12:00 PM
    expect(summerNy).toContain('12:00');
    // In December (EST), 16:00 UTC is 11:00 AM
    expect(winterNy).toContain('11:00');
  });
});

describe('4. Recurrence and Exceptions', () => {
  it('expands weekly recurring events and skips exceptions', () => {
    const weeklyEvent: CalendarEvent = {
      id: 'rec-1',
      spaceId: 'sp-1',
      title: 'Weekly Date Night',
      allDay: false,
      startDate: '2026-10-01',
      startAt: '2026-10-01T20:00:00.000Z',
      timeZone: 'UTC',
      ownerIds: ['u1'],
      createdBy: 'u1',
      color: 'var(--partner-a)',
      repeatRule: {
        frequency: 'weekly',
        interval: 1,
        endType: 'never',
      },
      exceptions: ['2026-10-15'], // Cancelled on Oct 15
      createdAt: '',
      updatedAt: '',
      updatedBy: '',
    };

    const rangeStart = parseISO('2026-10-01');
    const rangeEnd = parseISO('2026-10-31');

    const instances = expandEventsForRange([weeklyEvent], rangeStart, rangeEnd);

    // Oct 1, Oct 8, Oct 15 (skipped), Oct 22, Oct 29 = 4 instances
    expect(instances.length).toBe(4);
    expect(instances.some((i) => i.instanceDate === '2026-10-01')).toBe(true);
    expect(instances.some((i) => i.instanceDate === '2026-10-08')).toBe(true);
    expect(instances.some((i) => i.instanceDate === '2026-10-15')).toBe(false); // Exception excluded
    expect(instances.some((i) => i.instanceDate === '2026-10-22')).toBe(true);
    expect(instances.some((i) => i.instanceDate === '2026-10-29')).toBe(true);
  });

  it('respects after_count end condition', () => {
    const limitedEvent: CalendarEvent = {
      id: 'rec-2',
      spaceId: 'sp-1',
      title: 'Daily Yoga',
      allDay: true,
      startDate: '2026-10-01',
      startAt: null,
      timeZone: 'UTC',
      ownerIds: ['u1'],
      createdBy: 'u1',
      color: 'var(--accent)',
      repeatRule: {
        frequency: 'daily',
        interval: 1,
        endType: 'after_count',
        endCount: 3,
      },
      createdAt: '',
      updatedAt: '',
      updatedBy: '',
    };

    const instances = expandEventsForRange(
      [limitedEvent],
      parseISO('2026-10-01'),
      parseISO('2026-10-31')
    );

    expect(instances.length).toBe(3);
    expect(instances.map((i) => i.instanceDate)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
  });
});

describe('5. Reminder Scheduling and Duplicate Prevention', () => {
  it('builds reminders relative to start time', () => {
    const startAt = '2026-10-10T18:00:00.000Z';
    const reminders = buildReminders(
      startAt,
      false,
      '2026-10-10',
      'UTC',
      [0, 15, 60],
      ['user-1']
    );

    expect(reminders.length).toBe(3);
    // At event: 18:00
    expect(reminders[0].remindAt).toBe(startAt);
    // 15m before: 17:45
    expect(reminders[1].remindAt).toBe('2026-10-10T17:45:00.000Z');
    // 60m before: 17:00
    expect(reminders[2].remindAt).toBe('2026-10-10T17:00:00.000Z');
  });

  it('fires due reminders without duplicate alerts', () => {
    const fired: string[] = [];
    const event: CalendarEvent = {
      id: 'rem-event-1',
      spaceId: 'sp-1',
      title: 'Dentist Appointment',
      allDay: false,
      startDate: '2026-10-10',
      startAt: '2026-10-10T12:00:00.000Z',
      timeZone: 'UTC',
      ownerIds: ['user-1'],
      createdBy: 'user-1',
      color: 'var(--accent)',
      reminders: [
        {
          id: 'rem-unique-1',
          minutesBefore: 15,
          targetUserIds: ['user-1'],
          remindAt: '2026-10-10T11:45:00.000Z',
          sent: false,
        },
      ],
      createdAt: '',
      updatedAt: '',
      updatedBy: '',
    };

    const currentTime = new Date('2026-10-10T11:46:00.000Z');

    // First check fires reminder
    checkAndFireDueReminders([event], 'user-1', 'UTC', currentTime, (_evId, remId) => {
      fired.push(remId);
    });
    expect(fired).toContain('rem-unique-1');
    expect(event.reminders![0].sent).toBe(true);

    // Immediate second check should NOT fire duplicate
    checkAndFireDueReminders([event], 'user-1', 'UTC', currentTime, (_evId, remId) => {
      fired.push(remId);
    });
    expect(fired.length).toBe(1);
  });
});

describe('6. Midnight rollover', () => {
  it('detects day change on midnight transition', () => {
    const beforeMidnight = new Date(2026, 9, 10, 23, 59, 59);
    const afterMidnight = new Date(2026, 9, 11, 0, 0, 1);

    const day1 = format(beforeMidnight, 'yyyy-MM-dd');
    const day2 = format(afterMidnight, 'yyyy-MM-dd');

    expect(day1).toBe('2026-10-10');
    expect(day2).toBe('2026-10-11');
    expect(day1).not.toBe(day2);
  });
});

describe('7. Shared Clock Tick with Fake Timers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('notifies subscribers on clock tick and manages timer lifecycle', () => {
    const ticks: Date[] = [];
    const unsubscribe = sharedClock.subscribe((now) => {
      ticks.push(now);
    });

    // Initial notification upon subscription
    expect(ticks.length).toBe(1);

    // Advance 3 seconds
    vi.advanceTimersByTime(3000);
    expect(ticks.length).toBeGreaterThanOrEqual(3);

    unsubscribe();
  });
});
