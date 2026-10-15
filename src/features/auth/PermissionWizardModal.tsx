import React, { useState, useEffect } from 'react';
import {
  Bell,
  Camera,
  Volume2,
  HardDrive,
  Download,
  Check,
  X,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { useNotificationStore } from '../../lib/notifications';
import { soundEngine } from '../../lib/sounds';

interface PermissionWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
}

export const PermissionWizardModal: React.FC<PermissionWizardModalProps> = ({
  isOpen,
  onClose,
  userId,
}) => {
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [notifStatus, setNotifStatus] = useState<NotificationPermission | 'unsupported'>('default');
  const [mediaStatus, setMediaStatus] = useState<'granted' | 'denied' | 'prompt'>('prompt');
  const [audioUnlocked, setAudioUnlocked] = useState<boolean>(false);
  const [storagePersisted, setStoragePersisted] = useState<boolean>(false);
  const [isIosDevice, setIsIosDevice] = useState<boolean>(false);
  const [isStandalone, setIsStandalone] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      setIsIosDevice(isIos);
      const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
      setIsStandalone(standalone);

      if ('Notification' in window) {
        setNotifStatus(Notification.permission);
      }
      if (navigator.storage && navigator.storage.persisted) {
        navigator.storage.persisted().then(setStoragePersisted);
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRequestNotifications = async () => {
    const success = await useNotificationStore.getState().requestPermissionAndToken(userId);
    if ('Notification' in window) {
      setNotifStatus(Notification.permission);
    }
    if (success) {
      soundEngine.play('msg-pop');
    }
  };

  const handleRequestCameraMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMediaStatus('granted');
      soundEngine.play('msg-chime');
    } catch (err: any) {
      console.warn('Camera/Mic permission failed:', err);
      setMediaStatus('denied');
    }
  };

  const handleUnlockAudio = () => {
    soundEngine.unlockAudio();
    soundEngine.play('msg-knock', { force: true });
    setAudioUnlocked(true);
  };

  const handlePersistStorage = async () => {
    if (navigator.storage && navigator.storage.persist) {
      const persisted = await navigator.storage.persist();
      setStoragePersisted(persisted);
      soundEngine.play('msg-ding');
    }
  };

  const steps = [
    {
      id: 'install',
      title: 'Install Duo App',
      icon: <Download className="w-6 h-6 text-[var(--accent)]" />,
      description: isIosDevice
        ? 'On iPhone, Web Push notifications require adding Duo to your Home Screen. Tap the Share button in Safari, then tap "Add to Home Screen".'
        : 'Install Duo on your home screen or desktop for instant full-screen access and reliable alerts.',
      action: isStandalone ? (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--surface-2)] text-[var(--text)] text-xs font-chunky font-bold border border-[var(--border)]">
          <Check className="w-4 h-4 text-[var(--success)]" /> Installed
        </span>
      ) : (
        <div className="text-xs font-ui text-[var(--text-muted)] bg-[var(--surface-2)] p-3 rounded-2xl border border-[var(--border)]">
          {isIosDevice ? '1. Tap Safari Share icon ↗️  2. Select "Add to Home Screen"' : 'Look for the Install icon in the browser address bar.'}
        </div>
      ),
    },
    {
      id: 'notifications',
      title: 'Allow Notifications',
      icon: <Bell className="w-6 h-6 text-[var(--partner-a)]" />,
      description: 'Receive instant alerts when the other person sends a message, reacts, calls, or finishes a task.',
      status: notifStatus === 'granted' ? 'Allowed' : notifStatus === 'denied' ? 'Blocked' : 'Not asked',
      action: (
        <button
          type="button"
          onClick={handleRequestNotifications}
          disabled={notifStatus === 'granted'}
          className={`px-4 py-2 min-h-[44px] rounded-2xl text-xs font-chunky font-bold border-2 border-[var(--border)] cursor-pointer transition-transform ${
            notifStatus === 'granted'
              ? 'bg-[var(--surface-2)] text-[var(--text)] opacity-80'
              : 'bg-[var(--accent)] text-[var(--text)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5'
          }`}
        >
          {notifStatus === 'granted' ? '✓ Notifications Enabled' : 'Allow Notifications'}
        </button>
      ),
    },
    {
      id: 'media',
      title: 'Camera & Microphone',
      icon: <Camera className="w-6 h-6 text-[var(--partner-b)]" />,
      description: 'Required for video and voice calls, camera photos, and voice notes.',
      status: mediaStatus === 'granted' ? 'Allowed' : mediaStatus === 'denied' ? 'Blocked' : 'Not asked',
      action: (
        <button
          type="button"
          onClick={handleRequestCameraMic}
          disabled={mediaStatus === 'granted'}
          className={`px-4 py-2 min-h-[44px] rounded-2xl text-xs font-chunky font-bold border-2 border-[var(--border)] cursor-pointer transition-transform ${
            mediaStatus === 'granted'
              ? 'bg-[var(--surface-2)] text-[var(--text)] opacity-80'
              : 'bg-[var(--partner-b)] text-[var(--text)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5'
          }`}
        >
          {mediaStatus === 'granted' ? '✓ Camera & Mic Allowed' : 'Allow Camera & Mic'}
        </button>
      ),
    },
    {
      id: 'sounds',
      title: 'Turn On Sound Effects',
      icon: <Volume2 className="w-6 h-6 text-[var(--accent)]" />,
      description: 'Unlocks browser autoplay so incoming call ringtones, message pops, and alarm chimes play aloud.',
      status: audioUnlocked ? 'Allowed' : 'Not asked',
      action: (
        <button
          type="button"
          onClick={handleUnlockAudio}
          disabled={audioUnlocked}
          className={`px-4 py-2 min-h-[44px] rounded-2xl text-xs font-chunky font-bold border-2 border-[var(--border)] cursor-pointer transition-transform ${
            audioUnlocked
              ? 'bg-[var(--surface-2)] text-[var(--text)] opacity-80'
              : 'bg-[var(--accent)] text-[var(--text)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5'
          }`}
        >
          {audioUnlocked ? '✓ Sounds Unlocked' : 'Turn On Sounds 🔔'}
        </button>
      ),
    },
    {
      id: 'storage',
      title: 'Persistent Offline Storage',
      icon: <HardDrive className="w-6 h-6 text-[var(--partner-a)]" />,
      description: 'Prevents the phone or browser from evicting offline messages, drawings, and downloaded photos.',
      status: storagePersisted ? 'Allowed' : 'Not asked',
      action: (
        <button
          type="button"
          onClick={handlePersistStorage}
          disabled={storagePersisted}
          className={`px-4 py-2 min-h-[44px] rounded-2xl text-xs font-chunky font-bold border-2 border-[var(--border)] cursor-pointer transition-transform ${
            storagePersisted
              ? 'bg-[var(--surface-2)] text-[var(--text)] opacity-80'
              : 'bg-[var(--surface-2)] text-[var(--text)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5'
          }`}
        >
          {storagePersisted ? '✓ Storage Protected' : 'Protect Storage'}
        </button>
      ),
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--overlay)] backdrop-blur-sm animate-in fade-in"
    >
      <div className="relative w-full max-w-md rounded-3xl bg-[var(--surface)] border-3 border-[var(--border)] p-6 shadow-[0_8px_0_var(--shadow-color)] text-[var(--text)]">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-[var(--accent)] border-2 border-[var(--border)] flex items-center justify-center shadow-[0_2px_0_var(--shadow-color)]">
              <Sparkles className="w-5 h-5 text-[var(--text)]" />
            </div>
            <div>
              <h2 className="font-chunky text-lg font-bold">Set Up Duo</h2>
              <p className="text-xs font-ui text-[var(--text-muted)]">
                Step {currentStep + 1} of {steps.length}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 min-w-[44px] min-h-[44px] rounded-2xl border-2 border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Current Step Card */}
        <div className="p-4 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] space-y-3 mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)]">
              {steps[currentStep].icon}
            </div>
            <div>
              <h3 className="font-chunky text-base font-bold text-[var(--text)]">
                {steps[currentStep].title}
              </h3>
              {steps[currentStep].status && (
                <span className={`inline-block text-[10px] font-chunky font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${
                  steps[currentStep].status === 'Allowed'
                    ? 'bg-[var(--success)]/20 text-[var(--text)]'
                    : steps[currentStep].status === 'Blocked'
                    ? 'bg-[var(--urgent)]/20 text-[var(--urgent)]'
                    : 'bg-[var(--surface)] text-[var(--text-muted)]'
                }`}>
                  {steps[currentStep].status}
                </span>
              )}
            </div>
          </div>

          <p className="font-body text-xs text-[var(--text-muted)] leading-relaxed">
            {steps[currentStep].description}
          </p>

          <div className="pt-2 flex justify-end">
            {steps[currentStep].action}
          </div>
        </div>

        {/* Footer Navigation */}
        <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-ui font-semibold text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer min-h-[44px] px-2 flex items-center"
          >
            I'll do this later
          </button>

          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <button
                type="button"
                onClick={() => setCurrentStep((p) => p - 1)}
                className="px-3.5 py-2 min-h-[44px] rounded-xl border-2 border-[var(--border)] font-chunky text-xs font-bold hover:bg-[var(--surface-2)] cursor-pointer"
              >
                Back
              </button>
            )}

            {currentStep < steps.length - 1 ? (
              <button
                type="button"
                onClick={() => setCurrentStep((p) => p + 1)}
                className="px-4 py-2 min-h-[44px] rounded-xl bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] font-chunky text-xs font-bold shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 cursor-pointer flex items-center gap-1.5"
              >
                <span>Next</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 min-h-[44px] rounded-xl bg-[var(--partner-a)] text-white border-2 border-[var(--border)] font-chunky text-xs font-bold shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 cursor-pointer"
              >
                All Done! ✨
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
