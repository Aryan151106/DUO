import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  toggleMessageReaction,
  QUICK_REACTIONS,
  ALL_EMOJIS,
  type ReactionDoc,
  type ReactionsMap,
} from './reactions';

// Mock Firestore functions
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  doc: vi.fn((_db, _col, _spaceId, _subcol, docId) => ({ id: docId })),
  setDoc: vi.fn(() => Promise.resolve()),
  deleteDoc: vi.fn(() => Promise.resolve()),
  serverTimestamp: vi.fn(() => ({ seconds: 1234567890 })),
  onSnapshot: vi.fn(),
}));

// Mock firebase db
vi.mock('./firebase', () => ({
  db: {},
}));

describe('Message Reactions System (src/lib/reactions.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates quick reactions and full emoji palette', () => {
    expect(QUICK_REACTIONS).toContain('❤️');
    expect(QUICK_REACTIONS).toContain('🥰');
    expect(QUICK_REACTIONS).toContain('🔥');
    expect(QUICK_REACTIONS).toContain('😂');
    expect(QUICK_REACTIONS).toContain('👀');
    expect(QUICK_REACTIONS).toContain('🙏');
    expect(ALL_EMOJIS.length).toBeGreaterThanOrEqual(20);
  });

  describe('toggleMessageReaction()', () => {
    it('adds a reaction when the user has not yet reacted to the message', async () => {
      const result = await toggleMessageReaction({
        spaceId: 'space-duo-1',
        messageId: 'msg-456',
        userId: 'user-sam',
        userName: 'Sam',
        emoji: '❤️',
        currentReactions: {},
      });

      expect(result).toBe('added');
    });

    it('replaces an existing reaction with a new emoji when the user switches', async () => {
      const currentReactions = {
        '🔥': ['user-sam'], // Sam previously reacted with fire
      };

      const result = await toggleMessageReaction({
        spaceId: 'space-duo-1',
        messageId: 'msg-456',
        userId: 'user-sam',
        userName: 'Sam',
        emoji: '❤️',
        currentReactions,
      });

      expect(result).toBe('replaced');
    });

    it('removes the reaction when tapping the same emoji again', async () => {
      const currentReactions = {
        '❤️': ['user-sam'], // Sam already reacted with heart
      };

      const result = await toggleMessageReaction({
        spaceId: 'space-duo-1',
        messageId: 'msg-456',
        userId: 'user-sam',
        userName: 'Sam',
        emoji: '❤️',
        currentReactions,
      });

      expect(result).toBe('removed');
    });

    it('allows reacting to partner messages without affecting partner reactions', async () => {
      // Alex reacted with fire, Sam wants to react with heart to the same message
      const currentReactions = {
        '🔥': ['user-alex'],
      };

      const result = await toggleMessageReaction({
        spaceId: 'space-duo-1',
        messageId: 'msg-alex-1',
        userId: 'user-sam',
        userName: 'Sam',
        emoji: '❤️',
        currentReactions,
      });

      expect(result).toBe('added');
    });
  });

  describe('Reactions Grouping & Aggregation', () => {
    it('groups raw reaction documents by messageId and emoji correctly', () => {
      const rawDocs: ReactionDoc[] = [
        {
          id: 'msg-1_user-alex',
          messageId: 'msg-1',
          userId: 'user-alex',
          emoji: '❤️',
          createdAt: { seconds: 1 },
        },
        {
          id: 'msg-1_user-sam',
          messageId: 'msg-1',
          userId: 'user-sam',
          emoji: '❤️',
          createdAt: { seconds: 2 },
        },
        {
          id: 'msg-2_user-sam',
          messageId: 'msg-2',
          userId: 'user-sam',
          emoji: '🔥',
          createdAt: { seconds: 3 },
        },
      ];

      const grouped: ReactionsMap = {};
      rawDocs.forEach((doc) => {
        const { messageId, emoji, userId } = doc;
        if (!grouped[messageId]) grouped[messageId] = {};
        if (!grouped[messageId][emoji]) grouped[messageId][emoji] = [];
        if (!grouped[messageId][emoji].includes(userId)) {
          grouped[messageId][emoji].push(userId);
        }
      });

      expect(grouped['msg-1']['❤️']).toEqual(['user-alex', 'user-sam']);
      expect(grouped['msg-2']['🔥']).toEqual(['user-sam']);
    });
  });
});
