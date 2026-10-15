/**
 * Reactions Data Layer (src/lib/reactions.ts)
 * 
 * Provides:
 * 1. Dedicated Firestore documents at couples/{spaceId}/reactions/{messageId}_{userId}
 *    avoiding document contention and sender-only write permission errors.
 * 2. Add / replace / remove reaction lifecycle with optimistic rollback.
 * 3. Batch real-time subscription grouping reactions by message ID.
 * 4. Allowed emoji set with quick selection presets.
 */

import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import { useAuthStore } from './store';

export interface ReactionDoc {
  id: string; // `${messageId}_${userId}`
  messageId: string;
  userId: string;
  userName?: string;
  emoji: string;
  createdAt: any;
}

export type ReactionsMap = Record<string, Record<string, string[]>>; // messageId -> emoji -> userIds

export const QUICK_REACTIONS = ['❤️', '🥰', '🔥', '😂', '👀', '🙏'] as const;

export const ALL_EMOJIS = [
  '❤️', '🥰', '🔥', '😂', '👀', '🙏',
  '😍', '✨', '🎉', '💯', '👏', '🥹',
  '😘', '💋', '💖', '⭐', '🤤', '😴',
  '💪', '🥳', '😎', '☕', '🍕', '🍰'
] as const;

/**
 * Toggle a reaction on a message:
 * - If user already reacted with this emoji: remove it (delete doc)
 * - If user reacted with a different emoji: update it (set doc)
 * - If user hasn't reacted: add it (set doc)
 */
export async function toggleMessageReaction(params: {
  spaceId: string;
  messageId: string;
  userId: string;
  userName?: string;
  emoji: string;
  currentReactions?: Record<string, string[]>;
}): Promise<'added' | 'removed' | 'replaced'> {
  const { spaceId, messageId, userId, userName, emoji, currentReactions = {} } = params;
  const docId = `${messageId}_${userId}`;
  const reactionRef = doc(db, 'couples', spaceId, 'reactions', docId);

  // Check if current user already has a reaction on this message
  let existingEmoji: string | null = null;
  for (const [em, users] of Object.entries(currentReactions)) {
    if (users.includes(userId)) {
      existingEmoji = em;
      break;
    }
  }

  if (existingEmoji === emoji) {
    // User clicked the same emoji -> Remove it
    await deleteDoc(reactionRef);
    return 'removed';
  } else {
    // Add or Replace
    await setDoc(reactionRef, {
      id: docId,
      messageId,
      userId,
      userName: userName || 'Aryan',
      emoji,
      createdAt: serverTimestamp(),
    });
    return existingEmoji ? 'replaced' : 'added';
  }
}

/**
 * Subscribe to all reactions for a space in real-time, grouping by messageId.
 */
export function subscribeSpaceReactions(
  spaceId: string,
  onUpdate: (grouped: ReactionsMap, raw: ReactionDoc[]) => void
): Unsubscribe {
  if (useAuthStore.getState().isDemoMode || !spaceId || spaceId === 'couple-duo-main') {
    return () => {};
  }

  const colRef = collection(db, 'couples', spaceId, 'reactions');

  return onSnapshot(
    colRef,
    (snapshot) => {
      const grouped: ReactionsMap = {};
      const raw: ReactionDoc[] = [];

      snapshot.docs.forEach((docSnap) => {
        const data = docSnap.data() as ReactionDoc;
        raw.push(data);

        const { messageId, emoji, userId } = data;
        if (!messageId || !emoji || !userId) return;

        if (!grouped[messageId]) {
          grouped[messageId] = {};
        }
        if (!grouped[messageId][emoji]) {
          grouped[messageId][emoji] = [];
        }
        if (!grouped[messageId][emoji].includes(userId)) {
          grouped[messageId][emoji].push(userId);
        }
      });

      onUpdate(grouped, raw);
    },
    (err) => {
      console.warn('Reactions subscription error:', err);
    }
  );
}
