import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { duoDataStore } from '../../lib/dataStore';
import type { TaskItem } from '../../lib/dataStore';
import { useAuthStore } from '../../lib/store';
import { TaskCard } from './TaskCard';
import { CreateTaskModal } from './CreateTaskModal';
import { TaskReminderBanner } from './TaskReminderBanner';
import { getTimezoneDifference, isInQuietHours } from '../../lib/time';
import {
  Plus,
  CheckCircle2,
  Calendar as CalendarIcon,
  ArrowRight,
  Sunrise,
  Sun,
  Sunset,
  Moon,
  Clock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useCalendarEvents } from '../../lib/firestore';
import { useTaskStore } from '../../lib/tasksStore';
import { useNow, useMinuteNow } from '../../lib/useNow';
import { expandEventsForRange, getEventCountdown, formatEventTime } from '../../lib/calendar';
import { addDays, subDays, format } from 'date-fns';
import {
  getBucket,
  getBucketDefinition,
  STANDARD_BUCKET_ORDER,
  type TimeBucketId,
} from '../../lib/timeBuckets';
import { checkAndFireDueTaskReminders } from '../../lib/taskReminders';
import { soundEffects } from '../../lib/sound';
import { formatFriendlyDate, formatUpcomingDate } from '../../lib/format';

interface ClockTileProps {
  displayName: string;
  avatarUrl: string;
  timeZone: string;
  isCurrentUser: boolean;
}

const ClockTile: React.FC<ClockTileProps> = ({
  displayName,
  avatarUrl,
  timeZone,
  isCurrentUser,
}) => {
  const now = useNow();
  const isDay = useMemo(() => {
    try {
      const hour = parseInt(
        new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false }).format(now),
        10
      );
      return hour >= 6 && hour < 19;
    } catch {
      const h = now.getHours();
      return h >= 6 && h < 19;
    }
  }, [timeZone, now]);

  const timeParts = useMemo(() => {
    try {
      const dtf = new Intl.DateTimeFormat(undefined, {
        timeZone,
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
      const parts = dtf.formatToParts(now);
      const hour = parts.find((p) => p.type === 'hour')?.value || '12';
      const minute = parts.find((p) => p.type === 'minute')?.value || '00';
      const second = parts.find((p) => p.type === 'second')?.value || '00';
      const dayPeriod = parts.find((p) => p.type === 'dayPeriod')?.value || 'PM';
      return {
        main: `${hour}:${minute}`,
        seconds: `:${second}`,
        period: dayPeriod,
      };
    } catch {
      return {
        main: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        seconds: '',
        period: '',
      };
    }
  }, [timeZone, now]);

  const tzShort = useMemo(() => {
    return timeZone.split('/').pop()?.replace('_', ' ') || timeZone;
  }, [timeZone]);

  return (
    <div className="clock-tile card p-3.5 sm:p-4 flex flex-col items-center text-center min-w-0">
      {/* 1. Avatar (56px) with day/night icon badge */}
      <div className="relative mb-2 shrink-0">
        <img
          src={avatarUrl}
          alt={displayName}
          className={`w-14 h-14 rounded-2xl object-cover border-2 shadow-xs ${
            isCurrentUser ? 'border-[var(--partner-a)]' : 'border-[var(--partner-b)]'
          }`}
        />
        <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center text-[11px] shadow-xs">
          {isDay ? '☀️' : '🌙'}
        </div>
      </div>

      {/* 2. Name: no truncation, allow wrap to two lines */}
      <div className="font-chunky text-sm font-bold text-[var(--text)] leading-tight mb-1 break-words w-full">
        {isCurrentUser ? `You (${displayName})` : displayName}
      </div>

      {/* 3. Time on ONE line with white-space: nowrap */}
      <div
        className="font-numeric font-bold text-[var(--text)] whitespace-nowrap tabular-nums my-0.5"
        style={{ fontSize: 'clamp(1.25rem, 2.2vw, 1.75rem)' }}
      >
        <span>{timeParts.main}</span>
        <span className="clock-seconds">{timeParts.seconds}</span>
        {timeParts.period && (
          <span className="text-[0.65em] font-ui font-semibold ml-1 text-[var(--text-muted)]">
            {timeParts.period}
          </span>
        )}
      </div>

      {/* 4. Date and timezone as small muted text */}
      <div className="font-ui text-xs text-[var(--text-muted)] mt-0.5 truncate w-full">
        <span>{formatFriendlyDate(now, now)}</span> • <span>{tzShort}</span>
      </div>
    </div>
  );
};

export const TaskList: React.FC = () => {
  const { currentUser, partnerUser, couple, isDemoMode } = useAuthStore();
  const now = useMinuteNow();
  const setTab = useAuthStore((s) => s.setTab);

  // Day Switcher state
  const todayStr = useMemo(() => format(now, 'yyyy-MM-dd'), [now]);
  const [selectedDate, setSelectedDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));

  // Separate My Tasks and Partner's Tasks
  const [filter, setFilter] = useState<'mine' | 'partner' | 'done'>('mine');

  // Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createPreFillTime, setCreatePreFillTime] = useState<string | undefined>(undefined);
  const [doodlePreviewUrl, setDoodlePreviewUrl] = useState<string | null>(null);

  // Expanded/Collapsed sections tracking
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const {
    tasks: storeTasks,
    status: syncStatus,
    partnerActivity,
    clearPartnerActivity,
    initSubscription,
  } = useTaskStore();

  useEffect(() => {
    if (!isDemoMode && couple?.id) {
      const unsub = initSubscription(couple.id, currentUser.id, partnerUser.displayName);
      return unsub;
    }
  }, [isDemoMode, couple?.id, currentUser.id, partnerUser.displayName, initSubscription]);

  const { data: demoTasks = [] } = useQuery({
    queryKey: ['tasks', 'couple-duo-main'],
    queryFn: () => duoDataStore.getTasks(),
    enabled: isDemoMode,
    staleTime: 5000,
    refetchInterval: 5000,
  });

  const tasks: TaskItem[] = useMemo(() => {
    if (isDemoMode) return demoTasks;
    return storeTasks;
  }, [isDemoMode, demoTasks, storeTasks]);

  // Periodic reminder scheduler check
  useEffect(() => {
    checkAndFireDueTaskReminders(
      tasks,
      currentUser.id,
      currentUser.timezone,
      now,
      currentUser.quietHoursStart,
      currentUser.quietHoursEnd,
      partnerUser.displayName
    );
  }, [tasks, now, currentUser, partnerUser.displayName]);

  // Calendar Events for upcoming moments card
  const { events: firestoreCalendarEvents } = useCalendarEvents(
    !isDemoMode ? couple?.id || null : null
  );
  const calendarEvents = isDemoMode ? duoDataStore.getCalendarEvents() : firestoreCalendarEvents;

  const upcomingEvents = useMemo(() => {
    const expanded = expandEventsForRange(calendarEvents, now, addDays(now, 14));
    return expanded.slice(0, 3);
  }, [calendarEvents, now]);

  // Dual timezone difference
  const tzDiff = getTimezoneDifference(currentUser.timezone, partnerUser.timezone, now);
  const isPartnerQuiet = isInQuietHours(partnerUser.quietHoursStart, partnerUser.quietHoursEnd, partnerUser.timezone);

  // Current bucket according to viewer's local time
  const currentLocalBucketId = getBucket(now, currentUser.timezone);

  // Filter tasks by date & filter tab
  const dayTasks = useMemo(() => {
    const isViewingToday = selectedDate === todayStr;

    return tasks.filter((t) => {
      // If viewing today, also surface unfinished overdue tasks from previous days
      const isForDay = t.task_date === selectedDate;
      const isPastOverdue = isViewingToday && t.task_date < todayStr && t.status !== 'done';
      if (!isForDay && !isPastOverdue) return false;

      // Filter tab check
      if (filter === 'mine') {
        const isMine = t.assigned_to === currentUser.id || (!t.assigned_to && t.created_by === currentUser.id);
        return isMine && t.status !== 'done';
      }
      if (filter === 'partner') {
        const isPartner = t.assigned_to === partnerUser.id || (!t.assigned_to && t.created_by === partnerUser.id);
        return isPartner && t.status !== 'done';
      }
      if (filter === 'done') return t.status === 'done';
      return false;
    });
  }, [tasks, selectedDate, todayStr, filter, currentUser.id, partnerUser.id]);

  // Group tasks into time buckets using VIEWER'S LOCAL TIME
  const bucketedTasks = useMemo(() => {
    const groups: Record<TimeBucketId, TaskItem[]> = {
      late_night: [],
      morning: [],
      afternoon: [],
      evening: [],
      night: [],
      anytime: [],
    };

    for (const task of dayTasks) {
      const bucketId = getBucket(task.startAt, currentUser.timezone);
      groups[bucketId].push(task);
    }

    // Sort tasks chronologically inside each section by startAt
    for (const key of Object.keys(groups) as TimeBucketId[]) {
      groups[key].sort((a, b) => {
        if (!a.startAt) return 1;
        if (!b.startAt) return -1;
        return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
      });
    }

    return groups;
  }, [dayTasks, currentUser.timezone]);

  // Determine which sections to render
  const sectionsToRender: TimeBucketId[] = useMemo(() => {
    const list: TimeBucketId[] = [...STANDARD_BUCKET_ORDER];
    if (bucketedTasks.late_night.length > 0) {
      list.unshift('late_night');
    }
    if (bucketedTasks.anytime.length > 0) {
      list.push('anytime');
    }
    return list;
  }, [bucketedTasks]);

  const completedCount = tasks.filter((t) => t.status === 'done').length;
  const totalCount = tasks.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const quickSparks = [
    { label: 'Hug 🤗', sound: 520 },
    { label: 'Kiss 🫧', sound: 640 },
    { label: 'Poke 👉', sound: 440 },
    { label: 'Hydrate 💧', sound: 720 },
  ];

  const handleSparkClick = (freq: number) => {
    try {
      const audio = new AudioContext();
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.2, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audio.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + 0.15);
    } catch {}
  };

  const toggleSection = (id: string) => {
    soundEffects.playPop();
    setCollapsedSections((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const getSectionIcon = (iconName: string) => {
    switch (iconName) {
      case 'sunrise':
        return <Sunrise className="w-5 h-5 text-[var(--accent)]" />;
      case 'sun':
        return <Sun className="w-5 h-5 text-[var(--partner-a)]" />;
      case 'sunset':
        return <Sunset className="w-5 h-5 text-[var(--partner-b)]" />;
      case 'moon':
        return <Moon className="w-5 h-5 text-[var(--text-muted)]" />;
      default:
        return <Clock className="w-5 h-5 text-[var(--text)]" />;
    }
  };

  return (
    <div className="w-full min-w-0">
      {/* Interactive In-App Task Reminder Banner */}
      <TaskReminderBanner />

      {/* Two-column layout on >=1100px: missions left, clocks + widgets right (sticky) */}
      <div className="grid grid-cols-1 min-[1100px]:grid-cols-[minmax(0,1.8fr)_minmax(320px,1fr)] gap-6 items-start">
        {/* LEFT COLUMN: Day Switcher, Filters, and Time-of-Day Sections */}
        <div className="order-1 space-y-5 min-w-0">
          {/* Header & Add Mission Button */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="font-display text-3xl sm:text-4xl text-[var(--text)] tracking-tight">
                  Tasks
                </h1>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-chunky font-bold border-2 border-[var(--border)] ${
                  syncStatus === 'live'
                    ? 'bg-[var(--surface-2)] text-[var(--text)]'
                    : 'bg-[var(--surface)] text-[var(--text-muted)] animate-pulse'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${syncStatus === 'live' ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`} />
                  <span>{syncStatus === 'live' ? 'Live' : 'Syncing'}</span>
                </span>
              </div>
              <p className="font-body text-xs sm:text-sm text-[var(--text-muted)] mt-1">
                Personal and shared work, organized by your time of day ✨
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setCreatePreFillTime(undefined);
                setIsCreateOpen(true);
              }}
              className="flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-[var(--partner-a)] hover:opacity-90 text-white font-chunky font-bold text-sm border-2 border-[var(--border)] shadow-[0_3px_0_var(--shadow-color)] active:translate-y-1 active:shadow-none transition-all cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>New Task</span>
            </button>
          </div>

          {/* Real-time Partner Activity Alert */}
          {partnerActivity && (
            <div className="flex items-center justify-between p-3 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] text-xs font-chunky font-bold text-[var(--text)] shadow-xs animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center gap-2">
                <span className="text-base">✨</span>
                <span>{partnerActivity.message}</span>
              </div>
              <button
                type="button"
                onClick={clearPartnerActivity}
                className="px-2.5 py-1 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-[11px] font-ui hover:bg-[var(--surface-2)] cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Day Switcher Toolbar (Yesterday / Today / Tomorrow / Custom Date) */}
          <div className="card p-2 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-1.5">
              {[
                {
                  id: 'yesterday',
                  label: 'Yesterday',
                  dateStr: format(subDays(now, 1), 'yyyy-MM-dd'),
                },
                {
                  id: 'today',
                  label: 'Today',
                  dateStr: todayStr,
                },
                {
                  id: 'tomorrow',
                  label: 'Tomorrow',
                  dateStr: format(addDays(now, 1), 'yyyy-MM-dd'),
                },
              ].map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    soundEffects.playPop();
                    setSelectedDate(d.dateStr);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-ui font-semibold transition-all cursor-pointer ${
                    selectedDate === d.dateStr
                      ? 'bg-[var(--accent)] text-[var(--text)] border border-[var(--border)] font-bold shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>

            {/* A6: Friendly date label next to calendar icon; native picker opens on tap */}
            <label className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface-2)]/80 border border-[var(--border)] font-ui text-xs font-semibold text-[var(--text)] cursor-pointer">
              <CalendarIcon className="w-4 h-4 text-[var(--partner-a)] shrink-0" />
              <span>{formatFriendlyDate(selectedDate, now)}</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  if (e.target.value) {
                    soundEffects.playPop();
                    setSelectedDate(e.target.value);
                  }
                }}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                aria-label="Pick date"
              />
            </label>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            {(
              [
                { key: 'mine', label: 'My Tasks' },
                { key: 'partner', label: `${partnerUser.displayName || 'Vidhi'}'s Tasks` },
                { key: 'done', label: `Done (${completedCount})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key)}
                className={`px-4 py-2 rounded-2xl text-xs font-ui font-semibold whitespace-nowrap transition-all cursor-pointer border-2 ${
                  filter === tab.key
                    ? 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--text)] shadow-[0_2px_0_var(--shadow-color)] -translate-y-0.5'
                    : 'bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] border-[var(--border)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* TIME-OF-DAY SECTIONS (A4) */}
          <div className="space-y-4">
            {sectionsToRender.map((bucketId) => {
              const def = getBucketDefinition(bucketId);
              const sectionTasks = bucketedTasks[bucketId];
              const isCurrentSection =
                selectedDate === todayStr && bucketId === currentLocalBucketId;

              const totalSectionTasks = sectionTasks.length;
              const doneSectionTasks = sectionTasks.filter((t) => t.status === 'done').length;
              const sectionProgressPct =
                totalSectionTasks > 0
                  ? Math.round((doneSectionTasks / totalSectionTasks) * 100)
                  : 0;

              const isEmpty = totalSectionTasks === 0;
              const isAutoCollapsed =
                totalSectionTasks > 0 &&
                doneSectionTasks === totalSectionTasks &&
                bucketId !== currentLocalBucketId;

              // Empty sections collapse by default into a slim single row (56px height)
              const isCollapsed =
                collapsedSections[bucketId] !== undefined
                  ? collapsedSections[bucketId]
                  : (isEmpty || isAutoCollapsed);

              return (
                <div
                  key={bucketId}
                  className={`card transition-all duration-200 overflow-hidden ${
                    isCurrentSection
                      ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]'
                      : ''
                  }`}
                >
                  {/* Collapsible Section Header: 56px height row */}
                  <div
                    onClick={() => toggleSection(bucketId)}
                    className="min-h-[56px] h-14 px-4 flex items-center justify-between gap-3 cursor-pointer select-none bg-[var(--surface)] hover:bg-[var(--surface-2)]/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Icon 40px */}
                      <div className="w-10 h-10 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center shrink-0 shadow-xs">
                        {getSectionIcon(def.icon)}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-chunky text-base font-bold text-[var(--text)] leading-none truncate">
                            {def.label}
                          </h3>
                          {isCurrentSection && (
                            <span className="px-2 py-0.5 rounded-full bg-[var(--accent)] text-[var(--text)] text-[10px] font-chunky font-bold uppercase tracking-wider border border-[var(--border)] shadow-xs">
                              Now
                            </span>
                          )}
                        </div>
                        <span className="font-ui text-xs text-[var(--text-muted)] mt-0.5 block truncate">
                          {def.timeRange}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {/* Empty section has small "+ Add" icon button */}
                      {isEmpty && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            soundEffects.playPop();
                            setCreatePreFillTime(def.defaultTime);
                            setIsCreateOpen(true);
                          }}
                          title={`Add task for ${def.label} (${def.defaultTime})`}
                          aria-label={`Add task for ${def.label} (${def.defaultTime})`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--accent)] text-[var(--text)] font-chunky text-xs font-bold border border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                          <span>Add</span>
                        </button>
                      )}

                      {/* Done / Total count in --font-numeric aligned right with chevron */}
                      <div className="flex flex-col items-end">
                        <span className="font-numeric text-xs font-bold text-[var(--text)]">
                          {doneSectionTasks}/{totalSectionTasks}
                        </span>
                        {totalSectionTasks > 0 && (
                          <div className="w-14 h-1.5 rounded-full bg-[var(--surface-2)] border border-[var(--border)] overflow-hidden mt-0.5">
                            <div
                              className="h-full bg-[var(--success)] transition-all duration-300"
                              style={{ width: `${sectionProgressPct}%` }}
                            />
                          </div>
                        )}
                      </div>

                      <div className="p-1 rounded-xl border border-[var(--border)] text-[var(--text-muted)]">
                        {isCollapsed ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronUp className="w-4 h-4" />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Section Tasks List (when expanded) */}
                  {!isCollapsed && (
                    <div className="p-4 pt-0 space-y-3 border-t border-[var(--border)]/60 bg-[var(--surface)]">
                      {sectionTasks.length === 0 ? (
                        <div className="text-center py-6 px-4 rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--surface-2)]/40 my-2">
                          <p className="font-ui text-xs text-[var(--text-muted)] mb-3">
                            No tasks scheduled for {def.label.toLowerCase()}.
                          </p>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              soundEffects.playPop();
                              setCreatePreFillTime(def.defaultTime);
                              setIsCreateOpen(true);
                            }}
                            title={`Add task for ${def.label} (${def.defaultTime})`}
                            aria-label={`Add task for ${def.label} (${def.defaultTime})`}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[var(--surface)] hover:bg-[var(--accent)] text-[var(--text)] font-chunky text-xs font-bold border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                            <span>Add</span>
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3 pt-3">
                          {sectionTasks.map((task) => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              isOverdue={
                                selectedDate === todayStr &&
                                task.task_date < todayStr &&
                                task.status !== 'done'
                              }
                              onOpenDoodlePreview={(url) => setDoodlePreviewUrl(url)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT COLUMN: Clocks, Upcoming Moments & Daily Rhythm (Sticky on >=1100px) */}
        <div className="order-2 min-[1100px]:sticky min-[1100px]:top-[24px] space-y-5 min-w-0">
          {/* A3: Dual Clock Cards (Equal width grid-template-columns: 1fr 1fr, container queries) */}
          <div className="card p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3 min-w-0">
              <ClockTile
                displayName={currentUser.displayName}
                avatarUrl={currentUser.avatarUrl}
                timeZone={currentUser.timezone}
                isCurrentUser={true}
              />
              <ClockTile
                displayName={partnerUser.displayName}
                avatarUrl={partnerUser.avatarUrl}
                timeZone={partnerUser.timezone}
                isCurrentUser={false}
              />
            </div>

            {/* Timezone Difference Live Chip (on its own line below the tiles) */}
            <div className="pt-2 border-t-2 border-[var(--border)] flex flex-wrap items-center justify-between gap-2">
              <span className="px-3 py-1 rounded-xl bg-[var(--accent)] text-[var(--text)] border border-[var(--border)] font-chunky text-xs font-bold shadow-xs">
                {tzDiff}
              </span>
              {isPartnerQuiet && (
                <span className="px-3 py-1 rounded-xl bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border)] font-ui text-xs">
                  {partnerUser.displayName} in quiet hours 🌙
                </span>
              )}
            </div>
          </div>

          {/* Upcoming Moments Calendar Card (A6) */}
          <div className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-5 h-5 text-[var(--accent)]" />
                <h3 className="font-chunky text-base font-bold text-[var(--text)]">
                  Upcoming Moments
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setTab('calendar')}
                className="text-xs font-ui font-semibold text-[var(--accent)] hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                <span>Calendar</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {upcomingEvents.length === 0 ? (
              <p className="font-ui text-xs text-[var(--text-muted)] text-center py-3">
                No events in the next two weeks. Add one in Calendar!
              </p>
            ) : (
              <div className="space-y-2">
                {upcomingEvents.map((ev) => (
                  <div
                    key={`${ev.id}-${ev.instanceDate}`}
                    onClick={() => setTab('calendar')}
                    style={{ borderLeftColor: ev.color }}
                    className="p-3 rounded-2xl bg-[var(--surface-2)] hover:bg-[var(--surface-2)]/80 border-2 border-[var(--border)] border-l-4 text-xs cursor-pointer shadow-xs transition-transform hover:scale-[1.01]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-base shrink-0">{ev.icon || '📌'}</span>
                        <span className="font-chunky font-bold text-[var(--text)] truncate">
                          {ev.title}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 font-numeric text-[11px] font-bold text-[var(--text)]">
                        <span>{formatEventTime(ev, currentUser.timezone)}</span>
                        <span className="font-bold text-[var(--partner-a)]">
                          ({getEventCountdown(ev, now)})
                        </span>
                      </div>
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] font-ui mt-1">
                      <span>{formatUpcomingDate(ev.instanceDate, now)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Daily Rhythm Progress Card */}
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-[var(--success)]" />
                <h3 className="font-chunky text-base font-bold text-[var(--text)]">
                  Daily Rhythm
                </h3>
              </div>
              <span className="font-numeric text-xs font-bold text-[var(--text)] px-2.5 py-0.5 rounded-full bg-[var(--surface-2)] border border-[var(--border)]">
                {completedCount}/{totalCount} Completed
              </span>
            </div>

            <div className="space-y-1.5">
              <div className="w-full h-3 rounded-full bg-[var(--surface-2)] border border-[var(--border)] overflow-hidden">
                <div
                  className="h-full bg-[var(--accent)] transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] font-ui text-[var(--text-muted)]">
                <span>{progressPct}% finished</span>
                <span>{totalCount - completedCount} remaining</span>
              </div>
            </div>

            {/* Quick Sparks */}
            <div className="pt-2 border-t border-[var(--border)]">
              <div className="text-[11px] font-ui font-semibold text-[var(--text-muted)] mb-2">
                Send a quick spark:
              </div>
              <div className="grid grid-cols-2 gap-2">
                {quickSparks.map((spark) => (
                  <button
                    key={spark.label}
                    onClick={() => handleSparkClick(spark.sound)}
                    className="py-1.5 px-2 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--accent)]/30 border border-[var(--border)] text-xs font-chunky font-bold text-[var(--text)] shadow-xs active:translate-y-0.5 transition-all cursor-pointer text-center truncate"
                  >
                    {spark.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CREATE MISSION MODAL */}
      <CreateTaskModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        defaultDate={selectedDate}
        preFillTime={createPreFillTime}
        initialAssignedTo={filter === 'partner' ? partnerUser.id : currentUser.id}
      />

      {/* DOODLE PREVIEW MODAL */}
      {doodlePreviewUrl && (
        <div
          onClick={() => setDoodlePreviewUrl(null)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card max-w-lg w-full p-4 relative"
          >
            <h3 className="font-chunky text-base font-bold text-[var(--text)] mb-3">
              Task Doodle Art 🎨
            </h3>
            <img
              src={doodlePreviewUrl}
              alt="Doodle Preview"
              className="w-full rounded-2xl border-2 border-[var(--border)] bg-white object-contain max-h-[70vh]"
            />
            <button
              onClick={() => setDoodlePreviewUrl(null)}
              className="mt-4 w-full py-2.5 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface-2)]/80 text-[var(--text)] font-chunky font-bold text-sm border-2 border-[var(--border)] cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
