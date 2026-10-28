import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { duoDataStore } from '../../lib/dataStore';
import type { TaskItem } from '../../lib/dataStore';
import { useAuthStore } from '../../lib/store';
import { TaskCard } from './TaskCard';
import { CreateTaskModal } from './CreateTaskModal';
import { TaskReminderBanner } from './TaskReminderBanner';
import { getTimezoneDifference, isInQuietHours } from '../../lib/time';
import { GoogleIcon } from '../../components/GoogleIcon';
import { Sunrise, Sun, Sunset, Moon, Sparkles, Clock } from 'lucide-react';
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
import { WavyText } from '../../components/WavyHeading';

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
    <div className={`clk ${!isCurrentUser ? 'v' : ''} flex flex-col items-center text-center min-w-0`}>
      {/* 1. Avatar (62px) with day/night icon badge */}
      <div className="av relative shrink-0">
        <img
          src={avatarUrl}
          alt={displayName}
          className="w-full h-full rounded-full object-cover"
        />
        <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[var(--card)] border border-[var(--ink)] flex items-center justify-center text-[11px] shadow-xs">
          {isDay ? '☀️' : '🌙'}
        </div>
      </div>

      {/* 2. Name: no truncation, allow wrap to two lines */}
      <div className="font-heading text-sm font-normal leading-tight mb-1 break-words w-full text-[var(--text)]">
        {isCurrentUser ? `You (${displayName})` : displayName}
      </div>

      {/* 3. Time on ONE line with white-space: nowrap */}
      <b className="ck font-heading text-[28px] sm:text-[30px] font-normal leading-tight my-0.5 whitespace-nowrap">
        <span>{timeParts.main}</span>
        <span className="text-[0.6em] ml-0.5 opacity-80">{timeParts.seconds}</span>
        {timeParts.period && (
          <span className="text-[0.55em] font-ui font-semibold ml-1 opacity-90">
            {timeParts.period}
          </span>
        )}
      </b>

      {/* 4. Date and timezone as small muted text */}
      <small className="opacity-80 block truncate w-full font-ui text-[12px] mt-0.5">
        <span>{tzShort}</span>
      </small>
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

  // Compute next action for Today
  const nextTask = useMemo(() => {
    const currentTasks = bucketedTasks[currentLocalBucketId] || [];
    const pendingInCurrent = currentTasks.find((t) => t.status !== 'done');
    if (pendingInCurrent) return pendingInCurrent;
    for (const bId of sectionsToRender) {
      const p = (bucketedTasks[bId] || []).find((t) => t.status !== 'done');
      if (p) return p;
    }
    return null;
  }, [bucketedTasks, currentLocalBucketId, sectionsToRender]);

  const completedCount = tasks.filter((t) => t.status === 'done').length;
  const totalCount = tasks.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const quickSparks = [
    { label: 'Hug 🤗', sound: 520 },
    { label: 'Kiss 🫧', sound: 640 },
    { label: 'Poke 👉', sound: 440 },
    { label: 'Hydrate 💧', sound: 720 },
  ];

  const handleSparkClick = (_freq: number) => {
    try {
      soundEffects.playSuccess();
    } catch {
      soundEffects.playPop();
    }
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
        return <Sunrise className="w-6 h-6 stroke-[2.25]" aria-hidden="true" />;
      case 'sun':
        return <Sun className="w-6 h-6 stroke-[2.25]" aria-hidden="true" />;
      case 'sunset':
        return <Sunset className="w-6 h-6 stroke-[2.25]" aria-hidden="true" />;
      case 'moon':
        return <Moon className="w-6 h-6 stroke-[2.25]" aria-hidden="true" />;
      case 'sparkles':
        return <Sparkles className="w-6 h-6 stroke-[2.25]" aria-hidden="true" />;
      case 'clock':
      default:
        return <Clock className="w-6 h-6 stroke-[2.25]" aria-hidden="true" />;
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
          <div className="hd flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-[28px] sm:text-[38px] font-display font-normal text-[var(--text)] tracking-wide">
                  <WavyText text="TODAY" isDisplay={true} />
                </h1>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-ui font-bold border-2 border-[var(--border)] ${
                  syncStatus === 'live'
                    ? 'bg-[var(--surface-2)] text-[var(--text)]'
                    : 'bg-[var(--surface)] text-[var(--text-muted)] animate-pulse'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${syncStatus === 'live' ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`} />
                  <span>{syncStatus === 'live' ? 'Live' : 'Syncing'}</span>
                </span>
              </div>
              <p className="font-ui font-medium text-xs sm:text-sm text-[var(--text-muted)] mt-0.5">
                your day, sorted by vibes ✨
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setCreatePreFillTime(undefined);
                setIsCreateOpen(true);
              }}
              className="btn a font-ui font-bold text-xs sm:text-sm"
            >
              <GoogleIcon name="add" size={16} />
              <span>＋ New task</span>
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
          <div className="card card-switcher p-2 flex flex-wrap items-center justify-between gap-2.5">
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
              <GoogleIcon name="calendar_month" size={16} className="text-[var(--partner-a)] shrink-0" />
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
                { key: 'mine', label: 'My tasks' },
                { key: 'partner', label: `${partnerUser.displayName || 'Vidhi'}’s tasks` },
                { key: 'done', label: `Done (${completedCount})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key)}
                className={`chip ${filter === tab.key ? 'on' : ''} text-xs font-ui font-semibold whitespace-nowrap`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Next Action Highlight (Obvious at a glance) */}
          {selectedDate === todayStr && filter !== 'done' && nextTask && (
            <div className="card p-4 border-2 border-[var(--accent)] bg-gradient-to-r from-[var(--surface)] to-[var(--surface-2)] shadow-[0_4px_0_var(--shadow-color)] space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[var(--accent)] animate-ping" />
                  <span className="font-heading text-xs uppercase tracking-wider text-[var(--partner-a)]">
                    Next Action • Focus Now
                  </span>
                </div>
                <span className="font-ui text-xs font-semibold text-[var(--text-muted)]">
                  {getBucketDefinition(getBucket(nextTask.startAt, currentUser.timezone)).label}
                </span>
              </div>
              <TaskCard
                task={nextTask}
                isOverdue={nextTask.task_date < todayStr && nextTask.status !== 'done'}
                onOpenDoodlePreview={(url) => setDoodlePreviewUrl(url)}
              />
            </div>
          )}

          {/* TIME-OF-DAY SECTIONS (A4) */}
          <div className="space-y-4">
            {sectionsToRender.map((bucketId) => {
              const def = getBucketDefinition(bucketId);
              const sectionTasks = bucketedTasks[bucketId];
              const isCurrentSection =
                selectedDate === todayStr && bucketId === currentLocalBucketId;

              const totalSectionTasks = sectionTasks.length;
              const doneSectionTasks = sectionTasks.filter((t) => t.status === 'done').length;

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
                  className={`part part-${bucketId} ${!isCollapsed ? 'open' : ''} ${
                    isCurrentSection
                      ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]'
                      : ''
                  }`}
                >
                  {/* Collapsible Section Header */}
                  <div
                    onClick={() => toggleSection(bucketId)}
                    className="ph flex items-center justify-between gap-3 p-3 sm:p-4 cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {/* Icon */}
                      <div className="ic">
                        {getSectionIcon(def.icon)}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-chunky text-base font-bold leading-none truncate">
                            {def.label}
                          </h3>
                          {isCurrentSection && (
                            <span className="now">
                              NOW
                            </span>
                          )}
                        </div>
                        <small className="font-ui text-xs text-[var(--text-muted)] mt-0.5 block truncate">
                          {def.timeRange}
                        </small>
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
                          className="btn d text-xs py-1 px-2.5"
                        >
                          <GoogleIcon name="add" size={14} />
                          <span>Add</span>
                        </button>
                      )}

                      {/* Done / Total count */}
                      <b className="fat text-sm">
                        {doneSectionTasks}/{totalSectionTasks}
                      </b>

                      <div className="p-1 rounded-xl border border-[var(--border)] text-[var(--text-muted)] flex items-center justify-center">
                        {isCollapsed ? (
                          <GoogleIcon name="expand_more" size={16} />
                        ) : (
                          <GoogleIcon name="expand_less" size={16} />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Section Tasks List (when expanded) */}
                  {!isCollapsed && (
                    <div className="pb space-y-3 pt-2">
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
                            className="btn d text-xs py-1.5 px-3.5"
                          >
                            <GoogleIcon name="add" size={14} />
                            <span>Add</span>
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3 pt-1">
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
          {/* A3: Dual Clock Cards */}
          <div className="card card-clocks p-5 space-y-4">
            <div className="clocks">
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

            {/* Timezone Difference Live Chip */}
            <div className="pt-2 border-t-2 border-[var(--border)] flex flex-wrap items-center justify-between gap-2">
              <span className="chip on text-xs font-bold">
                {tzDiff}
              </span>
              {isPartnerQuiet && (
                <span className="chip text-xs text-[var(--text-muted)]">
                  {partnerUser.displayName} in quiet hours 🌙
                </span>
              )}
            </div>
          </div>

          {/* Upcoming Moments Calendar Card (A6) */}
          <div className="card card-moments p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GoogleIcon name="calendar_month" size={20} className="text-[var(--accent)]" />
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
                <GoogleIcon name="arrow_forward" size={14} />
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
                    className="ev p-3 rounded-2xl bg-[var(--surface-2)] hover:bg-[var(--surface-2)]/80 text-xs cursor-pointer shadow-xs transition-transform"
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
          <div className="card card-rhythm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GoogleIcon name="check_circle" size={20} filled className="text-[var(--success)]" />
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
