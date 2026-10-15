import { describe, it, expect, beforeEach } from 'vitest';
import { duoDataStore } from './dataStore';

const storage: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => storage[k] ?? null,
  setItem: (k: string, v: string) => { storage[k] = String(v); },
  removeItem: (k: string) => { delete storage[k]; },
  clear: () => {
    for (const key of Object.keys(storage)) {
      delete storage[key];
    }
  },
  key: (i: number) => Object.keys(storage)[i] ?? null,
  get length() { return Object.keys(storage).length; },
};

describe('Message Double-Tick & Read Receipts Mechanism', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('marks sent messages as delivered (double gray ticks)', () => {
    const testMessages = [
      {
        id: 'msg-101',
        couple_id: 'couple-1',
        sender_id: 'user-partner',
        content: 'Hey there!',
        message_type: 'text' as const,
        status: 'sent' as const,
        created_at: new Date().toISOString(),
      },
    ];

    duoDataStore.saveMessages(testMessages);
    expect(duoDataStore.getMessages()[0].status).toBe('sent');

    duoDataStore.markMessagesDelivered(['msg-101']);
    expect(duoDataStore.getMessages()[0].status).toBe('delivered');
  });

  it('marks delivered messages as read (double blue ticks) when viewed', () => {
    const testMessages = [
      {
        id: 'msg-102',
        couple_id: 'couple-1',
        sender_id: 'user-partner',
        content: 'Are you free for lunch?',
        message_type: 'text' as const,
        status: 'delivered' as const,
        created_at: new Date().toISOString(),
      },
    ];

    duoDataStore.saveMessages(testMessages);
    duoDataStore.markMessagesRead(['msg-102']);

    const messages = duoDataStore.getMessages();
    expect(messages[0].status).toBe('read');
  });

  it('only transitions unread messages and does not regress already read messages', () => {
    const testMessages = [
      {
        id: 'msg-103',
        couple_id: 'couple-1',
        sender_id: 'user-partner',
        content: 'Old message',
        message_type: 'text' as const,
        status: 'read' as const,
        created_at: new Date().toISOString(),
      },
    ];

    duoDataStore.saveMessages(testMessages);
    duoDataStore.markMessagesDelivered(['msg-103']);

    // Should stay read
    expect(duoDataStore.getMessages()[0].status).toBe('read');
  });
});

import { getMessageTimestamp } from './firestore';

describe('getMessageTimestamp & Message Chronological Ordering', () => {
  it('correctly parses Firestore Timestamps with toMillis()', () => {
    const msg = {
      createdAt: { toMillis: () => 1700000000000 },
    };
    expect(getMessageTimestamp(msg)).toBe(1700000000000);
  });

  it('correctly parses Firestore Timestamp objects with seconds and nanoseconds', () => {
    const msg = {
      createdAt: { seconds: 1700000000, nanoseconds: 500000000 },
    };
    expect(getMessageTimestamp(msg)).toBe(1700000000500);
  });

  it('correctly parses snake_case created_at ISO strings', () => {
    const iso = '2026-10-15T12:00:00.000Z';
    const msg = {
      created_at: iso,
    };
    expect(getMessageTimestamp(msg)).toBe(new Date(iso).getTime());
  });

  it('correctly parses snake_case created_at when it is a Firestore Timestamp object', () => {
    const msg = {
      created_at: { seconds: 1700000050, nanoseconds: 0 },
    };
    expect(getMessageTimestamp(msg)).toBe(1700000050000);
  });

  it('never returns NaN even when createdAt is empty or undefined', () => {
    const msg = {};
    const ts = getMessageTimestamp(msg);
    expect(Number.isFinite(ts)).toBe(true);
    expect(ts).toBeGreaterThan(0);
  });

  it('correctly sorts mixed messages chronologically', () => {
    const m1 = { id: 'm1', created_at: '2026-10-15T10:00:00.000Z' };
    const m2 = { id: 'm2', createdAt: { toMillis: () => new Date('2026-10-15T10:05:00.000Z').getTime() } };
    const m3 = { id: 'm3', createdAt: new Date('2026-10-15T10:10:00.000Z') };

    const unsorted = [m3, m1, m2];
    unsorted.sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));

    expect(unsorted.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });
});
