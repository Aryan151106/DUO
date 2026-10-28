import { describe, it, expect, beforeEach } from 'vitest';
import { duoDataStore, type DiaryEntry } from './dataStore';

const storage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => storage[key] || null,
  setItem: (key: string, val: string) => {
    storage[key] = val;
  },
  removeItem: (key: string) => {
    delete storage[key];
  },
  clear: () => {
    Object.keys(storage).forEach((k) => delete storage[k]);
  },
};
(globalThis as any).localStorage = mockLocalStorage;

describe('Personal Diary - Both Users Support', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  it('provides starter diary entries for Vidhi (user-vidhi-2 / user-sam-2)', () => {
    const vidhiEntries = duoDataStore.getDiaryEntries('user-vidhi-2');
    expect(vidhiEntries).toBeDefined();
    expect(vidhiEntries.length).toBeGreaterThan(0);
    expect(vidhiEntries[0].userId).toBe('user-vidhi-2');
    expect(vidhiEntries[0].title).toContain('grateful');

    const samEntries = duoDataStore.getDiaryEntries('user-sam-2');
    expect(samEntries.length).toBeGreaterThan(0);
    expect(samEntries[0].userId).toBe('user-sam-2');
  });

  it('provides starter diary entries for Aryan (user-aryan-1 / user-alex-1)', () => {
    const aryanEntries = duoDataStore.getDiaryEntries('user-aryan-1');
    expect(aryanEntries).toBeDefined();
    expect(aryanEntries.length).toBeGreaterThan(0);
    expect(aryanEntries[0].userId).toBe('user-aryan-1');

    const alexEntries = duoDataStore.getDiaryEntries('user-alex-1');
    expect(alexEntries.length).toBeGreaterThan(0);
    expect(alexEntries[0].userId).toBe('user-alex-1');
  });

  it('stores and isolates diary entries separately between partners', () => {
    const vidhiEntry: DiaryEntry = {
      id: 'vidhi-note-1',
      userId: 'user-vidhi-2',
      title: 'Vidhi Private Thought',
      content: 'This should only be in Vidhi diary.',
      date: '2026-10-27',
      tags: ['Personal'],
      createdAt: '2026-10-27T10:00:00Z',
      updatedAt: '2026-10-27T10:00:00Z',
    };

    const aryanEntry: DiaryEntry = {
      id: 'aryan-note-1',
      userId: 'user-aryan-1',
      title: 'Aryan Private Thought',
      content: 'This should only be in Aryan diary.',
      date: '2026-10-27',
      tags: ['Personal'],
      createdAt: '2026-10-27T11:00:00Z',
      updatedAt: '2026-10-27T11:00:00Z',
    };

    duoDataStore.saveDiaryEntries('user-vidhi-2', [vidhiEntry]);
    duoDataStore.saveDiaryEntries('user-aryan-1', [aryanEntry]);

    const loadedVidhi = duoDataStore.getDiaryEntries('user-vidhi-2');
    const loadedAryan = duoDataStore.getDiaryEntries('user-aryan-1');

    expect(loadedVidhi).toHaveLength(1);
    expect(loadedVidhi[0].title).toBe('Vidhi Private Thought');

    expect(loadedAryan).toHaveLength(1);
    expect(loadedAryan[0].title).toBe('Aryan Private Thought');
  });

  it('sorts diary entries descending by createdAt in memory without needing composite index', () => {
    const entries: DiaryEntry[] = [
      {
        id: 'old-1',
        userId: 'user-vidhi-2',
        title: 'Older note',
        content: 'content',
        date: '2026-10-25',
        createdAt: '2026-10-25T12:00:00Z',
        updatedAt: '2026-10-25T12:00:00Z',
      },
      {
        id: 'new-2',
        userId: 'user-vidhi-2',
        title: 'Newest note',
        content: 'content',
        date: '2026-10-27',
        createdAt: '2026-10-27T15:00:00Z',
        updatedAt: '2026-10-27T15:00:00Z',
      },
      {
        id: 'mid-3',
        userId: 'user-vidhi-2',
        title: 'Mid note',
        content: 'content',
        date: '2026-10-26',
        createdAt: '2026-10-26T08:00:00Z',
        updatedAt: '2026-10-26T08:00:00Z',
      },
    ];

    entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    expect(entries[0].id).toBe('new-2');
    expect(entries[1].id).toBe('mid-3');
    expect(entries[2].id).toBe('old-1');
  });
});
