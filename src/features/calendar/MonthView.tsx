import React from 'react';
import {
  format,
  isSameMonth,
  isSameDay,
  isToday,
} from 'date-fns';
import type { ExpandedCalendarEvent } from '../../lib/calendar';
import { getMonthViewDays, formatEventTime } from '../../lib/calendar';
import { useAuthStore } from '../../lib/store';
import { soundEffects } from '../../lib/sound';

interface MonthViewProps {
  currentDate: Date;
  selectedDate: Date;
  events: ExpandedCalendarEvent[];
  onSelectDate: (date: Date) => void;
  onOpenEvent: (event: ExpandedCalendarEvent) => void;
  onDropEventToDate?: (eventId: string, targetDateStr: string) => void;
}

const WEEKDAY_NAMES_SUNDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_NAMES_MONDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const MonthView: React.FC<MonthViewProps> = ({
  currentDate,
  selectedDate,
  events,
  onSelectDate,
  onOpenEvent,
  onDropEventToDate,
}) => {
  const { firstDayOfWeek, currentUser, timeFormat } = useAuthStore();
  const days = getMonthViewDays(currentDate, firstDayOfWeek);
  const weekdays = firstDayOfWeek === 'monday' ? WEEKDAY_NAMES_MONDAY : WEEKDAY_NAMES_SUNDAY;

  const handleDragStart = (e: React.DragEvent, eventId: string) => {
    e.dataTransfer.setData('text/plain', eventId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, dayStr: string) => {
    e.preventDefault();
    const eventId = e.dataTransfer.getData('text/plain');
    if (eventId && onDropEventToDate) {
      soundEffects.playPop();
      onDropEventToDate(eventId, dayStr);
    }
  };

  return (
    <div className="w-full bg-[var(--surface)] border-3 border-[var(--border)] rounded-3xl shadow-[0_4px_0_var(--shadow-color)] overflow-hidden">
      {/* Weekday Labels Header */}
      <div className="grid grid-cols-7 border-b-2 border-[var(--border)] bg-[var(--surface-2)]">
        {weekdays.map((dayName, idx) => (
          <div
            key={idx}
            className="py-3 text-center text-xs font-ui font-semibold text-[var(--text-muted)] tracking-wider"
          >
            {dayName}
          </div>
        ))}
      </div>

      {/* 7-Column Calendar Grid */}
      <div className="grid grid-cols-7 auto-rows-fr divide-x-2 divide-y-2 divide-[var(--border)] bg-[var(--border)]">
        {days.map((day, idx) => {
          const dayStr = format(day, 'yyyy-MM-dd');
          const isCurrentMonth = isSameMonth(day, currentDate);
          const isSelected = isSameDay(day, selectedDate);
          const isCurrentDay = isToday(day);

          // Get events matching this date
          const dayEvents = events.filter((ev) => ev.instanceDate === dayStr);
          const visibleEvents = dayEvents.slice(0, 3);
          const extraCount = dayEvents.length - 3;

          return (
            <div
              key={idx}
              onClick={() => {
                soundEffects.playPop();
                onSelectDate(day);
              }}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, dayStr)}
              className={`min-h-[86px] sm:min-h-[110px] p-1.5 sm:p-2 transition-colors cursor-pointer flex flex-col justify-between ${
                isCurrentMonth ? 'bg-[var(--surface)]' : 'bg-[var(--surface-2)]/60 text-[var(--text-muted)]'
              } ${
                isSelected
                  ? 'ring-3 ring-inset ring-[var(--accent)] bg-[var(--surface-2)]'
                  : 'hover:bg-[var(--surface-2)]/40'
              }`}
            >
              {/* Day Number Header */}
              <div className="flex items-center justify-between">
                <span
                  className={`w-7 h-7 flex items-center justify-center rounded-xl text-xs sm:text-sm font-numeric font-bold transition-all ${
                    isCurrentDay
                      ? 'bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] shadow-xs scale-105'
                      : isSelected
                      ? 'bg-[var(--text)] text-[var(--surface)]'
                      : isCurrentMonth
                      ? 'text-[var(--text)]'
                      : 'text-[var(--text-muted)] opacity-60'
                  }`}
                >
                  {format(day, 'd')}
                </span>

                {dayEvents.length > 0 && (
                  <span className="text-[10px] font-chunky text-[var(--text-muted)] hidden sm:inline">
                    {dayEvents.length} {dayEvents.length === 1 ? 'event' : 'events'}
                  </span>
                )}
              </div>

              {/* Event Chips (up to 3 + more) */}
              <div className="mt-1 space-y-1 flex-1 overflow-hidden">
                {visibleEvents.map((ev) => (
                  <div
                    key={`${ev.id}-${ev.instanceDate}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, ev.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      soundEffects.playPop();
                      onOpenEvent(ev);
                    }}
                    style={{
                      borderLeftColor: ev.color,
                      backgroundColor: 'var(--surface-2)',
                    }}
                    className="px-1.5 py-0.5 rounded-lg border-l-3 border-[var(--border)] text-[11px] font-ui font-medium text-[var(--text)] truncate hover:scale-[1.02] active:scale-95 transition-transform flex items-center gap-1 shadow-2xs"
                    title={`${ev.title} (${formatEventTime(ev, currentUser.timezone, timeFormat === '12h')})`}
                  >
                    <span>{ev.icon || '🌸'}</span>
                    <span className="truncate flex-1 font-chunky text-[11px] font-bold">
                      {ev.title}
                    </span>
                  </div>
                ))}

                {extraCount > 0 && (
                  <div className="text-[10px] font-chunky font-bold text-[var(--text-muted)] px-1">
                    +{extraCount} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
