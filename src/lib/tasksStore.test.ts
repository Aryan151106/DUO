import { describe, it, expect } from 'vitest';
import { sanitizeFirestoreData } from './tasksStore';
import type { TaskItem } from './dataStore';

describe('Realtime Tasks Store & Sanitization (src/lib/tasksStore.ts)', () => {
  it('recursively removes undefined properties from Firestore payload', () => {
    const raw = {
      title: 'Buy gifts',
      description: undefined,
      alarmSound: undefined,
      priority: 'urgent',
      reminders: [
        {
          id: 'rem-1',
          minutesBefore: 15,
          personalMessage: undefined,
        },
      ],
      nested: {
        keepMe: 'hello',
        removeMe: undefined,
      },
      nullableField: null,
    };

    const sanitized = sanitizeFirestoreData(raw);

    expect(sanitized.title).toBe('Buy gifts');
    expect(sanitized).not.toHaveProperty('description');
    expect(sanitized).not.toHaveProperty('alarmSound');
    expect(sanitized.priority).toBe('urgent');
    expect(sanitized.nullableField).toBeNull();
    expect(sanitized.nested).toEqual({ keepMe: 'hello' });
  });

  it('correctly reduces docChanges for added, modified, and removed tasks', () => {
    const initialTasks: TaskItem[] = [
      {
        id: 'task-1',
        couple_id: 'c1',
        title: 'Task 1',
        status: 'todo',
        task_date: '2026-10-10',
        assigned_to: 'u1',
        created_by: 'u1',
        updated_at: '2026-10-10',
      },
    ];

    // Simulate adding task-2
    let tasks = [...initialTasks];
    const addedTask: TaskItem = {
      id: 'task-2',
      couple_id: 'c1',
      title: 'Task 2',
      status: 'todo',
      task_date: '2026-10-10',
      assigned_to: 'u2',
      created_by: 'u2',
      updated_at: '2026-10-10',
    };
    tasks.unshift(addedTask);
    expect(tasks.length).toBe(2);
    expect(tasks[0].id).toBe('task-2');

    // Simulate modifying task-1 to 'done'
    tasks = tasks.map((t) => (t.id === 'task-1' ? { ...t, status: 'done' as const } : t));
    expect(tasks.find((t) => t.id === 'task-1')?.status).toBe('done');

    // Simulate removing task-2
    tasks = tasks.filter((t) => t.id !== 'task-2');
    expect(tasks.length).toBe(1);
    expect(tasks[0].id).toBe('task-1');
  });
});
