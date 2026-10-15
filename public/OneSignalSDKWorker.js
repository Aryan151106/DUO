importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

// Duo Custom Service Worker Extension - Direct Notification Reply & Action Click
self.addEventListener('notificationclick', (event) => {
  const action = event.action;
  const replyText = event.reply;
  const notification = event.notification;
  const data = (notification && notification.data) || {};

  // 1. Direct inline text reply from Android notification drawer (event.reply)
  if (replyText && replyText.trim()) {
    event.notification.close();
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
          if ('focus' in client) {
            client.focus();
          }
        }

        if (!sentToClient && self.clients.openWindow) {
          const replyUrl = `/?action=chat&replyText=${encodeURIComponent(replyText.trim())}${data.coupleId ? `&coupleId=${encodeURIComponent(data.coupleId)}` : ''}`;
          return self.clients.openWindow(replyUrl);
        }
      })
    );
    return;
  }

  // 2. Action button "Reply 💬" clicked
  if (action === 'reply') {
    event.notification.close();
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
        for (const client of clientList) {
          client.postMessage({
            type: 'FOCUS_REPLY_INPUT',
            coupleId: data.coupleId,
            timestamp: Date.now()
          });
          if ('focus' in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow('/?action=chat&openReply=true');
        }
      })
    );
  }
});
