import React, { useState } from 'react';
import { Heart, ExternalLink, ChevronUp } from 'lucide-react';
import { WidgetView } from './WidgetView';
import { useAuthStore } from '../../lib/store';
import { soundEffects } from '../../lib/sound';

export const FloatingWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { partnerUser } = useAuthStore();

  const toggleWidget = () => {
    soundEffects.playPop();
    setIsOpen(!isOpen);
  };

  const openDedicatedPopout = () => {
    const w = 360;
    const h = 540;
    const left = window.screen.width - w - 40;
    const top = 100;
    window.open(
      `${window.location.origin}/?widget=true`,
      'AVDesktopWidget',
      `width=${w},height=${h},top=${top},left=${left},resizable=yes,scrollbars=no,status=no`
    );
  };

  return (
    <div className="fixed bottom-20 right-4 sm:bottom-6 sm:right-6 z-40 flex flex-col items-end">
      {isOpen && (
        <div className="mb-3 animate-in fade-in slide-in-from-bottom-5 duration-200">
          <WidgetView onClose={() => setIsOpen(false)} />
        </div>
      )}

      {/* Floating Widget Trigger Pill */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={openDedicatedPopout}
          title="Open Standalone Desktop Widget"
          className="hidden sm:flex items-center gap-1.5 px-3 py-2 bg-[var(--surface)] hover:bg-[var(--surface-2)] border-2 border-[var(--border)] rounded-full font-ui text-xs font-bold text-[var(--text)] shadow-[0_2px_0_var(--shadow-color)] transition-all cursor-pointer group active:translate-y-1 active:shadow-none"
        >
          <ExternalLink className="w-3.5 h-3.5 text-[var(--partner-a)] group-hover:scale-110 transition-transform" />
          <span>Desktop Widget</span>
        </button>

        <button
          type="button"
          onClick={toggleWidget}
          className="flex items-center gap-2.5 px-3.5 py-2.5 bg-[var(--surface)] hover:bg-[var(--surface-2)] border-2 border-[var(--border)] rounded-full shadow-[0_2px_0_var(--shadow-color)] text-[var(--text)] transition-all hover:scale-102 active:translate-y-1 active:shadow-none cursor-pointer group"
        >
          <div className="relative">
            <img
              src={partnerUser.avatarUrl}
              alt={partnerUser.displayName}
              className="w-7 h-7 rounded-full object-cover border-2 border-[var(--border)] shadow-xs"
            />
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-[var(--success)] rounded-full border border-[var(--border)]" />
          </div>

          <div className="flex items-center gap-1.5 font-ui text-xs font-bold pr-1">
            <Heart className="w-4 h-4 text-[var(--partner-a)] fill-[var(--partner-a)] animate-pulse" />
            <span className="hidden sm:inline text-[var(--text)]">{partnerUser.displayName}</span>
          </div>

          <ChevronUp
            className={`w-4 h-4 text-[var(--text-muted)] transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </button>
      </div>
    </div>
  );
};
