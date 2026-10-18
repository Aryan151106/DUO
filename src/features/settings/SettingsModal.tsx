import React, { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '../../lib/store';
import {
  soundEngine,
  BUILTIN_SOUNDS,
  DEFAULT_SOUND_SETTINGS,
  type SoundSettings,
} from '../../lib/sounds';
import { signOut } from '../../lib/firebase';
import { ThemeChooser } from './ThemeChooser';
import { updateProfile } from '../../lib/firestore';
import { SoundChooserModal } from './SoundChooserModal';
import { InstallAppModal } from '../../components/InstallAppModal';
import { useNotificationStore } from '../../lib/notifications';
import {
  getOneSignalConfig,
  sendOneSignalPush,
} from '../../lib/oneSignal';
import {
  Bell,
  Download,
  LogOut,
  Clock,
  ShieldCheck,
  KeyRound,
  Check,
  Copy,
  ExternalLink,
  Laptop,
  Globe,
  Search,
  Volume2,
  Phone,
  MessageCircle,
  CalendarCheck,
  Play,
  Square,
  Sliders,
  RotateCcw,
  Info,
  Sparkles,
} from 'lucide-react';

const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'America/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'America/Buenos_Aires',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Rome',
  'Europe/Madrid',
  'Europe/Amsterdam',
  'Europe/Athens',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Brisbane',
  'Australia/Perth',
  'Pacific/Auckland',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'UTC',
];

export const SettingsModal: React.FC = () => {
  const {
    currentUser,
    partnerUser,
    couple,
    setCurrentUser,
    timeFormat,
    setTimeFormat,
    firstDayOfWeek,
    setFirstDayOfWeek,
  } = useAuthStore();

  const [copiedCode, setCopiedCode] = useState(false);
  const [tzSearch, setTzSearch] = useState('');
  const [showTzDropdown, setShowTzDropdown] = useState(false);

  // Sound & Notification Settings state
  const [soundSettings, setSoundSettings] = useState<SoundSettings>(() => soundEngine.getSettings());
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const previewStopRef = useRef<(() => void) | null>(null);

  // Sound Chooser Bottom Sheet / Modal state
  const [chooserConfig, setChooserConfig] = useState<{
    isOpen: boolean;
    title: string;
    category: 'message' | 'ringtone' | 'alarm';
    selectedSoundId: string;
    onSelectSound: (soundId: string) => void;
  } | null>(null);

  const [showInstallModal, setShowInstallModal] = useState(false);
  const [showActiveStatus, setShowActiveStatus] = useState(
    () => localStorage.getItem('duo_show_active_status') !== 'false'
  );
  const [privateNotes, setPrivateNotes] = useState(() => {
    const key = currentUser?.id ? `duo_private_notes_${currentUser.id}` : 'duo_private_notes';
    return localStorage.getItem(key) || '';
  });

  useEffect(() => {
    const key = currentUser?.id ? `duo_private_notes_${currentUser.id}` : 'duo_private_notes';
    setPrivateNotes(localStorage.getItem(key) || '');
  }, [currentUser?.id]);

  // OneSignal Free Push state
  const [oneSignalTesting, setOneSignalTesting] = useState(false);
  const [oneSignalTestResult, setOneSignalTestResult] = useState<string | null>(null);
  const [notifFeedback, setNotifFeedback] = useState<string | null>(null);

  // Stop any active preview on unmount
  useEffect(() => {
    return () => {
      if (previewStopRef.current) {
        previewStopRef.current();
      }
    };
  }, []);

  const updateSettings = (updates: Partial<SoundSettings>) => {
    soundEngine.saveSettings(updates);
    const next = soundEngine.getSettings();
    setSoundSettings({ ...next });

    if (currentUser?.id) {
      updateProfile(currentUser.id, { soundSettings: updates }).catch(() => {});
    }
  };

  const handleTogglePreview = async (soundId: string, category: 'message' | 'ringtone' | 'alarm') => {
    if (previewingId === soundId) {
      if (previewStopRef.current) previewStopRef.current();
      previewStopRef.current = null;
      setPreviewingId(null);
      return;
    }

    if (previewStopRef.current) {
      previewStopRef.current();
      previewStopRef.current = null;
    }

    setPreviewingId(soundId);
    const handle = await soundEngine.play(soundId, {
      category,
      force: true,
      loop: category === 'ringtone',
    });
    previewStopRef.current = handle.stop;

    if (category !== 'ringtone') {
      setTimeout(() => {
        if (previewingId === soundId) {
          if (previewStopRef.current) previewStopRef.current();
          setPreviewingId(null);
        }
      }, 4000);
    }
  };

  const getSoundName = (soundId: string): string => {
    const builtin = BUILTIN_SOUNDS.find((s) => s.id === soundId);
    if (builtin) return builtin.name;
    const custom = soundEngine.getCustomSounds().find((c) => c.id === soundId);
    if (custom) return custom.name;
    return 'Default';
  };

  const handleCopyCode = () => {
    if (couple?.inviteCode) {
      navigator.clipboard.writeText(couple.inviteCode);
      setCopiedCode(true);
      soundEngine.play('msg-pop', { force: true });
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const handlePrivateNotesChange = (value: string) => {
    setPrivateNotes(value);
    if (currentUser?.id) {
      localStorage.setItem(`duo_private_notes_${currentUser.id}`, value);
    }
  };

  const handleExportData = () => {
    soundEngine.play('msg-ding', { force: true });
    const backup = {
      exportedAt: new Date().toISOString(),
      user: currentUser,
      partner: partnerUser,
      couple,
      soundSettings,
      tasks: localStorage.getItem('duo_tasks_v1'),
      wishlist: localStorage.getItem('duo_wishlist_v1'),
      messages: localStorage.getItem('duo_messages_v1'),
      scores: localStorage.getItem('duo_scores_v1'),
      privateNotes: currentUser?.id ? localStorage.getItem(`duo_private_notes_${currentUser.id}`) : null,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `duo-our-journey-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  };

  const openDedicatedPopout = () => {
    const w = 360;
    const h = 540;
    const left = window.screen.width - w - 40;
    const top = 100;
    window.open(
      `${window.location.origin}/?widget=true`,
      'DuoWidgetPopout',
      `width=${w},height=${h},top=${top},left=${left},resizable=yes,scrollbars=no,status=no,toolbar=no`
    );
  };

  return (
    <div className="w-full max-w-[1500px] mx-auto pb-28 pt-2">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* 1. THEME & APPEARANCE */}
      <section className="bg-[var(--surface)] rounded-3xl p-6 sm:p-7 border-3 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)]">
        <div className="flex items-start gap-3 mb-5 pb-4 border-b-2 border-[var(--border)]">
          <div className="w-10 h-10 rounded-2xl bg-[var(--accent)] border-2 border-[var(--border)] flex items-center justify-center text-[var(--text)] shadow-[0_2px_0_var(--shadow-color)]">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-chunky font-bold text-[var(--text)]">Appearance</h2>
            <p className="font-clean text-xs text-[var(--text-muted)]">
              Choose a palette and adjust custom colors for your command center.
            </p>
          </div>
        </div>
        <ThemeChooser />
        <label className="mt-5 flex items-center justify-between gap-3 rounded-2xl border-2 border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 font-ui text-sm text-[var(--text)]">
          <span>
            <span className="block font-bold">Show my active status</span>
            <span className="block text-xs text-[var(--text-muted)]">Let your crew see when you are online.</span>
          </span>
          <input
            type="checkbox"
            checked={showActiveStatus}
            onChange={(event) => {
              const enabled = event.target.checked;
              setShowActiveStatus(enabled);
              localStorage.setItem('duo_show_active_status', String(enabled));
            }}
            aria-label="Show my active status"
          />
        </label>
      </section>

      {/* 2. PRIVATE NOTES / DIARY */}
      <section className="bg-[var(--surface)] rounded-3xl p-6 sm:p-7 border-3 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)]">
        <div className="flex items-start gap-3 mb-5 pb-4 border-b-2 border-[var(--border)]">
          <div className="w-10 h-10 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] flex items-center justify-center text-[var(--text)] shadow-[0_2px_0_var(--shadow-color)]">
            <CalendarCheck className="w-5 h-5 text-[var(--accent)]" />
          </div>
          <div>
            <h2 className="text-xl font-chunky font-bold text-[var(--text)]">Private journal</h2>
            <p className="font-clean text-xs text-[var(--text-muted)]">
              Only you can see these notes. They stay hidden from the other user.
            </p>
          </div>
        </div>
        <textarea
          value={privateNotes}
          onChange={(event) => handlePrivateNotesChange(event.target.value)}
          rows={6}
          placeholder="Write a quick private reflection, idea, or personal note..."
          className="w-full rounded-2xl border-2 border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 font-body text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] resize-none"
        />
      </section>

      {/* 3. TIME FORMAT & FIRST DAY OF WEEK */}
      <div className="bg-[var(--surface)] rounded-3xl p-6 sm:p-7 border-3 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)] space-y-4">
        <div className="flex items-center gap-2.5 mb-1 pb-3 border-b-2 border-[var(--border)]">
          <div className="w-9 h-9 rounded-2xl bg-[var(--accent)] border-2 border-[var(--border)] flex items-center justify-center text-[var(--text)] shadow-[0_2px_0_var(--shadow-color)]">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-chunky font-bold text-[var(--text)]">Time & Calendar Format</h2>
            <p className="font-clean text-xs text-[var(--text-muted)]">
              Personalize how hours and days are presented across all widgets
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <span className="text-xs font-clean font-semibold text-[var(--text-muted)] block mb-1.5">
              Clock Format
            </span>
            <div className="grid grid-cols-3 gap-2 bg-[var(--surface-2)] p-1 rounded-2xl border-2 border-[var(--border)]">
              {[
                { id: 'auto', label: 'Auto ⚙️' },
                { id: '12h', label: '12-Hour' },
                { id: '24h', label: '24-Hour' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    soundEngine.play('msg-pop', { force: true });
                    setTimeFormat(opt.id as any);
                  }}
                  className={`py-2 text-xs font-ui font-semibold rounded-xl transition-all cursor-pointer min-h-[44px] flex items-center justify-center ${
                    timeFormat === opt.id
                      ? 'bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] shadow-xs font-bold'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="text-xs font-clean font-semibold text-[var(--text-muted)] block mb-1.5">
              First Day of the Week
            </span>
            <div className="grid grid-cols-2 gap-2 bg-[var(--surface-2)] p-1 rounded-2xl border-2 border-[var(--border)]">
              {[
                { id: 'sunday', label: 'Sunday' },
                { id: 'monday', label: 'Monday' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    soundEngine.play('msg-pop', { force: true });
                    setFirstDayOfWeek(opt.id as any);
                  }}
                  className={`py-2 text-xs font-ui font-semibold rounded-xl transition-all cursor-pointer min-h-[44px] flex items-center justify-center ${
                    firstDayOfWeek === opt.id
                      ? 'bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] shadow-xs font-bold'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 3. PROFILE & TIMEZONE SETTINGS */}
      <div className="bg-[var(--surface)] rounded-3xl p-6 sm:p-7 border-3 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)] space-y-4">
        <div className="flex items-center gap-2.5 mb-1 pb-3 border-b-2 border-[var(--border)]">
          <div className="w-9 h-9 rounded-2xl bg-[var(--accent)] border-2 border-[var(--border)] flex items-center justify-center text-[var(--text)] shadow-[0_2px_0_var(--shadow-color)]">
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-chunky font-bold text-[var(--text)]">Profile & Timezone</h2>
            <p className="font-clean text-xs text-[var(--text-muted)]">
              Accurate dual timezones for your local clocks and shared calendar
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="text-xs font-clean font-semibold text-[var(--text-muted)] block">
                Current Timezone
              </span>
              <span className="font-numeric font-bold text-sm text-[var(--text)]">
                {currentUser.timezone || 'UTC'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                soundEngine.play('msg-ding', { force: true });
                const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
                setCurrentUser({ timezone: detected });
                if (currentUser?.id) {
                  updateProfile(currentUser.id, { timezone: detected }).catch(() => {});
                }
              }}
              className="px-4 py-2 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] text-xs font-chunky font-bold shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 cursor-pointer min-h-[44px]"
            >
              Detect Device Timezone 📍
            </button>
          </div>

          <div className="relative">
            <div className="flex items-center gap-2 p-2 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)]">
              <Search className="w-4 h-4 text-[var(--text-muted)] shrink-0 ml-1" />
              <input
                type="text"
                value={tzSearch}
                onFocus={() => setShowTzDropdown(true)}
                onChange={(e) => {
                  setTzSearch(e.target.value);
                  setShowTzDropdown(true);
                }}
                placeholder="Search timezone (e.g. New York, London, Tokyo, Kolkata)..."
                className="w-full bg-transparent text-xs font-clean text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none"
              />
            </div>

            {showTzDropdown && (
              <div className="absolute top-full left-0 right-0 mt-2 z-40 max-h-48 overflow-y-auto bg-[var(--surface)] border-2 border-[var(--border)] rounded-2xl shadow-[0_4px_0_var(--shadow-color)] p-1 divide-y divide-[var(--border)]">
                {COMMON_TIMEZONES.filter((tz) =>
                  tz.toLowerCase().includes(tzSearch.toLowerCase())
                ).map((tz) => (
                  <button
                    key={tz}
                    type="button"
                    onClick={() => {
                      soundEngine.play('msg-pop', { force: true });
                      setCurrentUser({ timezone: tz });
                      setShowTzDropdown(false);
                      setTzSearch('');
                      if (currentUser?.id) {
                        updateProfile(currentUser.id, { timezone: tz }).catch(() => {});
                      }
                    }}
                    className={`w-full text-left px-3 py-2 text-xs font-clean flex items-center justify-between hover:bg-[var(--surface-2)] cursor-pointer min-h-[36px] ${
                      currentUser.timezone === tz ? 'bg-[var(--accent)]/30 font-bold' : ''
                    }`}
                  >
                    <span>{tz}</span>
                    {currentUser.timezone === tz && <Check className="w-3.5 h-3.5 text-[var(--accent)]" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 4. NOTIFICATIONS AND SOUNDS (PART E) */}
      <div className="bg-[var(--surface)] rounded-3xl p-6 sm:p-7 border-3 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)] space-y-6">
        <div className="flex items-center justify-between pb-3 border-b-2 border-[var(--border)]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-[var(--accent)] border-2 border-[var(--border)] flex items-center justify-center text-[var(--text)] shadow-[0_2px_0_var(--shadow-color)]">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-chunky font-bold text-[var(--text)]">
                Notifications & Sounds
              </h2>
              <p className="font-clean text-xs text-[var(--text-muted)]">
                Custom sound effects, ringtones, alarm tones & vibration
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => updateSettings(DEFAULT_SOUND_SETTINGS)}
            className="px-3 py-1.5 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface)] border-2 border-[var(--border)] font-chunky text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text)] transition-all cursor-pointer flex items-center gap-1.5 min-h-[36px]"
            title="Reset to default audio settings"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Defaults</span>
          </button>
        </div>

        {/* Global Mute Switch & Duration Scheduler */}
        <div className="p-4 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-chunky text-xs font-bold text-[var(--text)]">
                Mute All Sounds
              </h4>
              <p className="font-clean text-xs text-[var(--text-muted)]">
                Silence all chat, call, and task audio notifications
              </p>
            </div>

            <button
              type="button"
              onClick={() => updateSettings({ muteAll: !soundSettings.muteAll })}
              className={`w-14 h-8 rounded-full border-2 border-[var(--border)] p-1 transition-colors relative cursor-pointer min-h-[32px] ${
                soundSettings.muteAll ? 'bg-[var(--urgent)]' : 'bg-[var(--surface)]'
              }`}
              aria-label="Toggle mute all sounds"
            >
              <div
                className={`w-5 h-5 rounded-full bg-[var(--text)] transition-transform ${
                  soundSettings.muteAll ? 'translate-x-6 bg-white' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Quick Mute Durations */}
          <div>
            <span className="text-[11px] font-clean font-semibold text-[var(--text-muted)] block mb-1">
              Temporary Mute:
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: 'off', label: 'Unmuted 🔔' },
                { id: '1h', label: '1 Hour' },
                { id: '8h', label: '8 Hours' },
                { id: 'tomorrow', label: 'Until 8:00 AM' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => soundEngine.setMuteDuration(m.id as any)}
                  className="py-1.5 px-2 rounded-xl bg-[var(--surface)] hover:bg-[var(--accent)]/30 border-2 border-[var(--border)] text-xs font-ui font-semibold text-[var(--text)] transition-all cursor-pointer min-h-[36px] flex items-center justify-center text-center"
                >
                  {m.label}
                </button>
              ))}
            </div>
            {soundSettings.mutedUntil && (
              <div className="mt-2 text-xs font-ui font-bold text-[var(--partner-a)] flex items-center gap-1">
                <span>🔕 Muted until: {new Date(soundSettings.mutedUntil).toLocaleTimeString()}</span>
              </div>
            )}
          </div>
        </div>

        {/* PWA Download App & Android Badges */}
        <div className="p-4 sm:p-5 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b-2 border-[var(--border)]">
            <div className="flex items-center gap-2">
              <Download className="w-4 h-4 text-[var(--accent)] shrink-0" />
              <h3 className="font-chunky text-sm font-bold text-[var(--text)]">
                App Download & Home Screen Tools
              </h3>
            </div>
            <span className="text-[11px] font-ui font-bold px-2.5 py-0.5 rounded-full border bg-emerald-500/15 text-emerald-600 border-emerald-500/30 shrink-0 whitespace-nowrap self-start sm:self-center">
              PWA Ready ✓
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setShowInstallModal(true)}
              className="p-3 rounded-xl bg-[var(--surface)] hover:bg-[var(--accent)]/20 border-2 border-[var(--border)] text-left flex items-center gap-3 cursor-pointer transition-colors shadow-xs"
            >
              <div className="w-9 h-9 rounded-lg bg-[var(--partner-a)]/30 border border-[var(--border)] flex items-center justify-center shrink-0">
                <Download className="w-4 h-4 text-[var(--text)]" />
              </div>
              <div className="min-w-0">
                <span className="font-ui font-bold text-xs text-[var(--text)] block truncate">
                  Download & Install Duo App
                </span>
                <span className="font-ui text-[11px] text-[var(--text-muted)] block truncate">
                  Install on phone home screen or laptop
                </span>
              </div>
            </button>

            <button
              type="button"
              onClick={async () => {
                await useNotificationStore.getState().clearAllBadges();
                soundEngine.play('pop', { force: true });
                setNotifFeedback('Android home badges & tray cleared! ✓');
                setTimeout(() => setNotifFeedback(null), 3000);
              }}
              className="p-3 rounded-xl bg-[var(--surface)] hover:bg-[var(--accent)]/20 border-2 border-[var(--border)] text-left flex items-center gap-3 cursor-pointer transition-colors shadow-xs"
            >
              <div className="w-9 h-9 rounded-lg bg-emerald-500/20 border border-[var(--border)] flex items-center justify-center shrink-0">
                <Check className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="min-w-0">
                <span className="font-ui font-bold text-xs text-[var(--text)] block truncate">
                  Clear Android Badge to 0
                </span>
                <span className="font-ui text-[11px] text-[var(--text-muted)] block truncate">
                  Wipe home icon badge & active tray cards
                </span>
              </div>
            </button>
          </div>

          {notifFeedback && (
            <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--text)] font-ui leading-relaxed">
              {notifFeedback}
            </div>
          )}
        </div>

        {/* ONESIGNAL FREE BACKGROUND PUSH (100% AUTOMATIC / NO MANUAL SETUP) */}
        <div className="p-4 sm:p-5 rounded-2xl bg-[var(--surface)] border-2 border-[var(--border)] shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b-2 border-[var(--border)]">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-500 shrink-0" />
              <h3 className="font-chunky text-sm font-bold text-[var(--text)]">
                Background Push Notifications
              </h3>
            </div>
            <span className="text-[11px] font-ui font-bold px-2.5 py-0.5 rounded-full border bg-emerald-500/15 text-emerald-600 border-emerald-500/30 shrink-0 whitespace-nowrap self-start sm:self-center">
              Automated & Active ✓
            </span>
          </div>

          <p className="font-clean text-xs text-[var(--text-muted)] leading-relaxed">
            Calls, messages, and nudges wake up the other person's phone even when the AV app is completely closed or locked. Powered automatically via OneSignal Web Push — <strong>no manual connection or credit card needed</strong>.
          </p>

          <div className="p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)]">Background Push Service:</span>
              <span className="font-bold text-emerald-600 flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Automated & Ready
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)]">TARGET USER:</span>
              <span className="font-bold text-[var(--text)]">
                {partnerUser?.displayName || 'Vidhi'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <button
              type="button"
              disabled={oneSignalTesting}
              onClick={async () => {
                setOneSignalTesting(true);
                setOneSignalTestResult(null);
                try {
                  const targetId = partnerUser?.id;
                  if (!targetId) {
                    setOneSignalTestResult('Vidhi / Aryan not connected yet');
                    return;
                  }
                  const res = await sendOneSignalPush({
                    coupleId: couple?.id,
                    targetUserId: targetId,
                    title: 'AV Signal Test',
                    body: `${currentUser.displayName || 'Aryan'} sent a test background push!`,
                    type: 'message',
                  });
                  setOneSignalTestResult(
                    res.requestAccepted
                      ? (res.recipients && res.recipients > 0
                          ? 'Request accepted by OneSignal (targeted active device) ✓'
                          : 'Request accepted by OneSignal (no active subscriber device linked)')
                      : `Push request not accepted: ${res.reason || 'check configuration'}`
                  );
                } finally {
                  setOneSignalTesting(false);
                }
              }}
              className="px-4 py-2 rounded-xl bg-[var(--accent)] hover:opacity-90 font-bold text-xs text-white cursor-pointer transition-all shadow-xs disabled:opacity-50"
            >
              {oneSignalTesting ? 'Sending test...' : 'SEND TEST PUSH'}
            </button>
          </div>

          {oneSignalTestResult && (
            <span className="text-[11px] font-bold text-[var(--text)] block mt-1">
              {oneSignalTestResult}
            </span>
          )}

          {/* Synchronized configuration info */}
          <details className="text-[11px] text-[var(--text-muted)] pt-1">
            <summary className="cursor-pointer hover:text-[var(--text)] font-semibold select-none">
              Push Diagnostics & App Configuration
            </summary>
            <div className="mt-3 space-y-2 p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
              <div>
                <label className="block mb-1 font-bold">Synchronized OneSignal App ID</label>
                <div className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] font-mono text-[11px] text-[var(--text-muted)] truncate select-all">
                  {getOneSignalConfig().appId}
                </div>
                <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                  Active production App ID synchronized between client PWA and Firebase Cloud Functions.
                </p>
              </div>
            </div>
          </details>
        </div>

        {/* SECTION E2: MESSAGES */}
        <div className="p-4 sm:p-5 rounded-2xl bg-[var(--surface)] border-2 border-[var(--border)] shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b-2 border-[var(--border)]">
            <MessageCircle className="w-4 h-4 text-[var(--partner-a)]" />
            <h3 className="font-chunky text-sm font-bold text-[var(--text)]">
              1. Messages & Chat
            </h3>
          </div>

          {/* Sound choice row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="font-clean text-xs font-bold text-[var(--text)] block">
                Incoming Message Tone: {getSoundName(soundSettings.messageSoundId)}
              </span>
              <span className="font-clean text-[11px] text-[var(--text-muted)]">
                Tone played when another user sends a note
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleTogglePreview(soundSettings.messageSoundId, 'message')}
                className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-xl bg-[var(--surface-2)] border-2 border-[var(--border)] flex items-center justify-center text-[var(--text)] hover:bg-[var(--surface)] cursor-pointer"
                aria-label="Preview message sound"
              >
                {previewingId === soundSettings.messageSoundId ? (
                  <Square className="w-4 h-4 fill-current text-[var(--urgent)]" />
                ) : (
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() =>
                  setChooserConfig({
                    isOpen: true,
                    title: 'Choose Message Sound',
                    category: 'message',
                    selectedSoundId: soundSettings.messageSoundId,
                    onSelectSound: (sid) => updateSettings({ messageSoundId: sid }),
                  })
                }
                className="h-11 min-h-[44px] px-3.5 rounded-xl bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] font-chunky text-xs font-bold shadow-xs active:translate-y-0.5 cursor-pointer flex items-center gap-1.5"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Change Sound</span>
              </button>
            </div>
          </div>

          {/* Message Volume Slider */}
          <div className="flex items-center justify-between gap-3 pt-2">
            <span className="text-xs font-clean font-semibold text-[var(--text-muted)] flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5" />
              <span>Volume</span>
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={soundSettings.messageVolume}
              onChange={(e) => updateSettings({ messageVolume: Number(e.target.value) })}
              className="w-36 accent-[var(--accent)] cursor-pointer"
              aria-label="Message tone volume"
            />
            <span className="font-numeric text-xs font-bold text-[var(--text)] w-8 text-right">
              {Math.round(soundSettings.messageVolume * 100)}%
            </span>
          </div>

          {/* Vibration Pattern Selection */}
          <div className="pt-2 border-t border-[var(--border)]">
            <span className="text-xs font-clean font-semibold text-[var(--text-muted)] block mb-1.5">
              Vibration Pattern:
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: 'off', label: 'Off' },
                { id: 'short', label: 'Short' },
                { id: 'double', label: 'Double' },
                { id: 'long', label: 'Long' },
              ].map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => updateSettings({ messageVibration: v.id as any })}
                  className={`py-2 px-3 rounded-xl border-2 font-ui text-xs font-bold transition-all cursor-pointer min-h-[44px] flex items-center justify-center ${
                    soundSettings.messageVibration === v.id
                      ? 'bg-[var(--accent)] text-[var(--text)] border-[var(--border)] shadow-xs'
                      : 'bg-[var(--surface-2)] border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          {/* Preview Content Mode */}
          <div className="pt-2 border-t border-[var(--border)]">
            <span className="text-xs font-clean font-semibold text-[var(--text-muted)] block mb-1.5">
              Notification Content Privacy:
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[
                { id: 'full', label: 'Show message text' },
                { id: 'sender_only', label: 'Show sender only' },
                { id: 'hidden', label: 'Hide all content' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => updateSettings({ messagePreviewMode: p.id as any })}
                  className={`py-2 px-3 rounded-xl border-2 font-ui text-xs font-semibold transition-all cursor-pointer min-h-[44px] flex items-center justify-center ${
                    soundSettings.messagePreviewMode === p.id
                      ? 'bg-[var(--accent)] text-[var(--text)] border-[var(--border)] font-bold shadow-xs'
                      : 'bg-[var(--surface-2)] border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* SECTION E2.2: REACTIONS */}
        <div className="p-4 sm:p-5 rounded-2xl bg-[var(--surface)] border-2 border-[var(--border)] shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b-2 border-[var(--border)]">
            <Sparkles className="w-4 h-4 text-[var(--accent)]" />
            <h3 className="font-chunky text-sm font-bold text-[var(--text)]">
              2. Reactions
            </h3>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="font-clean text-xs font-bold text-[var(--text)] block">
                Reaction Sound: {getSoundName(soundSettings.reactionSoundId)}
              </span>
              <span className="font-clean text-[11px] text-[var(--text-muted)]">
                Audio pop when either person taps an emoji reaction
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleTogglePreview(soundSettings.reactionSoundId, 'message')}
                className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-xl bg-[var(--surface-2)] border-2 border-[var(--border)] flex items-center justify-center text-[var(--text)] hover:bg-[var(--surface)] cursor-pointer"
                aria-label="Preview reaction sound"
              >
                {previewingId === soundSettings.reactionSoundId ? (
                  <Square className="w-4 h-4 fill-current text-[var(--urgent)]" />
                ) : (
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() =>
                  setChooserConfig({
                    isOpen: true,
                    title: 'Choose Reaction Sound',
                    category: 'message',
                    selectedSoundId: soundSettings.reactionSoundId,
                    onSelectSound: (sid) => updateSettings({ reactionSoundId: sid }),
                  })
                }
                className="h-11 min-h-[44px] px-3.5 rounded-xl bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] font-chunky text-xs font-bold shadow-xs active:translate-y-0.5 cursor-pointer flex items-center gap-1.5"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Change Sound</span>
              </button>
            </div>
          </div>
        </div>

        {/* SECTION E3: CALLS & RINGTONES */}
        <div className="p-4 sm:p-5 rounded-2xl bg-[var(--surface)] border-2 border-[var(--border)] shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b-2 border-[var(--border)]">
            <Phone className="w-4 h-4 text-[var(--partner-b)]" />
            <h3 className="font-chunky text-sm font-bold text-[var(--text)]">
              3. Calls & Ringtones
            </h3>
          </div>

          {/* Incoming Ringtone Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="font-clean text-xs font-bold text-[var(--text)] block">
                Incoming Call Ringtone: {getSoundName(soundSettings.incomingRingtoneId)}
              </span>
              <span className="font-clean text-[11px] text-[var(--text-muted)]">
                Loops until answered or declined (up to 45 seconds)
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleTogglePreview(soundSettings.incomingRingtoneId, 'ringtone')}
                className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-xl bg-[var(--surface-2)] border-2 border-[var(--border)] flex items-center justify-center text-[var(--text)] hover:bg-[var(--surface)] cursor-pointer"
                aria-label="Preview incoming ringtone"
              >
                {previewingId === soundSettings.incomingRingtoneId ? (
                  <Square className="w-4 h-4 fill-current text-[var(--urgent)]" />
                ) : (
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() =>
                  setChooserConfig({
                    isOpen: true,
                    title: 'Choose Incoming Ringtone',
                    category: 'ringtone',
                    selectedSoundId: soundSettings.incomingRingtoneId,
                    onSelectSound: (sid) => updateSettings({ incomingRingtoneId: sid }),
                  })
                }
                className="h-11 min-h-[44px] px-3.5 rounded-xl bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] font-chunky text-xs font-bold shadow-xs active:translate-y-0.5 cursor-pointer flex items-center gap-1.5"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Change Ringtone</span>
              </button>
            </div>
          </div>

          {/* Call Volume Slider */}
          <div className="flex items-center justify-between gap-3 pt-2">
            <span className="text-xs font-clean font-semibold text-[var(--text-muted)] flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5" />
              <span>Ringtone Volume</span>
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={soundSettings.callVolume}
              onChange={(e) => updateSettings({ callVolume: Number(e.target.value) })}
              className="w-36 accent-[var(--accent)] cursor-pointer"
              aria-label="Ringtone volume"
            />
            <span className="font-numeric text-xs font-bold text-[var(--text)] w-8 text-right">
              {Math.round(soundSettings.callVolume * 100)}%
            </span>
          </div>

          {/* Outgoing Ringback Tone */}
          <div className="pt-2 border-t border-[var(--border)]">
            <span className="text-xs font-clean font-semibold text-[var(--text-muted)] block mb-1.5">
              Outgoing Ringback (what you hear while calling):
            </span>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'ring-classic', label: 'Classic 📞' },
                { id: 'ring-marimba', label: 'Marimba 🎵' },
                { id: 'ring-silent', label: 'Silent' },
              ].map((rb) => (
                <button
                  key={rb.id}
                  type="button"
                  onClick={() => updateSettings({ ringbackToneId: rb.id })}
                  className={`py-2 px-3 rounded-xl border-2 font-ui text-xs font-bold transition-all cursor-pointer min-h-[44px] flex items-center justify-center ${
                    soundSettings.ringbackToneId === rb.id
                      ? 'bg-[var(--accent)] text-[var(--text)] border-[var(--border)] shadow-xs'
                      : 'bg-[var(--surface-2)] border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {rb.label}
                </button>
              ))}
            </div>
          </div>

          {/* Call Quiet Hours Override */}
          <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
            <div>
              <span className="font-clean text-xs font-bold text-[var(--text)] block">
                Let Calls Ring During Quiet Hours
              </span>
              <span className="font-clean text-[11px] text-[var(--text-muted)]">
                Keeps critical calls ringing even if do-not-disturb is active
              </span>
            </div>

            <button
              type="button"
              onClick={() => updateSettings({ ringDuringQuietHours: !soundSettings.ringDuringQuietHours })}
              className={`w-14 h-8 rounded-full border-2 border-[var(--border)] p-1 transition-colors relative cursor-pointer min-h-[32px] ${
                soundSettings.ringDuringQuietHours ? 'bg-[var(--success)]' : 'bg-[var(--surface-2)]'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-[var(--text)] transition-transform ${
                  soundSettings.ringDuringQuietHours ? 'translate-x-6 bg-white' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* SECTION E4: TASKS AND REMINDERS */}
        <div className="p-4 sm:p-5 rounded-2xl bg-[var(--surface)] border-2 border-[var(--border)] shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b-2 border-[var(--border)]">
            <CalendarCheck className="w-4 h-4 text-[var(--success)]" />
            <h3 className="font-chunky text-sm font-bold text-[var(--text)]">
              4. Tasks & Alarms
            </h3>
          </div>

          {/* Default Task Alarm Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="font-clean text-xs font-bold text-[var(--text)] block">
                Default Alarm Sound: {getSoundName(soundSettings.taskAlarmSoundId)}
              </span>
              <span className="font-clean text-[11px] text-[var(--text-muted)]">
                Tone played for mission reminders in your timezone
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleTogglePreview(soundSettings.taskAlarmSoundId, 'alarm')}
                className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-xl bg-[var(--surface-2)] border-2 border-[var(--border)] flex items-center justify-center text-[var(--text)] hover:bg-[var(--surface)] cursor-pointer"
                aria-label="Preview task alarm sound"
              >
                {previewingId === soundSettings.taskAlarmSoundId ? (
                  <Square className="w-4 h-4 fill-current text-[var(--urgent)]" />
                ) : (
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() =>
                  setChooserConfig({
                    isOpen: true,
                    title: 'Choose Task Alarm Sound',
                    category: 'alarm',
                    selectedSoundId: soundSettings.taskAlarmSoundId,
                    onSelectSound: (sid) => updateSettings({ taskAlarmSoundId: sid }),
                  })
                }
                className="h-11 min-h-[44px] px-3.5 rounded-xl bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] font-chunky text-xs font-bold shadow-xs active:translate-y-0.5 cursor-pointer flex items-center gap-1.5"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Change Sound</span>
              </button>
            </div>
          </div>

          {/* Urgent Priority Override Sound */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <div>
              <span className="font-clean text-xs font-bold text-[var(--text)] block">
                Urgent Mission Alarm: {getSoundName(soundSettings.urgentTaskAlarmSoundId)}
              </span>
              <span className="font-clean text-[11px] text-[var(--text-muted)]">
                Distinct high-priority alarm for critical deadlines
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleTogglePreview(soundSettings.urgentTaskAlarmSoundId, 'alarm')}
                className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-xl bg-[var(--surface-2)] border-2 border-[var(--border)] flex items-center justify-center text-[var(--text)] hover:bg-[var(--surface)] cursor-pointer"
                aria-label="Preview urgent alarm sound"
              >
                {previewingId === soundSettings.urgentTaskAlarmSoundId ? (
                  <Square className="w-4 h-4 fill-current text-[var(--urgent)]" />
                ) : (
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() =>
                  setChooserConfig({
                    isOpen: true,
                    title: 'Choose Urgent Alarm Sound',
                    category: 'alarm',
                    selectedSoundId: soundSettings.urgentTaskAlarmSoundId,
                    onSelectSound: (sid) => updateSettings({ urgentTaskAlarmSoundId: sid }),
                  })
                }
                className="h-11 min-h-[44px] px-3.5 rounded-xl bg-[var(--urgent)] text-white border-2 border-[var(--border)] font-chunky text-xs font-bold shadow-xs active:translate-y-0.5 cursor-pointer flex items-center gap-1.5"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Change Urgent</span>
              </button>
            </div>
          </div>

          {/* Alarm Style Selection */}
          <div className="pt-2 border-t border-[var(--border)]">
            <span className="text-xs font-clean font-semibold text-[var(--text-muted)] block mb-1.5">
              Alarm Behavior:
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[
                { id: 'once', label: 'Play Once' },
                { id: 'repeat_2min', label: 'Repeat (up to 2 min)' },
                { id: 'escalating', label: 'Escalating Volume' },
              ].map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => updateSettings({ alarmStyle: st.id as any })}
                  className={`py-2 px-3 rounded-xl border-2 font-ui text-xs font-semibold transition-all cursor-pointer min-h-[44px] flex items-center justify-center ${
                    soundSettings.alarmStyle === st.id
                      ? 'bg-[var(--accent)] text-[var(--text)] border-[var(--border)] font-bold shadow-xs'
                      : 'bg-[var(--surface-2)] border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>

          {/* Honest Limitation Information Banner */}
          <div className="p-3.5 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] text-xs font-ui text-[var(--text-muted)] flex items-start gap-2.5">
            <Info className="w-4 h-4 text-[var(--accent)] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold text-[var(--text)] block">
                How notifications work on mobile & desktop:
              </span>
              <p>
                When Duo is open or active in a background browser tab, your chosen personalized sounds and ringtones play at full volume. When the app is closed or your device is locked, system notifications use your phone's default tone.
              </p>
            </div>
          </div>
        </div>

        {/* Quiet Hours Inputs */}
        <div className="p-4 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-[var(--accent)]" />
            <h4 className="font-chunky text-xs font-bold text-[var(--text)]">
              Quiet Hours (Do-Not-Disturb)
            </h4>
          </div>
          <p className="font-ui text-xs text-[var(--text-muted)]">
            Non-urgent mission reminders wait until quiet hours end in your timezone.
          </p>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block font-clean text-xs font-semibold text-[var(--text-muted)] mb-1">
                Quiet Starts
              </label>
              <input
                type="time"
                value={currentUser.quietHoursStart}
                onChange={(e) => setCurrentUser({ quietHoursStart: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-[var(--surface)] border-2 border-[var(--border)] text-[var(--text)] font-numeric text-xs font-semibold"
              />
            </div>

            <div>
              <label className="block font-clean text-xs font-semibold text-[var(--text-muted)] mb-1">
                Quiet Ends
              </label>
              <input
                type="time"
                value={currentUser.quietHoursEnd}
                onChange={(e) => setCurrentUser({ quietHoursEnd: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-[var(--surface)] border-2 border-[var(--border)] text-[var(--text)] font-numeric text-xs font-semibold"
              />
            </div>
          </div>
        </div>

        {/* Profile & Period Tracking Role */}
        <div className="p-4 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-base">🌸</span>
            <h4 className="font-chunky text-xs font-bold text-[var(--text)]">
              Period Tracking Profile & Role
            </h4>
          </div>
          <p className="font-ui text-xs text-[var(--text-muted)]">
            Sets who logs period symptoms & cravings vs who receives alerts and care tips:
          </p>

          <div className="flex rounded-xl bg-[var(--surface)] p-1 border-2 border-[var(--border)]">
            {(
              [
                { id: 'female', label: 'Vidhi (Cycle Tracker) 🌸' },
                { id: 'male', label: 'Aryan (Supportive Partner) 💙' },
                { id: 'other', label: 'Other ✨' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  soundEngine.play('msg-pop', { force: true });
                  setCurrentUser({ gender: opt.id });
                }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-ui font-bold transition-all cursor-pointer ${
                  currentUser.gender === opt.id
                    ? 'bg-[var(--partner-a)] text-white shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Test Alert Sound Button */}
        <div className="pt-3 border-t-2 border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <span className="font-ui text-xs text-[var(--text-muted)] leading-relaxed">
            Verify that your device alerts work properly:
          </span>
          <button
            type="button"
            onClick={() => {
              soundEngine.play('msg-chime', { force: true });
            }}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] font-chunky text-xs font-bold shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 cursor-pointer shrink-0 min-h-[44px] flex items-center justify-center gap-1.5"
          >
            <span>Play Test Sound 🔔</span>
          </button>
        </div>
      </div>

      {/* 5. DESKTOP COMPANION WIDGET */}
      <div className="bg-[var(--surface)] rounded-3xl p-6 sm:p-7 border-3 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)] flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] flex items-center justify-center text-[var(--text)] shadow-[0_2px_0_var(--shadow-color)]">
            <Laptop className="w-5 h-5 text-[var(--partner-b)]" />
          </div>
          <div>
            <h3 className="font-chunky font-bold text-base text-[var(--text)]">Desktop Companion Widget</h3>
            <p className="font-clean text-xs text-[var(--text-muted)]">
              Pin a mini floating window on your computer screen
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={openDedicatedPopout}
          className="px-4 py-2.5 rounded-2xl bg-[var(--surface-2)] hover:bg-[var(--accent)]/30 border-2 border-[var(--border)] text-[var(--text)] font-chunky font-bold text-xs flex items-center gap-1.5 shadow-[0_2px_0_var(--shadow-color)] active:translate-y-1 active:shadow-none transition-all cursor-pointer shrink-0 min-h-[44px]"
        >
          <ExternalLink className="w-3.5 h-3.5 text-[var(--partner-a)]" />
          <span>Launch Popout</span>
        </button>
      </div>

      {/* 6. PAIRING & SECURITY STATUS */}
      <div className="bg-[var(--surface)] rounded-3xl p-6 sm:p-7 border-3 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)]">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-9 h-9 rounded-2xl bg-[var(--accent)] border-2 border-[var(--border)] flex items-center justify-center text-[var(--text)] shadow-[0_2px_0_var(--shadow-color)]">
            <KeyRound className="w-5 h-5" />
          </div>
          <h2 className="text-xl font-chunky font-bold text-[var(--text)]">AV Private Space & Lock</h2>
        </div>

        <div className="bg-[var(--surface-2)] border-2 border-[var(--border)] rounded-2xl p-4 flex items-center justify-between gap-4 mb-3">
          <div>
            <div className="font-clean text-xs text-[var(--text-muted)] uppercase font-semibold mb-0.5">
              Access Secret Code
            </div>
            <div className="text-3xl font-numeric font-bold text-[var(--text)] tracking-widest">
              {couple?.inviteCode || 'K7M2QX'}
            </div>
            <div className="font-clean text-xs text-[var(--partner-a)] font-bold mt-1">
              {couple?.locked ? 'AV LOCKED: ARYAN & VIDHI ACTIVE' : 'WAITING FOR VIDHI / ARYAN'}
            </div>
          </div>

          <button
            onClick={handleCopyCode}
            className="px-4 py-2.5 rounded-2xl bg-[var(--surface)] hover:bg-[var(--surface-2)] border-2 border-[var(--border)] text-[var(--text)] font-chunky font-bold text-xs flex items-center gap-1.5 shadow-[0_2px_0_var(--shadow-color)] active:translate-y-1 active:shadow-none transition-all cursor-pointer min-h-[44px]"
          >
            {copiedCode ? <Check className="w-4 h-4 text-[var(--success)]" /> : <Copy className="w-4 h-4" />}
            <span>{copiedCode ? 'Copied! 🎉' : 'Copy Code'}</span>
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs font-clean font-medium text-[var(--text)] bg-[var(--success)]/10 border-2 border-[var(--success)]/30 px-3.5 py-2.5 rounded-2xl">
          <ShieldCheck className="w-4 h-4 text-[var(--success)] shrink-0" />
          <span>Strict lock active: strictly private to Aryan & Vidhi.</span>
        </div>
      </div>

      {/* 7. BACKUP & EXPORT */}
      <div className="bg-[var(--surface)] rounded-3xl p-6 sm:p-7 border-3 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)] flex items-center justify-between">
        <div>
          <h3 className="font-chunky font-bold text-base text-[var(--text)] mb-0.5">Export Our Journey</h3>
          <p className="font-clean text-xs text-[var(--text-muted)]">Download all our tasks, dreams, scores & chat logs</p>
        </div>

        <button
          onClick={handleExportData}
          className="px-5 py-2.5 rounded-2xl bg-[var(--accent)] hover:opacity-90 border-2 border-[var(--border)] text-[var(--text)] font-chunky font-bold text-xs flex items-center gap-1.5 shadow-[0_2px_0_var(--shadow-color)] active:translate-y-1 active:shadow-none transition-all cursor-pointer min-h-[44px]"
        >
          <Download className="w-4 h-4" />
          <span>Export JSON 📥</span>
        </button>
      </div>

      {/* 8. DANGER ZONE: ACCOUNT & SIGN OUT */}
      <div className="bg-[var(--surface)] rounded-3xl p-6 sm:p-7 border-3 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)] flex items-center justify-between">
        <div>
          <h3 className="font-chunky font-bold text-base text-[var(--urgent)] mb-0.5">Danger Zone</h3>
          <p className="font-clean text-xs text-[var(--text-muted)]">
            Signed in as <span className="font-semibold text-[var(--text)]">{currentUser.displayName}</span>
          </p>
        </div>

        <button
          onClick={async () => {
            await signOut();
            window.location.reload();
          }}
          className="px-5 py-2.5 rounded-2xl bg-[var(--urgent)]/10 hover:bg-[var(--urgent)]/20 border-2 border-[var(--urgent)] text-[var(--urgent)] font-chunky font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-[0_2px_0_var(--urgent)] min-h-[44px]"
        >
          <LogOut className="w-4 h-4" />
          <span>Log Out</span>
        </button>
      </div>
      </div>

      {/* Sound Chooser Modal */}
      {chooserConfig && (
        <SoundChooserModal
          isOpen={chooserConfig.isOpen}
          onClose={() => setChooserConfig(null)}
          title={chooserConfig.title}
          category={chooserConfig.category}
          selectedSoundId={chooserConfig.selectedSoundId}
          onSelectSound={chooserConfig.onSelectSound}
        />
      )}

      {/* Download & Install App Modal */}
      <InstallAppModal
        isOpen={showInstallModal}
        onClose={() => setShowInstallModal(false)}
      />
    </div>
  );
};
