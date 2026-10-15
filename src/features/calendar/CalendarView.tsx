import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  format,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  subDays,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
} from 'date-fns';
import type { CalendarEvent, ExpandedCalendarEvent } from '../../lib/calendar';
import {
  expandEventsForRange,
  formatEventTime,
} from '../../lib/calendar';
import { MonthView } from './MonthView';
import { WeekView } from './WeekView';
import { DayView } from './DayView';
import { AgendaView } from './AgendaView';
import { EventFormModal } from './EventFormModal';
import { EventDetailModal } from './EventDetailModal';
import { useAuthStore } from '../../lib/store';
import { duoDataStore } from '../../lib/dataStore';
import type { PeriodTracker } from '../../lib/dataStore';
import {
  useCalendarEvents,
  addCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  usePeriodTracker,
  updatePeriodTracker,
} from '../../lib/firestore';
import { PeriodTrackerCard } from './PeriodTrackerCard';
import { useReminderStore, checkAndFireDueReminders } from '../../lib/reminders';
import { useMinuteNow } from '../../lib/useNow';
import { soundEffects } from '../../lib/sound';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Bell,
  Sparkles,
} from 'lucide-react';

export type CalendarViewType = 'month' | 'week' | 'day' | 'agenda';

export const CalendarView: React.FC = () => {
  const now = useMinuteNow();
  const { currentUser, partnerUser, couple, isDemoMode, firstDayOfWeek } = useAuthStore();
  const { permissionStatus, requestPermission } = useReminderStore();

  const [viewType, setViewType] = useState<CalendarViewType>('month');
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [filterOwner, setFilterOwner] = useState<'all' | 'me' | 'partner'>('all');

  // Modals
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<ExpandedCalendarEvent | null>(null);
  const [initialSlotTime, setInitialSlotTime] = useState<string | undefined>(undefined);

  // Quick month/year picker popover
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const [demoPeriodTracker, setDemoPeriodTracker] = useState<PeriodTracker | null>(() =>
    isDemoMode ? duoDataStore.getPeriodTracker() : null
  );
  const sharedPeriodTracker = usePeriodTracker(!isDemoMode ? couple?.id || null : null);
  const periodTracker = isDemoMode ? demoPeriodTracker : sharedPeriodTracker;

  const savePeriodTracker = useCallback(async (tracker: PeriodTracker) => {
    if (isDemoMode) {
      duoDataStore.savePeriodTracker(tracker);
      setDemoPeriodTracker(tracker);
      return;
    }
    if (couple?.id) {
      await updatePeriodTracker(couple.id, tracker);
    }
  }, [couple?.id, isDemoMode]);

  // Firestore / Demo mode events
  const { events: firestoreEvents } = useCalendarEvents(!isDemoMode ? couple?.id || null : null);
  const [localDemoEvents, setLocalDemoEvents] = useState<CalendarEvent[]>(() =>
    isDemoMode ? duoDataStore.getCalendarEvents() : []
  );

  const rawEvents = isDemoMode ? localDemoEvents : firestoreEvents;

  // Real-time reminder checker on each shared clock tick
  useEffect(() => {
    checkAndFireDueReminders(rawEvents, currentUser.id, currentUser.timezone, now);
  }, [rawEvents, currentUser.id, currentUser.timezone, now]);

  // Determine current visible range for event expansion
  const visibleRange = useMemo(() => {
    const weekStartsOn = firstDayOfWeek === 'monday' ? 1 : 0;
    if (viewType === 'month') {
      const start = startOfWeek(startOfMonth(currentDate), { weekStartsOn });
      const end = endOfWeek(endOfMonth(currentDate), { weekStartsOn });
      return { start, end };
    } else if (viewType === 'week') {
      const start = startOfWeek(currentDate, { weekStartsOn });
      const end = endOfWeek(currentDate, { weekStartsOn });
      return { start, end };
    } else if (viewType === 'day') {
      return { start: currentDate, end: currentDate };
    } else {
      // Agenda: past 7 days to next 60 days
      const start = subDays(new Date(), 1);
      const end = addDays(new Date(), 60);
      return { start, end };
    }
  }, [viewType, currentDate, firstDayOfWeek]);

  // Expand recurring instances and filter by owner
  const expandedEvents = useMemo(() => {
    const allExpanded = expandEventsForRange(rawEvents, visibleRange.start, visibleRange.end);
    if (filterOwner === 'all') return allExpanded;
    if (filterOwner === 'me') {
      return allExpanded.filter((e) => e.ownerIds.includes(currentUser.id));
    }
    return allExpanded.filter((e) => e.ownerIds.includes(partnerUser.id));
  }, [rawEvents, visibleRange, filterOwner, currentUser.id, partnerUser.id]);

  // Events for selected day (for side agenda on desktop or bottom agenda on mobile in month view)
  const selectedDayEvents = useMemo(() => {
    const dayStr = format(selectedDate, 'yyyy-MM-dd');
    return expandedEvents.filter((e) => e.instanceDate === dayStr);
  }, [expandedEvents, selectedDate]);

  // Navigation handlers
  const handlePrev = useCallback(() => {
    soundEffects.playPop();
    if (viewType === 'month') setCurrentDate((d) => subMonths(d, 1));
    else if (viewType === 'week') setCurrentDate((d) => subWeeks(d, 1));
    else if (viewType === 'day') {
      setCurrentDate((d) => subDays(d, 1));
      setSelectedDate((d) => subDays(d, 1));
    } else {
      setCurrentDate((d) => subMonths(d, 1));
    }
  }, [viewType]);

  const handleNext = useCallback(() => {
    soundEffects.playPop();
    if (viewType === 'month') setCurrentDate((d) => addMonths(d, 1));
    else if (viewType === 'week') setCurrentDate((d) => addWeeks(d, 1));
    else if (viewType === 'day') {
      setCurrentDate((d) => addDays(d, 1));
      setSelectedDate((d) => addDays(d, 1));
    } else {
      setCurrentDate((d) => addMonths(d, 1));
    }
  }, [viewType]);

  const handleGoToday = useCallback(() => {
    soundEffects.playSuccess();
    const today = new Date();
    setCurrentDate(today);
    setSelectedDate(today);
  }, []);

  // Keyboard Navigation:
  // - Arrow keys move between days
  // - Enter opens day
  // - PageUp / PageDown change month
  // - T goes to today
  // - N creates new event
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is inside an input, textarea, or modal is open
      if (
        isFormOpen ||
        selectedEvent !== null ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)
      ) {
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSelectedDate((d) => subDays(d, 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSelectedDate((d) => addDays(d, 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedDate((d) => subDays(d, 7));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedDate((d) => addDays(d, 7));
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'PageDown') {
        e.preventDefault();
        handleNext();
      } else if (e.key.toLowerCase() === 't') {
        e.preventDefault();
        handleGoToday();
      } else if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        soundEffects.playPop();
        setEditingEvent(null);
        setIsFormOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFormOpen, selectedEvent, handlePrev, handleNext, handleGoToday]);

  // Touch Swipe gestures (left / right)
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.touches[0].clientX);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX === null) return;
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 60) {
      if (diff > 0) handleNext();
      else handlePrev();
    }
    setTouchStartX(null);
  };

  // Event CRUD Handlers
  const handleSaveEvent = async (eventData: any) => {
    if (isDemoMode) {
      if (editingEvent) {
        // Update existing
        const updated = localDemoEvents.map((ev) =>
          ev.id === editingEvent.id
            ? { ...ev, ...eventData, updatedAt: new Date().toISOString() }
            : ev
        );
        setLocalDemoEvents(updated);
        duoDataStore.saveCalendarEvents(updated);
      } else {
        // Create new
        const newEv: CalendarEvent = {
          id: `ev-${Date.now()}`,
          spaceId: 'couple-duo-main',
          createdBy: currentUser.id,
          updatedBy: currentUser.id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...eventData,
        };
        const updated = [...localDemoEvents, newEv];
        setLocalDemoEvents(updated);
        duoDataStore.saveCalendarEvents(updated);
      }
    } else if (couple?.id) {
      if (editingEvent) {
        await updateCalendarEvent(couple.id, editingEvent.id, {
          ...eventData,
          updatedBy: currentUser.id,
        });
      } else {
        await addCalendarEvent(couple.id, {
          spaceId: couple.id,
          createdBy: currentUser.id,
          updatedBy: currentUser.id,
          ...eventData,
        });
      }
    }
    setIsFormOpen(false);
    setEditingEvent(null);
  };

  const handleDeleteEvent = async (
    eventId: string,
    recurringScope: 'this' | 'following' | 'all' = 'all',
    instanceDate?: string
  ) => {
    if (isDemoMode) {
      let updated: CalendarEvent[];
      if (recurringScope === 'this' && instanceDate) {
        // Add exception to event
        updated = localDemoEvents.map((ev) => {
          if (ev.id === eventId) {
            return {
              ...ev,
              exceptions: [...(ev.exceptions || []), instanceDate],
            };
          }
          return ev;
        });
      } else {
        // Delete entire event
        updated = localDemoEvents.filter((ev) => ev.id !== eventId);
      }
      setLocalDemoEvents(updated);
      duoDataStore.saveCalendarEvents(updated);
    } else if (couple?.id) {
      if (recurringScope === 'this' && instanceDate) {
        const ev = rawEvents.find((e) => e.id === eventId);
        if (ev) {
          await updateCalendarEvent(couple.id, eventId, {
            exceptions: [...(ev.exceptions || []), instanceDate],
          });
        }
      } else {
        await deleteCalendarEvent(couple.id, eventId);
      }
    }
  };

  const handleDuplicateEvent = (eventToDup: CalendarEvent) => {
    soundEffects.playSuccess();
    const dupTitle = `${eventToDup.title} (Copy)`;
    if (isDemoMode) {
      const newEv: CalendarEvent = {
        ...eventToDup,
        id: `ev-${Date.now()}`,
        title: dupTitle,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const updated = [...localDemoEvents, newEv];
      setLocalDemoEvents(updated);
      duoDataStore.saveCalendarEvents(updated);
    } else if (couple?.id) {
      addCalendarEvent(couple.id, {
        ...eventToDup,
        title: dupTitle,
      });
    }
  };

  const handleDropEventToDate = (eventId: string, targetDateStr: string) => {
    const ev = rawEvents.find((e) => e.id === eventId);
    if (!ev) return;

    let newStartAt = ev.startAt;
    if (ev.startAt) {
      try {
        const oldTimePart = ev.startAt.split('T')[1];
        newStartAt = `${targetDateStr}T${oldTimePart}`;
      } catch {
        newStartAt = null;
      }
    }

    if (isDemoMode) {
      const updated = localDemoEvents.map((e) =>
        e.id === eventId ? { ...e, startDate: targetDateStr, startAt: newStartAt } : e
      );
      setLocalDemoEvents(updated);
      duoDataStore.saveCalendarEvents(updated);
    } else if (couple?.id) {
      updateCalendarEvent(couple.id, eventId, {
        startDate: targetDateStr,
        startAt: newStartAt,
      });
    }
  };

  const handleSlotClick = (dateStr: string, hour: number) => {
    soundEffects.playPop();
    const hh = String(hour).padStart(2, '0');
    setInitialSlotTime(`${hh}:00`);
    setSelectedDate(new Date(dateStr));
    setEditingEvent(null);
    setIsFormOpen(true);
  };

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="w-full max-w-[1600px] mx-auto space-y-6 pb-24 lg:pb-8"
    >
      {/* Friendly Notification Permission Card (if default) */}
      {permissionStatus === 'default' && (
        <div className="p-4 rounded-3xl bg-[var(--surface-2)] border-2 border-[var(--border)] shadow-[0_3px_0_var(--shadow-color)] flex items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] flex items-center justify-center shrink-0">
              <Bell className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div className="min-w-0">
              <h4 className="font-chunky text-sm font-bold text-[var(--text)]">
                Never miss a shared moment
              </h4>
              <p className="font-ui text-xs text-[var(--text-muted)] truncate">
                Enable reminders so you both get notified for dates and plans!
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={requestPermission}
            className="px-4 py-2 rounded-xl bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] font-chunky text-xs font-bold shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none cursor-pointer shrink-0"
          >
            Allow Reminders
          </button>
        </div>
      )}

      {/* Main Calendar Bar: Month/Year, Navigation, View Selector, + New Event */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-[var(--surface)] p-4 sm:p-5 rounded-3xl border-3 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)]">
        {/* Month Title & Prev/Next/Today */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handlePrev}
              title="Previous (PageUp)"
              className="w-9 h-9 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface)] border-2 border-[var(--border)] flex items-center justify-center text-[var(--text)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleNext}
              title="Next (PageDown)"
              className="w-9 h-9 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface)] border-2 border-[var(--border)] flex items-center justify-center text-[var(--text)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setIsMonthPickerOpen(!isMonthPickerOpen)}
              className="font-display text-xl sm:text-2xl text-[var(--text)] hover:opacity-80 transition-opacity flex items-center gap-1.5 cursor-pointer"
            >
              <span>{format(currentDate, 'MMMM yyyy')}</span>
            </button>

            {/* Quick Month/Year Dropdown */}
            {isMonthPickerOpen && (
              <div className="absolute top-full left-0 mt-2 z-40 p-3 bg-[var(--surface)] border-3 border-[var(--border)] rounded-2xl shadow-[0_6px_0_var(--shadow-color)] grid grid-cols-3 gap-1.5 w-64 animate-in fade-in">
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((mIdx) => {
                  const mDate = new Date(currentDate.getFullYear(), mIdx, 1);
                  return (
                    <button
                      key={mIdx}
                      type="button"
                      onClick={() => {
                        soundEffects.playPop();
                        setCurrentDate(mDate);
                        setIsMonthPickerOpen(false);
                      }}
                      className="px-2 py-1.5 rounded-xl text-xs font-ui font-semibold text-[var(--text)] hover:bg-[var(--accent)] border border-[var(--border)] cursor-pointer"
                    >
                      {format(mDate, 'MMM')}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleGoToday}
            className="px-3 py-1.5 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] font-chunky text-xs font-bold shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none cursor-pointer ml-1"
          >
            Today
          </button>
        </div>

        {/* View Switcher & + New Event */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Segmented View Control */}
          <div className="flex items-center p-1 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)]">
            {(['month', 'week', 'day', 'agenda'] as CalendarViewType[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  soundEffects.playPop();
                  setViewType(v);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-ui font-semibold capitalize transition-all cursor-pointer ${
                  viewType === v
                    ? 'bg-[var(--accent)] text-[var(--text)] border border-[var(--border)] shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          {/* Filter: Mine / Other member / Both */}
          <div className="flex items-center gap-1 p-1 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)]">
            {[
              { id: 'all', label: 'All' },
              { id: 'me', label: 'Me' },
              { id: 'partner', label: partnerUser.displayName },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  soundEffects.playPop();
                  setFilterOwner(f.id as any);
                }}
                className={`px-2.5 py-1 rounded-xl text-[11px] font-ui font-semibold transition-all cursor-pointer ${
                  filterOwner === f.id
                    ? 'bg-[var(--text)] text-[var(--surface)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* + New Event Button */}
          <button
            type="button"
            onClick={() => {
              soundEffects.playPop();
              setEditingEvent(null);
              setInitialSlotTime(undefined);
              setIsFormOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] font-chunky font-bold text-xs shadow-[0_3px_0_var(--shadow-color)] active:translate-y-1 active:shadow-none cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>New Event</span>
          </button>
        </div>
      </div>

      {/* Main View Area (Month / Week / Day / Agenda) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Left Column: Calendar Grid / Timeline */}
        <div className="min-w-0">
          {viewType === 'month' && (
            <MonthView
              currentDate={currentDate}
              selectedDate={selectedDate}
              events={expandedEvents}
              onSelectDate={(date) => {
                setSelectedDate(date);
              }}
              onOpenEvent={(ev) => setSelectedEvent(ev)}
              onDropEventToDate={handleDropEventToDate}
            />
          )}

          {viewType === 'week' && (
            <WeekView
              currentDate={currentDate}
              events={expandedEvents}
              onOpenEvent={(ev) => setSelectedEvent(ev)}
              onSlotClick={handleSlotClick}
            />
          )}

          {viewType === 'day' && (
            <DayView
              currentDate={currentDate}
              events={expandedEvents}
              onOpenEvent={(ev) => setSelectedEvent(ev)}
              onSlotClick={handleSlotClick}
            />
          )}

          {viewType === 'agenda' && (
            <AgendaView
              events={expandedEvents}
              onOpenEvent={(ev) => setSelectedEvent(ev)}
              onNewEvent={() => {
                setEditingEvent(null);
                setIsFormOpen(true);
              }}
            />
          )}
        </div>

        {/* Right Side Panel on Desktop (or below on mobile): Selected Day Agenda & Upcoming */}
        <div className="space-y-5">
          <PeriodTrackerCard
            tracker={periodTracker}
            onSave={savePeriodTracker}
            currentUserId={currentUser.id}
          />
          {/* Selected Date Summary Card */}
          <div className="p-5 rounded-3xl bg-[var(--surface)] border-3 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)] space-y-3.5">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-ui font-semibold text-[var(--text-muted)] uppercase">
                  {format(selectedDate, 'EEEE')}
                </span>
                <h4 className="font-chunky text-lg font-bold text-[var(--text)]">
                  {format(selectedDate, 'MMMM d')}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => {
                  soundEffects.playPop();
                  setEditingEvent(null);
                  setIsFormOpen(true);
                }}
                className="w-8 h-8 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--accent)] border-2 border-[var(--border)] flex items-center justify-center text-[var(--text)] cursor-pointer"
                title="Add event on this day"
              >
                <Plus className="w-4 h-4 stroke-[3]" />
              </button>
            </div>

            {/* List of events on this selected date */}
            <div className="space-y-2 pt-2 border-t-2 border-[var(--border)]">
              {selectedDayEvents.length === 0 ? (
                <div className="py-6 text-center text-xs text-[var(--text-muted)] font-ui">
                  No events on this day. Tap + to plan one! 🌸
                </div>
              ) : (
                selectedDayEvents.map((ev) => (
                  <div
                    key={`${ev.id}-${ev.instanceDate}`}
                    onClick={() => {
                      soundEffects.playPop();
                      setSelectedEvent(ev);
                    }}
                    style={{ borderLeftColor: ev.color }}
                    className="p-3 rounded-2xl bg-[var(--surface-2)] hover:bg-[var(--surface-2)]/80 border-2 border-[var(--border)] border-l-4 text-xs cursor-pointer shadow-xs transition-transform hover:scale-[1.02]"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-chunky font-bold text-[var(--text)] truncate">
                        {ev.icon} {ev.title}
                      </span>
                      <span className="font-numeric text-[11px] font-bold text-[var(--text)]">
                        {formatEventTime(ev, currentUser.timezone)}
                      </span>
                    </div>
                    {ev.location && (
                      <div className="text-[11px] text-[var(--text-muted)] font-ui mt-0.5">
                        📍 {ev.location}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Quick Love / Reminder Hint */}
          <div className="p-4 rounded-3xl bg-[var(--surface-2)] border-2 border-[var(--border)] text-xs text-[var(--text-muted)] font-ui space-y-1.5 shadow-[0_2px_0_var(--shadow-color)]">
            <div className="flex items-center gap-1.5 font-bold text-[var(--text)]">
              <Sparkles className="w-4 h-4 text-[var(--accent)]" />
              <span>Keyboard Shortcuts</span>
            </div>
            <p>
              Use <strong>Arrow keys</strong> to move days, <strong>T</strong> for Today, and{' '}
              <strong>N</strong> for a New event.
            </p>
          </div>
        </div>
      </div>

      {/* Add / Edit Event Modal */}
      <EventFormModal
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setEditingEvent(null);
        }}
        onSave={handleSaveEvent}
        initialDate={format(selectedDate, 'yyyy-MM-dd')}
        initialTime={initialSlotTime}
        initialEvent={editingEvent}
      />

      {/* Event Details Sheet */}
      <EventDetailModal
        isOpen={selectedEvent !== null}
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
        onEdit={(ev) => {
          setSelectedEvent(null);
          setEditingEvent(ev);
          setIsFormOpen(true);
        }}
        onDelete={(eventId, scope, instDate) => {
          handleDeleteEvent(eventId, scope, instDate);
          setSelectedEvent(null);
        }}
        onDuplicate={(ev) => {
          handleDuplicateEvent(ev);
          setSelectedEvent(null);
        }}
      />
    </div>
  );
};
