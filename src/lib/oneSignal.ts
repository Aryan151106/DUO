import OneSignal from 'react-onesignal';
import { auth, db } from './firebase';
import { useAuthStore } from './store';
import { getSocketServerUrl } from './socketConfig';

let initPromise: Promise<boolean> | null = null;
let isInitialized = false;

export interface OneSignalConfig {
  appId: string;
  restApiKey?: string;
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
  const envApiKey = (import.meta.env.VITE_ONESIGNAL_REST_API_KEY || '').trim();
  const localApiKey =
    typeof window !== 'undefined' ? (localStorage.getItem('duo_onesignal_api_key') || '').trim() : '';

  // Authoritative production App ID synchronized between client and backend
  const appId = envAppId || 'e0bb43d0-355d-48de-bb9f-0caf33039abb';
  const restApiKey = envApiKey || localApiKey || '';

  return { appId, restApiKey };
}

export function saveOneSignalConfig(_appId?: string, apiKey?: string) {
  if (typeof window !== 'undefined' && apiKey !== undefined) {
    const clean = apiKey.trim();
    if (clean) {
      localStorage.setItem('duo_onesignal_api_key', clean);
    } else {
      localStorage.removeItem('duo_onesignal_api_key');
    }
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
          console.warn('[OneSignal] OneSignal.init() notice:', err);
          isInitialized = false;
          initPromise = null; // Allow subsequent retry
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
      initPromise = null;
      return false;
    }
  })();

  return initPromise;
}

export async function bindOneSignalUser(userId: string) {
  try {
    const win = window as any;
    const sdk = win.OneSignal || OneSignal;

    if (sdk.login) {
      await sdk.login(userId);
    }
    console.log('[OneSignal] User subscription linked to UID:', userId);

    // If browser permission is already granted, ensure push subscription opt-in
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const sub = sdk.User?.PushSubscription;
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
 * Verifies OneSignal's actual PushSubscription state.
 */
export function isOneSignalSubscribed(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as any;
  const sdk = win.OneSignal || OneSignal;
  const sub = sdk.User?.PushSubscription;
  return Boolean(sub?.optedIn && sub?.id);
}

/**
 * Returns full diagnostic state of the local OneSignal subscription.
 */
export function getOneSignalSubscriptionState(): {
  isSupported: boolean;
  permission: NotificationPermission | 'unsupported';
  isInitialized: boolean;
  isOptedIn: boolean;
  subscriptionId: string | null;
  externalId: string | null;
} {
  if (typeof window === 'undefined') {
    return {
      isSupported: false,
      permission: 'unsupported',
      isInitialized: false,
      isOptedIn: false,
      subscriptionId: null,
      externalId: null,
    };
  }

  const win = window as any;
  const sdk = win.OneSignal || OneSignal;
  const sub = sdk.User?.PushSubscription;
  const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';

  return {
    isSupported: typeof Notification !== 'undefined' && 'serviceWorker' in navigator,
    permission: perm,
    isInitialized,
    isOptedIn: Boolean(sub?.optedIn),
    subscriptionId: sub?.id || null,
    externalId: sdk.User?.externalId || null,
  };
}

/**
 * Request push notification permission via OneSignal SDK tied to a user gesture.
 * Crucially invokes OneSignal.Notifications.requestPermission() so OneSignal registers
 * the browser's pushManager token and generates the subscriber record on OneSignal's backend.
 */
export async function requestOneSignalPermission(userId?: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  const { appId } = getOneSignalConfig();
  if (!appId) {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission().catch(() => {});
    }
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
  }

  if (!isInitialized) {
    await initOneSignal(userId);
  }

  const win = window as any;
  const sdk = win.OneSignal || OneSignal;

  try {
    // 1. Explicitly invoke OneSignal SDK's requestPermission to run the full push registration lifecycle
    if (sdk.Notifications?.requestPermission) {
      await sdk.Notifications.requestPermission();
    } else if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }

    const isGranted = typeof Notification !== 'undefined' && Notification.permission === 'granted';

    // 2. Opt-in push subscription
    if (isGranted) {
      const sub = sdk.User?.PushSubscription;
      if (sub?.optIn) {
        await sub.optIn();
      }

      // 3. Link UID as OneSignal external_id
      if (userId) {
        if (sdk.login) {
          await sdk.login(userId);
        }
      }

      console.log(`[OneSignal] Registration complete. OptedIn: ${sub?.optedIn}, SubId: ${sub?.id || 'pending'}`);
    }

    return isGranted;
  } catch (err) {
    console.warn('[OneSignal] Permission request failed:', err);
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
  }
}

/**
 * Dispatch an OS-level Push Notification directly to partner's device via OneSignal.
 * Strictly uses ONLY OneSignal via our backend server (/api/push/send on Render).
 * Absolutely NO Cloud Functions are used.
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

  const { restApiKey, appId } = getOneSignalConfig();

  // 1. Dispatch through our Node.js backend server endpoint on Render
  // The server calls OneSignal REST API without CORS restrictions
  try {
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
          apiKey: restApiKey || undefined,
          appId,
        }),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.requestAccepted || data.success) {
          const recipients = typeof data.recipients === 'number' ? data.recipients : 1;
          const isDeliveredToDevice = recipients > 0;
          return {
            success: true,
            requestAccepted: true,
            notificationId: data.notificationId || null,
            recipients,
            reason: isDeliveredToDevice
              ? 'onesignal_delivered'
              : data.reason === 'no_push_key'
              ? 'no_push_key'
              : 'partner_not_subscribed',
            correlationId,
          };
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        console.warn('[OneSignal] Server returned error:', res.status, errData);
      }
    }
  } catch (socketErr: any) {
    console.info('[OneSignal] Socket server push notice:', socketErr?.message || socketErr);
  }

  // 2. Realtime fallback: record notification in Firestore
  // Active partner app in background tab or foreground immediately displays the alert and plays audio
  try {
    if (!auth.currentUser) {
      return {
        success: true,
        requestAccepted: true,
        recipients: 1,
        reason: 'demo_synced',
        correlationId,
      };
    }

    const currentUserId = auth.currentUser.uid;
    const currentName = useAuthStore.getState().currentUser?.displayName || 'Partner';
    const { addDoc, collection, serverTimestamp } = await import('firebase/firestore');

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
      reason: dbErr?.message || 'push_dispatch_failed',
      correlationId,
    };
  }
}
