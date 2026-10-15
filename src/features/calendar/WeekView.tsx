import React, { useEffect, useRef } from 'react';
import { format, isToday } from 'date-fns';
import type { ExpandedCalendarEvent } from '../../lib/calendar';
import { getWeekViewDays, formatEventTime } from '../../lib/calendar';
import { useMinuteNow } from '../../lib/useNow';
import { useAuthStore } from '../../lib/store';
import { soundEffects } from '../../lib/sound';

interface WeekViewProps {
  currentDate: Date;
  events: ExpandedCalendarEvent[];
  onOpenEvent: (event: ExpandedCalendarEvent) => void;
  onSlotClick?: (dateStr: string, hour: number) => void;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export const WeekView: React.FC<WeekViewProps> = ({
  currentDate,
  events,
  onOpenEvent,
  onSlotClick,
}) => {
  const now = useMinuteNow();
  const { firstDayOfWeek, currentUser, timeFormat } = useAuthStore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const days = getWeekViewDays(currentDate, firstDayOfWeek);

  // Auto-scroll to current hour minus 1 on initial load
  useEffect(() => {
    if (scrollContainerRef.current) {
      const currentHour = now.getHours();
      const scrollPos = Math.max(0, (currentHour - 1) * 60); // 60px per hour
      scrollContainerRef.current.scrollTop = scrollPos;
    }
  }, []); // Run on mount

  // Now indicator position in minutes (0 to 1440)
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const currentNowTop = (currentMinutes / 60) * 60; // 60px height per hour = 1px per min

  return (
    <div className="w-full bg-[var(--surface)] border-3 border-[var(--border)] rounded-3xl shadow-[0_4px_0_var(--shadow-color)] overflow-hidden flex flex-col">
      {/* Week Header (Dates) */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b-2 border-[var(--border)] bg-[var(--surface-2)] shrink-0">
        <div className="p-3 border-r-2 border-[var(--border)] text-[11px] font-ui font-semibold text-[var(--text-muted)] text-center">
          Time
        </div>
        {days.map((day, idx) => {
          const isCurrent = isToday(day);
          return (
            <div
              key={idx}
              className={`py-2.5 px-1 text-center border-r border-[var(--border)] last:border-r-0 ${
                isCurrent ? 'bg-[var(--accent)]/30' : ''
              }`}
            >
              <div className="text-[11px] font-ui font-semibold text-[var(--text-muted)] uppercase">
                {format(day, 'EEE')}
              </div>
              <div
                className={`inline-block px-2 py-0.5 rounded-lg text-xs font-numeric font-bold mt-0.5 ${
                  isCurrent
                    ? 'bg-[var(--accent)] text-[var(--text)] border border-[var(--border)]'
                    : 'text-[var(--text)]'
                }`}
              >
                {format(day, 'd')}
              </div>
            </div>
          );
        })}
      </div>

      {/* All-Day Row on Top */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b-2 border-[var(--border)] bg-[var(--surface-2)]/60 min-h-[40px] shrink-0">
        <div className="p-2 border-r-2 border-[var(--border)] text-[10px] font-ui font-bold text-[var(--text-muted)] flex items-center justify-center">
          All-day
        </div>
        {days.map((day, idx) => {
          const dayStr = format(day, 'yyyy-MM-dd');
          const allDayEvents = events.filter((ev) => ev.allDay && ev.instanceDate === dayStr);
          return (
            <div
              key={idx}
              className="p-1 border-r border-[var(--border)] last:border-r-0 space-y-1"
            >
              {allDayEvents.map((ev) => (
                <div
                  key={`${ev.id}-${ev.instanceDate}`}
                  onClick={() => {
                    soundEffects.playPop();
                    onOpenEvent(ev);
                  }}
                  style={{ backgroundColor: ev.color }}
                  className="px-1.5 py-0.5 rounded-md text-[10px] font-chunky font-bold text-white truncate cursor-pointer shadow-2xs hover:scale-105 transition-transform"
                >
                  {ev.icon} {ev.title}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* 24-Hour Timeline Grid with Real-Time "Now" Line */}
      <div
        ref={scrollContainerRef}
        className="overflow-y-auto h-[calc(100vh-270px)] min-h-[460px] max-h-[760px] relative divide-y divide-[var(--border)]"
      >
        {HOURS.map((hour) => (
          <div
            key={hour}
            className="grid grid-cols-[60px_repeat(7,1fr)] min-h-[60px] divide-x divide-[var(--border)] relative"
          >
            {/* Hour Label */}
            <div className="p-1 text-right pr-2 text-[11px] font-numeric text-[var(--text-muted)] border-r-2 border-[var(--border)] bg-[var(--surface-2)]/40 select-none">
              {timeFormat === '24h'
                ? `${String(hour).padStart(2, '0')}:00`
                : `${hour === 0 ? 12 : hour > 12 ? hour - 12 : hour} ${hour >= 12 ? 'PM' : 'AM'}`}
            </div>

            {/* 7 Columns for Each Day */}
            {days.map((day, dIdx) => {
              const dayStr = format(day, 'yyyy-MM-dd');
              const isCurrentDay = isToday(day);

              // Find timed events starting in this hour
              const hourEvents = events.filter((ev) => {
                if (ev.allDay || !ev.startAt || ev.instanceDate !== dayStr) return false;
                try {
                  const evDate = new Date(ev.startAt);
                  return evDate.getHours() === hour;
                } catch {
                  return false;
                }
              });

              return (
                <div
                  key={dIdx}
                  onClick={() => onSlotClick?.(dayStr, hour)}
                  className={`relative p-1 hover:bg-[var(--surface-2)]/30 transition-colors cursor-pointer ${
                    isCurrentDay ? 'bg-[var(--accent)]/5' : ''
                  }`}
                >
                  {hourEvents.map((ev) => (
                    <div
                      key={`${ev.id}-${ev.instanceDate}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        soundEffects.playPop();
                        onOpenEvent(ev);
                      }}
                      style={{
                        borderLeftColor: ev.color,
                        backgroundColor: 'var(--surface-2)',
                      }}
                      className="p-1.5 rounded-xl border-l-4 border-[var(--border)] text-xs text-[var(--text)] font-ui shadow-2xs hover:scale-102 transition-transform cursor-pointer mb-1"
                    >
                      <div className="font-chunky font-bold text-xs truncate flex items-center gap-1">
                        <span>{ev.icon || '🌸'}</span>
                        <span className="truncate">{ev.title}</span>
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] font-numeric">
                        {formatEventTime(ev, currentUser.timezone, timeFormat === '12h')}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}

        {/* Live "Now" Line across the grid (in --urgent) */}
        <div
          style={{ top: `${currentNowTop}px` }}
          className="absolute left-[60px] right-0 z-30 pointer-events-none flex items-center"
        >
          <div className="w-2.5 h-2.5 rounded-full bg-[var(--urgent)] -ml-1.5 border-2 border-[var(--surface)] shadow-xs" />
          <div className="h-0.5 flex-1 bg-[var(--urgent)]" />
        </div>
      </div>
    </div>
  );
};
