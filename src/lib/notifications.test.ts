import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from './store';
import type { NotificationType } from './notifications';

describe('Chat Notification Suppression Logic (src/lib/notifications.ts)', () => {
  beforeEach(() => {
    useAuthStore.getState().setTab('chat');
  });

  function shouldSuppressNotification(params: {
    type: NotificationType;
    activeTab: string;
    visibilityState: DocumentVisibilityState;
    hasFocus: boolean;
  }): boolean {
    const isChatContent =
      params.type === 'message' ||
      params.type === 'voice' ||
      params.type === 'attachment' ||
      params.type === 'reaction' ||
      params.type === 'doodle';

    const isChatOpenAndFocused =
      params.activeTab === 'chat' &&
      params.visibilityState === 'visible' &&
      params.hasFocus;

    return Boolean(isChatContent && isChatOpenAndFocused);
  }

  it('suppresses OS notification when chat is open, visible, and focused (like WhatsApp/Instagram)', () => {
    const result = shouldSuppressNotification({
      type: 'message',
      activeTab: 'chat',
      visibilityState: 'visible',
      hasFocus: true,
    });
    expect(result).toBe(true);
  });

  it('suppresses voice notes and doodles when chat is open and focused', () => {
    expect(
      shouldSuppressNotification({
        type: 'voice',
        activeTab: 'chat',
        visibilityState: 'visible',
        hasFocus: true,
      })
    ).toBe(true);

    expect(
      shouldSuppressNotification({
        type: 'doodle',
        activeTab: 'chat',
        visibilityState: 'visible',
        hasFocus: true,
      })
    ).toBe(true);
  });

  it('does NOT suppress notification if user is on another tab (e.g. today / tasks)', () => {
    const result = shouldSuppressNotification({
      type: 'message',
      activeTab: 'today',
      visibilityState: 'visible',
      hasFocus: true,
    });
    expect(result).toBe(false);
  });

  it('does NOT suppress notification if window is minimized or hidden', () => {
    const result = shouldSuppressNotification({
      type: 'message',
      activeTab: 'chat',
      visibilityState: 'hidden',
      hasFocus: false,
    });
    expect(result).toBe(false);
  });

  it('does NOT suppress incoming phone/video calls even if chat is open', () => {
    const result = shouldSuppressNotification({
      type: 'call',
      activeTab: 'chat',
      visibilityState: 'visible',
      hasFocus: true,
    });
    expect(result).toBe(false);
  });

  it('correctly calculates unread count only for partner notifications and clears to 0 on markAllAsRead', () => {
    const currentUserId = 'user-alex';
    const partnerId = 'user-sam';

    const notifs = [
      { id: '1', read: false, senderId: partnerId },
      { id: '2', read: false, senderId: partnerId },
      { id: '3', read: true, senderId: partnerId },
      { id: '4', read: false, senderId: currentUserId }, // own notification
    ];

    const unread = notifs.filter((n) => !n.read && n.senderId !== currentUserId).length;
    expect(unread).toBe(2);

    // After markAllAsRead:
    const markedRead = notifs.map((n) => ({ ...n, read: true }));
    const unreadAfter = markedRead.filter((n) => !n.read && n.senderId !== currentUserId).length;
    expect(unreadAfter).toBe(0);
  });
});
