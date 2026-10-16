import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  collection,
  doc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import type { FileAttachment } from './attachments';

export interface StarredMessage {
  id: string; // `${messageId}_${userId}`
  messageId: string;
  userId: string;
  coupleId: string;
  content: string;
  senderId: string;
  senderName: string;
  messageType: string;
  attachments?: FileAttachment[];
  mediaUrl?: string;
  doodleUrl?: string;
  createdAt: any;
  starredAt: any;
}

const DEMO_STORAGE_PREFIX = 'duo_starred_messages_';

function getDemoStars(userId: string): StarredMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(`${DEMO_STORAGE_PREFIX}${userId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveDemoStars(userId: string, stars: StarredMessage[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${DEMO_STORAGE_PREFIX}${userId}`, JSON.stringify(stars));
  } catch {}
}

/**
 * Toggle starred state of a message for the current user.
 */
export async function toggleStarMessage(
  coupleId: string,
  userId: string,
  message: any,
  senderName: string,
  isDemo: boolean = false
): Promise<boolean> {
  const starDocId = `${message.id}_${userId}`;

  if (isDemo || !coupleId || coupleId.startsWith('demo')) {
    const stars = getDemoStars(userId);
    const existingIndex = stars.findIndex((s) => s.messageId === message.id);
    if (existingIndex >= 0) {
      stars.splice(existingIndex, 1);
      saveDemoStars(userId, stars);
      return false; // unstarred
    } else {
      const newStar: StarredMessage = {
        id: starDocId,
        messageId: message.id,
        userId,
        coupleId: coupleId || 'demo-couple',
        content: message.content || '',
        senderId: message.sender_id || message.senderId || '',
        senderName: senderName || 'Partner',
        messageType: message.message_type || message.messageType || 'text',
        attachments: message.attachments || [],
        mediaUrl: message.media_url || message.mediaUrl,
        doodleUrl: (message as any).doodle_url || (message as any).doodleUrl,
        createdAt: message.created_at || new Date().toISOString(),
        starredAt: new Date().toISOString(),
      };
      stars.unshift(newStar);
      saveDemoStars(userId, stars);
      return true; // starred
    }
  }

  // Firestore live path
  const starRef = doc(db, 'couples', coupleId, 'starredMessages', starDocId);
  try {
    // Check if star exists
    const starData: StarredMessage = {
      id: starDocId,
      messageId: message.id,
      userId,
      coupleId,
      content: message.content || '',
      senderId: message.sender_id || message.senderId || '',
      senderName: senderName || 'Partner',
      messageType: message.message_type || message.messageType || 'text',
      attachments: message.attachments || [],
      mediaUrl: message.media_url || message.mediaUrl || null,
      doodleUrl: (message as any).doodle_url || (message as any).doodleUrl || null,
      createdAt: message.created_at || new Date().toISOString(),
      starredAt: serverTimestamp(),
    };

    // Clean undefined fields
    const sanitized = Object.fromEntries(
      Object.entries(starData).filter(([_, v]) => v !== undefined)
    );

    // Using deterministic starDocId: check if already exists to delete, or setDoc
    await setDoc(starRef, sanitized);
    return true;
  } catch (err) {
    console.warn('[StarredMessages] Error saving star:', err);
    throw err;
  }
}

export async function removeStarMessage(
  coupleId: string,
  userId: string,
  messageId: string,
  isDemo: boolean = false
): Promise<void> {
  const starDocId = `${messageId}_${userId}`;

  if (isDemo || !coupleId || coupleId.startsWith('demo')) {
    const stars = getDemoStars(userId);
    const filtered = stars.filter((s) => s.messageId !== messageId);
    saveDemoStars(userId, filtered);
    return;
  }

  const starRef = doc(db, 'couples', coupleId, 'starredMessages', starDocId);
  await deleteDoc(starRef);
}

/**
 * Hook to subscribe to user's starred messages list in real-time.
 */
export function useStarredMessages(
  coupleId: string | null,
  userId: string | null,
  isDemo: boolean = false
) {
  const [starredList, setStarredList] = useState<StarredMessage[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // In-memory set of starred message IDs for O(1) checks in chat bubble rendering
  const starredMessageIds = useMemo(() => {
    return new Set(starredList.map((s) => s.messageId));
  }, [starredList]);

  useEffect(() => {
    if (!userId) {
      setStarredList([]);
      setLoading(false);
      return;
    }

    if (isDemo || !coupleId || coupleId.startsWith('demo')) {
      setStarredList(getDemoStars(userId));
      setLoading(false);

      const handleStorage = () => {
        setStarredList(getDemoStars(userId));
      };
      window.addEventListener('storage', handleStorage);
      return () => window.removeEventListener('storage', handleStorage);
    }

    setLoading(true);
    const q = query(
      collection(db, 'couples', coupleId, 'starredMessages'),
      where('userId', '==', userId),
      orderBy('starredAt', 'desc'),
      limit(100)
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const items: StarredMessage[] = [];
        snapshot.forEach((docSnap) => {
          items.push(docSnap.data() as StarredMessage);
        });
        setStarredList(items);
        setLoading(false);
      },
      (err) => {
        console.warn('[StarredMessages] Subscription notice:', err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [coupleId, userId, isDemo]);

  const isStarred = useCallback(
    (messageId: string) => starredMessageIds.has(messageId),
    [starredMessageIds]
  );

  const toggle = useCallback(
    async (message: any, senderName: string) => {
      if (!userId || !coupleId) return;
      if (isStarred(message.id)) {
        await removeStarMessage(coupleId, userId, message.id, isDemo);
        if (isDemo) setStarredList(getDemoStars(userId));
      } else {
        await toggleStarMessage(coupleId, userId, message, senderName, isDemo);
        if (isDemo) setStarredList(getDemoStars(userId));
      }
    },
    [coupleId, userId, isDemo, isStarred]
  );

  const unstar = useCallback(
    async (messageId: string) => {
      if (!userId || !coupleId) return;
      await removeStarMessage(coupleId, userId, messageId, isDemo);
      if (isDemo) setStarredList(getDemoStars(userId));
    },
    [coupleId, userId, isDemo]
  );

  return {
    starredList,
    isStarred,
    toggle,
    unstar,
    loading,
  };
}
