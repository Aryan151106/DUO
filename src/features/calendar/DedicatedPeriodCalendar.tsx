import React, { useState } from 'react';
import {
  format,
  parseISO,
  addDays,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  differenceInDays,
} from 'date-fns';
import {
  CalendarHeart,
  Droplets,
  Heart,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  X,
  Send,
  Check,
  Lock,
  Coffee,
} from 'lucide-react';
import type { PeriodTracker, PeriodFeelingLog } from '../../lib/dataStore';
import { duoDataStore } from '../../lib/dataStore';
import { useAuthStore } from '../../lib/store';
import { useNotificationStore } from '../../lib/notifications';
import { sendMessage } from '../../lib/firestore';
import { soundEffects } from '../../lib/sound';
import confetti from 'canvas-confetti';

interface DedicatedPeriodCalendarProps {
  isOpen: boolean;
  onClose: () => void;
  tracker: PeriodTracker | null;
  onSave: (tracker: PeriodTracker) => Promise<void> | void;
}

const COMMON_FEELINGS = [
  { id: 'cramps', label: 'Cramps 😣' },
  { id: 'fatigue', label: 'Tired / Low Energy 😴' },
  { id: 'bloated', label: 'Bloated 🎈' },
  { id: 'headache', label: 'Headache 🤕' },
  { id: 'mood_swings', label: 'Mood Swings 🥺' },
  { id: 'cuddles', label: 'Need Cuddles 🫂' },
  { id: 'back_pain', label: 'Lower Back Pain 🩹' },
  { id: 'sensitive', label: 'Emotional / Sensitive 🥺' },
  { id: 'sweet_soft', label: 'Gentle & Soft 🥰' },
  { id: 'calm', label: 'Calm & Cozy 🌸' },
];

const COMMON_CRAVINGS = [
  { id: 'chocolate', label: 'Chocolate 🍫' },
  { id: 'ice_cream', label: 'Ice Cream 🍦' },
  { id: 'salty_fries', label: 'Salty Fries 🍟' },
  { id: 'warm_ramen', label: 'Warm Ramen 🍜' },
  { id: 'pizza', label: 'Cheesy Pizza 🍕' },
  { id: 'warm_soup', label: 'Hot Soup 🍲' },
  { id: 'pastries', label: 'Pastries & Sweets 🥐' },
  { id: 'boba', label: 'Boba Tea 🧋' },
  { id: 'sour_candy', label: 'Sour Candy 🍬' },
  { id: 'warm_tea', label: 'Herbal Tea 🍵' },
];

export const DedicatedPeriodCalendar: React.FC<DedicatedPeriodCalendarProps> = ({
  isOpen,
  onClose,
  tracker,
  onSave,
}) => {
  const { currentUser, partnerUser, couple, isDemoMode } = useAuthStore();
  const [currentMonth, setCurrentMonth] = useState<Date>(() => new Date());

  // Setup / Editing state
  const [isEditingSetup, setIsEditingSetup] = useState(false);
  const [lastPeriodDate, setLastPeriodDate] = useState(tracker?.lastPeriodDate || format(new Date(), 'yyyy-MM-dd'));
  const [cycleLength, setCycleLength] = useState(String(tracker?.cycleLength || 28));
  const [periodLength, setPeriodLength] = useState(String(tracker?.periodLength || 5));

  // Feelings & Cravings state (exclusively for female user)
  const [selectedFeelings, setSelectedFeelings] = useState<string[]>([]);
  const [selectedCravings, setSelectedCravings] = useState<string[]>([]);
  const [customNote, setCustomNote] = useState('');
  const [isSendingUpdate, setIsSendingUpdate] = useState(false);
  const [sentSuccessFeedback, setSentSuccessFeedback] = useState(false);

  // Selected date on the calendar to view past logs
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<Date>(new Date());
  const [activeTab, setActiveTab] = useState<'calendar' | 'feelings'>('calendar');

  if (!isOpen) return null;

  // Determine if the current viewer is the female partner
  const isFemale =
    currentUser.gender === 'female' ||
    (!currentUser.gender && partnerUser.gender === 'male') ||
    tracker?.femaleUserId === currentUser.id;

  // Determine female user's display name
  const femaleDisplayName = isFemale
    ? currentUser.displayName
    : partnerUser.gender === 'female'
    ? partnerUser.displayName
    : 'Vidhi';

  // Cycle Calculations
  const cycleDays = Math.min(60, Math.max(18, Number(cycleLength) || 28));
  const flowDays = Math.min(14, Math.max(1, Number(periodLength) || 5));

  const lastStart = tracker?.lastPeriodDate ? parseISO(tracker.lastPeriodDate) : null;
  const nextStart = lastStart ? addDays(lastStart, tracker?.cycleLength || cycleDays) : null;

  // Days since last period started
  const today = new Date();
  const dayOfCycle = lastStart ? differenceInDays(today, lastStart) + 1 : null;
  const daysUntilNext = nextStart ? differenceInDays(nextStart, today) : null;

  // Current Cycle Phase
  let phaseName = 'Follicular Phase';
  let phaseEmoji = '🌿';
  let phaseDesc = 'Rising energy, focus, and creativity.';
  let careTip = 'Great time for fun dates, trying new recipes, and active adventures together!';

  if (dayOfCycle !== null && dayOfCycle > 0) {
    if (dayOfCycle <= flowDays) {
      phaseName = 'Menstrual Phase';
      phaseEmoji = '🩸';
      phaseDesc = 'Rest, renewal, and gentle warmth.';
      careTip = 'Bring her favorite snacks, warm tea, a hot water bottle, and infinite gentle hugs!';
    } else if (dayOfCycle < Math.round(cycleDays / 2) - 2) {
      phaseName = 'Follicular Phase';
      phaseEmoji = '🌿';
      phaseDesc = 'Rising energy, optimism, and fresh motivation.';
      careTip = 'Plan something exciting! Energy is climbing and spirits are bright.';
    } else if (dayOfCycle <= Math.round(cycleDays / 2) + 2) {
      phaseName = 'Ovulation Window';
      phaseEmoji = '🌸';
      phaseDesc = 'Peak glow, warmth, and connection.';
      careTip = 'High romantic energy! Plan a candlelit dinner or romantic movie night.';
    } else {
      phaseName = 'Luteal Phase';
      phaseEmoji = '🌙';
      phaseDesc = 'Winding down, cravings, and cozy nesting.';
      careTip = 'Be extra patient and cozy. Stock comfort foods and offer back rubs & soothing tea.';
    }
  }

  // Days in current viewed month
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const daysInGrid = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  // Helper to check day classifications
  const isPeriodDay = (day: Date) => {
    if (!lastStart) return false;
    // Check multiple cycle iterations (past and future)
    for (let c = -2; c <= 3; c++) {
      const cycleDate = addDays(lastStart, c * cycleDays);
      const diff = differenceInDays(day, cycleDate);
      if (diff >= 0 && diff < flowDays) {
        return c === 0 ? 'current' : c > 0 ? 'predicted' : 'past';
      }
    }
    return null;
  };

  const isOvulationDay = (day: Date) => {
    if (!lastStart) return false;
    for (let c = -2; c <= 3; c++) {
      const cycleDate = addDays(lastStart, c * cycleDays);
      const ovulationDay = addDays(cycleDate, Math.round(cycleDays / 2));
      const diff = Math.abs(differenceInDays(day, ovulationDay));
      if (diff <= 1) return true;
    }
    return false;
  };

  // Find logs for a specific day
  const logsForDay = (day: Date) => {
    const dStr = format(day, 'yyyy-MM-dd');
    return (tracker?.logs || []).filter((l) => l.date === dStr);
  };

  const selectedDayLogs = logsForDay(selectedCalendarDate);

  // Toggle feelings selection
  const toggleFeeling = (item: string) => {
    soundEffects.playPop();
    setSelectedFeelings((prev) =>
      prev.includes(item) ? prev.filter((f) => f !== item) : [...prev, item]
    );
  };

  // Toggle craving selection
  const toggleCraving = (item: string) => {
    soundEffects.playPop();
    setSelectedCravings((prev) =>
      prev.includes(item) ? prev.filter((c) => c !== item) : [...prev, item]
    );
  };

  // Save Settings
  const handleSaveSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lastPeriodDate) return;
    soundEffects.playSuccess();
    await onSave({
      lastPeriodDate,
      cycleLength: Math.min(60, Math.max(18, Number(cycleLength) || 28)),
      periodLength: Math.min(14, Math.max(1, Number(periodLength) || 5)),
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser.id,
      femaleUserId: isFemale ? currentUser.id : tracker?.femaleUserId || partnerUser.id,
      logs: tracker?.logs || [],
    });
    setIsEditingSetup(false);
  };

  // Log "Period started today"
  const handlePeriodStartedToday = async () => {
    soundEffects.playSuccess();
    confetti({ particleCount: 40, spread: 50, origin: { y: 0.6 } });
    const todayFormatted = format(new Date(), 'yyyy-MM-dd');
    setLastPeriodDate(todayFormatted);
    await onSave({
      lastPeriodDate: todayFormatted,
      cycleLength: tracker?.cycleLength || 28,
      periodLength: tracker?.periodLength || 5,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser.id,
      femaleUserId: isFemale ? currentUser.id : tracker?.femaleUserId || partnerUser.id,
      logs: tracker?.logs || [],
    });
  };

  // Dispatch feeling & craving update to partner (both chat message & notification)
  const handleSendFeelingsAndCravings = async () => {
    if (selectedFeelings.length === 0 && selectedCravings.length === 0 && !customNote.trim()) {
      return;
    }

    setIsSendingUpdate(true);
    soundEffects.playSuccess();
    confetti({ particleCount: 45, spread: 60, origin: { y: 0.7 } });

    const feelingsText = selectedFeelings.join(', ');
    const cravingsText = selectedCravings.join(', ');
    const todayFormatted = format(new Date(), 'yyyy-MM-dd');

    // 1. Construct rich chat message
    let messageContent = `🌸 Period Update from ${currentUser.displayName}:\n`;
    if (feelingsText) messageContent += `• Feeling: ${feelingsText}\n`;
    if (cravingsText) messageContent += `• Craving: ${cravingsText}\n`;
    if (customNote.trim()) messageContent += `• Note: "${customNote.trim()}"`;

    // 2. Create log entry
    const newLog: PeriodFeelingLog = {
      id: `log-${Date.now()}`,
      date: todayFormatted,
      feelings: [...selectedFeelings],
      cravings: [...selectedCravings],
      note: customNote.trim() || undefined,
      createdAt: new Date().toISOString(),
      createdBy: currentUser.id,
    };

    const updatedLogs = [newLog, ...(tracker?.logs || [])];

    // Save to tracker state
    await onSave({
      lastPeriodDate: tracker?.lastPeriodDate || todayFormatted,
      cycleLength: tracker?.cycleLength || 28,
      periodLength: tracker?.periodLength || 5,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser.id,
      femaleUserId: currentUser.id,
      logs: updatedLogs,
    });

    // 3. Dispatch text message into couple's chat
    try {
      if (!isDemoMode && couple?.id) {
        await sendMessage(couple.id, {
          senderId: currentUser.id,
          content: messageContent,
          messageType: 'text',
        });
      } else {
        const msgs = duoDataStore.getMessages();
        duoDataStore.saveMessages([
          ...msgs,
          {
            id: `msg-${Date.now()}`,
            couple_id: 'couple-duo-main',
            sender_id: currentUser.id,
            content: messageContent,
            message_type: 'text',
            created_at: new Date().toISOString(),
          },
        ]);
      }
    } catch (e) {
      console.warn('Failed to dispatch period chat message:', e);
    }

    // 4. Dispatch notification & push to partner
    try {
      await useNotificationStore.getState().sendNotification({
        coupleId: couple?.id || 'couple-duo-main',
        senderId: currentUser.id,
        senderName: currentUser.displayName,
        type: 'message',
        title: `${currentUser.displayName} shared a period update 🌸`,
        body: `Craving: ${cravingsText || 'Comfort food'} | Feeling: ${feelingsText || 'Cramps'}`,
        deepLink: '/?action=calendar',
      });
    } catch (e) {
      console.warn('Failed to send period push notification:', e);
    }

    setIsSendingUpdate(false);
    setSentSuccessFeedback(true);
    setSelectedFeelings([]);
    setSelectedCravings([]);
    setCustomNote('');

    setTimeout(() => setSentSuccessFeedback(false), 4000);
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-in fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card max-w-4xl w-full p-3.5 sm:p-7 relative border-3 border-[var(--border)] shadow-[0_6px_0_var(--shadow-color)] my-auto max-h-[94vh] overflow-y-auto scrollbar-none"
      >
        {/* Top Header */}
        <div className="flex items-start justify-between gap-2.5 sm:gap-4 pb-3 sm:pb-4 border-b-2 border-[var(--border)]">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-rose-500/20 border-2 border-rose-500/40 flex items-center justify-center text-rose-500 shrink-0">
              <CalendarHeart className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.5]" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <h2 className="font-display text-base sm:text-2xl font-bold text-[var(--text)] truncate">
                  Period Tracker & Cycle Calendar
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-chunky font-bold bg-rose-500/15 text-rose-500 border border-rose-500/30 whitespace-nowrap">
                  Shared Privately 🌸
                </span>
              </div>
              <p className="text-[11px] sm:text-xs font-ui text-[var(--text-muted)] mt-0.5 line-clamp-1 sm:line-clamp-none">
                Always accessible to both partners so you stay in sync, understand her cycle, and care for each other.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 sm:p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5 stroke-[2.5]" />
          </button>
        </div>

        {/* Cycle Phase & Quick Stats Row - Horizontal 3-Column Grid */}
        {tracker?.lastPeriodDate && (
          <div className="grid grid-cols-3 gap-2 sm:gap-3.5 my-3 sm:my-5">
            {/* 1. Current Phase Card */}
            <div className="p-2 sm:p-4 rounded-xl sm:rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] flex items-center gap-1.5 sm:gap-3 min-w-0">
              <span className="text-xl sm:text-3xl shrink-0">{phaseEmoji}</span>
              <div className="min-w-0">
                <span className="text-[9px] sm:text-[11px] font-ui font-bold uppercase tracking-wider text-[var(--text-muted)] truncate block">
                  Phase
                </span>
                <h4 className="font-chunky text-xs sm:text-base font-bold text-[var(--text)] leading-tight truncate">
                  {phaseName}
                </h4>
                <p className="text-[11px] font-ui text-[var(--text-muted)] mt-0.5 line-clamp-1 hidden md:block">
                  {phaseDesc}
                </p>
              </div>
            </div>

            {/* 2. Cycle Day Card */}
            <div className="p-2 sm:p-4 rounded-xl sm:rounded-2xl bg-rose-500/10 border-2 border-rose-500/30 flex items-center gap-1.5 sm:gap-3 min-w-0">
              <div className="w-7 h-7 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-rose-500/20 flex items-center justify-center text-rose-500 font-bold font-numeric text-xs sm:text-base shrink-0">
                {dayOfCycle ? dayOfCycle : '—'}
              </div>
              <div className="min-w-0">
                <span className="text-[9px] sm:text-[11px] font-ui font-bold uppercase tracking-wider text-rose-500 truncate block">
                  Cycle Day
                </span>
                <h4 className="font-chunky text-xs sm:text-base font-bold text-[var(--text)] leading-tight truncate">
                  {dayOfCycle ? `Day ${dayOfCycle}` : 'Calc...'}
                </h4>
                <p className="text-[10px] sm:text-[11px] font-ui text-[var(--text-muted)] mt-0.5 truncate hidden sm:block">
                  Last: {format(parseISO(tracker.lastPeriodDate), 'MMM d')}
                </p>
              </div>
            </div>

            {/* 3. Estimated Next Period */}
            <div className="p-2 sm:p-4 rounded-xl sm:rounded-2xl bg-[var(--surface)] border-2 border-[var(--border)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 sm:gap-2 min-w-0">
              <div className="min-w-0">
                <span className="text-[9px] sm:text-[11px] font-ui font-bold uppercase tracking-wider text-[var(--text-muted)] truncate block">
                  Next Due
                </span>
                <h4 className="font-chunky text-xs sm:text-base font-bold text-[var(--text)] leading-tight truncate">
                  {daysUntilNext !== null && daysUntilNext >= 0 ? `in ~${daysUntilNext}d` : nextStart ? format(nextStart, 'MMM d') : '—'}
                </h4>
              </div>
              {isFemale && (
                <button
                  type="button"
                  onClick={handlePeriodStartedToday}
                  className="px-2 py-0.5 sm:py-1 rounded-lg sm:rounded-xl bg-rose-500 text-white text-[9px] sm:text-[11px] font-chunky font-bold hover:opacity-90 shadow-xs cursor-pointer shrink-0 truncate"
                  title="Period started today"
                >
                  Started 🩸
                </button>
              )}
            </div>
          </div>
        )}

        {/* Mobile Navigation Tabs: Cycle Calendar vs Cravings/Care */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-[var(--surface-2)] rounded-2xl border-2 border-[var(--border)] lg:hidden my-2.5">
          <button
            type="button"
            onClick={() => {
              soundEffects.playPop();
              setActiveTab('calendar');
            }}
            className={`py-2 text-xs font-chunky font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'calendar'
                ? 'bg-rose-500 text-white border-2 border-rose-600 shadow-xs'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            <CalendarHeart className="w-3.5 h-3.5" />
            <span>Cycle Calendar 📅</span>
          </button>
          <button
            type="button"
            onClick={() => {
              soundEffects.playPop();
              setActiveTab('feelings');
            }}
            className={`py-2 text-xs font-chunky font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'feelings'
                ? 'bg-rose-500 text-white border-2 border-rose-600 shadow-xs'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            <Heart className="w-3.5 h-3.5" />
            <span>{isFemale ? 'Feelings & Cravings 🌸' : 'Care & Updates 💖'}</span>
          </button>
        </div>

        {/* MAIN BODY: 2 Columns on Desktop, Tabbed on Mobile */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_1fr] gap-6 mt-3">
          {/* LEFT: Dedicated Calendar Grid */}
          <div className={activeTab === 'calendar' ? 'space-y-4' : 'hidden lg:block space-y-4'}>
            {/* Month Switcher Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-chunky text-base sm:text-lg font-bold text-[var(--text)]">
                  {format(currentMonth, 'MMMM yyyy')}
                </h3>
                <button
                  type="button"
                  onClick={() => setCurrentMonth(new Date())}
                  className="px-2 py-0.5 rounded-lg bg-[var(--surface-2)] text-[10px] sm:text-[11px] font-ui font-semibold text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
                >
                  Today
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  className="p-1.5 rounded-xl border border-[var(--border)] hover:bg-[var(--surface-2)] text-[var(--text)] cursor-pointer"
                  title="Previous month"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  className="p-1.5 rounded-xl border border-[var(--border)] hover:bg-[var(--surface-2)] text-[var(--text)] cursor-pointer"
                  title="Next month"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Days of week header (Guaranteed 7 Columns) */}
            <div
              style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}
              className="gap-1 text-center font-ui font-bold text-[10px] sm:text-[11px] text-[var(--text-muted)] py-1 uppercase tracking-wider"
            >
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>

            {/* Calendar Days Matrix (Guaranteed 7 Columns) */}
            <div
              style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}
              className="gap-1 sm:gap-1.5"
            >
              {daysInGrid.map((day) => {
                const isCurMonth = isSameMonth(day, currentMonth);
                const isSelected = isSameDay(day, selectedCalendarDate);
                const isToday = isSameDay(day, today);
                const periodStatus = isPeriodDay(day);
                const ovulation = isOvulationDay(day);
                const logs = logsForDay(day);

                let cellBg = 'bg-[var(--surface)] hover:bg-[var(--surface-2)]';
                let cellBorder = 'border-[var(--border)]';

                if (periodStatus === 'current') {
                  cellBg = 'bg-rose-500/20 text-rose-500 font-bold';
                  cellBorder = 'border-rose-500/60 shadow-xs';
                } else if (periodStatus === 'predicted') {
                  cellBg = 'bg-rose-500/10 text-rose-400';
                  cellBorder = 'border-dashed border-rose-500/40';
                } else if (ovulation) {
                  cellBg = 'bg-purple-500/15 text-purple-400 font-bold';
                  cellBorder = 'border-purple-500/40';
                }

                if (isSelected) {
                  cellBorder = 'border-[var(--text)] ring-2 ring-[var(--accent)]';
                }

                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    onClick={() => {
                      soundEffects.playPop();
                      setSelectedCalendarDate(day);
                    }}
                    className={`h-11 sm:h-16 rounded-lg sm:rounded-xl border p-0.5 sm:p-1.5 flex flex-col justify-between transition-all cursor-pointer relative min-w-0 overflow-hidden ${cellBg} ${cellBorder} ${
                      !isCurMonth ? 'opacity-35' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span
                        className={`text-xs font-numeric font-bold ${
                          isToday
                            ? 'w-5 h-5 rounded-full bg-[var(--partner-a)] text-white flex items-center justify-center'
                            : ''
                        }`}
                      >
                        {format(day, 'd')}
                      </span>

                      {periodStatus && (
                        <Droplets className="w-3 h-3 text-rose-500 fill-rose-500" />
                      )}
                      {!periodStatus && ovulation && (
                        <Sparkles className="w-3 h-3 text-purple-500" />
                      )}
                    </div>

                    <div className="flex items-center justify-end gap-1 w-full">
                      {logs.length > 0 && (
                        <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" title="Has cravings/feelings logged" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Legend & Edit Setup Row */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t-2 border-[var(--border)] text-xs font-ui">
              <div className="flex items-center gap-3 flex-wrap text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-md bg-rose-500/30 border border-rose-500/60 inline-block" />
                  <span className="text-[var(--text-muted)]">Period Flow</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-md bg-rose-500/10 border border-dashed border-rose-500/40 inline-block" />
                  <span className="text-[var(--text-muted)]">Next Predicted</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-md bg-purple-500/20 border border-purple-500/50 inline-block" />
                  <span className="text-[var(--text-muted)]">Ovulation Window</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsEditingSetup(!isEditingSetup)}
                className="font-chunky font-bold text-xs text-[var(--partner-a)] hover:underline cursor-pointer"
              >
                {isEditingSetup ? 'Close Setup' : '⚙️ Cycle Settings'}
              </button>
            </div>

            {/* Inline Setup Form */}
            {isEditingSetup && (
              <form onSubmit={handleSaveSetup} className="p-4 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] space-y-3 animate-in fade-in">
                <h4 className="font-chunky font-bold text-xs text-[var(--text)] uppercase tracking-wider">
                  Update Cycle Information
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-ui font-bold text-[var(--text)] mb-1">
                      First Day of Last Period
                    </label>
                    <input
                      type="date"
                      required
                      value={lastPeriodDate}
                      onChange={(e) => setLastPeriodDate(e.target.value)}
                      className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-ui font-bold text-[var(--text)] mb-1">
                      Cycle Length (Days)
                    </label>
                    <input
                      type="number"
                      min="18"
                      max="60"
                      value={cycleLength}
                      onChange={(e) => setCycleLength(e.target.value)}
                      className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-ui font-bold text-[var(--text)] mb-1">
                      Period Length (Days)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="14"
                      value={periodLength}
                      onChange={(e) => setPeriodLength(e.target.value)}
                      className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text)]"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsEditingSetup(false)}
                    className="px-3 py-1.5 rounded-xl text-xs font-ui text-[var(--text-muted)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-xl bg-[var(--partner-a)] text-white text-xs font-chunky font-bold shadow-xs"
                  >
                    Save Cycle Settings
                  </button>
                </div>
              </form>
            )}

            {/* Selected Date Past Logs Display */}
            <div className="p-4 rounded-2xl bg-[var(--surface)] border-2 border-[var(--border)] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-chunky text-xs font-bold text-[var(--text)]">
                  Logs for {format(selectedCalendarDate, 'MMMM d, yyyy')}
                </span>
                <span className="text-[11px] font-ui text-[var(--text-muted)]">
                  {selectedDayLogs.length} logged
                </span>
              </div>

              {selectedDayLogs.length === 0 ? (
                <p className="text-xs font-ui text-[var(--text-muted)] py-2">
                  No feeling or craving logs on this day.
                </p>
              ) : (
                <div className="space-y-2 pt-1">
                  {selectedDayLogs.map((log) => (
                    <div
                      key={log.id}
                      className="p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-xs space-y-1.5"
                    >
                      {log.feelings && log.feelings.length > 0 && (
                        <div>
                          <span className="font-bold text-[var(--text)]">Feeling: </span>
                          <span className="text-[var(--text-muted)]">{log.feelings.join(', ')}</span>
                        </div>
                      )}
                      {log.cravings && log.cravings.length > 0 && (
                        <div>
                          <span className="font-bold text-rose-500">Craving: </span>
                          <span className="text-[var(--text)]">{log.cravings.join(', ')}</span>
                        </div>
                      )}
                      {log.note && (
                        <div className="text-[11px] italic text-[var(--text-muted)] border-t border-[var(--border)] pt-1 mt-1">
                          "{log.note}"
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Describe Feelings & Cravings Panel (Exclusive to Female Partner) */}
          <div className={activeTab === 'feelings' ? 'space-y-4' : 'hidden lg:block space-y-4'}>
            {isFemale ? (
              /* FEMALE USER INTERFACE: Full Logging & Instant Sharing */
              <div className="p-5 rounded-3xl bg-[var(--surface-2)] border-3 border-rose-500/40 shadow-xs space-y-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Heart className="w-5 h-5 text-rose-500 fill-rose-500" />
                    <h3 className="font-chunky text-base font-bold text-[var(--text)]">
                      How are you feeling & craving?
                    </h3>
                  </div>
                  <p className="text-xs font-ui text-[var(--text-muted)] mt-1">
                    Tap what you're feeling and craving. When sent, it will instantly notify{' '}
                    <strong className="text-[var(--text)]">{partnerUser.displayName}</strong> via push and couple chat!
                  </p>
                </div>

                {/* 1. Feelings Chips */}
                <div>
                  <label className="block text-xs font-chunky font-bold text-[var(--text)] mb-2 uppercase tracking-wider">
                    1. Describe What You're Feeling 😣
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {COMMON_FEELINGS.map((f) => {
                      const isSelected = selectedFeelings.includes(f.label);
                      return (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => toggleFeeling(f.label)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-ui font-semibold transition-all cursor-pointer border ${
                            isSelected
                              ? 'bg-rose-500 text-white border-rose-600 shadow-xs -translate-y-0.5'
                              : 'bg-[var(--surface)] text-[var(--text)] border-[var(--border)] hover:bg-[var(--surface-2)]'
                          }`}
                        >
                          {f.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Cravings Chips */}
                <div>
                  <label className="block text-xs font-chunky font-bold text-[var(--text)] mb-2 uppercase tracking-wider">
                    2. What are you craving? 🍫
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {COMMON_CRAVINGS.map((c) => {
                      const isSelected = selectedCravings.includes(c.label);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleCraving(c.label)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-ui font-semibold transition-all cursor-pointer border ${
                            isSelected
                              ? 'bg-[var(--accent)] text-[var(--text)] border-[var(--text)] font-bold shadow-xs -translate-y-0.5'
                              : 'bg-[var(--surface)] text-[var(--text)] border-[var(--border)] hover:bg-[var(--surface-2)]'
                          }`}
                        >
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 3. Custom Note */}
                <div>
                  <label className="block text-xs font-chunky font-bold text-[var(--text)] mb-1 uppercase tracking-wider">
                    3. Sweet Note for {partnerUser.displayName}
                  </label>
                  <textarea
                    rows={2}
                    value={customNote}
                    onChange={(e) => setCustomNote(e.target.value)}
                    placeholder="Tell him what would make you feel cozy right now (e.g. Please bring hot soup and give me hugs)..."
                    className="w-full rounded-2xl border-2 border-[var(--border)] bg-[var(--surface)] p-3 text-xs text-[var(--text)] placeholder-[var(--text-muted)] resize-none focus:outline-none focus:border-rose-500"
                  />
                </div>

                {/* Send Button */}
                <button
                  type="button"
                  onClick={handleSendFeelingsAndCravings}
                  disabled={
                    isSendingUpdate ||
                    (selectedFeelings.length === 0 && selectedCravings.length === 0 && !customNote.trim())
                  }
                  className="w-full py-3 rounded-2xl bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white font-chunky font-bold text-sm border-2 border-[var(--border)] shadow-[0_3px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>Notify {partnerUser.displayName} & Send to Chat 🌸</span>
                </button>

                {sentSuccessFeedback && (
                  <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 text-xs font-ui font-bold flex items-center gap-2 animate-in fade-in">
                    <Check className="w-4 h-4 shrink-0" />
                    <span>Sent! Your update was posted to chat and notification delivered to {partnerUser.displayName}! ❤️</span>
                  </div>
                )}
              </div>
            ) : (
              /* MALE / OTHER PARTNER INTERFACE: Caring Support & Partner's Latest Needs */
              <div className="space-y-4">
                <div className="p-5 rounded-3xl bg-[var(--surface-2)] border-2 border-[var(--border)] space-y-3">
                  <div className="flex items-center gap-2">
                    <Coffee className="w-5 h-5 text-[var(--partner-a)]" />
                    <h3 className="font-chunky text-base font-bold text-[var(--text)]">
                      How to Support {femaleDisplayName}
                    </h3>
                  </div>
                  <p className="text-xs font-ui text-[var(--text-muted)] leading-relaxed">
                    {careTip}
                  </p>
                </div>

                {/* Partner Locked Notice */}
                <div className="p-4 rounded-2xl bg-[var(--surface)] border border-[var(--border)] flex items-start gap-3 text-xs font-ui">
                  <div className="p-2 rounded-xl bg-rose-500/10 text-rose-500 shrink-0">
                    <Lock className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-chunky font-bold text-[var(--text)]">
                      Feelings & Cravings Logging
                    </h4>
                    <p className="text-[var(--text-muted)] mt-0.5">
                      The "Describe feelings & cravings" feature is reserved for {femaleDisplayName}. Whatever she feels or craves will appear right here and be sent as an alert and text message to you!
                    </p>
                  </div>
                </div>

                {/* Recent Updates from Partner */}
                <div className="p-5 rounded-3xl bg-[var(--surface)] border-2 border-[var(--border)] space-y-3">
                  <h4 className="font-chunky text-sm font-bold text-[var(--text)] flex items-center gap-2">
                    <span>🌸 Latest Updates from {femaleDisplayName}</span>
                  </h4>

                  {tracker?.logs && tracker.logs.length > 0 ? (
                    <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                      {tracker.logs.slice(0, 5).map((log) => (
                        <div
                          key={log.id}
                          className="p-3.5 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] text-xs space-y-1.5"
                        >
                          <div className="flex items-center justify-between text-[11px] font-ui text-[var(--text-muted)]">
                            <span>{format(parseISO(log.date), 'EEEE, MMM d')}</span>
                            <span className="text-rose-500 font-bold">Cycle Log</span>
                          </div>
                          {log.feelings && log.feelings.length > 0 && (
                            <div>
                              <span className="font-bold text-[var(--text)]">Feeling: </span>
                              <span className="text-[var(--text-muted)]">{log.feelings.join(', ')}</span>
                            </div>
                          )}
                          {log.cravings && log.cravings.length > 0 && (
                            <div>
                              <span className="font-bold text-rose-500">Craving: </span>
                              <span className="text-[var(--text)]">{log.cravings.join(', ')}</span>
                            </div>
                          )}
                          {log.note && (
                            <p className="text-xs italic text-[var(--text-muted)] bg-[var(--surface)] p-2 rounded-xl border border-[var(--border)]">
                              "{log.note}"
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs font-ui text-[var(--text-muted)] py-4 text-center">
                      No cravings or feelings shared yet. Check in with her! 💖
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
