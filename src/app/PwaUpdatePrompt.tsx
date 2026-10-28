import React, { useState, useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, X } from 'lucide-react';
import { useCallStore } from '../lib/store';

export const PwaUpdatePrompt: React.FC = () => {
  const [dismissed, setDismissed] = useState(false);
  const callState = useCallStore((s) => s.callState);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(registration) {
      console.log('[PWA] Service worker registered successfully');
      // Periodically check for updates without auto-reloading
      if (registration) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
        intervalRef.current = setInterval(() => {
          registration.update().catch(() => {});
        }, 60 * 60 * 1000); // 1 hour check
      }
    },
    onRegisterError(error) {
      console.warn('[PWA] Service worker registration notice:', error);
    },
  });

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  // Never interrupt an active call or display if dismissed
  if (!needRefresh || dismissed || callState !== 'idle') {
    return null;
  }

  const handleUpdate = async () => {
    try {
      await updateServiceWorker(true);
    } catch (e) {
      console.warn('[PWA] Failed to update service worker:', e);
      window.location.reload();
    }
  };

  return (
    <div
      role="alert"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[calc(100%-2rem)] p-3 bg-[var(--surface)] text-[var(--text)] border-2 border-[var(--border)] rounded-2xl shadow-xl flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top duration-300 select-none"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-8 h-8 rounded-xl bg-[var(--partner-a)] text-white flex items-center justify-center shrink-0">
          <RefreshCw className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="font-ui font-bold text-xs leading-tight">Update available</p>
          <p className="font-ui text-[11px] text-[var(--text-muted)] truncate">Reload now for the latest features</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={handleUpdate}
          className="px-2.5 py-1 text-xs font-bold bg-[var(--partner-a)] text-white rounded-xl hover:opacity-90 active:scale-95 transition-all cursor-pointer"
        >
          Update
        </button>
        <button
          type="button"
          onClick={() => {
            setDismissed(true);
            setNeedRefresh(false);
          }}
          className="p-1 text-[var(--text-muted)] hover:text-[var(--text)] rounded-lg cursor-pointer"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
