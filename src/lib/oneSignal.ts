import OneSignal from 'react-onesignal';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { useAuthStore } from './store';

let initPromise: Promise<boolean> | null = null;
let isInitialized = false;

export interface OneSignalConfig {
  appId: string;
}

export function getOneSignalConfig(): OneSignalConfig {
  const envAppId = import.meta.env.VITE_ONESIGNAL_APP_ID || '';
  const localAppId = typeof window !== 'undefined' ? localStorage.getItem('duo_onesignal_app_id') || '' : '';
  const appId = (envAppId || localAppId || 'e0bb43d0-355d-48de-bb9f-0caf33039abb').trim();

  // Actively purge any legacy exposed REST API key from client storage
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem('duo_onesignal_api_key');
    } catch {
      // Ignore storage errors in restricted contexts
    }
  }

  return { appId };
}

export function saveOneSignalConfig(appId: string) {
  if (typeof window !== 'undefined') {
    if (appId) {
      localStorage.setItem('duo_onesignal_app_id', appId.trim());
    } else {
      localStorage.removeItem('duo_onesignal_app_id');
    }

    try {
      localStorage.removeItem('duo_onesignal_api_key');
    } catch {
      // Ignore storage errors
    }
  }
}

/**
 * Initialize OneSignal and bind current user's Firebase UID as external_id
 */
export async function initOneSignal(userId?: string): Promise<boolean> {
  const { appId } = getOneSignalConfig();
  if (!appId) {
    console.log('[OneSignal] No App ID configured yet. Skipping initialization.');
    return false;
  }

  if (typeof window === 'undefined') return false;
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (isLocal) {
    console.info('[OneSignal] Localhost dev environment: push notifications active on production https://av-space-311906.web.app');
    return false;
  }

  if (initPromise) {
    if (userId) {
      void initPromise.then(() => bindOneSignalUser(userId));
    }
    return initPromise;
  }

  initPromise = (async () => {
    try {
      const win = window as any;

      if (!isInitialized) {
        try {
          await OneSignal.init({
            appId,
            allowLocalhostAsSecureOrigin: true,
            notifyButton: { enable: false } as any,
          });
          isInitialized = true;
        } catch {
          // May already be initialized via index.html or script
          isInitialized = true;
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
      } catch {
        // Notification listener notice
      }

      if (userId) {
        await bindOneSignalUser(userId);
      }

      return true;
    } catch (error) {
      console.warn('[OneSignal] Initialization notice:', error);
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

    // If permission is already granted in the browser, ensure OneSignal push subscription is opted in
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      if (win.OneSignal?.User?.PushSubscription?.optIn) {
        await win.OneSignal.User.PushSubscription.optIn();
      } else if (OneSignal.User?.PushSubscription?.optIn) {
        await OneSignal.User.PushSubscription.optIn();
      }
    }
  } catch (e) {
    console.warn('[OneSignal] User push subscription setup notice:', e);
  }
}

/**
 * Check if the current client is opted in and subscribed to OneSignal Web Push
 */
export function isOneSignalSubscribed(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as any;
  return Boolean(
    win.OneSignal?.User?.PushSubscription?.optedIn ||
    (typeof Notification !== 'undefined' && Notification.permission === 'granted')
  );
}

/**
 * Request system push notification permission via OneSignal
 */
export async function requestOneSignalPermission(userId?: string): Promise<boolean> {
  try {
    // 1. Direct native browser prompt if available
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
        if (win.OneSignal?.User?.PushSubscription?.optIn) {
          await win.OneSignal.User.PushSubscription.optIn();
        } else if (OneSignal.User?.PushSubscription?.optIn) {
          await OneSignal.User.PushSubscription.optIn();
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
 * Delegates to the secure sendPushNotification Cloud Function on the backend.
 * Never exposes REST API keys or credentials in client bundles or network requests.
 */
export async function sendOneSignalPush(params: {
  coupleId?: string;
  targetUserId: string;
  title: string;
  body: string;
  type?: string;
  deepLink?: string;
  metadata?: Record<string, any>;
}): Promise<boolean> {
  const { targetUserId, title, body, type, deepLink, metadata } = params;
  const coupleId = params.coupleId || useAuthStore.getState().couple?.id;

  if (!targetUserId) {
    return false;
  }

  if (!coupleId) {
    console.warn('[OneSignal] Cannot dispatch push: coupleId is not available.');
    return false;
  }

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
      },
      { success: boolean; reason?: string; error?: string }
    >(functions, 'sendPushNotification');

    const response = await sendPushFn({
      coupleId,
      targetUserId,
      title,
      body,
      type: type || 'message',
      deepLink: deepLink || '/',
      metadata,
    });

    if (response.data && response.data.success) {
      console.log('[OneSignal] Push successfully sent to partner via secure Cloud Function');
      return true;
    }

    if (response.data?.reason) {
      console.warn('[OneSignal] Push dispatch status:', response.data.reason);
    }
    return false;
  } catch (error: any) {
    console.warn('[OneSignal] Failed to send push via Cloud Function:', error?.message || error);
    return false;
  }
}

