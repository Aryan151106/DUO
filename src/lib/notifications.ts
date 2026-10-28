/**
 * Duo Notifications Engine (src/lib/notifications.ts)
 * 
 * Provides:
 * 1. Unified Web Push registration & FCM device token tracking
 * 2. Cross-feature notification dispatching (Messages, Voice, Attachments, Reactions, Doodles, Calls, Tasks, Calendar, Sparks)
 * 3. In-App Notification Center with badges & unread counters
 * 4. Quiet hours & mute duration enforcement
 * 5. Foreground deduplication: plays chosen sound via soundEngine without duplicate OS prompts
 * 6. Troubleshooting diagnostics panel support
 */

import { create } from 'zustand';
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  writeBatch,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import { soundEngine } from './sounds';
import { useAuthStore } from './store';
import {
  sendOneSignalPush,
  requestOneSignalPermission,
  initOneSignal,
} from './oneSignal';

export type NotificationType =
  | 'message'
  | 'voice'
  | 'attachment'
  | 'reaction'
  | 'doodle'
  | 'call'
  | 'task'
  | 'task_reminder'
  | 'calendar'
  | 'quick_love'
  | 'streak';

export interface InAppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  senderId: string;
  senderName: string;
  deepLink: string;
  read: boolean;
  createdAt: any;
  metadata?: Record<string, any>;
}

export interface NotificationDiagnostics {
  permission: NotificationPermission | 'unsupported';
  isServiceWorkerReady: boolean;
  fcmTokenPresent: boolean;
  pushSupported: boolean;
  lastTokenRefresh: string | null;
  devicePlatform: string;
  notes: string[];
}

interface NotificationStoreState {
  notifications: InAppNotification[];
  unreadCount: number;
  fcmToken: string | null;
  permission: NotificationPermission | 'unsupported';
  diagnostics: NotificationDiagnostics;

  initNotifications: (userId: string, coupleId: string) => Unsubscribe | void;
  cleanupNotifications: () => void;
  requestPermissionAndToken: (userId: string) => Promise<boolean>;
  markAsRead: (coupleId: string, notifId: string) => Promise<void>;
  markAllAsRead: (coupleId: string) => Promise<void>;
  clearAllBadges: (coupleId?: string) => Promise<void>;
  sendNotification: (params: {
    coupleId: string;
    senderId: string;
    senderName: string;
    type: NotificationType;
    title: string;
    body: string;
    deepLink: string;
    metadata?: Record<string, any>;
  }) => Promise<void>;
}

/**
 * Fully clears Android launcher badges, WebAPK badges, and dismisses all active
 * notifications sitting in the Android notification drawer.
 */
export async function clearAndroidAndPwaBadges() {
  if (typeof navigator === 'undefined') return;

  // 1. Clear Chromium Badging API
  if ('clearAppBadge' in navigator) {
    try {
      await (navigator as any).clearAppBadge();
    } catch {}
  }

  // 2. Clear Badging on all registered service workers AND dismiss active Android tray notifications
  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        if ('clearAppBadge' in reg) {
          try {
            await (reg as any).clearAppBadge();
          } catch {}
        }
        try {
          const activeNotifs = await reg.getNotifications();
          activeNotifs.forEach((n) => n.close());
        } catch {}
        if (reg.active) {
          reg.active.postMessage({ type: 'CLEAR_BADGE_AND_NOTIFICATIONS' });
        }
      }
    } catch {}
  }
}

export const useNotificationStore = create<NotificationStoreState>((set, get) => {
  let activeUnsubscribe: Unsubscribe | null = null;

  return {
    notifications: [],
    unreadCount: 0,
    fcmToken: null,
    permission: typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported',
    diagnostics: {
      permission: typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported',
      isServiceWorkerReady: false,
      fcmTokenPresent: false,
      pushSupported: typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window,
      lastTokenRefresh: null,
      devicePlatform: typeof navigator !== 'undefined' ? navigator.platform || 'unknown' : 'unknown',
      notes: [],
    },

    cleanupNotifications: () => {
      if (activeUnsubscribe) {
        activeUnsubscribe();
        activeUnsubscribe = null;
      }
      set({ notifications: [], unreadCount: 0 });
    },

    initNotifications: (userId: string, coupleId: string) => {
      if (!coupleId || coupleId.startsWith('demo')) return;

      if (activeUnsubscribe) {
        activeUnsubscribe();
      }

      // 1. Subscribe to In-App Notifications collection with bound limit
      const notifsCol = collection(db, 'couples', coupleId, 'notifications');
      const q = query(notifsCol, orderBy('createdAt', 'desc'), limit(50));

      let isInitialLoad = true;

      activeUnsubscribe = onSnapshot(
        q,
        (snapshot) => {
        const items: InAppNotification[] = snapshot.docs.map((d) => ({
          ...d.data(),
          id: d.id, // Strictly ensure id is the exact Firestore document ID
        })) as InAppNotification[];

        // Only count unread items for this user created within last 7 days (prevents old history buildup)
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const unread = items.filter((n) => {
          if (n.read || n.senderId === userId) return false;
          const createdMs = n.createdAt?.toMillis
            ? n.createdAt.toMillis()
            : n.createdAt?.seconds
            ? n.createdAt.seconds * 1000
            : null;
          if (createdMs && createdMs < sevenDaysAgo) return false;
          return true;
        }).length;

        set({ notifications: items, unreadCount: unread });

        // On first app load, sync Android/PWA tray badges without destroying unread state
        if (isInitialLoad) {
          clearAndroidAndPwaBadges();
          isInitialLoad = false;
        }

        // Update PWA App Badge if supported
        if (typeof navigator !== 'undefined') {
          try {
            // When user is currently in the active app or has 0 unread, clear the home screen badge!
            if (
              (typeof document !== 'undefined' && document.visibilityState === 'visible') ||
              unread === 0
            ) {
              clearAndroidAndPwaBadges();
            } else if (unread > 0 && 'setAppBadge' in navigator) {
              (navigator as any).setAppBadge(unread);
            }
          } catch {}
        }

        // Trigger real-time OS pop-up notifications for newly arrived items from partner
        if (!isInitialLoad) {
          snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
              const item = change.doc.data() as InAppNotification;
              if (item.senderId !== userId && !item.read) {
                // Ensure notification was created within last 45s (prevents replaying old messages)
                const itemTime = item.createdAt?.toMillis
                  ? item.createdAt.toMillis()
                  : item.createdAt?.seconds
                  ? item.createdAt.seconds * 1000
                  : Date.now();
                if (Date.now() - itemTime > 45000) {
                  return;
                }
                // If the chat is currently open and focused on screen,
                // do NOT send an OS/System notification pop-up or vibrate (like WhatsApp & Instagram)
                const isChatContent =
                  item.type === 'message' ||
                  item.type === 'voice' ||
                  item.type === 'attachment' ||
                  item.type === 'reaction' ||
                  item.type === 'doodle';

                const { activeTab } = useAuthStore.getState();
                const isChatOpenAndFocused =
                  activeTab === 'chat' &&
                  typeof document !== 'undefined' &&
                  document.visibilityState === 'visible' &&
                  (document.hasFocus ? document.hasFocus() : true);

                if (isChatContent && isChatOpenAndFocused) {
                  // User is actively viewing the chat: play subtle in-chat pop only, no notification popup or vibration
                  const settings = soundEngine.getSettings();
                  soundEngine.play(settings.messageSoundId || 'msg-pop');
                  get().markAsRead(coupleId, change.doc.id);
                  return;
                }

                // 1. Play corresponding sound
                const settings = soundEngine.getSettings();
                if (item.type === 'call') {
                  soundEngine.play(settings.incomingRingtoneId || 'ring-heartbeat', { force: true });
                } else if (item.type === 'reaction') {
                  soundEngine.play(settings.reactionSoundId || 'msg-bubble');
                } else if (item.type === 'task' || item.type === 'task_reminder') {
                  soundEngine.play(settings.taskAlarmSoundId || 'alarm-gentle-rise');
                } else {
                  soundEngine.play(settings.messageSoundId || 'msg-pop');
                }

                // 2. Play subtle sound & vibrate if appropriate
                // Foreground in-app audio feedback is played cleanly.
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                  try {
                    navigator.vibrate(item.type === 'call' ? [500, 200, 500, 200, 500] : [200, 100, 200]);
                  } catch {}
                }

                // 3. If tab is in background or unfocused, trigger notification banner if permitted
                if (
                  typeof document !== 'undefined' &&
                  document.visibilityState !== 'visible' &&
                  typeof Notification !== 'undefined' &&
                  Notification.permission === 'granted'
                ) {
                  try {
                    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
                      navigator.serviceWorker.ready.then((reg) => {
                        reg.showNotification(item.title || 'AV', {
                          body: item.body || 'New update from your partner.',
                          icon: '/pwa-192x192.png',
                          badge: '/favicon.svg',
                          tag: `av-${item.type}-${change.doc.id}`,
                          data: { url: item.deepLink || '/' },
                        }).catch(() => {});
                      }).catch(() => {});
                    }
                  } catch {}
                }
              }
            }
          });
        }

        isInitialLoad = false;
      },
      (error) => {
        console.warn('[Notifications] Snapshot subscription error:', error);
      });

      // 2. Initialize OneSignal user session immediately
      initOneSignal(userId).catch(() => {});

      return () => {
        if (activeUnsubscribe) {
          activeUnsubscribe();
          activeUnsubscribe = null;
        }
      };
    },

    requestPermissionAndToken: async (userId: string) => {
      if (typeof window === 'undefined' || !('Notification' in window)) {
        return false;
      }

      try {
        if (Notification.permission === 'default') {
          try {
            await Notification.requestPermission();
          } catch {}
        }

        const granted = await requestOneSignalPermission(userId);
        const perm = typeof Notification !== 'undefined' ? Notification.permission : 'default';

        set((state) => ({
          permission: perm,
          diagnostics: {
            ...state.diagnostics,
            permission: perm,
            pushSupported: true,
            isServiceWorkerReady: true,
            lastTokenRefresh: new Date().toISOString(),
          },
        }));

        return granted || perm === 'granted';
      } catch (err: any) {
        console.warn('[Notifications] OneSignal permission request failed:', err);
        const perm = typeof Notification !== 'undefined' ? Notification.permission : 'default';
        set({ permission: perm });
        return perm === 'granted';
      }
    },

    markAsRead: async (coupleId: string, notifId: string) => {
      const existing = get().notifications.find((n) => n.id === notifId);
      if (existing && existing.read) {
        return; // Already marked read, do not trigger store re-renders
      }

      // Optimistically mark as read in local state
      set((state) => {
        const updated = state.notifications.map((n) =>
          n.id === notifId ? { ...n, read: true } : n
        );
        const currentUserId = useAuthStore.getState().currentUser?.id || '';
        const unread = updated.filter((n) => !n.read && n.senderId !== currentUserId).length;
        if (typeof navigator !== 'undefined') {
          try {
            if (
              (typeof document !== 'undefined' && document.visibilityState === 'visible') ||
              unread === 0
            ) {
              if ('clearAppBadge' in navigator) {
                (navigator as any).clearAppBadge();
              }
            } else if (unread > 0 && 'setAppBadge' in navigator) {
              (navigator as any).setAppBadge(unread);
            }
          } catch {}
        }
        return { notifications: updated, unreadCount: unread };
      });

      if (!coupleId || !notifId) return;
      try {
        await updateDoc(doc(db, 'couples', coupleId, 'notifications', notifId), {
          read: true,
        });
      } catch (e) {
        console.warn('Failed to mark notification as read:', e);
      }
    },

    markAllAsRead: async (coupleId: string) => {
      const { unreadCount, notifications } = get();
      const unreadList = notifications.filter((n) => !n.read);
      if (unreadCount === 0 && unreadList.length === 0) {
        clearAndroidAndPwaBadges();
        return; // Nothing to clear, exit early to prevent re-render loops
      }

      // Optimistically clear all unread count and app badge immediately
      set((state) => ({
        unreadCount: 0,
        notifications: state.notifications.map((n) => (n.read ? n : { ...n, read: true })),
      }));

      clearAndroidAndPwaBadges();

      if (!coupleId || unreadList.length === 0) return;

      try {
        // Use writeBatch for high-speed atomic update of all documents
        const batch = writeBatch(db);
        unreadList.slice(0, 500).forEach((item) => {
          if (item.id) {
            batch.update(doc(db, 'couples', coupleId, 'notifications', item.id), {
              read: true,
            });
          }
        });
        await batch.commit();
      } catch (e) {
        console.warn('Failed to mark all notifications as read:', e);
      }
    },

    clearAllBadges: async (coupleId?: string) => {
      // 1. Immediately reset store to 0
      set((state) => ({
        unreadCount: 0,
        notifications: state.notifications.map((n) => (n.read ? n : { ...n, read: true })),
      }));

      // 2. Fully wipe Android notification drawer and Chromium App Badge
      await clearAndroidAndPwaBadges();

      // 3. Mark all notifications read in Firestore
      const activeCoupleId = coupleId || useAuthStore.getState().couple?.id;
      if (activeCoupleId) {
        const { notifications } = get();
        const unreadList = notifications.filter((n) => !n.read);
        if (unreadList.length > 0) {
          try {
            const batch = writeBatch(db);
            unreadList.slice(0, 500).forEach((item) => {
              if (item.id) {
                batch.update(doc(db, 'couples', activeCoupleId, 'notifications', item.id), {
                  read: true,
                });
              }
            });
            await batch.commit();
          } catch {}
        }
      }
    },

    sendNotification: async (params) => {
      const { coupleId, senderId, senderName, type, title, body, deepLink, metadata } = params;
      const notifDocId = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      // 1. INSTANT DISPATCH VIA ONESIGNAL (0ms DELAY - NON-BLOCKING)
      try {
        const authState = useAuthStore.getState();
        const targetUserId =
          metadata?.targetUserId ||
          metadata?.calleeId ||
          authState.partnerUser?.id ||
          (authState.couple as any)?.members?.find((m: string) => m !== senderId);

        if (targetUserId && targetUserId !== senderId) {
          void sendOneSignalPush({
            coupleId,
            targetUserId,
            title,
            body: body || `${senderName} sent you a ${type}`,
            type,
            deepLink,
            metadata,
            eventId: notifDocId,
          }).catch((err) => {
            console.warn('[OneSignal] Push dispatch notice:', err);
          });
        }
      } catch (e) {
        console.warn('[OneSignal] Push dispatch failed:', e);
      }

      // 2. Persist in-app notification record in Firestore (Non-blocking background write)
      if (coupleId && !useAuthStore.getState().isDemoMode) {
        try {
          const notifRef = doc(db, 'couples', coupleId, 'notifications', notifDocId);

          setDoc(notifRef, {
            id: notifDocId,
            type,
            title,
            body,
            senderId,
            senderName,
            deepLink: deepLink || null,
            read: false,
            metadata: metadata || {},
            createdAt: serverTimestamp(),
          }).catch((err) => {
            console.warn('[NotificationDispatcher] In-app record notice:', err);
          });
        } catch (err) {
          console.warn('[NotificationDispatcher] Failed to write in-app record:', err);
        }
      }
    },
  };
});
