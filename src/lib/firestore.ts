/**
 * Firestore data layer — real-time hooks for all Duo collections.
 *
 * Each hook returns live data via Firestore onSnapshot listeners,
 * which automatically sync across devices with offline persistence.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  collection,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  getDocs,
  writeBatch,
  serverTimestamp,
  limit,
  enableNetwork,
  disableNetwork,
  type DocumentData,
} from 'firebase/firestore';
import { db } from './firebase';
import { usePresenceStore } from './store';
import type { CalendarEvent } from './calendar';
import type { FileAttachment } from './attachments';
import type { TaskReminder } from './taskReminders';
import type { PeriodTracker, DiaryEntry } from './dataStore';
import {
  normalizeMessageTimestamp,
  groupMessagesByDay,
} from './chatHistory';

// ─── Types ──────────────────────────────────────────────────────

export interface TaskItem {
  id: string;
  title: string;
  description?: string;
  status: 'todo' | 'doing' | 'done';
  taskDate: string;
  assignedTo: string;
  createdBy: string;
  doodleUrl?: string;
  startAt?: string | null; // ISO UTC string or null for Anytime
  timeZone?: string; // Creator's IANA timezone
  priority?: 'normal' | 'important' | 'urgent';
  repeatRule?: 'once' | 'daily' | 'weekdays' | 'weekly';
  reminders?: TaskReminder[];
  attachments?: FileAttachment[];
  alarmSound?: string;
  completedAt?: string | null;
  completedBy?: string | null;
  snoozedUntil?: string | null;
  lastNudgedAt?: string | null;
  updatedAt: any;
  createdAt?: any;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  sender_id?: string;
  couple_id?: string;
  content: string;
  messageType: 'text' | 'voice' | 'doodle' | 'call_card' | 'media';
  message_type?: 'text' | 'voice' | 'doodle' | 'call_card' | 'media';
  mediaUrl?: string;
  media_url?: string;
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
  reactions?: Record<string, string[]>;
  replyTo?: ReplySnapshot;
  reply_to?: any;
  replyToMessageId?: string;
  deletedForEveryone?: boolean;
  deleted_for_everyone?: boolean;
  deletedForMe?: string[];
  deleted_for_me?: string[];
  clientId?: string;
  client_id?: string;
  clientTimestamp?: number;
  created_at?: string;
  status?: 'sending' | 'sent' | 'delivered' | 'read';
  deliveredAt?: any;
  readAt?: any;
  createdAt: any;
}

export interface ReplySnapshot {
  messageId: string;
  senderId: string;
  senderName: string;
  type: ChatMessage['messageType'];
  snippet: string;
  thumbnailUrl?: string;
}

export interface ScoreEvent {
  id: string;
  userId: string;
  taskId?: string;
  kind: 'done' | 'early' | 'nudge_fast' | 'day_bonus' | 'shared';
  points: number;
  day: string;
  createdAt: any;
}

export interface WishlistItem {
  id: string;
  title: string;
  category: 'date' | 'travel' | 'food' | 'movie';
  notes?: string;
  completed: boolean;
  hearts: string[];
  createdBy: string;
  createdAt?: any;
}

export interface NudgeItem {
  id: string;
  taskId: string;
  taskTitle: string;
  senderId: string;
  receiverId: string;
  level: number;
  level4Count: number;
  resolved: boolean;
  createdAt: any;
}

// ─── Couple Management ──────────────────────────────────────────

/**
 * Generate a random 6-character alphanumeric invite code.
 */
function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No O/0/I/1 for clarity
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Create a new couple and link the current user to it.
 */
export async function createCouple(userId: string): Promise<{ coupleId: string; inviteCode: string }> {
  const inviteCode = generateInviteCode();
  const coupleRef = doc(collection(db, 'couples'));
  const coupleId = coupleRef.id;

  await setDoc(coupleRef, {
    inviteCode,
    locked: false,
    members: [userId],
    createdAt: serverTimestamp(),
  });

  // Update user profile with couple ID (safe setDoc with merge)
  await setDoc(doc(db, 'profiles', userId), { coupleId }, { merge: true });

  return { coupleId, inviteCode };
}

/**
 * Join an existing couple using an invite code.
 */
export async function joinCoupleByCode(userId: string, code: string): Promise<{ success: boolean; coupleId?: string; error?: string }> {
  // Find couple with this invite code
  const q = query(collection(db, 'couples'), where('inviteCode', '==', code.toUpperCase()));
  const snap = await getDocs(q);

  if (snap.empty) {
    return { success: false, error: 'Invalid invite code. Please check and try again.' };
  }

  const coupleDoc = snap.docs[0];
  const coupleData = coupleDoc.data();
  const coupleId = coupleDoc.id;

  if (coupleData.members?.includes(userId)) {
    // Already a member — safely re-link profile and return success!
    await setDoc(doc(db, 'profiles', userId), { coupleId }, { merge: true });
    return { success: true, coupleId };
  }

  if (coupleData.locked && coupleData.members?.length >= 2) {
    return { success: false, error: 'This space is already paired and locked.' };
  }

  if (coupleData.members?.length >= 2) {
    return { success: false, error: 'This space already has two members.' };
  }

  // Add user to couple
  const updatedMembers = [...(coupleData.members || []), userId];
  await updateDoc(coupleDoc.ref, {
    members: updatedMembers,
    locked: updatedMembers.length >= 2,
  });

  // Update user profile with couple ID (safe setDoc with merge)
  await setDoc(doc(db, 'profiles', userId), { coupleId }, { merge: true });

  return { success: true, coupleId };
}

export async function createCoupleWithCode(userId: string): Promise<{ id: string; inviteCode: string; locked: boolean; createdAt: string }> {
  const result = await createCouple(userId);
  return {
    id: result.coupleId,
    inviteCode: result.inviteCode,
    locked: false,
    createdAt: new Date().toISOString(),
  };
}

export async function joinCoupleWithCode(a: string, b: string): Promise<{ id: string; inviteCode: string; locked: boolean; createdAt: string }> {
  // Intelligently detect which is code and which is userId
  const isCodeA = a.length <= 8 && !a.includes('-');
  const code = isCodeA ? a : b;
  const userId = isCodeA ? b : a;

  const result = await joinCoupleByCode(userId, code);
  if (!result.success) {
    throw new Error(result.error || 'Failed to join private space');
  }
  return {
    id: result.coupleId || '',
    inviteCode: code,
    locked: true,
    createdAt: new Date().toISOString(),
  };
}

export function onCoupleChange(coupleId: string, callback: (data: DocumentData | undefined) => void) {
  if (!coupleId || coupleId.startsWith('demo') || coupleId === 'couple-duo-main') {
    return () => {};
  }
  return onSnapshot(
    doc(db, 'couples', coupleId),
    (snapshot) => {
      if (snapshot.exists()) {
        callback(snapshot.data());
      }
    },
    (error) => {
      console.warn('[Firestore] onCoupleChange notice:', error);
    }
  );
}

export function usePeriodTracker(coupleId: string | null) {
  const [tracker, setTracker] = useState<PeriodTracker | null>(null);

  useEffect(() => {
    if (!coupleId || coupleId === 'couple-duo-main') {
      setTracker(null);
      return;
    }
    return onSnapshot(
      doc(db, 'couples', coupleId),
      (snapshot) => {
        const value = snapshot.data()?.periodTracker;
        setTracker(value ? (value as PeriodTracker) : null);
      },
      (error) => {
        console.warn('[Firestore] Period tracker subscription error:', error);
      }
    );
  }, [coupleId]);

  return tracker;
}

export async function updatePeriodTracker(coupleId: string, tracker: PeriodTracker) {
  await updateDoc(doc(db, 'couples', coupleId), { periodTracker: tracker });
}

// ─── Real-time Hooks ────────────────────────────────────────────

/**
 * Live-subscribe to all tasks for a couple.
 */
export function useTasks(coupleId: string | null) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!coupleId || coupleId.startsWith('demo')) { setLoading(false); return; }

    const q = query(
      collection(db, 'couples', coupleId, 'tasks'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items: TaskItem[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as TaskItem[];
        setTasks(items);
        setLoading(false);
      },
      (error) => {
        console.warn('[Firestore] useTasks snapshot error:', error);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [coupleId]);

  return { tasks, loading };
}

/**
 * Robust timestamp extractor: parses Firestore Timestamp objects, ISO strings,
 * Date objects, epoch numbers, and fallbacks.
 * Guarantees that mobile phone clock drift or missing fields never cause messages
 * to be sorted out of order or return NaN.
 */
export function getMessageTimestamp(m: any): number {
  if (!m) return 0;

  const parseTs = (val: any): number | null => {
    if (!val) return null;
    if (typeof val.toMillis === 'function') {
      const t = val.toMillis();
      if (typeof t === 'number' && !isNaN(t) && t > 0) return t;
    }
    if (typeof val.seconds === 'number' && val.seconds > 0) {
      const ms = val.seconds * 1000 + (val.nanoseconds ? Math.round(val.nanoseconds / 1e6) : 0);
      if (!isNaN(ms) && ms > 0) return ms;
    }
    if (typeof val._seconds === 'number' && val._seconds > 0) {
      const ms = val._seconds * 1000 + (val._nanoseconds ? Math.round(val._nanoseconds / 1e6) : 0);
      if (!isNaN(ms) && ms > 0) return ms;
    }
    if (val instanceof Date && !isNaN(val.getTime())) {
      return val.getTime();
    }
    if (typeof val === 'number' && !isNaN(val) && val > 0) {
      return val > 1e9 && val < 1e11 ? val * 1000 : val;
    }
    if (typeof val === 'string') {
      const parsed = new Date(val).getTime();
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return null;
  };

  const fromCreatedAt = parseTs(m.createdAt);
  if (fromCreatedAt) return fromCreatedAt;

  const fromCreatedAtSnake = parseTs(m.created_at);
  if (fromCreatedAtSnake) return fromCreatedAtSnake;

  if (typeof m.clientTimestamp === 'number' && !isNaN(m.clientTimestamp) && m.clientTimestamp > 0) {
    return m.clientTimestamp;
  }
  const fromTimestamp = parseTs(m.timestamp);
  if (fromTimestamp) return fromTimestamp;

  // Extract from clientId or ID if it starts with msg-<timestamp>
  const idToCheck = m.clientId || m.id;
  if (typeof idToCheck === 'string' && idToCheck.startsWith('msg-')) {
    const parts = idToCheck.split('-');
    const ts = parseInt(parts[1], 10);
    if (!isNaN(ts) && ts > 1e11) return ts;
  }

  const fromDelivered = parseTs(m.deliveredAt);
  if (fromDelivered) return fromDelivered;

  const fromRead = parseTs(m.readAt);
  if (fromRead) return fromRead;

  // Stable deterministic fallback pinned to the object
  try {
    if ((m as any)._pinnedTime) return (m as any)._pinnedTime;
    (m as any)._pinnedTime = Date.now();
    return (m as any)._pinnedTime;
  } catch {
    return Date.now();
  }
}

/**
 * Live-subscribe to messages for a couple.
 * Queries newest messages first (limitCount) and falls back gracefully if un-migrated.
 */
export function useMessages(coupleId: string | null, _limitCount?: number) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!coupleId || coupleId.startsWith('demo') || coupleId === 'couple-duo-main') {
      setMessages([]);
      setLoading(false);
      return;
    }

    const messagesCol = collection(db, 'couples', coupleId, 'messages');

    const handleSnapshot = (snapshot: any) => {
      const items: ChatMessage[] = snapshot.docs.map((d: any) => {
        const raw = d.data({ serverTimestamps: 'estimate' });
        return {
          id: d.id,
          ...raw,
          // Ensure dual-property mapping so all components get both conventions
          senderId: raw.senderId || raw.sender_id,
          sender_id: raw.sender_id || raw.senderId,
          messageType: raw.messageType || raw.message_type || 'text',
          message_type: raw.message_type || raw.messageType || 'text',
          mediaUrl: raw.mediaUrl || raw.media_url,
          media_url: raw.media_url || raw.mediaUrl,
          replyTo: raw.replyTo || raw.reply_to,
          reply_to: raw.reply_to || raw.replyTo,
        };
      }) as unknown as ChatMessage[];

      // Sort chronologically (oldest to newest) with deterministic tie-breaker
      items.sort((a: any, b: any) => {
        const tA = getMessageTimestamp(a);
        const tB = getMessageTimestamp(b);
        if (tA !== tB) return tA - tB;
        return (a.id || '').localeCompare(b.id || '');
      });

      setMessages(items);
      setLoading(false);
    };

    // Subscribe directly to messages collection to reliably receive all messages
    // (legacy messages and messages from mobile devices without clientTimestamp)
    const unsubscribe = onSnapshot(
      messagesCol,
      handleSnapshot,
      (error) => {
        console.error('[Firestore] useMessages error:', error);
        setLoading(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [coupleId]);

  return { messages, loading };
}

export interface UsePaginatedMessagesResult {
  messages: ChatMessage[];
  allLoadedMessages: ChatMessage[];
  loading: boolean;
  isLoadingEarlier: boolean;
  hasMoreEarlier: boolean;
  loadEarlier: () => Promise<void>;
  isAllCaughtUp: boolean;
  displayedDayCount: number;
}

/**
 * Progressive day-by-day chat message hook.
 * Initially loads only the newest day's messages (bounded to 100).
 * Supports top-scroll day-by-day pagination, within-day pagination if >100 messages,
 * and maintains real-time updates for live incoming messages.
 */
export function usePaginatedMessages(
  coupleId: string | null,
  timeZone?: string
): UsePaginatedMessagesResult {
  const [allMessages, setAllMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLoadingEarlier, setIsLoadingEarlier] = useState(false);
  const [unlockedDaysCount, setUnlockedDaysCount] = useState(1);
  const [earliestDayLimit, setEarliestDayLimit] = useState(100);

  // Reset pagination state when coupleId changes
  useEffect(() => {
    setUnlockedDaysCount(1);
    setEarliestDayLimit(100);
  }, [coupleId]);

  useEffect(() => {
    if (!coupleId || coupleId.startsWith('demo') || coupleId === 'couple-duo-main') {
      setAllMessages([]);
      setLoading(false);
      return;
    }

    const messagesCol = collection(db, 'couples', coupleId, 'messages');

    const handleSnapshot = (snapshot: any) => {
      const items: ChatMessage[] = snapshot.docs.map((d: any) => {
        const raw = d.data({ serverTimestamps: 'estimate' });
        return {
          id: d.id,
          ...raw,
          senderId: raw.senderId || raw.sender_id,
          sender_id: raw.sender_id || raw.senderId,
          messageType: raw.messageType || raw.message_type || 'text',
          message_type: raw.message_type || raw.messageType || 'text',
          mediaUrl: raw.mediaUrl || raw.media_url,
          media_url: raw.media_url || raw.mediaUrl,
          replyTo: raw.replyTo || raw.reply_to,
          reply_to: raw.reply_to || raw.replyTo,
        };
      }) as unknown as ChatMessage[];

      items.sort((a: any, b: any) => {
        const tA = normalizeMessageTimestamp(a);
        const tB = normalizeMessageTimestamp(b);
        if (tA !== tB) return tA - tB;
        return (a.id || '').localeCompare(b.id || '');
      });

      setAllMessages(items);
      setLoading(false);
    };

    const unsubscribe = onSnapshot(
      messagesCol,
      handleSnapshot,
      (error) => {
        console.error('[Firestore] usePaginatedMessages error:', error);
        setLoading(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [coupleId]);

  const dayGroups = useMemo(() => {
    return groupMessagesByDay(allMessages, timeZone);
  }, [allMessages, timeZone]);

  const { visibleMessages, hasMoreEarlier } = useMemo(() => {
    if (dayGroups.length === 0) {
      return { visibleMessages: [], hasMoreEarlier: false };
    }

    const startIndex = Math.max(0, dayGroups.length - unlockedDaysCount);
    const visibleGroups = dayGroups.slice(startIndex);

    const earliestGroup = visibleGroups[0];
    const earliestDayMessages = earliestGroup.messages;
    const hasMoreInEarliestDay = earliestDayMessages.length > earliestDayLimit;

    const result: ChatMessage[] = [];
    visibleGroups.forEach((group, idx) => {
      if (idx === 0 && hasMoreInEarliestDay) {
        result.push(...group.messages.slice(-earliestDayLimit));
      } else {
        result.push(...group.messages);
      }
    });

    const hasEarlierDays = startIndex > 0;
    const hasMore = hasEarlierDays || hasMoreInEarliestDay;

    return { visibleMessages: result, hasMoreEarlier: hasMore };
  }, [dayGroups, unlockedDaysCount, earliestDayLimit]);

  const loadEarlier = useCallback(async () => {
    if (isLoadingEarlier || !hasMoreEarlier) return;
    setIsLoadingEarlier(true);

    try {
      const startIndex = Math.max(0, dayGroups.length - unlockedDaysCount);
      const earliestGroup = dayGroups[startIndex];
      if (earliestGroup && earliestGroup.messages.length > earliestDayLimit) {
        setEarliestDayLimit((prev) => prev + 100);
      } else {
        setUnlockedDaysCount((prev) => prev + 1);
        setEarliestDayLimit(100);
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    } finally {
      setIsLoadingEarlier(false);
    }
  }, [isLoadingEarlier, hasMoreEarlier, dayGroups, unlockedDaysCount, earliestDayLimit]);

  return {
    messages: visibleMessages,
    allLoadedMessages: allMessages,
    loading,
    isLoadingEarlier,
    hasMoreEarlier,
    loadEarlier,
    isAllCaughtUp: !hasMoreEarlier && allMessages.length > 0,
    displayedDayCount: Math.min(unlockedDaysCount, dayGroups.length),
  };
}

/**
 * Fetch a previous day's messages using an epoch timestamp cursor.
 */
export async function fetchPreviousDay(
  coupleId: string,
  beforeTimestamp: number,
  _cursorDoc?: any,
  pageLimit: number = 100
): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
  if (!coupleId) return { messages: [], hasMore: false };
  try {
    const messagesCol = collection(db, 'couples', coupleId, 'messages');
    const snap = await getDocs(messagesCol);
    const all = snap.docs.map((d: any) => ({
      id: d.id,
      ...d.data(),
    })) as ChatMessage[];

    const earlier = all
      .filter((m) => normalizeMessageTimestamp(m) < beforeTimestamp)
      .sort((a, b) => normalizeMessageTimestamp(b) - normalizeMessageTimestamp(a));

    const page = earlier.slice(0, pageLimit).reverse();
    return {
      messages: page,
      hasMore: earlier.length > pageLimit,
    };
  } catch (err) {
    console.warn('[Firestore] fetchPreviousDay error:', err);
    return { messages: [], hasMore: false };
  }
}


/**
 * Real-time typing status broadcaster synced across devices via Firestore.
 */
export async function updateTypingStatus(
  coupleId: string,
  userId: string,
  isTyping: boolean,
  isRecording: boolean = false
): Promise<void> {
  if (!coupleId || !userId) return;
  try {
    const typingDocRef = doc(db, 'couples', coupleId, 'typing', userId);
    await setDoc(typingDocRef, {
      isTyping,
      isRecording,
      updatedAt: Date.now(),
    }, { merge: true });
  } catch {
    // Non-blocking
  }
}

/**
 * Live subscription to partner's real-time typing status.
 */
export function usePartnerTyping(coupleId: string | null, partnerId: string | null) {
  useEffect(() => {
    if (!coupleId || !partnerId) return;

    let timeoutId: number | null = null;
    const typingDocRef = doc(db, 'couples', coupleId, 'typing', partnerId);

    const unsubscribe = onSnapshot(
      typingDocRef,
      (snap) => {
        if (timeoutId) window.clearTimeout(timeoutId);

        if (snap.exists()) {
          const data = snap.data();
          const isRecent = data.updatedAt && (Date.now() - Number(data.updatedAt) < 7000);
          const typing = Boolean(data.isTyping && isRecent);
          const recording = Boolean(data.isRecording && isRecent);

          usePresenceStore.getState().setPartnerTyping(typing);
          usePresenceStore.getState().setPartnerRecording(recording);

          if (typing || recording) {
            usePresenceStore.getState().setPartnerPresence(true);
            timeoutId = window.setTimeout(() => {
              usePresenceStore.getState().setPartnerTyping(false);
              usePresenceStore.getState().setPartnerRecording(false);
            }, 5000);
          }
        } else {
          usePresenceStore.getState().setPartnerTyping(false);
          usePresenceStore.getState().setPartnerRecording(false);
        }
      },
      () => {
        // Ignore errors
      }
    );

    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [coupleId, partnerId]);
}

/**
 * Automatically marks received messages from partner as 'delivered' (double tick)
 * whenever this user's app receives them over the wire.
 */
export function useMessageDeliverySync(coupleId: string | null, currentUserId: string | null) {
  useEffect(() => {
    if (!coupleId || !currentUserId) return;

    const markedSet = new Set<string>();

    const q = query(
      collection(db, 'couples', coupleId, 'messages'),
      where('status', '==', 'sent'),
      limit(50)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const undeliveredPartnerIds: string[] = [];
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data();
          const sender = data.senderId || data.sender_id;
          if (sender && sender !== currentUserId && !markedSet.has(docSnap.id)) {
            undeliveredPartnerIds.push(docSnap.id);
            markedSet.add(docSnap.id);
          }
        });

        if (undeliveredPartnerIds.length > 0) {
          markMessagesDelivered(coupleId, undeliveredPartnerIds).catch(() => {
            undeliveredPartnerIds.forEach((id) => markedSet.delete(id));
          });
        }
      },
      (err) => {
        console.warn('[DeliverySync] Listener notice:', err);
      }
    );

    return unsubscribe;
  }, [coupleId, currentUserId]);
}

/**
 * Live-subscribe to scores for a couple.
 */
export function useScores(coupleId: string | null) {
  const [scores, setScores] = useState<ScoreEvent[]>([]);

  useEffect(() => {
    if (!coupleId || coupleId.startsWith('demo') || coupleId === 'couple-duo-main') return;

    const q = query(
      collection(db, 'couples', coupleId, 'scores'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setScores(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as ScoreEvent[]);
      },
      (error) => {
        console.warn('[Firestore] useScores snapshot error:', error);
      }
    );

    return unsubscribe;
  }, [coupleId]);

  return scores;
}

/**
 * Live-subscribe to wishlist for a couple.
 */
export function useWishlist(coupleId: string | null) {
  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);

  useEffect(() => {
    if (!coupleId || coupleId.startsWith('demo') || coupleId === 'couple-duo-main') return;

    const q = query(
      collection(db, 'couples', coupleId, 'wishlist'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setWishlist(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as WishlistItem[]);
      },
      (error) => {
        console.warn('[Firestore] useWishlist snapshot error:', error);
      }
    );

    return unsubscribe;
  }, [coupleId]);

  return wishlist;
}

/**
 * Live-subscribe to active nudges for a couple.
 */
export function useNudges(coupleId: string | null) {
  const [nudges, setNudges] = useState<NudgeItem[]>([]);

  useEffect(() => {
    if (!coupleId || coupleId.startsWith('demo') || coupleId === 'couple-duo-main') return;

    const q = query(
      collection(db, 'couples', coupleId, 'nudges'),
      where('resolved', '==', false)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setNudges(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as NudgeItem[]);
      },
      (error) => {
        console.warn('[Firestore] useNudges snapshot error:', error);
      }
    );

    return unsubscribe;
  }, [coupleId]);

  return nudges;
}

function isPlainObject(obj: any): boolean {
  if (typeof obj !== 'object' || obj === null) return false;
  const proto = Object.getPrototypeOf(obj);
  return proto === null || proto === Object.prototype;
}

function cleanUndefined<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(cleanUndefined) as unknown as T;
  if (isPlainObject(obj)) {
    const res: any = {};
    for (const [k, v] of Object.entries(obj as any)) {
      if (v !== undefined) {
        res[k] = cleanUndefined(v);
      }
    }
    return res;
  }
  return obj;
}

// ─── Mutation Functions ─────────────────────────────────────────

export async function addTask(coupleId: string, task: Omit<TaskItem, 'id' | 'createdAt' | 'updatedAt'>) {
  const sanitized = cleanUndefined({
    ...task,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return addDoc(collection(db, 'couples', coupleId, 'tasks'), sanitized);
}

export async function updateTask(coupleId: string, taskId: string, updates: Partial<TaskItem>) {
  const sanitized = cleanUndefined({
    ...updates,
    updatedAt: serverTimestamp(),
  });
  return updateDoc(doc(db, 'couples', coupleId, 'tasks', taskId), sanitized);
}

export async function deleteTask(coupleId: string, taskId: string) {
  return deleteDoc(doc(db, 'couples', coupleId, 'tasks', taskId));
}

/**
 * Forces Firestore WebChannel to reconnect immediately.
 * Called when mobile devices resume from background / screen unlock.
 */
let isReconnecting = false;
export async function forceFirestoreReconnect(): Promise<void> {
  if (isReconnecting) return;
  isReconnecting = true;
  try {
    await enableNetwork(db);
  } catch {
    try {
      await disableNetwork(db);
      await enableNetwork(db);
    } catch {}
  } finally {
    setTimeout(() => {
      isReconnecting = false;
    }, 1000);
  }
}

export async function sendMessage(
  coupleId: string,
  message: Omit<ChatMessage, 'id' | 'createdAt'> & { clientId?: string; sender_id?: string; message_type?: any }
) {
  const now = new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  const senderId = message.senderId || (message as any).sender_id || '';
  const messageType = message.messageType || (message as any).message_type || 'text';
  const mediaUrl = message.mediaUrl || (message as any).media_url;
  const replyTo = message.replyTo || (message as any).reply_to;

  const sanitized = cleanUndefined({
    ...message,
    senderId,
    sender_id: senderId,
    messageType,
    message_type: messageType,
    mediaUrl,
    media_url: mediaUrl,
    replyTo,
    reply_to: replyTo,
    clientTimestamp: nowMs,
    created_at: nowIso,
    createdAt: serverTimestamp(),
  });
  return addDoc(collection(db, 'couples', coupleId, 'messages'), sanitized);
}

export async function updateMessage(coupleId: string, messageId: string, updates: Partial<ChatMessage>) {
  const sanitized = cleanUndefined(updates);
  return updateDoc(doc(db, 'couples', coupleId, 'messages', messageId), sanitized);
}

/**
 * Mark messages as delivered (double gray ticks) when recipient's device receives them.
 */
export async function markMessagesDelivered(coupleId: string, messageIds: string[]): Promise<void> {
  if (!coupleId || !messageIds || messageIds.length === 0) return;
  const uniqueIds = Array.from(new Set(messageIds)).filter(Boolean);
  const chunkSize = 400;
  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize);
    try {
      const batch = writeBatch(db);
      chunk.forEach((id) => {
        batch.update(doc(db, 'couples', coupleId, 'messages', id), {
          status: 'delivered',
          deliveredAt: serverTimestamp(),
        });
      });
      await batch.commit();
    } catch (err) {
      console.warn('[Firestore] Failed to mark messages delivered batch:', err);
    }
  }
}

/**
 * Mark messages as read / seen (double blue ticks) when recipient opens/views chat.
 */
export async function markMessagesRead(coupleId: string, messageIds: string[]): Promise<void> {
  if (!coupleId || !messageIds || messageIds.length === 0) return;
  const uniqueIds = Array.from(new Set(messageIds)).filter(Boolean);
  const chunkSize = 400;
  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize);
    try {
      const batch = writeBatch(db);
      chunk.forEach((id) => {
        batch.update(doc(db, 'couples', coupleId, 'messages', id), {
          status: 'read',
          readAt: serverTimestamp(),
        });
      });
      await batch.commit();
    } catch (err) {
      console.warn('[Firestore] Failed to mark messages read batch:', err);
    }
  }
}

export async function deleteChatMessage(coupleId: string, messageId: string) {
  return deleteDoc(doc(db, 'couples', coupleId, 'messages', messageId));
}

export async function updateMessageReactions(coupleId: string, messageId: string, reactions: Record<string, string[]>) {
  return updateDoc(doc(db, 'couples', coupleId, 'messages', messageId), { reactions });
}

export async function addScore(coupleId: string, score: Omit<ScoreEvent, 'id' | 'createdAt'>) {
  const sanitized = cleanUndefined({
    ...score,
    createdAt: serverTimestamp(),
  });
  return addDoc(collection(db, 'couples', coupleId, 'scores'), sanitized);
}

export async function addWishlistItem(coupleId: string, item: Omit<WishlistItem, 'id' | 'createdAt'>) {
  const sanitized = cleanUndefined({
    ...item,
    createdAt: serverTimestamp(),
  });
  return addDoc(collection(db, 'couples', coupleId, 'wishlist'), sanitized);
}

export async function updateWishlistItem(coupleId: string, itemId: string, updates: Partial<WishlistItem>) {
  const sanitized = cleanUndefined(updates);
  return updateDoc(doc(db, 'couples', coupleId, 'wishlist', itemId), sanitized);
}

export async function createNudge(coupleId: string, nudge: Omit<NudgeItem, 'id' | 'createdAt'>) {
  const sanitized = cleanUndefined({
    ...nudge,
    createdAt: serverTimestamp(),
  });
  return addDoc(collection(db, 'couples', coupleId, 'nudges'), sanitized);
}

export async function resolveNudge(coupleId: string, nudgeId: string) {
  return updateDoc(doc(db, 'couples', coupleId, 'nudges', nudgeId), {
    resolved: true,
  });
}

// ─── Couple Info Hook ───────────────────────────────────────────

export interface CoupleInfo {
  id: string;
  inviteCode: string;
  locked: boolean;
  members: string[];
  createdAt: any;
}

export function useCoupleInfo(coupleId: string | null) {
  const [couple, setCouple] = useState<CoupleInfo | null>(null);

  useEffect(() => {
    if (!coupleId || coupleId.startsWith('demo') || coupleId === 'couple-duo-main') return;

    const unsubscribe = onSnapshot(
      doc(db, 'couples', coupleId),
      (snap) => {
        if (snap.exists()) {
          setCouple({ id: snap.id, ...snap.data() } as CoupleInfo);
        }
      },
      (error) => {
        console.warn('[Firestore] useCoupleInfo error:', error);
      }
    );

    return unsubscribe;
  }, [coupleId]);

  return couple;
}

/**
 * Get the partner's profile from Firestore given the couple's member list.
 */
export function usePartnerProfile(coupleId: string | null, currentUserId: string | null) {
  const [partner, setPartner] = useState<DocumentData | null>(null);

  useEffect(() => {
    if (!coupleId || coupleId.startsWith('demo') || coupleId === 'couple-duo-main' || !currentUserId) {
      setPartner(null);
      return;
    }

    let unsubPartner: (() => void) | null = null;

    // Listen to couple doc to get member list, then watch partner profile
    const unsubCouple = onSnapshot(
      doc(db, 'couples', coupleId),
      (coupleSnap) => {
        if (!coupleSnap.exists()) {
          setPartner(null);
          return;
        }
        const members: string[] = coupleSnap.data().members || [];
        const partnerId = members.find((m) => m !== currentUserId);

        if (!partnerId) {
          if (unsubPartner) {
            unsubPartner();
            unsubPartner = null;
          }
          setPartner(null);
          return;
        }

        if (unsubPartner) {
          unsubPartner();
        }

        // Watch partner profile for live updates (mood, theme, etc.)
        unsubPartner = onSnapshot(
          doc(db, 'profiles', partnerId),
          (profileSnap) => {
            if (profileSnap.exists()) {
              setPartner({ uid: profileSnap.id, ...profileSnap.data() });
            }
          },
          (err) => {
            console.warn('[Firestore] Partner profile listener notice:', err);
          }
        );
      },
      (err) => {
        console.warn('[Firestore] Couple profile listener notice:', err);
      }
    );

    return () => {
      unsubCouple();
      if (unsubPartner) unsubPartner();
    };
  }, [coupleId, currentUserId]);

  return partner;
}

/**
 * Update the current user's profile in Firestore.
 */
export async function updateProfile(uid: string, updates: Record<string, any>) {
  const sanitized = cleanUndefined(updates);
  return updateDoc(doc(db, 'profiles', uid), sanitized);
}

export async function updateCoupleNickname(coupleId: string, partnerId: string, nickname: string) {
  return updateDoc(doc(db, 'couples', coupleId), {
    [`nicknames.${partnerId}`]: nickname,
  });
}

// ─── Calendar Events ──────────────────────────────────────────

/**
 * Live-subscribe to calendar events for a couple space.
 */
export function useCalendarEvents(coupleId: string | null) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!coupleId || coupleId === 'couple-duo-main') {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'couples', coupleId, 'events'),
      orderBy('startDate', 'asc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items: CalendarEvent[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as CalendarEvent[];
        setEvents(items);
        setLoading(false);
      },
      (error) => {
        console.warn('Firestore calendar events error, using cached events:', error);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [coupleId]);

  return { events, loading };
}

export async function addCalendarEvent(
  coupleId: string,
  event: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const eventsCol = collection(db, 'couples', coupleId, 'events');
  const now = new Date().toISOString();
  const sanitized = cleanUndefined({
    ...event,
    createdAt: now,
    updatedAt: now,
  });
  const docRef = await addDoc(eventsCol, sanitized);
  return docRef.id;
}

export async function updateCalendarEvent(
  coupleId: string,
  eventId: string,
  updates: Partial<CalendarEvent>
) {
  const now = new Date().toISOString();
  const sanitized = cleanUndefined({
    ...updates,
    updatedAt: now,
  });
  return updateDoc(doc(db, 'couples', coupleId, 'events', eventId), sanitized);
}

export async function deleteCalendarEvent(coupleId: string, eventId: string) {
  // Soft delete with deletedAt or hard delete
  const now = new Date().toISOString();
  return updateDoc(doc(db, 'couples', coupleId, 'events', eventId), {
    deletedAt: now,
    updatedAt: now,
  });
}

// ─── Personal Diary (Private per User) ──────────────────────────

export function useDiaryEntries(coupleId: string | null, userId: string) {
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!coupleId || !userId) {
      setEntries([]);
      setLoading(false);
      return;
    }

    const col = collection(db, 'couples', coupleId, 'diaries');
    const q = query(col, where('userId', '==', userId), orderBy('createdAt', 'desc'));

    return onSnapshot(
      q,
      (snapshot) => {
        const list: DiaryEntry[] = snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            userId: data.userId || userId,
            title: data.title || '',
            content: data.content || '',
            mood: data.mood,
            date: data.date || '',
            tags: data.tags || [],
            createdAt: data.createdAt || new Date().toISOString(),
            updatedAt: data.updatedAt || new Date().toISOString(),
          };
        });
        setEntries(list);
        setLoading(false);
      },
      (err) => {
        console.warn('[Firestore] Diary subscription error:', err);
        setLoading(false);
      }
    );
  }, [coupleId, userId]);

  return { entries, loading };
}

export async function addDiaryEntry(
  coupleId: string,
  entry: Omit<DiaryEntry, 'id'>
): Promise<string> {
  const col = collection(db, 'couples', coupleId, 'diaries');
  const now = new Date().toISOString();
  const sanitized = cleanUndefined({
    ...entry,
    createdAt: entry.createdAt || now,
    updatedAt: now,
  });
  const docRef = await addDoc(col, sanitized);
  return docRef.id;
}

export async function updateDiaryEntry(
  coupleId: string,
  entryId: string,
  updates: Partial<DiaryEntry>
) {
  const now = new Date().toISOString();
  const sanitized = cleanUndefined({
    ...updates,
    updatedAt: now,
  });
  return updateDoc(doc(db, 'couples', coupleId, 'diaries', entryId), sanitized);
}

export async function deleteDiaryEntry(coupleId: string, entryId: string) {
  return deleteDoc(doc(db, 'couples', coupleId, 'diaries', entryId));
}

