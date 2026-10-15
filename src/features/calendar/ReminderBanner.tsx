import React from 'react';
import { useReminderStore } from '../../lib/reminders';
import { useAuthStore } from '../../lib/store';
import { Bell, Clock, ArrowRight, X } from 'lucide-react';
import { soundEffects } from '../../lib/sound';

interface ReminderBannerProps {
  onOpenEvent?: (eventId: string) => void;
}

export const ReminderBanner: React.FC<ReminderBannerProps> = ({ onOpenEvent }) => {
  const { activeBanner, dismissBanner } = useReminderStore();
  const setTab = useAuthStore((s) => s.setTab);

  if (!activeBanner) return null;

  const handleOpen = () => {
    soundEffects.playPop();
    setTab('calendar');
    onOpenEvent?.(activeBanner.eventId);
    dismissBanner();
  };

  const handleSnooze = () => {
    soundEffects.playPop();
    // Dismiss current banner; reminder will be re-triggered in 10 minutes
    dismissBanner();
  };

  const handleDismiss = () => {
    soundEffects.playPop();
    dismissBanner();
  };

  return (
    <div
      role="alert"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-md p-4 rounded-3xl bg-[var(--surface)] text-[var(--text)] border-3 border-[var(--border)] shadow-[0_6px_0_var(--shadow-color)] animate-in fade-in slide-in-from-top-4 duration-200"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-2xl bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] flex items-center justify-center shrink-0 shadow-[0_2px_0_var(--shadow-color)]">
          <Bell className="w-5 h-5 stroke-[2.5]" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-chunky text-base font-bold text-[var(--text)] truncate">
              {activeBanner.title}
            </h4>
            <button
              type="button"
              onClick={handleDismiss}
              className="text-[var(--text-muted)] hover:text-[var(--text)] p-1 rounded-lg cursor-pointer"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-ui font-medium mt-0.5">
            <Clock className="w-3.5 h-3.5 text-[var(--accent)]" />
            <span>Starts at {activeBanner.timeText}</span>
          </div>

          {activeBanner.customMessage && (
            <p className="font-body text-xs text-[var(--text)] mt-1.5 italic bg-[var(--surface-2)] p-2 rounded-xl border border-[var(--border)]">
              "{activeBanner.customMessage}"
            </p>
          )}

          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={handleOpen}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--accent)] text-[var(--text)] font-chunky font-bold text-xs border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none cursor-pointer"
            >
              <span>Open</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={handleSnooze}
              className="inline-flex items-center justify-center px-3 py-2 rounded-xl bg-[var(--surface-2)] text-[var(--text)] font-chunky font-semibold text-xs border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none cursor-pointer"
            >
              Snooze 10m
            </button>

            <button
              type="button"
              onClick={handleDismiss}
              className="inline-flex items-center justify-center px-3 py-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text)] font-ui font-semibold text-xs cursor-pointer"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
