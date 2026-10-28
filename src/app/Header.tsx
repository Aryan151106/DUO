import React, { useState } from 'react';
import { useAuthStore, usePresenceStore, useCallStore } from '../lib/store';
import { soundManager } from '../lib/sound';
import { useTheme } from '../lib/theme';
import { GoogleIcon } from '../components/GoogleIcon';
import { isInQuietHours } from '../lib/time';
import { useNow } from '../lib/useNow';
import { formatTimeOnly, formatFriendlyDate } from '../lib/format';
import { InstallAppModal } from '../components/InstallAppModal';

export const Header: React.FC = () => {
  const { currentUser, partnerUser, switchActiveProfile, isDemoMode } = useAuthStore();
  const { isPartnerOnline, partnerTyping } = usePresenceStore();
  const { startCall } = useCallStore();
  const { resolvedMode, toggleMode } = useTheme();
  const now = useNow();
  const [showInstallModal, setShowInstallModal] = useState(false);

  const isQuiet = isInQuietHours(partnerUser.quietHoursStart, partnerUser.quietHoursEnd, partnerUser.timezone);

  const handleSwitchUser = () => {
    soundManager.playPing();
    switchActiveProfile();
  };

  const partnerTimeStr = formatTimeOnly(now, partnerUser.timezone, { showSeconds: false });
  const friendlyDateStr = formatFriendlyDate(now);

  return (
    <header className="w-full h-[72px] bg-[var(--surface)] border-b border-[var(--border)] flex items-center shrink-0">
      {/* Same max-width and padding-inline as the main area */}
      <div className="w-full max-w-[1200px] mx-auto px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4">
        {/* Brand & Partner Status: Two clear lines */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] flex items-center justify-center p-1.5 shrink-0 shadow-xs">
            <img src="/logo.svg" alt="AV" className="w-full h-full object-contain" />
          </div>

          <div className="min-w-0">
            {/* Line 1: Names in --font-ui 600 */}
            <div className="flex items-center gap-2">
              <span className="font-ui font-semibold text-base sm:text-lg text-[var(--text)] tracking-tight leading-none truncate">
                {currentUser.displayName || 'Aryan'} & {partnerUser.displayName || 'Vidhi'}
              </span>
              {isDemoMode && (
                <span className="inline-flex items-center rounded-full border border-[var(--accent)] bg-[var(--accent)]/20 px-2 py-0.5 text-[10px] font-ui font-bold uppercase tracking-wide text-[var(--text)]">
                  Demo
                </span>
              )}
            </div>

            {/* Line 2: Status in --font-ui 500 at 13px, --text-muted */}
            <div className="flex items-center gap-1.5 font-ui font-medium text-[13px] text-[var(--text-muted)] mt-1 leading-none truncate">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  isPartnerOnline ? 'bg-[var(--success)] animate-pulse' : 'bg-stone-300'
                }`}
              />
              <span className="truncate">
                {partnerTyping ? 'Typing…' : isPartnerOnline ? 'Online' : 'Offline'}{' '}
                <span className="tabular-nums font-ui font-semibold text-[var(--text)]">
                  {partnerTimeStr}
                </span>
              </span>
              {/* Hide the date on screens under 640px */}
              <span className="hidden sm:inline">
                • {friendlyDateStr}
              </span>
              {isQuiet && <GoogleIcon name="bedtime" size={14} className="text-amber-500 inline shrink-0" />}
              {partnerTyping && <GoogleIcon name="auto_awesome" size={14} className="text-[var(--accent)] animate-spin inline shrink-0" />}
            </div>
          </div>
        </div>

        {/* Action Controls: 44px tap targets, never wrap */}
        <div className="flex items-center gap-2 shrink-0 flex-nowrap">
          {/* Theme Toggle Button (44px tap target) */}
          <button
            type="button"
            onClick={toggleMode}
            title={`Switch to ${resolvedMode === 'dark' ? 'Light' : 'Dark'} mode`}
            className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-2xl bg-[var(--surface-2)] hover:bg-[var(--accent)]/30 border-2 border-[var(--border)] text-[var(--text)] flex items-center justify-center shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none transition-all cursor-pointer shrink-0"
            aria-label="Toggle light or dark theme"
          >
            {resolvedMode === 'dark' ? (
              <GoogleIcon name="light_mode" size={18} className="text-amber-400" />
            ) : (
              <GoogleIcon name="dark_mode" size={18} className="text-indigo-500" />
            )}
          </button>

          {/* Persona Switcher Button (Dev demo only, hidden in production) */}
          {isDemoMode && !import.meta.env.PROD && (
            <button
              onClick={handleSwitchUser}
              title={`Switch persona to ${partnerUser.displayName}`}
              className="h-11 min-h-[44px] px-3.5 rounded-2xl bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] font-chunky font-bold text-xs shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
              aria-label={`Switch persona to ${partnerUser.displayName}`}
            >
              <GoogleIcon name="sync" size={15} />
              <span className="hidden sm:inline">Switch to {partnerUser.displayName}</span>
              <span className="sm:hidden">{partnerUser.displayName}</span>
            </button>
          )}

          {/* Download / Install App Button */}
          <button
            type="button"
            onClick={() => setShowInstallModal(true)}
            title="Download & Install AV App"
            className="h-11 min-h-[44px] px-3 rounded-2xl bg-[var(--surface-2)] hover:bg-[var(--accent)]/30 border-2 border-[var(--border)] text-[var(--text)] flex items-center gap-1.5 shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none transition-all cursor-pointer shrink-0 font-ui text-xs font-bold"
            aria-label="Download and install AV app"
          >
            <GoogleIcon name="download" size={18} className="text-[var(--accent)]" />
            <span className="hidden sm:inline">GET APP</span>
          </button>

          {/* Video Call (44px tap target) */}
          <button
            onClick={() => startCall('video', true)}
            className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-2xl bg-[var(--partner-a)] text-white border-2 border-[var(--border)] flex items-center justify-center shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none transition-all cursor-pointer shrink-0"
            title={isDemoMode ? 'Demo video room' : 'Open video room'}
            aria-label={isDemoMode ? 'Start demo video room' : 'Open video room'}
          >
            <GoogleIcon name="videocam" size={20} />
          </button>
        </div>
      </div>

      <InstallAppModal
        isOpen={showInstallModal}
        onClose={() => setShowInstallModal(false)}
      />
    </header>
  );
};
