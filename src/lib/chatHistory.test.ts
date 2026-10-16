import { describe, it, expect } from 'vitest';
import {
  normalizeMessageTimestamp,
  getDateKeyForTimestamp,
  getFriendlyDayLabel,
  groupMessagesByDay,
  mergeAndDeduplicateMessages,
  reconcileOptimisticMessages,
  calculateScrollCompensation,
} from './chatHistory';
import type { ChatMessage } from './dataStore';

describe('chatHistory engine', () => {
  describe('Legacy timestamp normalization', () => {
    it('normalizes Firestore Timestamp to milliseconds', () => {
      const msg = {
        id: 'msg-1',
        createdAt: { toMillis: () => 1760000000000 },
      };
      expect(normalizeMessageTimestamp(msg)).toBe(1760000000000);
    });

    it('normalizes Firestore _seconds/_nanoseconds object to milliseconds', () => {
      const msg = {
        id: 'msg-2',
        createdAt: { _seconds: 1760000000, _nanoseconds: 500000000 },
      };
      expect(normalizeMessageTimestamp(msg)).toBe(1760000000500);
    });

    it('normalizes ISO string created_at to milliseconds', () => {
      const msg = {
        id: 'msg-3',
        created_at: '2026-10-15T12:00:00.000Z',
      };
      expect(normalizeMessageTimestamp(msg)).toBe(new Date('2026-10-15T12:00:00.000Z').getTime());
    });

    it('normalizes clientTimestamp number', () => {
      const msg = {
        id: 'msg-4',
        clientTimestamp: 1760548123000,
      };
      expect(normalizeMessageTimestamp(msg)).toBe(1760548123000);
    });

    it('extracts epoch from msg-<epoch> clientId if no timestamp field is present', () => {
      const msg = {
        id: 'msg-1760548999000-abc',
      };
      expect(normalizeMessageTimestamp(msg)).toBe(1760548999000);
    });

    it('falls back to deliveredAt or readAt', () => {
      const msg = {
        id: 'msg-5',
        deliveredAt: '2026-10-15T14:30:00.000Z',
      };
      expect(normalizeMessageTimestamp(msg)).toBe(new Date('2026-10-15T14:30:00.000Z').getTime());
    });
  });

  describe('Day-boundary grouping and timezone behavior', () => {
    it('formats consistent date keys in specified timezone', () => {
      const timeMs = new Date('2026-10-15T19:30:00.000Z').getTime(); // 19:30 UTC = Oct 16 01:00 in Asia/Kolkata (+5:30)
      const utcKey = getDateKeyForTimestamp(timeMs, 'UTC');
      const istKey = getDateKeyForTimestamp(timeMs, 'Asia/Kolkata');

      expect(utcKey).toBe('2026-10-15');
      expect(istKey).toBe('2026-10-16');
    });

    it('returns Today for today dateKey', () => {
      const todayKey = getDateKeyForTimestamp(Date.now());
      expect(getFriendlyDayLabel(todayKey)).toBe('Today');
    });

    it('groups messages by calendar day with proper labels', () => {
      const t1 = new Date('2026-10-14T10:00:00.000Z').getTime();
      const t2 = new Date('2026-10-14T15:00:00.000Z').getTime();
      const t3 = new Date('2026-10-15T09:00:00.000Z').getTime();

      const msgs: ChatMessage[] = [
        { id: '1', couple_id: 'c1', sender_id: 'u1', content: 'hello', message_type: 'text', created_at: new Date(t1).toISOString() },
        { id: '2', couple_id: 'c1', sender_id: 'u2', content: 'hey', message_type: 'text', created_at: new Date(t2).toISOString() },
        { id: '3', couple_id: 'c1', sender_id: 'u1', content: 'today message', message_type: 'text', created_at: new Date(t3).toISOString() },
      ];

      const groups = groupMessagesByDay(msgs, 'UTC');
      expect(groups.length).toBe(2);
      expect(groups[0].dateKey).toBe('2026-10-14');
      expect(groups[0].messages.length).toBe(2);
      expect(groups[1].dateKey).toBe('2026-10-15');
      expect(groups[1].messages.length).toBe(1);
    });
  });

  describe('Ordering messages with equal timestamps', () => {
    it('breaks ties deterministically using message ID', () => {
      const sameTime = 1760000000000;
      const msgs: ChatMessage[] = [
        { id: 'z-last', couple_id: 'c1', sender_id: 'u1', content: 'Z', message_type: 'text', created_at: new Date(sameTime).toISOString() },
        { id: 'a-first', couple_id: 'c1', sender_id: 'u2', content: 'A', message_type: 'text', created_at: new Date(sameTime).toISOString() },
        { id: 'm-mid', couple_id: 'c1', sender_id: 'u1', content: 'M', message_type: 'text', created_at: new Date(sameTime).toISOString() },
      ];

      const merged = mergeAndDeduplicateMessages([], msgs);
      expect(merged[0].id).toBe('a-first');
      expect(merged[1].id).toBe('m-mid');
      expect(merged[2].id).toBe('z-last');
    });
  });

  describe('Deduplication between live listener and history page', () => {
    it('merges live and historical messages without duplicate entries', () => {
      const historical: ChatMessage[] = [
        { id: 'msg-1', couple_id: 'c1', sender_id: 'u1', content: 'Hi', message_type: 'text', created_at: '2026-10-15T10:00:00Z' },
        { id: 'msg-2', couple_id: 'c1', sender_id: 'u2', content: 'Hello', message_type: 'text', created_at: '2026-10-15T10:01:00Z' },
      ];

      const incomingLive: ChatMessage[] = [
        // Duplicate msg-2 with updated delivery status
        { id: 'msg-2', couple_id: 'c1', sender_id: 'u2', content: 'Hello', message_type: 'text', created_at: '2026-10-15T10:01:00Z', status: 'delivered' },
        // Brand new message
        { id: 'msg-3', couple_id: 'c1', sender_id: 'u1', content: 'How are you?', message_type: 'text', created_at: '2026-10-15T10:02:00Z' },
      ];

      const merged = mergeAndDeduplicateMessages(historical, incomingLive);
      expect(merged.length).toBe(3);
      expect(merged.map((m) => m.id)).toEqual(['msg-1', 'msg-2', 'msg-3']);
      expect(merged[1].status).toBe('delivered');
    });

    it('matches optimistic message by client_id and merges with server record', () => {
      const optimistic: ChatMessage[] = [
        { id: 'temp-123', couple_id: 'c1', sender_id: 'u1', content: 'Testing optimistic', message_type: 'text', status: 'sending', created_at: '2026-10-15T10:00:00Z' },
      ];

      const serverMsg: ChatMessage = {
        id: 'server-doc-456',
        couple_id: 'c1',
        sender_id: 'u1',
        content: 'Testing optimistic',
        message_type: 'text',
        status: 'sent',
        client_id: 'temp-123',
        created_at: '2026-10-15T10:00:00Z',
      };

      const remainingOptimistic = reconcileOptimisticMessages(optimistic, [serverMsg]);
      expect(remainingOptimistic.length).toBe(0);
    });
  });

  describe('Preserving scroll anchor when earlier messages are inserted', () => {
    it('compensates scroll position by the height delta of inserted messages', () => {
      const prevScrollHeight = 1200;
      const currentScrollTop = 50; // User scrolled near top
      const newScrollHeight = 1800; // 600px of older messages inserted at top

      const nextScrollTop = calculateScrollCompensation(prevScrollHeight, newScrollHeight, currentScrollTop);
      expect(nextScrollTop).toBe(650); // 50 + (1800 - 1200) = 650
    });

    it('does not change scrollTop if height did not increase', () => {
      expect(calculateScrollCompensation(1000, 1000, 200)).toBe(200);
      expect(calculateScrollCompensation(1000, 950, 200)).toBe(200);
    });
  });

  describe('Bounded pagination and within-day paging (>100 messages)', () => {
    it('slices a day with over 100 messages bounded to limit before advancing to previous day', () => {
      // Create 150 messages for today and 10 for yesterday
      const todayMs = new Date('2026-10-16T12:00:00Z').getTime();
      const yesterdayMs = new Date('2026-10-15T12:00:00Z').getTime();

      const messages: ChatMessage[] = [];
      for (let i = 0; i < 10; i++) {
        messages.push({
          id: `y-${i}`,
          couple_id: 'c1',
          sender_id: 'u1',
          content: `Yesterday ${i}`,
          message_type: 'text',
          created_at: new Date(yesterdayMs + i * 1000).toISOString(),
        });
      }
      for (let i = 0; i < 150; i++) {
        messages.push({
          id: `t-${i}`,
          couple_id: 'c1',
          sender_id: 'u2',
          content: `Today ${i}`,
          message_type: 'text',
          created_at: new Date(todayMs + i * 1000).toISOString(),
        });
      }

      const groups = groupMessagesByDay(messages, 'UTC');
      expect(groups.length).toBe(2);
      expect(groups[0].messages.length).toBe(10); // yesterday
      expect(groups[1].messages.length).toBe(150); // today

      // When unlockedDaysCount = 1 (only latest day) and earliestDayLimit = 100:
      const visibleGroups1 = groups.slice(-1);
      const earliestGroup1 = visibleGroups1[0];
      const page1 = earliestGroup1.messages.slice(-100);
      expect(page1.length).toBe(100);
      expect(page1[page1.length - 1].id).toBe('t-149');
      expect(page1[0].id).toBe('t-50');

      // When user scrolls to top of page 1, earliestDayLimit expands to 200:
      const page2 = earliestGroup1.messages.slice(-200);
      expect(page2.length).toBe(150);
      expect(page2[0].id).toBe('t-0');

      // Now all of today is shown; next scroll to top advances unlockedDaysCount to 2:
      const visibleGroups2 = groups.slice(-2);
      expect(visibleGroups2.length).toBe(2);
      expect(visibleGroups2[0].dateKey).toBe('2026-10-15');
    });

    it('falls back to documented fallback timezone when timezone is invalid or undefined', () => {
      const ts = new Date('2026-10-15T12:00:00Z').getTime();
      // Should not throw even with invalid timezone string; falls back gracefully
      const key = getDateKeyForTimestamp(ts, 'INVALID_TZ_XYZ');
      expect(typeof key).toBe('string');
      expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
