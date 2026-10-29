import React, { useState } from 'react';
import type { CalendarEvent, ExpandedCalendarEvent } from '../../lib/calendar';
import { formatDualTimezone, getEventCountdown } from '../../lib/calendar';
import { useAuthStore } from '../../lib/store';
import { soundEffects } from '../../lib/sound';
import {
  X,
  Clock,
  MapPin,
  AlignLeft,
  Link as LinkIcon,
  Bell,
  Edit2,
  Trash2,
  Copy,
  Repeat,
  ExternalLink,
} from 'lucide-react';

interface EventDetailModalProps {
  event: ExpandedCalendarEvent | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (event: CalendarEvent) => void;
  onDelete: (eventId: string, recurringScope?: 'this' | 'following' | 'all', instanceDate?: string) => void;
  onDuplicate: (event: CalendarEvent) => void;
}

export const EventDetailModal: React.FC<EventDetailModalProps> = ({
  event,
  isOpen,
  onClose,
  onEdit,
  onDelete,
  onDuplicate,
}) => {
  const { currentUser, partnerUser, timeFormat } = useAuthStore();
  const [deleteRecurringScope, setDeleteRecurringScope] = useState<'this' | 'all' | null>(null);

  if (!isOpen || !event) return null;

  const dualTimeStr = formatDualTimezone(
    event,
    currentUser.timezone,
    partnerUser.displayName,
    partnerUser.timezone,
    timeFormat === '12h' ? true : timeFormat === '24h' ? false : undefined
  );

  const countdown = getEventCountdown(event);

  const handleDeleteClick = () => {
    soundEffects.playPop();
    if (event.repeatRule) {
      setDeleteRecurringScope('this');
    } else {
      if (confirm(`Delete "${event.title}"?`)) {
        onDelete(event.id);
        onClose();
      }
    }
  };

  const handleConfirmRecurringDelete = (scope: 'this' | 'all') => {
    soundEffects.playPop();
    onDelete(event.id, scope, event.instanceDate);
    setDeleteRecurringScope(null);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[70] bg-[var(--overlay)] flex flex-col justify-end sm:justify-center sm:items-center p-0 sm:p-4 animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-[var(--surface)] text-[var(--text)] border-t-3 sm:border-3 border-[var(--border)] rounded-t-3xl sm:rounded-3xl shadow-[0_6px_0_var(--shadow-color)] overflow-hidden max-h-[88vh] max-h-[88dvh] flex flex-col"
      >
        {/* Header Banner */}
        <div
          style={{ borderTopColor: event.color }}
          className="p-5 bg-[var(--surface-2)] border-b-2 border-[var(--border)] flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-3 min-w-0">
            <div
              style={{ backgroundColor: event.color }}
              className="w-12 h-12 rounded-2xl border-2 border-[var(--border)] text-white flex items-center justify-center text-2xl shadow-[0_2px_0_var(--shadow-color)] shrink-0"
            >
              {event.icon || '🌸'}
            </div>
            <div className="min-w-0">
              <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-chunky font-bold uppercase tracking-wider bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] mb-1">
                {countdown}
              </span>
              <h3 className="font-chunky text-xl font-bold text-[var(--text)] leading-tight truncate">
                {event.title}
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-[var(--surface)] hover:bg-[var(--surface-2)] border-2 border-[var(--border)] flex items-center justify-center text-[var(--text)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1 font-body text-sm">
          {/* Time & Timezone Conversion */}
          <div className="p-3.5 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] flex items-center gap-3">
            <Clock className="w-5 h-5 text-[var(--accent)] shrink-0" />
            <div className="min-w-0">
              <span className="font-chunky text-sm font-bold text-[var(--text)] block">
                {dualTimeStr}
              </span>
              <span className="font-ui text-xs text-[var(--text-muted)] block truncate">
                Date: {event.instanceDate || event.startDate}
              </span>
            </div>
          </div>

          {/* Location */}
          {event.location && (
            <div className="flex items-center gap-3 text-xs text-[var(--text)]">
              <MapPin className="w-4 h-4 text-[var(--accent)] shrink-0" />
              <span className="font-medium">{event.location}</span>
            </div>
          )}

          {/* Link */}
          {event.link && (
            <div className="flex items-center gap-3 text-xs">
              <LinkIcon className="w-4 h-4 text-[var(--accent)] shrink-0" />
              <a
                href={event.link}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--partner-b)] hover:underline inline-flex items-center gap-1 font-medium truncate"
              >
                <span>{event.link}</span>
                <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            </div>
          )}

          {/* Notes */}
          {event.notes && (
            <div className="p-3.5 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-ui font-semibold">
                <AlignLeft className="w-3.5 h-3.5" />
                <span>Notes</span>
              </div>
              <p className="text-xs text-[var(--text)] whitespace-pre-wrap">{event.notes}</p>
            </div>
          )}

          {/* Repeat Details */}
          {event.repeatRule && (
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] font-ui">
              <Repeat className="w-4 h-4 text-[var(--accent)]" />
              <span>Repeats {event.repeatRule.frequency}</span>
            </div>
          )}

          {/* Reminders List */}
          {event.reminders && event.reminders.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-xs font-ui font-semibold text-[var(--text-muted)] flex items-center gap-1.5">
                <Bell className="w-3.5 h-3.5 text-[var(--accent)]" />
                <span>Scheduled Reminders</span>
              </span>
              <div className="flex flex-wrap gap-1.5">
                {event.reminders.map((r, idx) => (
                  <span
                    key={idx}
                    className="px-2.5 py-1 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-xs font-ui text-[var(--text)]"
                  >
                    🔔 {r.minutesBefore === 0 ? 'At event' : `${r.minutesBefore >= 60 ? `${r.minutesBefore / 60}h` : `${r.minutesBefore}m`} before`}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Scope Selection for Recurring Deletion */}
          {deleteRecurringScope && (
            <div className="p-3.5 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--urgent)] space-y-2 animate-in fade-in">
              <p className="text-xs font-ui font-semibold text-[var(--urgent)]">
                This is a repeating event. Which occurrences would you like to delete?
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleConfirmRecurringDelete('this')}
                  className="flex-1 py-1.5 px-3 rounded-xl bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] font-chunky text-xs cursor-pointer"
                >
                  Only this event
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirmRecurringDelete('all')}
                  className="flex-1 py-1.5 px-3 rounded-xl bg-[var(--urgent)] text-white font-chunky text-xs cursor-pointer"
                >
                  All occurrences
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t-2 border-[var(--border)] bg-[var(--surface-2)] pb-[calc(14px+env(safe-area-inset-bottom,0px))] sm:pb-4 flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={handleDeleteClick}
            className="p-2.5 min-h-[44px] min-w-[44px] rounded-2xl bg-[var(--surface)] hover:bg-[var(--urgent)]/20 text-[var(--urgent)] border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none cursor-pointer flex items-center justify-center"
            title="Delete Event"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                soundEffects.playPop();
                onDuplicate(event);
                onClose();
              }}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-2xl bg-[var(--surface)] hover:bg-[var(--surface-2)] border-2 border-[var(--border)] text-[var(--text)] font-chunky text-xs shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Duplicate</span>
            </button>

            <button
              type="button"
              onClick={() => {
                soundEffects.playPop();
                onEdit(event);
                onClose();
              }}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 min-h-[44px] rounded-2xl bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] font-chunky font-bold text-xs shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none cursor-pointer"
            >
              <Edit2 className="w-3.5 h-3.5" />
              <span>Edit</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
