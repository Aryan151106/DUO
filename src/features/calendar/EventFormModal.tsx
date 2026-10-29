import React, { useState, useEffect } from 'react';
import type { CalendarEvent, RepeatRule, EventFrequency, RecurrenceEndType } from '../../lib/calendar';
import { buildReminders } from '../../lib/calendar';
import { useAuthStore } from '../../lib/store';
import { soundEffects } from '../../lib/sound';
import {
  X,
  Clock,
  MapPin,
  AlignLeft,
  Link as LinkIcon,
  Bell,
  Repeat,
} from 'lucide-react';

interface EventFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (event: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt' | 'spaceId' | 'createdBy' | 'updatedBy'>) => void;
  initialDate?: string;
  initialTime?: string;
  initialEvent?: CalendarEvent | null;
}

const COLOR_OPTIONS = [
  { name: 'Alex', value: 'var(--partner-a)' },
  { name: 'Sam', value: 'var(--partner-b)' },
  { name: 'Butter', value: 'var(--accent)' },
  { name: 'Blush', value: 'var(--accent-2)' },
  { name: 'Sage', value: 'var(--success)' },
  { name: 'Coral', value: 'var(--urgent)' },
];

const EMOJI_OPTIONS = ['🌸', '🍝', '☕', '🎬', '✈️', '🥂', '🚲', '🎂', '💖', '⭐', '🛒', '🐾'];

const TIMED_REMINDER_CHIPS = [
  { label: 'At event', minutes: 0 },
  { label: '5m before', minutes: 5 },
  { label: '10m before', minutes: 10 },
  { label: '15m before', minutes: 15 },
  { label: '30m before', minutes: 30 },
  { label: '1h before', minutes: 60 },
  { label: '2h before', minutes: 120 },
  { label: '1d before', minutes: 1440 },
  { label: '2d before', minutes: 2880 },
  { label: '1w before', minutes: 10080 },
];

const ALL_DAY_REMINDER_CHIPS = [
  { label: 'On the day', minutes: 0 },
  { label: '1 day before', minutes: 1440 },
  { label: '1 week before', minutes: 10080 },
];

export const EventFormModal: React.FC<EventFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialDate,
  initialTime,
  initialEvent,
}) => {
  const { currentUser, partnerUser } = useAuthStore();

  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [startTime, setStartTime] = useState('09:00');
  const [ownerTarget, setOwnerTarget] = useState<'me' | 'partner' | 'both'>('both');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [link, setLink] = useState('');
  const [color, setColor] = useState('var(--partner-a)');
  const [icon, setIcon] = useState('🌸');

  // Recurrence
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState<EventFrequency>('weekly');
  const [endType, setEndType] = useState<RecurrenceEndType>('never');
  const [endDate, setEndDate] = useState('');
  const [endCount, setEndCount] = useState(10);

  // Reminders
  const [selectedReminderMinutes, setSelectedReminderMinutes] = useState<number[]>([15]);
  const [customMinutes, setCustomMinutes] = useState<string>('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [remindTarget, setRemindTarget] = useState<'me' | 'partner' | 'both'>('both');
  const [reminderMessage, setReminderMessage] = useState('');

  useEffect(() => {
    if (initialEvent) {
      setTitle(initialEvent.title);
      setStartDate(initialEvent.startDate);
      setAllDay(initialEvent.allDay);
      if (initialEvent.startAt) {
        try {
          const d = new Date(initialEvent.startAt);
          const hh = String(d.getHours()).padStart(2, '0');
          const mm = String(d.getMinutes()).padStart(2, '0');
          setStartTime(`${hh}:${mm}`);
        } catch {
          setStartTime('09:00');
        }
      }
      // Target
      if (initialEvent.ownerIds.length >= 2) {
        setOwnerTarget('both');
      } else if (initialEvent.ownerIds.includes(currentUser.id)) {
        setOwnerTarget('me');
      } else {
        setOwnerTarget('partner');
      }
      setLocation(initialEvent.location || '');
      setNotes(initialEvent.notes || '');
      setLink(initialEvent.link || '');
      setColor(initialEvent.color || 'var(--partner-a)');
      setIcon(initialEvent.icon || '🌸');

      if (initialEvent.repeatRule) {
        setIsRecurring(true);
        setFrequency(initialEvent.repeatRule.frequency);
        setEndType(initialEvent.repeatRule.endType);
        setEndDate(initialEvent.repeatRule.endDate || '');
        setEndCount(initialEvent.repeatRule.endCount || 10);
      } else {
        setIsRecurring(false);
      }

      if (initialEvent.reminders && initialEvent.reminders.length > 0) {
        setSelectedReminderMinutes(initialEvent.reminders.map((r) => r.minutesBefore));
        setReminderMessage(initialEvent.reminders[0].customMessage || '');
      } else {
        setSelectedReminderMinutes([]);
      }
    } else {
      // New Event defaults
      const today = new Date().toISOString().split('T')[0];
      setTitle('');
      setStartDate(initialDate || today);
      setAllDay(false);
      setStartTime(initialTime || '09:00');
      setOwnerTarget('both');
      setLocation('');
      setNotes('');
      setLink('');
      setColor('var(--partner-a)');
      setIcon('🌸');
      setIsRecurring(false);
      setFrequency('weekly');
      setEndType('never');
      setSelectedReminderMinutes([15]);
      setReminderMessage('');
    }
  }, [initialEvent, initialDate, initialTime, currentUser.id, isOpen]);

  if (!isOpen) return null;

  const handleQuickTime = (timeStr: string) => {
    soundEffects.playPop();
    setAllDay(false);
    setStartTime(timeStr);
  };

  const toggleReminderMinute = (minutes: number) => {
    soundEffects.playPop();
    if (selectedReminderMinutes.includes(minutes)) {
      setSelectedReminderMinutes(selectedReminderMinutes.filter((m) => m !== minutes));
    } else {
      if (selectedReminderMinutes.length >= 5) return; // Up to 5 per event
      setSelectedReminderMinutes([...selectedReminderMinutes, minutes]);
    }
  };

  const handleAddCustomMinutes = () => {
    const val = parseInt(customMinutes, 10);
    if (!isNaN(val) && val >= 0 && !selectedReminderMinutes.includes(val)) {
      if (selectedReminderMinutes.length < 5) {
        setSelectedReminderMinutes([...selectedReminderMinutes, val]);
      }
      setCustomMinutes('');
      setShowCustomInput(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !startDate) return;

    soundEffects.playSuccess();

    // Determine owner IDs
    let ownerIds: string[] = [];
    if (ownerTarget === 'both') {
      ownerIds = [currentUser.id, partnerUser.id];
    } else if (ownerTarget === 'me') {
      ownerIds = [currentUser.id];
    } else {
      ownerIds = [partnerUser.id];
    }

    // Determine startAt in UTC (if timed)
    let startAtUtc: string | null = null;
    if (!allDay && startTime) {
      // Local date & time in creator's timezone -> convert to ISO UTC string
      const localDateTimeStr = `${startDate}T${startTime}:00`;
      const dateObj = new Date(localDateTimeStr);
      startAtUtc = dateObj.toISOString();
    }

    // Build repeat rule
    let repeatRule: RepeatRule | undefined = undefined;
    if (isRecurring) {
      repeatRule = {
        frequency,
        interval: 1,
        endType,
        endDate: endType === 'on_date' ? endDate : undefined,
        endCount: endType === 'after_count' ? endCount : undefined,
      };
    }

    // Build reminders
    const reminders = buildReminders(
      startAtUtc,
      allDay,
      startDate,
      currentUser.timezone,
      selectedReminderMinutes,
      remindTarget === 'both' ? [currentUser.id, partnerUser.id] : [remindTarget === 'me' ? currentUser.id : partnerUser.id],
      reminderMessage
    );

    onSave({
      title: title.trim(),
      startDate,
      allDay,
      startAt: startAtUtc,
      timeZone: currentUser.timezone,
      ownerIds,
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
      link: link.trim() || undefined,
      color,
      icon,
      repeatRule,
      reminders,
    });

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
        className="w-full sm:max-w-lg bg-[var(--surface)] text-[var(--text)] border-t-3 sm:border-3 border-[var(--border)] rounded-t-3xl sm:rounded-3xl shadow-[0_6px_0_var(--shadow-color)] max-h-[88vh] max-h-[88dvh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between p-4 sm:p-5 border-b-2 border-[var(--border)] bg-[var(--surface-2)]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] flex items-center justify-center text-xl shadow-[0_2px_0_var(--shadow-color)] shrink-0">
              {icon}
            </div>
            <div className="min-w-0">
              <h3 className="font-chunky text-lg font-bold text-[var(--text)] leading-tight truncate">
                {initialEvent ? 'Edit Event' : 'New Shared Event'}
              </h3>
              <p className="font-ui text-xs text-[var(--text-muted)] truncate">
                Syncs live between both members
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close event modal"
            className="w-10 h-10 min-w-[40px] rounded-xl bg-[var(--surface)] hover:bg-[var(--surface-2)] border-2 border-[var(--border)] flex items-center justify-center text-[var(--text)] cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Container */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Scrollable Form Body */}
          <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1 min-h-0 overscroll-contain">
            {/* Title */}
          <div>
            <label className="block text-xs font-ui font-semibold text-[var(--text)] mb-1.5">
              Event Title *
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Pasta Date Night, Morning Coffee, Flight to Tokyo"
              className="w-full px-4 py-2.5 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] text-[var(--text)] font-body text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>

          {/* Date & All-Day Toggle */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-ui font-semibold text-[var(--text)] mb-1.5">
                Date
              </label>
              <div className="relative">
                <input
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] text-[var(--text)] font-body text-sm focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-ui font-semibold text-[var(--text)] mb-1.5">
                Time Type
              </label>
              <button
                type="button"
                onClick={() => setAllDay(!allDay)}
                className={`w-full px-4 py-2.5 rounded-2xl border-2 font-ui font-semibold text-xs flex items-center justify-between cursor-pointer transition-all ${
                  allDay
                    ? 'bg-[var(--accent)] text-[var(--text)] border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)]'
                    : 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--border)]'
                }`}
              >
                <span>{allDay ? 'All Day Event ✨' : 'Specific Time ⏰'}</span>
                <span className="text-[11px] px-2 py-0.5 rounded-md bg-[var(--surface)] border border-[var(--border)]">
                  Toggle
                </span>
              </button>
            </div>
          </div>

          {/* Start Time Section (ONLY START TIME - NO END TIME, NO DURATION, NO RANGE) */}
          {!allDay && (
            <div className="p-3.5 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-ui font-semibold text-[var(--text)] flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[var(--accent)]" />
                  <span>Start Time</span>
                </label>
                <input
                  type="time"
                  required={!allDay}
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="px-3 py-1.5 rounded-xl bg-[var(--surface)] border-2 border-[var(--border)] text-[var(--text)] font-numeric text-sm focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              {/* Quick time chips */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {[
                  { label: 'Morning 9:00', time: '09:00' },
                  { label: 'Afternoon 1:00 PM', time: '13:00' },
                  { label: 'Evening 5:00 PM', time: '17:00' },
                  { label: 'Night 8:00 PM', time: '20:00' },
                ].map((chip) => (
                  <button
                    key={chip.time}
                    type="button"
                    onClick={() => handleQuickTime(chip.time)}
                    className={`px-2.5 py-1 rounded-xl text-[11px] font-chunky font-semibold border transition-all cursor-pointer ${
                      startTime === chip.time
                        ? 'bg-[var(--accent)] text-[var(--text)] border-[var(--border)] shadow-xs'
                        : 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text)]'
                    }`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Who it is for */}
          <div>
            <label className="block text-xs font-ui font-semibold text-[var(--text)] mb-1.5">
              Who is this for?
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'both', label: 'Both Members' },
                { id: 'me', label: `For Me (${currentUser.displayName})` },
                { id: 'partner', label: `For ${partnerUser.displayName}` },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setOwnerTarget(opt.id as any)}
                  className={`px-3 py-2 rounded-2xl border-2 text-xs font-ui font-semibold truncate cursor-pointer transition-all ${
                    ownerTarget === opt.id
                      ? 'bg-[var(--accent)] text-[var(--text)] border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)]'
                      : 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Color & Emoji Picker */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-ui font-semibold text-[var(--text)] mb-1.5">
                Accent Color
              </label>
              <div className="flex items-center gap-2">
                {COLOR_OPTIONS.map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => setColor(c.value)}
                    style={{ backgroundColor: c.value }}
                    className={`w-7 h-7 rounded-xl border-2 transition-transform cursor-pointer ${
                      color === c.value ? 'scale-110 border-[var(--text)] ring-2 ring-[var(--accent)]' : 'border-black/20'
                    }`}
                    title={c.name}
                  />
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-ui font-semibold text-[var(--text)] mb-1.5">
                Emoji Icon
              </label>
              <div className="flex flex-wrap gap-1.5">
                {EMOJI_OPTIONS.slice(0, 6).map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => setIcon(em)}
                    className={`w-7 h-7 rounded-xl border flex items-center justify-center text-sm cursor-pointer transition-all ${
                      icon === em
                        ? 'bg-[var(--accent)] border-[var(--border)] scale-110 shadow-xs'
                        : 'bg-[var(--surface-2)] border-[var(--border)]'
                    }`}
                  >
                    {em}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Location & Link */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-ui font-semibold text-[var(--text)] mb-1.5 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-[var(--accent)]" />
                <span>Location (optional)</span>
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Central Park or Zoom"
                className="w-full px-3.5 py-2 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] text-[var(--text)] font-body text-xs focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            <div>
              <label className="block text-xs font-ui font-semibold text-[var(--text)] mb-1.5 flex items-center gap-1">
                <LinkIcon className="w-3.5 h-3.5 text-[var(--accent)]" />
                <span>Link (optional)</span>
              </label>
              <input
                type="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://..."
                className="w-full px-3.5 py-2 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] text-[var(--text)] font-body text-xs focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-ui font-semibold text-[var(--text)] mb-1.5 flex items-center gap-1">
              <AlignLeft className="w-3.5 h-3.5 text-[var(--accent)]" />
              <span>Notes</span>
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Sweet details, what to bring, reservation notes..."
              className="w-full px-3.5 py-2 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] text-[var(--text)] font-body text-xs focus:outline-none focus:border-[var(--accent)] resize-none"
            />
          </div>

          {/* Repeat Rule */}
          <div className="p-3.5 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Repeat className="w-4 h-4 text-[var(--accent)]" />
                <span className="text-xs font-ui font-semibold text-[var(--text)]">Repeat Event</span>
              </div>
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={(e) => setIsRecurring(e.target.checked)}
                className="w-5 h-5 accent-[var(--accent)] rounded cursor-pointer"
              />
            </div>

            {isRecurring && (
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[var(--border)]">
                <div>
                  <label className="block text-[11px] font-ui text-[var(--text-muted)] mb-1">
                    Frequency
                  </label>
                  <select
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as any)}
                    className="w-full p-2 rounded-xl bg-[var(--surface)] border-2 border-[var(--border)] text-xs text-[var(--text)] font-ui"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-ui text-[var(--text-muted)] mb-1">
                    Ends
                  </label>
                  <select
                    value={endType}
                    onChange={(e) => setEndType(e.target.value as any)}
                    className="w-full p-2 rounded-xl bg-[var(--surface)] border-2 border-[var(--border)] text-xs text-[var(--text)] font-ui"
                  >
                    <option value="never">Never</option>
                    <option value="on_date">On specific date</option>
                    <option value="after_count">After count</option>
                  </select>
                </div>

                {endType === 'on_date' && (
                  <div className="col-span-2">
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full p-2 rounded-xl bg-[var(--surface)] border-2 border-[var(--border)] text-xs text-[var(--text)]"
                    />
                  </div>
                )}

                {endType === 'after_count' && (
                  <div className="col-span-2">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={endCount}
                      onChange={(e) => setEndCount(parseInt(e.target.value, 10) || 1)}
                      className="w-full p-2 rounded-xl bg-[var(--surface)] border-2 border-[var(--border)] text-xs text-[var(--text)]"
                      placeholder="Number of times"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Reminders Section */}
          <div className="p-3.5 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Bell className="w-4 h-4 text-[var(--accent)]" />
                <span className="text-xs font-ui font-semibold text-[var(--text)]">
                  Reminders ({selectedReminderMinutes.length}/5)
                </span>
              </div>
              <span className="text-[11px] font-ui text-[var(--text-muted)]">
                Push + In-app alert
              </span>
            </div>

            {/* Reminder chips */}
            <div className="flex flex-wrap gap-1.5">
              {(allDay ? ALL_DAY_REMINDER_CHIPS : TIMED_REMINDER_CHIPS).map((chip) => {
                const isSelected = selectedReminderMinutes.includes(chip.minutes);
                return (
                  <button
                    key={chip.minutes}
                    type="button"
                    onClick={() => toggleReminderMinute(chip.minutes)}
                    className={`px-2.5 py-1 rounded-xl text-xs font-ui font-semibold border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[var(--accent)] text-[var(--text)] border-[var(--border)] shadow-xs'
                        : 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text)]'
                    }`}
                  >
                    {chip.label}
                  </button>
                );
              })}

              {!showCustomInput ? (
                <button
                  type="button"
                  onClick={() => setShowCustomInput(true)}
                  className="px-2.5 py-1 rounded-xl text-xs font-ui font-semibold bg-[var(--surface)] text-[var(--text-muted)] border border-dashed border-[var(--border)] hover:text-[var(--text)] cursor-pointer"
                >
                  + Custom
                </button>
              ) : (
                <div className="inline-flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    value={customMinutes}
                    onChange={(e) => setCustomMinutes(e.target.value)}
                    placeholder="Mins before"
                    className="w-24 px-2 py-1 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--text)]"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomMinutes}
                    className="px-2 py-1 rounded-lg bg-[var(--accent)] text-[var(--text)] text-xs font-ui font-bold cursor-pointer"
                  >
                    Add
                  </button>
                </div>
              )}
            </div>

            {/* Target reminder & message */}
            <div className="pt-2 border-t border-[var(--border)] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-ui text-[var(--text-muted)]">Who gets reminded:</span>
                <div className="flex items-center gap-1">
                  {[
                    { id: 'both', label: 'Both' },
                    { id: 'me', label: 'Me' },
                    { id: 'partner', label: partnerUser.displayName },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setRemindTarget(t.id as any)}
                      className={`px-2 py-0.5 rounded-lg text-[11px] font-ui font-semibold border cursor-pointer ${
                        remindTarget === t.id
                          ? 'bg-[var(--accent)] text-[var(--text)] border-[var(--border)]'
                          : 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)]'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <input
                  type="text"
                  maxLength={140}
                  value={reminderMessage}
                  onChange={(e) => setReminderMessage(e.target.value)}
                  placeholder="Optional reminder message (e.g. Wear the red dress! 👗)"
                  className="w-full px-3 py-1.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] text-xs font-body placeholder:text-[var(--text-muted)]"
                />
              </div>
            </div>
          </div>

          </div>

          {/* Sticky Action Footer */}
          <div className="shrink-0 p-4 border-t-2 border-[var(--border)] bg-[var(--surface)] pb-[calc(14px+env(safe-area-inset-bottom,0px))] sm:pb-4 flex items-center justify-end gap-3 z-10 shadow-[0_-2px_8px_rgba(0,0,0,0.03)]">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 min-h-[44px] rounded-2xl bg-[var(--surface-2)] text-[var(--text)] border-2 border-[var(--border)] font-chunky font-bold text-xs cursor-pointer shadow-[0_2px_0_var(--shadow-color)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 min-h-[44px] rounded-2xl bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] font-chunky font-bold text-xs shadow-[0_3px_0_var(--shadow-color)] active:translate-y-1 active:shadow-none cursor-pointer"
            >
              {initialEvent ? 'Save Changes' : 'Create Event'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
