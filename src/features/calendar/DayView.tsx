import React, { useEffect, useRef } from 'react';
import { format, isToday } from 'date-fns';
import type { ExpandedCalendarEvent } from '../../lib/calendar';
import { formatEventTime } from '../../lib/calendar';
import { useMinuteNow } from '../../lib/useNow';
import { useAuthStore } from '../../lib/store';
import { soundEffects } from '../../lib/sound';

interface DayViewProps {
  currentDate: Date;
  events: ExpandedCalendarEvent[];
  onOpenEvent: (event: ExpandedCalendarEvent) => void;
  onSlotClick?: (dateStr: string, hour: number) => void;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export const DayView: React.FC<DayViewProps> = ({
  currentDate,
  events,
  onOpenEvent,
  onSlotClick,
}) => {
  const now = useMinuteNow();
  const { currentUser, timeFormat } = useAuthStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  const dateStr = format(currentDate, 'yyyy-MM-dd');
  const isCurrentDay = isToday(currentDate);

  useEffect(() => {
    if (scrollRef.current) {
      const scrollPos = Math.max(0, (now.getHours() - 1) * 64);
      scrollRef.current.scrollTop = scrollPos;
    }
  }, []);

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const currentNowTop = (currentMinutes / 60) * 64;

  const dayEvents = events.filter((ev) => ev.instanceDate === dateStr);
  const allDayEvents = dayEvents.filter((ev) => ev.allDay);

  return (
    <div className="w-full bg-[var(--surface)] border-3 border-[var(--border)] rounded-3xl shadow-[0_4px_0_var(--shadow-color)] overflow-hidden flex flex-col">
      {/* Day Banner Header */}
      <div className="p-4 border-b-2 border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-between">
        <div>
          <span className="text-xs font-ui font-semibold text-[var(--text-muted)] uppercase">
            {format(currentDate, 'EEEE')}
          </span>
          <h3 className="font-display text-xl text-[var(--text)]">
            {format(currentDate, 'MMMM d, yyyy')}
          </h3>
        </div>
        {isCurrentDay && (
          <span className="px-3 py-1 rounded-full bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] font-chunky text-xs font-bold shadow-xs">
            Today ✨
          </span>
        )}
      </div>

      {/* All-Day Events row */}
      {allDayEvents.length > 0 && (
        <div className="p-3 border-b-2 border-[var(--border)] bg-[var(--surface-2)]/60 flex flex-wrap gap-2">
          <span className="text-xs font-ui font-bold text-[var(--text-muted)] self-center mr-1">
            All Day:
          </span>
          {allDayEvents.map((ev) => (
            <div
              key={`${ev.id}-${ev.instanceDate}`}
              onClick={() => {
                soundEffects.playPop();
                onOpenEvent(ev);
              }}
              style={{ backgroundColor: ev.color }}
              className="px-2.5 py-1 rounded-xl text-xs font-chunky font-bold text-white shadow-2xs hover:scale-105 transition-transform cursor-pointer flex items-center gap-1.5"
            >
              <span>{ev.icon}</span>
              <span>{ev.title}</span>
            </div>
          ))}
        </div>
      )}

      {/* Hour Axis Timeline */}
      <div
        ref={scrollRef}
        className="overflow-y-auto h-[calc(100vh-270px)] min-h-[460px] max-h-[760px] relative divide-y divide-[var(--border)]"
      >
        {HOURS.map((hour) => {
          const hourEvents = dayEvents.filter((ev) => {
            if (ev.allDay || !ev.startAt) return false;
            try {
              return new Date(ev.startAt).getHours() === hour;
            } catch {
              return false;
            }
          });

          return (
            <div
              key={hour}
              onClick={() => onSlotClick?.(dateStr, hour)}
              className="grid grid-cols-[70px_1fr] min-h-[64px] divide-x divide-[var(--border)] hover:bg-[var(--surface-2)]/30 transition-colors cursor-pointer relative"
            >
              <div className="p-2 text-right pr-3 text-xs font-numeric text-[var(--text-muted)] bg-[var(--surface-2)]/30 select-none">
                {timeFormat === '24h'
                  ? `${String(hour).padStart(2, '0')}:00`
                  : `${hour === 0 ? 12 : hour > 12 ? hour - 12 : hour} ${hour >= 12 ? 'PM' : 'AM'}`}
              </div>

              <div className="p-2 space-y-1.5">
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
                    className="p-3 rounded-2xl border-l-4 border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] hover:scale-[1.01] transition-transform cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{ev.icon || '🌸'}</span>
                        <h4 className="font-chunky text-sm font-bold text-[var(--text)]">
                          {ev.title}
                        </h4>
                      </div>
                      <span className="text-xs font-numeric font-bold text-[var(--text)]">
                        {formatEventTime(ev, currentUser.timezone, timeFormat === '12h')}
                      </span>
                    </div>
                    {ev.location && (
                      <div className="text-xs text-[var(--text-muted)] font-ui mt-1">
                        📍 {ev.location}
                      </div>
                    )}
                    {ev.notes && (
                      <p className="text-xs text-[var(--text)] font-body mt-1 line-clamp-1">
                        {ev.notes}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* Live "Now" Line */}
        {isCurrentDay && (
          <div
            style={{ top: `${currentNowTop}px` }}
            className="absolute left-[70px] right-0 z-30 pointer-events-none flex items-center"
          >
            <div className="w-3 h-3 rounded-full bg-[var(--urgent)] -ml-1.5 border-2 border-[var(--surface)] shadow-xs" />
            <div className="h-0.5 flex-1 bg-[var(--urgent)]" />
          </div>
        )}
      </div>
    </div>
  );
};
