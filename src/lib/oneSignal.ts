import OneSignal from 'react-onesignal';
import { auth } from './firebase';
import { useAuthStore } from './store';
import { getSocketServerUrl } from './socketConfig';

let initPromise: Promise<boolean> | null = null;
let isInitialized = false;
let initError: string | null = null;

export interface OneSignalConfig {
  appId: string;
}

export interface SendPushResult {
  provider: 'onesignal';
  requestAccepted: boolean;
  notificationId?: string | null;
  recipients: number;
  reason: string;
  correlationId: string;
}

export interface SubscriptionDiagnosticState {
  isSupported: boolean;
  permission: NotificationPermission | 'unsupported';
  isInitialized: boolean;
  initError: string | null;
  isOptedIn: boolean;
  subscriptionId: string | null;
  externalId: string | null;
  isLinkedToUser: boolean;
  isIos: boolean;
  isStandalone: boolean;
  isServiceWorkerReady: boolean;
}

/**
 * Returns the configured OneSignal App ID.
 * REST credentials NEVER touch the client; they are kept strictly on the Node.js server.
 */
export function getOneSignalConfig(): OneSignalConfig {
  const envAppId = (import.meta.env.VITE_ONESIGNAL_APP_ID || '').trim();
  const appId = envAppId || 'e0bb43d0-355d-48de-bb9f-0caf33039abb';
  return { appId };
}

/**
 * Platform detection for iOS and standalone PWA mode.
 */
export function getPlatformState(): { isIos: boolean; isStandalone: boolean } {
  if (typeof window === 'undefined') return { isIos: false, isStandalone: false };

  const ua = window.navigator.userAgent.toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true;

  return { isIos, isStandalone };
}

/**
 * Single authoritative initialization promise for OneSignal Web SDK v16.
 * Attaches to unified root service worker at /sw.js with scope /.
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
    return initPromise.then(async (ok) => {
      if (ok && userId) {
        await bindOneSignalUser(userId);
      }
      return ok;
    });
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
        initError = null;
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        if (errMsg.toLowerCase().includes('already initialized') || win.OneSignal?.initialized) {
          console.info('[OneSignal] OneSignal SDK already initialized.');
          isInitialized = true;
          initError = null;
        } else {
          console.warn('[OneSignal] OneSignal.init() notice:', err);
          isInitialized = false;
          initError = errMsg;
          initPromise = null;
          return false;
        }
      }

      // Deep link navigation on notification click
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
        console.warn('[OneSignal] Click listener notice:', e);
      }

      if (userId) {
        await bindOneSignalUser(userId);
      }

      return true;
    } catch (error: any) {
      console.error('[OneSignal] Initialization error:', error);
      isInitialized = false;
      initError = error?.message || String(error);
      initPromise = null;
      return false;
    }
  })();

  return initPromise;
}

/**
 * Links current browser's OneSignal push subscription to the signed-in Firebase UID.
 */
export async function bindOneSignalUser(userId: string): Promise<boolean> {
  try {
    if (!userId) return false;
    const win = typeof window !== 'undefined' ? (window as any) : null;
    const sdk = win?.OneSignal || OneSignal;

    if (sdk.login) {
      await sdk.login(userId);
    }
    console.info('[OneSignal] Subscription linked to UID:', userId);

    // If permission is already granted, verify push subscription opt-in
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const sub = sdk.User?.PushSubscription;
      if (sub && !sub.optedIn && sub.optIn) {
        await sub.optIn();
      }
    }
    return true;
  } catch (e) {
    console.warn('[OneSignal] User linking notice:', e);
    return false;
  }
}

/**
 * Clears the external_id link on logout to prevent misdirected push notifications.
 */
export async function logoutOneSignal(): Promise<void> {
  try {
    const win = typeof window !== 'undefined' ? (window as any) : null;
    const sdk = win?.OneSignal || OneSignal;
    if (sdk?.logout) {
      await sdk.logout();
      console.info('[OneSignal] Logged out external_id');
    }
  } catch (e) {
    console.warn('[OneSignal] Logout notice:', e);
  }
}

/**
 * Returns full diagnostic state of the local OneSignal subscription.
 */
export function getOneSignalSubscriptionState(currentUserId?: string): SubscriptionDiagnosticState {
  const { isIos, isStandalone } = getPlatformState();

  if (typeof window === 'undefined') {
    return {
      isSupported: false,
      permission: 'unsupported',
      isInitialized: false,
      initError: null,
      isOptedIn: false,
      subscriptionId: null,
      externalId: null,
      isLinkedToUser: false,
      isIos,
      isStandalone,
      isServiceWorkerReady: false,
    };
  }

  const win = window as any;
  const sdk = win.OneSignal || OneSignal;
  const sub = sdk.User?.PushSubscription;
  const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  const extId = sdk.User?.externalId || null;

  const isSupported =
    typeof Notification !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    (!isIos || isStandalone);

  const isServiceWorkerReady =
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    Boolean(navigator.serviceWorker.controller || (win as any).__swRegistered);

  return {
    isSupported,
    permission: perm,
    isServiceWorkerReady,
    isInitialized,
    initError,
    isOptedIn: Boolean(sub?.optedIn),
    subscriptionId: sub?.id || null,
    externalId: extId,
    isLinkedToUser: Boolean(currentUserId && extId && extId === currentUserId),
    isIos,
    isStandalone,
  };
}

/**
 * Explicit user-action flow to request permission, opt-in to Web Push, and link account.
 */
export async function subscribeDevice(userId?: string): Promise<{
  success: boolean;
  permission: NotificationPermission | 'unsupported';
  isOptedIn: boolean;
  subscriptionId: string | null;
  externalId: string | null;
  reason: string;
}> {
  if (typeof window === 'undefined') {
    return {
      success: false,
      permission: 'unsupported',
      isOptedIn: false,
      subscriptionId: null,
      externalId: null,
      reason: 'window_undefined',
    };
  }

  const { isIos, isStandalone } = getPlatformState();
  if (isIos && !isStandalone) {
    return {
      success: false,
      permission: 'unsupported',
      isOptedIn: false,
      subscriptionId: null,
      externalId: null,
      reason: 'ios_pwa_required',
    };
  }

  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    return {
      success: false,
      permission: 'unsupported',
      isOptedIn: false,
      subscriptionId: null,
      externalId: null,
      reason: 'unsupported_browser',
    };
  }

  // Ensure OneSignal SDK is initialized
  await initOneSignal(userId);

  const win = window as any;
  const sdk = win.OneSignal || OneSignal;

  try {
    // 1. If permission is default, invoke OneSignal's permission request
    if (Notification.permission === 'default') {
      if (sdk.Notifications?.requestPermission) {
        await sdk.Notifications.requestPermission();
      } else {
        await Notification.requestPermission();
      }
    }

    const currentPerm = Notification.permission;
    if (currentPerm !== 'granted') {
      return {
        success: false,
        permission: currentPerm,
        isOptedIn: false,
        subscriptionId: null,
        externalId: null,
        reason: 'permission_denied',
      };
    }

    // 2. Explicitly opt in to Push Subscription
    const sub = sdk.User?.PushSubscription;
    if (sub?.optIn && !sub.optedIn) {
      await sub.optIn();
    }

    // 3. Link UID as OneSignal external_id
    if (userId && sdk.login) {
      await sdk.login(userId);
    }

    // 4. Wait briefly for OneSignal to issue subscription ID
    let subId = sdk.User?.PushSubscription?.id || null;
    if (!subId) {
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 350));
        subId = sdk.User?.PushSubscription?.id || null;
        if (subId) break;
      }
    }

    const optedIn = Boolean(sdk.User?.PushSubscription?.optedIn);
    const extId = sdk.User?.externalId || null;

    return {
      success: Boolean(subId),
      permission: currentPerm,
      isOptedIn: optedIn,
      subscriptionId: subId,
      externalId: extId,
      reason: subId ? 'subscribed' : 'subscription_id_pending',
    };
  } catch (err: any) {
    console.warn('[OneSignal] Subscription registration notice:', err);
    return {
      success: false,
      permission: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
      isOptedIn: false,
      subscriptionId: null,
      externalId: null,
      reason: err?.message || 'subscription_error',
    };
  }
}

/**
 * Backward compatibility alias for subscribeDevice
 */
export async function requestOneSignalPermission(userId?: string): Promise<boolean> {
  const result = await subscribeDevice(userId);
  return result.success || result.permission === 'granted';
}

/**
 * Dispatches an OS Push Notification strictly through our authenticated Node.js backend.
 * Never claims delivery unless OneSignal confirmed accepting it.
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
      provider: 'onesignal',
      success: false,
      requestAccepted: false,
      recipients: 0,
      reason: 'missing_target_user_id',
      correlationId,
    } as any;
  }

  if (!coupleId) {
    return {
      provider: 'onesignal',
      success: false,
      requestAccepted: false,
      recipients: 0,
      reason: 'missing_couple_id',
      correlationId,
    } as any;
  }

  const socketUrl = getSocketServerUrl();
  if (!socketUrl) {
    return {
      provider: 'onesignal',
      success: false,
      requestAccepted: false,
      recipients: 0,
      reason: 'push_server_unavailable',
      correlationId,
    } as any;
  }

  if (!auth.currentUser) {
    return {
      provider: 'onesignal',
      success: false,
      requestAccepted: false,
      recipients: 0,
      reason: 'user_not_authenticated',
      correlationId,
    } as any;
  }

  try {
    const idToken = await auth.currentUser.getIdToken();
    const controller = new AbortController();
    // 25s timeout to allow Render free tier to wake up from cold start spin-down
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    const res = await fetch(`${socketUrl}/api/push/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        'X-Correlation-ID': correlationId,
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
        correlationId,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      const recipients = typeof data.recipients === 'number' ? data.recipients : 0;
      return {
        provider: 'onesignal',
        success: data.requestAccepted === true,
        requestAccepted: Boolean(data.requestAccepted),
        notificationId: data.notificationId || null,
        recipients,
        reason: data.reason || (recipients > 0 ? 'accepted' : 'zero_recipients'),
        correlationId,
      } as any;
    } else {
      return {
        provider: 'onesignal',
        success: false,
        requestAccepted: false,
        recipients: 0,
        reason: data.error || data.reason || `http_${res.status}`,
        correlationId,
      } as any;
    }
  } catch (err: any) {
    const isTimeout = err?.name === 'AbortError';
    return {
      provider: 'onesignal',
      success: false,
      requestAccepted: false,
      recipients: 0,
      reason: isTimeout ? 'server_timeout_possible_cold_start' : (err?.message || 'push_request_failed'),
      correlationId,
    } as any;
  }
}
