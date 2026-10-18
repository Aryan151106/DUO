// Top-level message handler registered safely
const handleWorkerMessage = (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_BADGE_AND_NOTIFICATIONS') {
    event.waitUntil(
      (async () => {
        if ('clearAppBadge' in self.registration) {
          try {
            await self.registration.clearAppBadge();
          } catch (e) {}
        }
        try {
          const notifs = await self.registration.getNotifications();
          notifs.forEach((n) => n.close());
        } catch (e) {}
      })()
    );
  }
};

// Use onmessage property to avoid Chromium "Event handler of 'message' event must be added on initial evaluation" warning
if ('onmessage' in self) {
  const prevOnMsg = self.onmessage;
  self.onmessage = (event) => {
    if (typeof prevOnMsg === 'function') prevOnMsg(event);
    handleWorkerMessage(event);
  };
} else {
  self.addEventListener('message', handleWorkerMessage);
}

// Import OneSignal SDK worker synchronously
try {
  importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
} catch (e) {
  console.warn('[SW] OneSignal worker import failed:', e);
}


self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((k) => {
          if (k.startsWith('av-cache-') && k !== 'av-cache-v3') {
            return caches.delete(k);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});


// Ensure Firebase Auth handler URLs are never cached or intercepted by SW
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/__/')) {
    return; // Pass directly to network
  }
});

// Push notification handling
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const payload = event.data.json();
    // OneSignal's SDK worker handles OneSignal notifications natively
    if (payload && payload.custom && payload.custom.i) {
      return;
    }
    const title = payload.title || 'AV Alert';
    const options = {
      body: payload.body || 'You have an update in AV.',
      icon: '/pwa-192x192.png',
      badge: '/logo.svg',
      tag: payload.tag || 'av-notification',
      renotify: payload.renotify !== false,
      requireInteraction: payload.type === 'nudge' || payload.type === 'call',
      vibrate: payload.vibrate || [300, 100, 300],
      data: payload.data || {},
      actions: payload.actions || [
        { action: 'reply', type: 'text', title: 'Reply 💬', placeholder: 'Type a message...' },
        { action: 'open', title: 'Open AV' }
      ]
    };

    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        const focused = clientList.find(c => c.focused);
        if (focused) {
          focused.postMessage({
            type: 'IN_APP_PUSH_EVENT',
            payload
          });
          if (payload.type !== 'nudge' && payload.type !== 'call') {
            return;
          }
        }
        return self.registration.showNotification(title, options);
      })
    );
  } catch (err) {
    console.error('Error handling push payload:', err);
  }
});

// Notification click and inline reply handling
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const action = event.action;
  const data = event.notification.data || {};

  // WhatsApp-style Inline Reply directly from Notification Panel
  if (action === 'reply' || event.reply) {
    const replyText = event.reply;
    if (replyText && replyText.trim()) {
      event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
          let sentToClient = false;
          for (const client of clientList) {
            client.postMessage({
              type: 'NOTIFICATION_REPLY_ACTION',
              replyText: replyText.trim(),
              coupleId: data.coupleId,
              senderId: data.senderId,
              timestamp: Date.now()
            });
            sentToClient = true;
          }

          if (!sentToClient && self.clients.openWindow) {
            const replyUrl = `/?replyText=${encodeURIComponent(replyText.trim())}${data.coupleId ? `&coupleId=${encodeURIComponent(data.coupleId)}` : ''}`;
            return self.clients.openWindow(replyUrl);
          }
        })
      );
    }
    return;
  }

  if (action === 'done' || action === 'snooze' || action === 'mercy') {
    const actionPromise = fetch('/functions/v1/notification-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        actionToken: data.actionToken,
        taskId: data.taskId,
        coupleId: data.coupleId,
        timestamp: Date.now()
      })
    }).catch(err => {
      console.warn('Notification action fetch failed (offline/mock mode):', err);
    });

    event.waitUntil(
      Promise.all([
        actionPromise,
        self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(client => {
            client.postMessage({
              type: 'NOTIFICATION_ACTION_EXECUTED',
              action,
              taskId: data.taskId
            });
          });
        })
      ])
    );
    return;
  }

  // Open or focus the app window
  const urlToOpen = data.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});

