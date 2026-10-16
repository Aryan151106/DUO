/**
 * Shared Media Engine (src/lib/sharedMedia.ts)
 *
 * Provides:
 * 1. Dedicated index collection: couples/{coupleId}/sharedMedia/{id}
 * 2. Separate categories: Doodles, Photos, Videos
 * 3. Efficient paginated queries without scanning 1,000 text messages
 * 4. Transparent fallback / migration for existing messages and doodles
 * 5. On-demand full resolution retrieval
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  onSnapshot,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import { useAuthStore } from './store';
import { duoDataStore } from './dataStore';

export type SharedMediaCategory = 'all' | 'doodles' | 'photos' | 'videos';

export interface SharedMediaItem {
  id: string;
  category: 'doodles' | 'photos' | 'videos';
  name: string;
  url: string;
  thumbnailUrl: string;
  path?: string;
  thumbnailPath?: string;
  createdAt: string;
  timestamp: number;
  source: 'chat' | 'doodle' | 'task';
  sourceId?: string;
  senderId?: string;
  size?: number;
  caption?: string;
  width?: number;
  height?: number;
}

/**
 * Index a media item into couples/{coupleId}/sharedMedia/{id}
 */
export async function indexSharedMediaItem(coupleId: string, item: SharedMediaItem): Promise<void> {
  if (!coupleId || coupleId.startsWith('demo') || coupleId === 'couple-duo-main') {
    return;
  }
  try {
    const docRef = doc(db, 'couples', coupleId, 'sharedMedia', item.id);
    await setDoc(docRef, {
      ...item,
      updatedAt: Date.now(),
    }, { merge: true });
  } catch (err) {
    console.warn('[SharedMedia] Failed to index media item:', err);
  }
}

/**
 * Remove an item from the sharedMedia index
 */
export async function removeSharedMediaItem(coupleId: string, itemId: string): Promise<void> {
  if (!coupleId || coupleId.startsWith('demo') || coupleId === 'couple-duo-main') {
    return;
  }
  try {
    await deleteDoc(doc(db, 'couples', coupleId, 'sharedMedia', itemId));
  } catch (err) {
    console.warn('[SharedMedia] Failed to remove media item:', err);
  }
}

/**
 * Hook to retrieve and subscribe to Shared Media with pagination and category filtering.
 * Replaces old pattern of downloading 1,000 raw chat messages.
 */
export function useSharedMedia(
  coupleId: string | null,
  category: SharedMediaCategory = 'all',
  pageSize: number = 30
) {
  const isDemo = useAuthStore((s) => s.isDemoMode);
  const [items, setItems] = useState<SharedMediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);

  // Live subscription to dedicated couples/{coupleId}/sharedMedia index
  useEffect(() => {
    if (isDemo || !coupleId || coupleId === 'couple-duo-main') {
      // Demo mode aggregation
      const chatMsgs = duoDataStore.getMessages();
      const taskList = duoDataStore.getTasks();

      const list: SharedMediaItem[] = [];

      for (const m of chatMsgs) {
        if (m.attachments) {
          for (const att of m.attachments) {
            const cat = att.type === 'video' ? 'videos' : 'photos';
            list.push({
              id: att.id,
              category: cat,
              name: att.fileName,
              url: att.url,
              thumbnailUrl: att.thumbnailUrl || att.url,
              path: att.path,
              thumbnailPath: att.thumbnailPath,
              createdAt: att.createdAt || m.created_at || new Date().toISOString(),
              timestamp: new Date(att.createdAt || m.created_at || Date.now()).getTime(),
              source: 'chat',
              sourceId: m.id,
              senderId: m.sender_id,
              size: att.size,
              caption: m.content,
            });
          }
        }
        if (m.message_type === 'doodle' && m.media_url) {
          list.push({
            id: `doodle-${m.id}`,
            category: 'doodles',
            name: 'Shared Doodle',
            url: m.media_url,
            thumbnailUrl: m.metadata?.doodlePreview || m.media_url,
            createdAt: m.created_at || new Date().toISOString(),
            timestamp: new Date(m.created_at || Date.now()).getTime(),
            source: 'doodle',
            sourceId: m.id,
            senderId: m.sender_id,
            caption: m.content,
          });
        }
      }

      for (const t of taskList) {
        if (t.attachments) {
          for (const att of t.attachments) {
            const cat = att.type === 'video' ? 'videos' : 'photos';
            list.push({
              id: att.id,
              category: cat,
              name: att.fileName,
              url: att.url,
              thumbnailUrl: att.thumbnailUrl || att.url,
              path: att.path,
              createdAt: att.createdAt || new Date().toISOString(),
              timestamp: new Date(att.createdAt || Date.now()).getTime(),
              source: 'task',
              sourceId: t.id,
              size: att.size,
            });
          }
        }
      }

      list.sort((a, b) => b.timestamp - a.timestamp);
      setItems(list);
      setLoading(false);
      return;
    }

    setLoading(true);

    const mediaRef = collection(db, 'couples', coupleId, 'sharedMedia');
    let q = query(
      mediaRef,
      orderBy('timestamp', 'desc'),
      limit(pageSize)
    );

    const unsubscribe = onSnapshot(
      q,
      async (snap) => {
        const liveItems: SharedMediaItem[] = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        } as SharedMediaItem));

        if (snap.docs.length > 0) {
          setLastDoc(snap.docs[snap.docs.length - 1]);
          setHasMore(snap.docs.length === pageSize);
        } else {
          setHasMore(false);
        }

        // If sharedMedia is empty or transitioning, transparently backfill from recent media messages & doodles
        if (liveItems.length === 0) {
          try {
            // Query ONLY media messages (never 1000 general messages!)
            const msgsQuery = query(
              collection(db, 'couples', coupleId, 'messages'),
              where('messageType', 'in', ['media', 'doodle']),
              limit(30)
            );
            const doodlesQuery = query(
              collection(db, 'couples', coupleId, 'doodles'),
              limit(20)
            );

            const [msgsSnap, doodlesSnap] = await Promise.all([
              getDocs(msgsQuery).catch(() => null),
              getDocs(doodlesQuery).catch(() => null),
            ]);

            const backfillItems: SharedMediaItem[] = [];

            if (msgsSnap) {
              for (const mDoc of msgsSnap.docs) {
                const mData = mDoc.data();
                if (mData.attachments && Array.isArray(mData.attachments)) {
                  for (const att of mData.attachments) {
                    const item: SharedMediaItem = {
                      id: att.id,
                      category: att.type === 'video' ? 'videos' : 'photos',
                      name: att.fileName || 'Photo',
                      url: att.url,
                      thumbnailUrl: att.thumbnailUrl || att.url,
                      path: att.path,
                      thumbnailPath: att.thumbnailPath,
                      createdAt: att.createdAt || new Date().toISOString(),
                      timestamp: typeof mData.createdAt?.toMillis === 'function'
                        ? mData.createdAt.toMillis()
                        : Date.now(),
                      source: 'chat',
                      sourceId: mDoc.id,
                      senderId: mData.senderId,
                      size: att.size,
                      caption: mData.content,
                    };
                    backfillItems.push(item);
                    // Lazily index in background
                    void indexSharedMediaItem(coupleId, item);
                  }
                } else if (mData.messageType === 'doodle' && mData.mediaUrl) {
                  const item: SharedMediaItem = {
                    id: `doodle-${mDoc.id}`,
                    category: 'doodles',
                    name: 'Shared Doodle',
                    url: mData.mediaUrl,
                    thumbnailUrl: mData.metadata?.doodlePreview || mData.mediaUrl,
                    createdAt: new Date().toISOString(),
                    timestamp: typeof mData.createdAt?.toMillis === 'function'
                      ? mData.createdAt.toMillis()
                      : Date.now(),
                    source: 'doodle',
                    sourceId: mDoc.id,
                    senderId: mData.senderId,
                    caption: mData.content,
                  };
                  backfillItems.push(item);
                  void indexSharedMediaItem(coupleId, item);
                }
              }
            }

            if (doodlesSnap) {
              for (const dDoc of doodlesSnap.docs) {
                const dData = dDoc.data();
                const item: SharedMediaItem = {
                  id: dDoc.id,
                  category: 'doodles',
                  name: dData.caption || 'Shared Doodle',
                  url: dData.imageUrl,
                  thumbnailUrl: dData.thumbnailUrl || dData.imageUrl,
                  path: dData.path,
                  createdAt: new Date().toISOString(),
                  timestamp: typeof dData.createdAt?.toMillis === 'function'
                    ? dData.createdAt.toMillis()
                    : Date.now(),
                  source: 'doodle',
                  sourceId: dDoc.id,
                  senderId: dData.createdBy,
                  caption: dData.caption,
                  width: dData.width,
                  height: dData.height,
                };
                backfillItems.push(item);
                void indexSharedMediaItem(coupleId, item);
              }
            }

            backfillItems.sort((a, b) => b.timestamp - a.timestamp);
            setItems(backfillItems);
            setLoading(false);
            return;
          } catch (backfillErr) {
            console.warn('[SharedMedia] Backfill notice:', backfillErr);
          }
        }

        setItems(liveItems);
        setLoading(false);
      },
      (err) => {
        console.warn('[SharedMedia] Subscription error:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [coupleId, isDemo, pageSize]);

  // Load next page
  const loadMore = useCallback(async () => {
    if (!lastDoc || !coupleId || isDemo) return;
    try {
      const mediaRef = collection(db, 'couples', coupleId, 'sharedMedia');
      const nextQuery = query(
        mediaRef,
        orderBy('timestamp', 'desc'),
        startAfter(lastDoc),
        limit(pageSize)
      );
      const snap = await getDocs(nextQuery);
      if (snap.docs.length > 0) {
        const nextItems = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        } as SharedMediaItem));
        setItems((prev) => [...prev, ...nextItems]);
        setLastDoc(snap.docs[snap.docs.length - 1]);
        setHasMore(snap.docs.length === pageSize);
      } else {
        setHasMore(false);
      }
    } catch (err) {
      console.warn('[SharedMedia] loadMore error:', err);
    }
  }, [lastDoc, coupleId, isDemo, pageSize]);

  // Filter items by selected category
  const filteredItems = useMemo(() => {
    if (category === 'all') return items;
    return items.filter((item) => item.category === category);
  }, [items, category]);

  return {
    items: filteredItems,
    allItems: items,
    loading,
    hasMore,
    loadMore,
  };
}
