import React, { useState } from 'react';
import { usePwaInstall } from '../lib/usePwaInstall';
import {
  Download,
  Smartphone,
  Laptop,
  Share2,
  PlusSquare,
  Check,
  X,
  Sparkles,
} from 'lucide-react';

interface InstallAppModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InstallAppModal: React.FC<InstallAppModalProps> = ({ isOpen, onClose }) => {
  const { isInstallable, isInstalled, isIos, promptInstall } = usePwaInstall();
  const [installStatus, setInstallStatus] = useState<string | null>(null);
  const [activePlatformTab, setActivePlatformTab] = useState<'mobile' | 'laptop'>(
    typeof window !== 'undefined' && window.innerWidth < 768 ? 'mobile' : 'laptop'
  );

  if (!isOpen) return null;

  const handleInstallClick = async () => {
    const outcome = await promptInstall();
    if (outcome === 'accepted') {
      setInstallStatus('Installed successfully! You can now launch AV from your apps.');
      setTimeout(() => onClose(), 2000);
    } else if (outcome === 'manual_ios') {
      setActivePlatformTab('mobile');
    } else if (outcome === 'unavailable') {
      setInstallStatus('Follow the browser guide below to install AV.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="w-full max-w-md bg-[var(--surface)] border-2 border-[var(--border)] rounded-3xl p-5 sm:p-6 shadow-[0_8px_0_var(--shadow-color)] flex flex-col gap-4 animate-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] flex items-center justify-center p-2 shrink-0">
              <img src="/logo.svg" alt="AV" className="w-full h-full object-contain" />
            </div>
            <div>
              <h2 className="font-chunky text-xl font-bold text-[var(--text)] flex items-center gap-1.5 leading-tight">
                <span>Download AV App</span>
                <Sparkles className="w-4 h-4 text-[var(--accent)] shrink-0" />
              </h2>
              <p className="font-ui text-xs text-[var(--text-muted)] mt-0.5">
                Install on phone & laptop for pop-up alerts
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Platform Tabs */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-[var(--surface-2)] rounded-2xl border-2 border-[var(--border)]">
          <button
            type="button"
            onClick={() => setActivePlatformTab('mobile')}
            className={`flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-ui font-bold transition-all cursor-pointer border-2 ${
              activePlatformTab === 'mobile'
                ? 'bg-[var(--surface)] text-[var(--text)] border-[var(--border)] shadow-xs'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            <Smartphone className="w-4 h-4" />
            <span>Mobile (Phone)</span>
          </button>
          <button
            type="button"
            onClick={() => setActivePlatformTab('laptop')}
            className={`flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-ui font-bold transition-all cursor-pointer border-2 ${
              activePlatformTab === 'laptop'
                ? 'bg-[var(--surface)] text-[var(--text)] border-[var(--border)] shadow-xs'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            <Laptop className="w-4 h-4" />
            <span>Laptop / Desktop</span>
          </button>
        </div>

        {/* Tab Content */}
        {activePlatformTab === 'mobile' ? (
          <div className="space-y-3 font-ui text-xs">
            {isIos ? (
              <div className="space-y-2 bg-[var(--surface-2)] p-3.5 rounded-2xl border-2 border-[var(--border)]">
                <div className="font-bold text-[var(--text)] text-sm mb-1 flex items-center gap-1.5">
                  <span>iPhone / iPad Installation:</span>
                </div>
                <div className="flex items-center gap-2 text-[var(--text)]">
                  <div className="w-6 h-6 rounded-lg bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center shrink-0 font-bold font-numeric text-[11px]">
                    1
                  </div>
                  <span>Tap the <strong>Share</strong> button <Share2 className="w-3.5 h-3.5 inline mx-0.5 text-[var(--accent)]" /> at the bottom of Safari.</span>
                </div>
                <div className="flex items-center gap-2 text-[var(--text)]">
                  <div className="w-6 h-6 rounded-lg bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center shrink-0 font-bold font-numeric text-[11px]">
                    2
                  </div>
                  <span>Scroll down and tap <strong>Add to Home Screen</strong> <PlusSquare className="w-3.5 h-3.5 inline mx-0.5 text-[var(--accent)]" />.</span>
                </div>
                <div className="flex items-center gap-2 text-[var(--text)]">
                  <div className="w-6 h-6 rounded-lg bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center shrink-0 font-bold font-numeric text-[11px]">
                    3
                  </div>
                  <span>Tap <strong>Add</strong> in the top-right corner. AV is now on your home screen!</span>
                </div>
              </div>
            ) : (
              <div className="space-y-2 bg-[var(--surface-2)] p-3.5 rounded-2xl border-2 border-[var(--border)]">
                <div className="font-bold text-[var(--text)] text-sm mb-1">
                  Android Installation:
                </div>
                <p className="text-[var(--text-muted)] leading-relaxed">
                  Install AV directly to your Android home screen and app drawer. It launches fullscreen with native app performance and pop-up notifications!
                </p>
                {isInstallable && (
                  <button
                    type="button"
                    onClick={handleInstallClick}
                    className="w-full mt-2 py-2.5 px-4 rounded-xl bg-[var(--partner-a)] text-white font-chunky font-bold text-sm border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4 stroke-[2.5]" />
                    <span>Download & Install AV</span>
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3 font-ui text-xs">
            <div className="space-y-2 bg-[var(--surface-2)] p-3.5 rounded-2xl border-2 border-[var(--border)]">
              <div className="font-bold text-[var(--text)] text-sm mb-1">
                Windows & Mac Laptop Installation:
              </div>
              <p className="text-[var(--text-muted)] leading-relaxed">
                Add AV to your desktop, taskbar, or dock. Runs in a dedicated native window without browser address bars, with instant Windows Action Center / Mac Notification Center alerts.
              </p>
              {isInstallable ? (
                <button
                  type="button"
                  onClick={handleInstallClick}
                  className="w-full mt-2 py-2.5 px-4 rounded-xl bg-[var(--partner-a)] text-white font-chunky font-bold text-sm border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 cursor-pointer flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4 stroke-[2.5]" />
                  <span>Install AV on Laptop</span>
                </button>
              ) : (
                <div className="text-[11px] text-[var(--text-muted)] pt-1 border-t border-[var(--border)]">
                  💡 In Chrome or Edge, click the <strong>Install</strong> icon in the right side of the address bar, or open the browser menu (⋮) &rarr; <strong>Install AV</strong>.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Status message */}
        {installStatus && (
          <div className="p-2.5 rounded-xl bg-[var(--surface-2)] border-2 border-[var(--border)] text-xs font-ui text-[var(--accent)] font-semibold text-center animate-in fade-in">
            {installStatus}
          </div>
        )}

        {/* If already installed */}
        {isInstalled && (
          <div className="p-3 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] text-xs font-ui flex items-center gap-2 text-[var(--success)] font-bold">
            <Check className="w-4 h-4 stroke-[3]" />
            <span>AV is already installed on this device!</span>
          </div>
        )}

        {/* Footer buttons */}
        <div className="flex items-center justify-end gap-2 pt-1 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-ui font-semibold text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
          >
            Close
          </button>
          {!isInstalled && isInstallable && (
            <button
              type="button"
              onClick={handleInstallClick}
              className="px-4 py-2 rounded-xl bg-[var(--partner-a)] text-white font-chunky font-bold text-xs border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 cursor-pointer flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Install Now</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
