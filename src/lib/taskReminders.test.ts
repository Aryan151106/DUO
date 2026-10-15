import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildTaskReminders,
  checkAndFireDueTaskReminders,
  getNudgeRemainingSeconds,
  useTaskReminderStore,
} from './taskReminders';
import type { TaskItem } from './dataStore';

describe('Task Reminders Engine', () => {
  beforeEach(() => {
    useTaskReminderStore.setState({ activeBanner: null, lastNudgeTimes: {} });
  });

  it('builds reminders relative to start time up to 3 max', () => {
    const startAt = '2026-10-10T14:00:00.000Z'; // 2 PM UTC
    const reminders = buildTaskReminders(
      startAt,
      '2026-10-10',
      [0, 15, 60, 1440], // 4 requested, capped at 3
      'user-sam',
      true,
      'Dont forget the keys! 🔑'
    );

    expect(reminders.length).toBe(3);
    // Reminder at 0m before
    expect(reminders[0].remindAt).toBe('2026-10-10T14:00:00.000Z');
    // Reminder at 15m before -> 13:45
    expect(reminders[1].remindAt).toBe('2026-10-10T13:45:00.000Z');
    // Reminder at 60m before -> 13:00
    expect(reminders[2].remindAt).toBe('2026-10-10T13:00:00.000Z');
    expect(reminders[0].personalMessage).toBe('Dont forget the keys! 🔑');
  });

  it('deduplicates reminders so they are never fired twice', () => {
    const firedCount = { val: 0 };
    const task: TaskItem = {
      id: 'task-test-1',
      couple_id: 'couple-1',
      title: 'Buy groceries',
      status: 'todo',
      task_date: '2026-10-10',
      assigned_to: 'user-sam',
      created_by: 'user-alex',
      updated_at: '2026-10-10',
      reminders: [
        {
          id: 'rem-unique-abc',
          minutesBefore: 15,
          remindAt: '2026-10-10T10:00:00.000Z',
          targetUserId: 'user-sam',
          sent: false,
        },
      ],
    };

    const now = new Date('2026-10-10T10:05:00.000Z');

    // First check fires reminder
    checkAndFireDueTaskReminders(
      [task],
      'user-sam',
      'UTC',
      now,
      '23:00',
      '07:00',
      'Alex',
      () => {
        firedCount.val++;
      }
    );

    expect(firedCount.val).toBe(1);
    expect(task.reminders![0].sent).toBe(true);

    // Second check immediately after should NOT fire again
    checkAndFireDueTaskReminders(
      [task],
      'user-sam',
      'UTC',
      now,
      '23:00',
      '07:00',
      'Alex',
      () => {
        firedCount.val++;
      }
    );

    expect(firedCount.val).toBe(1);
  });

  it('never fires reminders for completed tasks', () => {
    const firedCount = { val: 0 };
    const task: TaskItem = {
      id: 'task-done-1',
      couple_id: 'couple-1',
      title: 'Already finished mission',
      status: 'done',
      task_date: '2026-10-10',
      assigned_to: 'user-sam',
      created_by: 'user-alex',
      updated_at: '2026-10-10',
      reminders: [
        {
          id: 'rem-done-1',
          minutesBefore: 0,
          remindAt: '2026-10-10T10:00:00.000Z',
          targetUserId: 'user-sam',
          sent: false,
        },
      ],
    };

    const now = new Date('2026-10-10T10:05:00.000Z');
    checkAndFireDueTaskReminders([task], 'user-sam', 'UTC', now, '23:00', '07:00', 'Alex', () => {
      firedCount.val++;
    });

    expect(firedCount.val).toBe(0);
    expect(task.reminders![0].sent).toBe(false);
  });

  it('tracks nudge cooldowns properly', () => {
    const taskId = 'task-cooldown-1';
    expect(getNudgeRemainingSeconds(taskId)).toBe(0);

    useTaskReminderStore.getState().recordNudge(taskId);
    const rem = getNudgeRemainingSeconds(taskId);
    expect(rem).toBeGreaterThan(0);
    expect(rem).toBeLessThanOrEqual(600); // 10 minutes = 600s
  });
});
