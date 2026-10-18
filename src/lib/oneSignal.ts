import OneSignal from 'react-onesignal';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { useAuthStore } from './store';

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
  const localApiKey = typeof window !== 'undefined' ? (localStorage.getItem('duo_onesignal_api_key') || '').trim() : '';

  // Authoritative production App ID synchronized between client and backend
  const appId = envAppId || 'e0bb43d0-355d-48de-bb9f-0caf33039abb';
  const restApiKey = envApiKey || localApiKey || '';

  return { appId, restApiKey };
}

export function saveOneSignalConfig(_appId?: string, apiKey?: string) {
  if (typeof window !== 'undefined' && apiKey !== undefined) {
    if (apiKey) {
      localStorage.setItem('duo_onesignal_api_key', apiKey.trim());
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
 * Direct client REST dispatch fallback when backend Cloud Functions are undeployed
 * (e.g. Firebase Spark free plan). Delivers push notifications directly to partner.
 */
async function sendDirectOneSignalPush(params: {
  coupleId?: string;
  targetUserId: string;
  title: string;
  body: string;
  type?: string;
  deepLink?: string;
  metadata?: Record<string, any>;
  correlationId: string;
}): Promise<SendPushResult> {
  const { coupleId, targetUserId, title, body, type, deepLink, metadata, correlationId } = params;
  const { appId, restApiKey } = getOneSignalConfig();

  if (!appId || !restApiKey) {
    return {
      success: false,
      requestAccepted: false,
      reason: 'missing_onesignal_credentials',
      correlationId,
    };
  }

  const origin =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : 'https://av-space-311906.web.app';

  const cleanKey = restApiKey.trim();
  const authHeader =
    cleanKey.startsWith('Key ') || cleanKey.startsWith('Basic ')
      ? cleanKey
      : cleanKey.startsWith('os_v2_app_')
      ? `Key ${cleanKey}`
      : `Basic ${cleanKey}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': authHeader,
  };

  const url = deepLink || (type === 'message' ? `${origin}/?action=chat` : origin);
  const payload: Record<string, any> = {
    app_id: appId,
    include_aliases: {
      external_id: [targetUserId],
    },
    target_channel: 'push',
    headings: { en: title },
    contents: { en: body },
    chrome_web_icon: `${origin}/pwa-192x192.png`,
    chrome_web_badge: `${origin}/logo.svg`,
    priority: 10,
    android_priority: 10,
    delayed_option: 'immediate',
    ttl: type === 'call' ? 120 : 86400,
    android_visibility: 1,
    android_accent_color: 'FF4D6D',
    url,
    data: {
      type: type || 'message',
      targetUserId,
      coupleId,
      openReply: true,
      ...(metadata || {}),
    },
    web_buttons: [
      { id: 'reply', text: 'Reply 💬', icon: '', url: `${origin}/?action=chat&openReply=true` },
      { id: 'open', text: 'Open Duo ❤️', icon: '', url: `${origin}/?action=chat` },
    ],
  };

  try {
    let res: Response;
    try {
      res = await fetch('https://api.onesignal.com/notifications', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
    } catch {
      res = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
    }

    if (res.ok) {
      const data = await res.json();
      console.log(`[OneSignal] Direct push accepted (ID: ${data?.id || 'unknown'}, correlation: ${correlationId})`);
      return {
        success: true,
        requestAccepted: true,
        notificationId: data?.id || null,
        recipients: data?.recipients ?? 1,
        reason: 'direct_rest_accepted',
        correlationId,
      };
    }

    // Fallback attempt with legacy include_external_user_ids
    const legacyPayload = {
      ...payload,
      include_aliases: undefined,
      target_channel: undefined,
      include_external_user_ids: [targetUserId],
      channel_for_external_user_ids: 'push',
    };

    let legacyRes: Response;
    try {
      legacyRes = await fetch('https://api.onesignal.com/notifications', {
        method: 'POST',
        headers,
        body: JSON.stringify(legacyPayload),
      });
    } catch {
      legacyRes = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers,
        body: JSON.stringify(legacyPayload),
      });
    }

    if (legacyRes.ok) {
      const data = await legacyRes.json();
      console.log(`[OneSignal] Direct push legacy accepted (ID: ${data?.id || 'unknown'})`);
      return {
        success: true,
        requestAccepted: true,
        notificationId: data?.id || null,
        recipients: data?.recipients ?? 1,
        reason: 'direct_legacy_accepted',
        correlationId,
      };
    }

    const errText = await legacyRes.text();
    console.warn(`[OneSignal] Direct push rejected (${legacyRes.status}):`, errText);
    return {
      success: false,
      requestAccepted: false,
      reason: `http_${legacyRes.status}`,
      correlationId,
    };
  } catch (err: any) {
    console.error(`[OneSignal] Direct push network error:`, err);
    return {
      success: false,
      requestAccepted: false,
      reason: err?.message || 'network_error',
      correlationId,
    };
  }
}

/**
 * Dispatch an OS-level Push Notification directly to partner's device via OneSignal.
 * Delegates to the Cloud Function when deployed, with immediate direct REST API fallback
 * for zero-setup Spark plan compatibility.
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
  // 1. Attempt Cloud Function dispatch
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
    const latency = Date.now() - startTime;

    if (resData?.requestAccepted) {
      console.log(
        `[OneSignal] Push request accepted via Cloud Function (ID: ${resData.notificationId || 'unknown'}, recipients: ${resData.recipients ?? 0}, latency: ${latency}ms)`
      );
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
    console.info(`[OneSignal] Cloud Function unavailable (${latency}ms: ${error?.message || error}), falling back to direct REST API.`);
  }

  // 2. Direct REST API Fallback
  return sendDirectOneSignalPush({
    coupleId,
    targetUserId,
    title,
    body,
    type,
    deepLink,
    metadata,
    correlationId,
  });
}
