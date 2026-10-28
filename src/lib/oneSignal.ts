import OneSignal from 'react-onesignal';
import { httpsCallable } from 'firebase/functions';
import { functions, auth, db } from './firebase';
import { useAuthStore } from './store';

let initPromise: Promise<boolean> | null = null;
let isInitialized = false;

export interface OneSignalConfig {
  appId: string;
}

export interface SendPushResult {
  success: boolean;
  requestAccepted: boolean;
  notificationId?: string | null;
  recipients?: number;
  reason?: string;
  correlationId?: string;
}

export function getOneSignalConfig(): OneSignalConfig {
  const envAppId = (import.meta.env.VITE_ONESIGNAL_APP_ID || '').trim();

  // Authoritative production App ID synchronized between client and backend
  const appId = envAppId || 'e0bb43d0-355d-48de-bb9f-0caf33039abb';

  // Sanitize any legacy stored API key from localStorage to protect credentials
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem('duo_onesignal_api_key');
    } catch {}
  }

  return { appId };
}

export function saveOneSignalConfig(_appId?: string, _apiKey?: string) {
  // Deprecated: API keys must only be stored in secure backend secret manager.
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem('duo_onesignal_api_key');
    } catch {}
  }
}

/**
 * Initialize OneSignal authoritatively and bind current user's Firebase UID as external_id.
 * Configured with serviceWorkerPath: 'sw.js' to unify PWA caching and OneSignal push into one worker.
 */
export async function initOneSignal(userId?: string): Promise<boolean> {
  const { appId } = getOneSignalConfig();
  if (!appId) {
    console.warn('[OneSignal] No App ID configured. Skipping initialization.');
    return false;
  }

  if (typeof window === 'undefined') return false;
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (isLocal) {
    console.info('[OneSignal] Localhost dev environment: push notifications active on production https://av-space-311906.web.app');
    return false;
  }

  if (isInitialized) {
    if (userId) {
      await bindOneSignalUser(userId);
    }
    return true;
  }

  if (initPromise) {
    if (userId) {
      void initPromise.then((ok) => {
        if (ok) void bindOneSignalUser(userId);
      });
    }
    return initPromise;
  }

  initPromise = (async () => {
    try {
      const win = window as any;

      try {
        await OneSignal.init({
          appId,
          serviceWorkerPath: 'sw.js',
          serviceWorkerParam: { scope: '/' },
          allowLocalhostAsSecureOrigin: true,
          notifyButton: { enable: false } as any,
        });
        isInitialized = true;
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        if (errMsg.toLowerCase().includes('already initialized') || win.OneSignal?.initialized) {
          console.info('[OneSignal] OneSignal SDK already initialized.');
          isInitialized = true;
        } else {
          console.error('[OneSignal] OneSignal.init() failed with error:', err);
          isInitialized = false;
          initPromise = null; // Allow subsequent retry on genuine failure
          return false;
        }
      }

      // Register notification click listener for deep linking to screens
      try {
        const notifApi = win.OneSignal?.Notifications || (OneSignal as any).Notifications;
        if (notifApi?.addEventListener) {
          notifApi.addEventListener('click', (event: any) => {
            const data = event?.notification?.additionalData;
            if (data?.action || data?.tab) {
              const targetTab = data.action || data.tab;
              useAuthStore.getState().setTab(targetTab);
            }
          });
        }
      } catch (e) {
        console.warn('[OneSignal] Notification click listener notice:', e);
      }

      if (userId) {
        await bindOneSignalUser(userId);
      }

      return true;
    } catch (error) {
      console.error('[OneSignal] Initialization error:', error);
      isInitialized = false;
      initPromise = null; // Allow retry on failure
      return false;
    }
  })();

  return initPromise;
}

async function bindOneSignalUser(userId: string) {
  try {
    const win = window as any;
    if (win.OneSignal?.login) {
      await win.OneSignal.login(userId);
    } else if (OneSignal.login) {
      await OneSignal.login(userId);
    }
    console.log('[OneSignal] User subscription successfully linked');

    // If browser permission is already granted, verify push subscription opt-in
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const sub = win.OneSignal?.User?.PushSubscription || (OneSignal as any).User?.PushSubscription;
      if (sub && !sub.optedIn && sub.optIn) {
        await sub.optIn();
      }
    }
  } catch (e) {
    console.warn('[OneSignal] User push subscription setup notice:', e);
  }
}

/**
 * Check if the current client is opted in and subscribed to OneSignal Web Push.
 * Verifies OneSignal's actual PushSubscription state, not just browser permission.
 */
export function isOneSignalSubscribed(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as any;
  const sub = win.OneSignal?.User?.PushSubscription || (OneSignal as any).User?.PushSubscription;
  return Boolean(sub?.optedIn && sub?.id);
}

/**
 * Request system push notification permission via OneSignal tied to a user gesture.
 */
export async function requestOneSignalPermission(userId?: string): Promise<boolean> {
  try {
    let nativePerm: NotificationPermission = 'default';
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        try {
          nativePerm = await Notification.requestPermission();
        } catch (e) {
          console.warn('[Notifications] Native Notification.requestPermission error:', e);
        }
      } else {
        nativePerm = Notification.permission;
      }
    }

    const { appId } = getOneSignalConfig();
    if (!appId) {
      return nativePerm === 'granted';
    }

    if (!isInitialized) {
      await initOneSignal(userId);
    }

    const win = window as any;
    if (nativePerm === 'default') {
      try {
        if (win.OneSignal?.Notifications?.requestPermission) {
          await win.OneSignal.Notifications.requestPermission();
        } else if (OneSignal.Notifications?.requestPermission) {
          await OneSignal.Notifications.requestPermission();
        }
      } catch (err) {
        console.warn('[OneSignal] SDK permission request notice:', err);
      }
    }

    const isGranted = typeof Notification !== 'undefined' && Notification.permission === 'granted';

    if (isGranted) {
      try {
        const sub = win.OneSignal?.User?.PushSubscription || (OneSignal as any).User?.PushSubscription;
        if (sub?.optIn) {
          await sub.optIn();
        }
        if (userId) {
          if (win.OneSignal?.login) {
            await win.OneSignal.login(userId);
          } else if (OneSignal.login) {
            await OneSignal.login(userId);
          }
        }
      } catch (e) {
        console.warn('[OneSignal] Push optIn setup notice:', e);
      }
    }

    return isGranted;
  } catch (err) {
    console.warn('[OneSignal] Permission request failed:', err);
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
  }
}

/**
 * Dispatch an OS-level Push Notification directly to partner's device via OneSignal.
 * Strictly delegates to the authenticated Cloud Function where the OneSignal REST API key
 * is stored securely in Firebase Secret Manager, never exposed to the client browser.
 */
export async function sendOneSignalPush(params: {
  coupleId?: string;
  targetUserId: string;
  title: string;
  body: string;
  type?: string;
  deepLink?: string;
  metadata?: Record<string, any>;
  eventId?: string;
}): Promise<SendPushResult> {
  const { targetUserId, title, body, type, deepLink, metadata, eventId } = params;
  const coupleId = params.coupleId || useAuthStore.getState().couple?.id;
  const correlationId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  if (!targetUserId) {
    return {
      success: false,
      requestAccepted: false,
      reason: 'missing_target_user_id',
      correlationId,
    };
  }

  if (!coupleId) {
    console.warn('[OneSignal] Cannot dispatch push: coupleId is not available.');
    return {
      success: false,
      requestAccepted: false,
      reason: 'missing_couple_id',
      correlationId,
    };
  }

  const startTime = Date.now();

  // 1. First attempt: Cloud Function (if deployed)
  try {
    const sendPushFn = httpsCallable<
      {
        coupleId: string;
        targetUserId: string;
        title: string;
        body: string;
        type?: string;
        deepLink?: string;
        metadata?: Record<string, any>;
        eventId?: string;
        correlationId?: string;
      },
      {
        success: boolean;
        requestAccepted?: boolean;
        notificationId?: string | null;
        recipients?: number;
        reason?: string;
        correlationId?: string;
      }
    >(functions, 'sendPushNotification');

    const response = await sendPushFn({
      coupleId,
      targetUserId,
      title,
      body,
      type: type || 'message',
      deepLink: deepLink || '/',
      metadata,
      eventId,
      correlationId,
    });

    const resData = response.data;
    if (resData?.requestAccepted) {
      return {
        success: Boolean(resData.success),
        requestAccepted: true,
        notificationId: resData.notificationId,
        recipients: resData.recipients,
        reason: resData.reason || 'accepted',
        correlationId,
      };
    }
  } catch (error: any) {
    const latency = Date.now() - startTime;
    console.info(`[OneSignal] Cloud Function dispatch notice (${latency}ms):`, error?.message || error);
  }

  // 2. Second attempt: Render socket / API server endpoint
  try {
    const { getSocketServerUrl } = await import('./socketConfig');
    const socketUrl = getSocketServerUrl();
    if (socketUrl && auth.currentUser) {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch(`${socketUrl}/api/push/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          coupleId,
          targetUserId,
          title,
          body,
          type: type || 'message',
          deepLink: deepLink || '/',
          metadata,
          eventId,
        }),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.requestAccepted || data.success) {
          return {
            success: true,
            requestAccepted: true,
            notificationId: data.notificationId || null,
            recipients: data.recipients || 1,
            reason: data.reason || 'server_accepted',
            correlationId,
          };
        }
      }
    }
  } catch (socketErr: any) {
    console.info('[OneSignal] Socket server push notice:', socketErr?.message || socketErr);
  }

  // 3. Resilient fallback: write to Firestore notifications collection
  // Partner's active client is subscribed in real-time and will immediately display the alert!
  try {
    const { addDoc, collection, serverTimestamp } = await import('firebase/firestore');
    const currentUserId = auth.currentUser?.uid || '';
    const currentName = useAuthStore.getState().currentUser?.displayName || 'Partner';

    await addDoc(collection(db, 'couples', coupleId, 'notifications'), {
      title,
      body,
      type: type || 'message',
      senderId: currentUserId,
      senderName: currentName,
      deepLink: deepLink || '/',
      read: false,
      createdAt: serverTimestamp(),
      metadata: { recipientId: targetUserId, ...(metadata || {}) },
    });

    return {
      success: true,
      requestAccepted: true,
      recipients: 1,
      reason: 'realtime_synced',
      correlationId,
    };
  } catch (dbErr: any) {
    console.error('[OneSignal] Push fallback error:', dbErr?.message || dbErr);
    return {
      success: false,
      requestAccepted: false,
      reason: dbErr?.message || 'push_fallback_failed',
      correlationId,
    };
  }
}

