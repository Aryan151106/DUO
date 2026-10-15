import type { FileAttachment } from './attachments';
import type { TaskReminder } from './taskReminders';

export interface TaskItem {
  id: string;
  couple_id: string;
  title: string;
  description?: string;
  status: 'todo' | 'doing' | 'done';
  task_date: string;
  assigned_to: string; // user id
  task_scope?: 'personal' | 'shared';
  created_by: string; // user id
  doodle_url?: string;
  startAt?: string | null; // ISO UTC string or null for Anytime
  timeZone?: string; // Creator's IANA timezone
  priority?: 'normal' | 'important' | 'urgent';
  repeatRule?: 'once' | 'daily' | 'weekdays' | 'weekly';
  reminders?: TaskReminder[];
  attachments?: FileAttachment[];
  alarmSound?: string;
  completed_at?: string | null;
  completed_by?: string | null;
  deleted_at?: string | null;
  snoozedUntil?: string | null;
  lastNudgedAt?: string | null;
  created_at?: string;
  updated_at: string;
  client_id?: string;
}

export interface ChatMessage {
  id: string;
  couple_id: string;
  sender_id: string;
  content: string;
  message_type: 'text' | 'voice' | 'doodle' | 'call_card' | 'media';
  media_url?: string;
  doodle_url?: string;
  attachments?: FileAttachment[];
  metadata?: {
    durationSec?: number;
    durationMs?: number;
    callDuration?: string;
    callType?: 'video' | 'audio';
    doodlePreview?: string;
    audioUrl?: string;
    storagePath?: string;
    mimeType?: string;
    waveform?: number[];
  };
  reactions?: Record<string, string[]>; // emoji -> [userId1, userId2]
  reply_to?: ReplySnapshot;
  replyToMessageId?: string;
  deleted_for_everyone?: boolean;
  deleted_for_me?: string[];
  status?: 'sending' | 'sent' | 'delivered' | 'read';
  client_id?: string;
  created_at: string;
}

export interface ReplySnapshot {
  messageId: string;
  senderId: string;
  sender_name: string;
  type: ChatMessage['message_type'];
  content: string;
  snippet: string;
  thumbnailUrl?: string;
}

export interface ScoreEvent {
  id: string;
  couple_id: string;
  user_id: string;
  task_id?: string;
  kind: 'done' | 'early' | 'nudge_fast' | 'day_bonus' | 'shared';
  points: number;
  day: string;
  created_at: string;
}

export interface WishlistItem {
  id: string;
  title: string;
  category: 'date' | 'travel' | 'food' | 'movie';
  notes?: string;
  completed: boolean;
  hearts: string[]; // userIds
  created_by: string;
}

import type { CalendarEvent } from './calendar';

const STORAGE_TASKS = 'duo_tasks_v1';
const STORAGE_MESSAGES = 'duo_messages_v1';
const STORAGE_SCORES = 'duo_scores_v1';
const STORAGE_WISHLIST = 'duo_wishlist_v1';
const STORAGE_CALENDAR = 'duo_calendar_v1';
const STORAGE_PERIOD_TRACKER = 'duo_period_tracker_v1';

export interface PeriodFeelingLog {
  id: string;
  date: string;
  feelings: string[];
  cravings: string[];
  note?: string;
  createdAt: string;
  createdBy: string;
}

export interface PeriodTracker {
  lastPeriodDate: string;
  cycleLength: number;
  periodLength: number;
  updatedAt: string;
  updatedBy: string;
  femaleUserId?: string;
  logs?: PeriodFeelingLog[];
}

export interface DiaryEntry {
  id: string;
  userId: string;
  title: string;
  content: string;
  mood?: string;
  date: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}


// Initial sample tasks
const todayStr = new Date().toISOString().split('T')[0];
const defaultTasks: TaskItem[] = [
  {
    id: 'task-1',
    couple_id: 'couple-duo-main',
    title: 'Book train tickets for weekend getaway 🚆',
    description: 'Check the 9:15 AM departure from Grand Central.',
    status: 'todo',
    task_date: todayStr,
    startAt: `${todayStr}T09:15:00.000Z`,
    timeZone: 'America/New_York',
    priority: 'important',
    assigned_to: 'user-sam-2',
    created_by: 'user-alex-1',
    updated_at: new Date().toISOString(),
  },
  {
    id: 'task-2',
    couple_id: 'couple-duo-main',
    title: 'Pick up anniversary pastries from bakery 🥐',
    description: 'The strawberry tart we both love!',
    status: 'doing',
    task_date: todayStr,
    startAt: `${todayStr}T13:30:00.000Z`,
    timeZone: 'America/New_York',
    priority: 'urgent',
    assigned_to: 'user-alex-1',
    created_by: 'user-alex-1',
    updated_at: new Date().toISOString(),
  },
  {
    id: 'task-3',
    couple_id: 'couple-duo-main',
    title: 'FaceTime bedtime call 🌙',
    description: 'Sync up our timezones before sleeping.',
    status: 'todo',
    task_date: todayStr,
    startAt: `${todayStr}T21:00:00.000Z`,
    timeZone: 'America/New_York',
    priority: 'normal',
    assigned_to: 'user-alex-1',
    created_by: 'user-sam-2',
    updated_at: new Date().toISOString(),
  },
  {
    id: 'task-4',
    couple_id: 'couple-duo-main',
    title: 'Water the windowsill monsteras 🌿',
    description: 'They looked a bit thirsty yesterday.',
    status: 'done',
    task_date: todayStr,
    startAt: null, // Anytime
    timeZone: 'America/New_York',
    priority: 'normal',
    assigned_to: 'user-sam-2',
    created_by: 'user-sam-2',
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

// Initial messages spanning multiple days to demonstrate date dividers
const defaultMessages: ChatMessage[] = [
  {
    id: 'msg-1',
    couple_id: 'couple-duo-main',
    sender_id: 'user-sam-2',
    content: 'Good morning honey! Just landed at the airport. How is New York today? ☕',
    message_type: 'text',
    reactions: { '❤️': ['user-alex-1'] },
    created_at: new Date(Date.now() - 86400000 * 2).toISOString(), // 2 days ago
  },
  {
    id: 'msg-2',
    couple_id: 'couple-duo-main',
    sender_id: 'user-alex-1',
    content: 'Missing you already! Sun just came up over the city. Have a safe drive to the hotel.',
    message_type: 'text',
    reactions: { '🥰': ['user-sam-2'] },
    created_at: new Date(Date.now() - 86400000).toISOString(), // Yesterday
  },
  {
    id: 'msg-3',
    couple_id: 'couple-duo-main',
    sender_id: 'user-sam-2',
    content: 'Voice note for you while waiting for luggage',
    message_type: 'voice',
    metadata: { durationSec: 14 },
    created_at: new Date(Date.now() - 3600000 * 2).toISOString(), // Today
  },
  {
    id: 'msg-4',
    couple_id: 'couple-duo-main',
    sender_id: 'user-alex-1',
    content: 'Call lasted 18 mins',
    message_type: 'call_card',
    metadata: { callDuration: '18:24', callType: 'video' },
    created_at: new Date(Date.now() - 1800000).toISOString(), // Today
  },
];

const defaultWishlist: WishlistItem[] = [
  {
    id: 'wish-1',
    title: 'Midnight picnic under cherry blossoms 🌸',
    category: 'date',
    completed: false,
    hearts: ['user-alex-1', 'user-sam-2'],
    created_by: 'user-alex-1',
  },
  {
    id: 'wish-2',
    title: 'Trip to Kyoto & stay in a traditional ryokan 🏯',
    category: 'travel',
    completed: false,
    hearts: ['user-sam-2'],
    created_by: 'user-sam-2',
  },
  {
    id: 'wish-3',
    title: 'Learn handmade pasta making masterclass 🍝',
    category: 'food',
    completed: true,
    hearts: ['user-alex-1', 'user-sam-2'],
    created_by: 'user-alex-1',
  },
];

class DuoDataStore {
  public getTasks(): TaskItem[] {
    try {
      const raw = localStorage.getItem(STORAGE_TASKS);
      return raw ? JSON.parse(raw) : defaultTasks;
    } catch {
      return defaultTasks;
    }
  }

  public saveTasks(tasks: TaskItem[]) {
    localStorage.setItem(STORAGE_TASKS, JSON.stringify(tasks));
  }

  public getMessages(): ChatMessage[] {
    try {
      const raw = localStorage.getItem(STORAGE_MESSAGES);
      return raw ? JSON.parse(raw) : defaultMessages;
    } catch {
      return defaultMessages;
    }
  }

  public saveMessages(messages: ChatMessage[]) {
    localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(messages));
  }

  public markMessagesDelivered(messageIds: string[]) {
    const messages = this.getMessages();
    let changed = false;
    const updated = messages.map((m) => {
      if (messageIds.includes(m.id) && m.status === 'sent') {
        changed = true;
        return { ...m, status: 'delivered' as const };
      }
      return m;
    });
    if (changed) {
      this.saveMessages(updated);
    }
  }

  public markMessagesRead(messageIds: string[]) {
    const messages = this.getMessages();
    let changed = false;
    const updated = messages.map((m) => {
      if (messageIds.includes(m.id) && m.status !== 'read') {
        changed = true;
        return { ...m, status: 'read' as const };
      }
      return m;
    });
    if (changed) {
      this.saveMessages(updated);
    }
  }

  public getScores(): ScoreEvent[] {
    try {
      const raw = localStorage.getItem(STORAGE_SCORES);
      if (raw) return JSON.parse(raw);
      // Seed default scores
      const initial: ScoreEvent[] = [
        {
          id: 'sc-1',
          couple_id: 'couple-duo-main',
          user_id: 'user-alex-1',
          kind: 'done',
          points: 10,
          day: new Date().toISOString().split('T')[0],
          created_at: new Date().toISOString(),
        },
        {
          id: 'sc-2',
          couple_id: 'couple-duo-main',
          user_id: 'user-alex-1',
          kind: 'early',
          points: 5,
          day: new Date().toISOString().split('T')[0],
          created_at: new Date().toISOString(),
        },
        {
          id: 'sc-3',
          couple_id: 'couple-duo-main',
          user_id: 'user-sam-2',
          kind: 'done',
          points: 10,
          day: new Date().toISOString().split('T')[0],
          created_at: new Date().toISOString(),
        },
        {
          id: 'sc-4',
          couple_id: 'couple-duo-main',
          user_id: 'user-sam-2',
          kind: 'nudge_fast',
          points: 5,
          day: new Date().toISOString().split('T')[0],
          created_at: new Date().toISOString(),
        },
      ];
      this.saveScores(initial);
      return initial;
    } catch {
      return [];
    }
  }

  public saveScores(scores: ScoreEvent[]) {
    localStorage.setItem(STORAGE_SCORES, JSON.stringify(scores));
  }

  public getWishlist(): WishlistItem[] {
    try {
      const raw = localStorage.getItem(STORAGE_WISHLIST);
      return raw ? JSON.parse(raw) : defaultWishlist;
    } catch {
      return defaultWishlist;
    }
  }

  public saveWishlist(items: WishlistItem[]) {
    localStorage.setItem(STORAGE_WISHLIST, JSON.stringify(items));
  }

  public getCalendarEvents(): CalendarEvent[] {
    try {
      const raw = localStorage.getItem(STORAGE_CALENDAR);
      if (raw) return JSON.parse(raw);

      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const tomorrow = new Date(now.getTime() + 86400000);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      // Sample initial events for Demo Mode
      const initial: CalendarEvent[] = [
        {
          id: 'ev-sample-1',
          spaceId: 'couple-duo-main',
          title: 'Dinner at Little Italy 🍝',
          allDay: false,
          startDate: todayStr,
          startAt: `${todayStr}T19:30:00.000Z`,
          timeZone: 'America/New_York',
          ownerIds: ['user-alex-1', 'user-sam-2'],
          createdBy: 'user-alex-1',
          location: 'Trattoria Bella',
          notes: 'Corner booth reserved under Alex 💕',
          color: 'var(--partner-a)',
          icon: '🍝',
          reminders: [
            {
              id: 'rem-1',
              minutesBefore: 60,
              targetUserIds: ['user-alex-1', 'user-sam-2'],
              customMessage: 'Get ready for pasta night! ✨',
              remindAt: new Date(new Date(`${todayStr}T19:30:00.000Z`).getTime() - 60 * 60000).toISOString(),
              sent: false,
            },
          ],
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          updatedBy: 'user-alex-1',
        },
        {
          id: 'ev-sample-2',
          spaceId: 'couple-duo-main',
          title: 'Morning Matcha & Pastry 🍵',
          allDay: false,
          startDate: tomorrowStr,
          startAt: `${tomorrowStr}T09:00:00.000Z`,
          timeZone: 'America/New_York',
          ownerIds: ['user-sam-2'],
          createdBy: 'user-sam-2',
          location: 'Matchaful Cafe',
          notes: 'Grab iced oat matchas together',
          color: 'var(--partner-b)',
          icon: '🍵',
          reminders: [
            {
              id: 'rem-2',
              minutesBefore: 15,
              targetUserIds: ['user-alex-1', 'user-sam-2'],
              remindAt: new Date(new Date(`${tomorrowStr}T09:00:00.000Z`).getTime() - 15 * 60000).toISOString(),
              sent: false,
            },
          ],
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          updatedBy: 'user-sam-2',
        },
        {
          id: 'ev-sample-3',
          spaceId: 'couple-duo-main',
          title: 'Movie Marathon & Blanket Fort 🎬',
          allDay: true,
          startDate: tomorrowStr,
          startAt: null,
          timeZone: 'America/New_York',
          ownerIds: ['user-alex-1', 'user-sam-2'],
          createdBy: 'user-alex-1',
          notes: 'Studio Ghibli films + popcorn',
          color: 'var(--accent)',
          icon: '🎬',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          updatedBy: 'user-alex-1',
        },
      ];
      this.saveCalendarEvents(initial);
      return initial;
    } catch {
      return [];
    }
  }

  public saveCalendarEvents(items: CalendarEvent[]) {
    localStorage.setItem(STORAGE_CALENDAR, JSON.stringify(items));
  }

  public getPeriodTracker(): PeriodTracker | null {
    try {
      const raw = localStorage.getItem(STORAGE_PERIOD_TRACKER);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  public savePeriodTracker(tracker: PeriodTracker) {
    localStorage.setItem(STORAGE_PERIOD_TRACKER, JSON.stringify(tracker));
  }

  public getDiaryEntries(userId: string): DiaryEntry[] {
    try {
      const key = `duo_diary_${userId}_v1`;
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
      if (userId === 'user-alex-1') {
        const initial: DiaryEntry[] = [
          {
            id: 'diary-demo-1',
            userId: 'user-alex-1',
            title: 'Quiet reflections & grateful for us 🌸',
            content: 'Today was such a peaceful afternoon. Working alongside Sam in the study room made everything feel softer and calmer. Taking time to remember how far we have come together.',
            mood: '🌸 Peaceful',
            date: new Date().toISOString().split('T')[0],
            tags: ['Reflections', 'Gratitude'],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ];
        this.saveDiaryEntries(userId, initial);
        return initial;
      }
      return [];
    } catch {
      return [];
    }
  }

  public saveDiaryEntries(userId: string, entries: DiaryEntry[]) {
    try {
      const key = `duo_diary_${userId}_v1`;
      localStorage.setItem(key, JSON.stringify(entries));
    } catch (e) {
      console.warn('Failed to save diary entries to localStorage:', e);
    }
  }
}

export const duoDataStore = new DuoDataStore();
