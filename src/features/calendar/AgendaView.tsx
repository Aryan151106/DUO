import React from 'react';
import { format, parseISO, addDays } from 'date-fns';
import type { ExpandedCalendarEvent } from '../../lib/calendar';
import { formatEventTime, getEventCountdown } from '../../lib/calendar';
import { useAuthStore } from '../../lib/store';
import { soundEffects } from '../../lib/sound';
import { Clock, MapPin } from 'lucide-react';

interface AgendaViewProps {
  events: ExpandedCalendarEvent[];
  onOpenEvent: (event: ExpandedCalendarEvent) => void;
  onNewEvent: () => void;
}

export const AgendaView: React.FC<AgendaViewProps> = ({
  events,
  onOpenEvent,
  onNewEvent,
}) => {
  const { currentUser, timeFormat } = useAuthStore();

  const now = new Date();
  const tomorrowStr = format(addDays(now, 1), 'yyyy-MM-dd');
  const todayStr = format(now, 'yyyy-MM-dd');

  // Group events by instanceDate
  const grouped: Record<string, ExpandedCalendarEvent[]> = {};
  for (const ev of events) {
    if (!grouped[ev.instanceDate]) {
      grouped[ev.instanceDate] = [];
    }
    grouped[ev.instanceDate].push(ev);
  }

  const sortedDates = Object.keys(grouped).sort();

  if (sortedDates.length === 0) {
    return (
      <div className="w-full bg-[var(--surface)] border-3 border-dashed border-[var(--border)] rounded-3xl p-12 text-center shadow-[0_4px_0_var(--shadow-color)]">
        <div className="w-16 h-16 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] flex items-center justify-center mx-auto mb-3 text-3xl shadow-[0_2px_0_var(--shadow-color)]">
          📅
        </div>
        <h4 className="font-chunky text-xl font-bold text-[var(--text)] mb-1">
          No Upcoming Events
        </h4>
        <p className="font-body text-xs sm:text-sm text-[var(--text-muted)] max-w-sm mx-auto mb-5">
          Schedule your next dinner date, trip, or sweet little plan together!
        </p>
        <button
          type="button"
          onClick={onNewEvent}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-[var(--accent)] text-[var(--text)] font-chunky font-bold text-xs border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-1 active:shadow-none cursor-pointer"
        >
          <span>Plan an Event</span>
        </button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      {sortedDates.map((dateStr) => {
        const dayEvents = grouped[dateStr];
        const dateObj = parseISO(dateStr);
        const isCurrent = dateStr === todayStr;
        const isTomorrow = dateStr === tomorrowStr;

        return (
          <div key={dateStr} className="space-y-3">
            {/* Group Header */}
            <div className="flex items-center gap-2.5">
              <span className="font-chunky text-base font-bold text-[var(--text)]">
                {format(dateObj, 'EEEE, MMMM d')}
              </span>
              {isCurrent && (
                <span className="px-2.5 py-0.5 rounded-full bg-[var(--accent)] text-[var(--text)] border border-[var(--border)] font-chunky text-xs font-bold shadow-xs">
                  Today ✨
                </span>
              )}
              {isTomorrow && (
                <span className="px-2.5 py-0.5 rounded-full bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] font-chunky text-xs font-semibold">
                  Tomorrow
                </span>
              )}
            </div>

            {/* Event Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {dayEvents.map((ev) => {
                const countdown = getEventCountdown(ev, now);
                const timeText = formatEventTime(ev, currentUser.timezone, timeFormat === '12h');

                return (
                  <div
                    key={`${ev.id}-${ev.instanceDate}`}
                    onClick={() => {
                      soundEffects.playPop();
                      onOpenEvent(ev);
                    }}
                    style={{
                      borderLeftColor: ev.color,
                    }}
                    className="p-4 rounded-3xl bg-[var(--surface)] hover:bg-[var(--surface-2)]/50 border-2 border-[var(--border)] border-l-6 shadow-[0_3px_0_var(--shadow-color)] transition-all cursor-pointer space-y-2 hover:-translate-y-0.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-2xl shrink-0">{ev.icon || '🌸'}</span>
                        <h4 className="font-chunky text-base font-bold text-[var(--text)] truncate">
                          {ev.title}
                        </h4>
                      </div>
                      <span className="text-[11px] font-chunky font-bold px-2 py-0.5 rounded-full bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] shrink-0">
                        {countdown}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-[var(--text-muted)] font-ui">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-[var(--accent)]" />
                        <span>{timeText}</span>
                      </span>

                      {ev.location && (
                        <span className="flex items-center gap-1 truncate">
                          <MapPin className="w-3.5 h-3.5 text-[var(--accent)]" />
                          <span className="truncate">{ev.location}</span>
                        </span>
                      )}
                    </div>

                    {ev.notes && (
                      <p className="font-body text-xs text-[var(--text)] line-clamp-2 bg-[var(--surface-2)] p-2 rounded-xl border border-[var(--border)]">
                        {ev.notes}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};
