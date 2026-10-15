import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../lib/store';
import { useNotificationStore } from '../lib/notifications';
import { requestOneSignalPermission } from '../lib/oneSignal';
import { Bell, X, Sparkles } from 'lucide-react';

export const NotificationPromptBanner: React.FC = () => {
  const { currentUser } = useAuthStore();
  const { permission, requestPermissionAndToken } = useNotificationStore();
  const [dismissed, setDismissed] = useState(false);
  const [grantedFeedback, setGrantedFeedback] = useState(false);

  useEffect(() => {
    try {
      const isDismissed = sessionStorage.getItem('duo_notif_banner_dismissed') === 'true';
      if (isDismissed) setDismissed(true);
    } catch {}
  }, []);

  if (dismissed || grantedFeedback) return null;
  if (typeof window === 'undefined' || !('Notification' in window)) return null;
  if (permission === 'granted' || permission === 'denied') return null;

  const handleEnable = async () => {
    const success = await requestPermissionAndToken(currentUser.id);
    await requestOneSignalPermission().catch(() => {});
    if (success) {
      setGrantedFeedback(true);
      setTimeout(() => setDismissed(true), 2500);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem('duo_notif_banner_dismissed', 'true');
    } catch {}
  };

  return (
    <aside
      aria-label="Notification prompt"
      className="w-full bg-[var(--surface-2)] border-b-2 border-[var(--border)] px-4 py-2.5 flex items-center justify-between gap-3 text-xs font-ui shrink-0 animate-in slide-in-from-top-2"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-8 h-8 rounded-xl bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] flex items-center justify-center shrink-0 shadow-xs">
          <Bell className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <div className="font-bold text-[var(--text)] flex items-center gap-1 truncate">
            <span>Turn on Pop-up Notifications</span>
            <Sparkles className="w-3 h-3 text-[var(--accent)] shrink-0" />
          </div>
          <p className="text-[var(--text-muted)] truncate hidden sm:block">
            Receive screen pop-up alerts like WhatsApp & Instagram for messages, calls & doodles.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={handleEnable}
          className="px-3.5 py-1.5 rounded-xl bg-[var(--partner-a)] text-white font-chunky font-bold text-xs border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 cursor-pointer flex items-center gap-1.5"
        >
          <Bell className="w-3.5 h-3.5" />
          <span>Enable</span>
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
          aria-label="Dismiss banner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
};
