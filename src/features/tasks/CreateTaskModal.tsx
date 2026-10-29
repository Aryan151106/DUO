import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../lib/store';
import { duoDataStore } from '../../lib/dataStore';
import type { TaskItem } from '../../lib/dataStore';
import { broadcastEvent } from '../../lib/supabase';
import { soundManager, soundEffects } from '../../lib/sound';
import { useTaskStore } from '../../lib/tasksStore';
import { useNotificationStore } from '../../lib/notifications';
import { useQueryClient } from '@tanstack/react-query';
import {
  X,
  Sparkles,
  Clock,
  Calendar as CalendarIcon,
  Bell,
  Paperclip,
} from 'lucide-react';
import { getBucket, getBucketDefinition } from '../../lib/timeBuckets';
import { buildTaskReminders } from '../../lib/taskReminders';
import { AttachmentPicker } from '../chat/AttachmentPicker';
import { AttachmentPreview } from '../chat/AttachmentPreview';
import type { FileAttachment } from '../../lib/attachments';

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  attachedDoodleUrl?: string | null;
  initialDate?: string;
  initialTime?: string;
  defaultDate?: string;
  preFillTime?: string;
  initialAssignedTo?: string;
}

const QUICK_TIME_CHIPS = [
  { label: 'Morning 9:00', time: '09:00' },
  { label: 'Afternoon 1:00 PM', time: '13:00' },
  { label: 'Evening 5:00 PM', time: '17:00' },
  { label: 'Night 8:00 PM', time: '20:00' },
];

const RELATIVE_REMINDER_OPTIONS = [
  { label: 'At start time', minutes: 0 },
  { label: '5 min before', minutes: 5 },
  { label: '15 min before', minutes: 15 },
  { label: '30 min before', minutes: 30 },
  { label: '1 hour before', minutes: 60 },
  { label: '1 day before', minutes: 1440 },
];

const EMOJI_ROW = ['❤️', '☕', '✨', '⭐', '🔔', '🌸'];

export const CreateTaskModal: React.FC<CreateTaskModalProps> = ({
  isOpen,
  onClose,
  attachedDoodleUrl,
  initialDate,
  initialTime,
  defaultDate,
  preFillTime,
  initialAssignedTo,
}) => {
  const { currentUser, partnerUser, couple } = useAuthStore();
  const queryClient = useQueryClient();

  const todayStr = new Date().toISOString().split('T')[0];
  const [taskDate, setTaskDate] = useState<string>(initialDate || defaultDate || todayStr);
  const [startTime, setStartTime] = useState<string>(initialTime || preFillTime || '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedTo, setAssignedTo] = useState<string>(initialAssignedTo || currentUser.id);
  const [priority, setPriority] = useState<'normal' | 'important' | 'urgent'>('normal');
  const [repeatRule, setRepeatRule] = useState<'once' | 'daily' | 'weekdays' | 'weekly'>('once');
  const [alarmSound, setAlarmSound] = useState<string>('default');

  // Reminders state
  const [notifyPartner, setNotifyPartner] = useState<boolean>(true);
  const [selectedReminderOffsets, setSelectedReminderOffsets] = useState<number[]>([15]);
  const [customReminderTime, setCustomReminderTime] = useState<string>('');
  const [personalMessage, setPersonalMessage] = useState<string>('');
  const [alsoRemindMe, setAlsoRemindMe] = useState<boolean>(false);

  // Attachments
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);

  // Handle Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Lock body scroll while open
  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  // Reset or initialize when opened
  useEffect(() => {
    if (isOpen) {
      if (initialDate) setTaskDate(initialDate);
      if (initialTime) setStartTime(initialTime);
      if (initialAssignedTo) {
        setAssignedTo(initialAssignedTo);
      } else {
        setAssignedTo(currentUser.id);
      }
      setNotifyPartner(initialAssignedTo === partnerUser.id);
    }
  }, [isOpen, initialDate, initialTime, initialAssignedTo, currentUser.id, partnerUser.id]);

  if (!isOpen) return null;

  // Derive section and partner time hint
  const derivedBucketId = startTime ? getBucket(startTime, currentUser.timezone) : 'anytime';
  const bucketDef = getBucketDefinition(derivedBucketId);

  let partnerTimeHint: string | null = null;
  if (startTime) {
    try {
      const localDate = new Date(`${taskDate}T${startTime}:00`);
      const partnerFmt = new Intl.DateTimeFormat('en-US', {
        timeZone: partnerUser.timezone,
        hour: 'numeric',
        minute: '2-digit',
      }).format(localDate);
      partnerTimeHint = `${partnerUser.displayName}'s ${partnerFmt}`;
    } catch {
      partnerTimeHint = null;
    }
  }

  const toggleReminderOffset = (minutes: number) => {
    soundEffects.playPop();
    setSelectedReminderOffsets((prev) => {
      if (prev.includes(minutes)) {
        return prev.filter((m) => m !== minutes);
      }
      if (prev.length >= 3) return prev; // max 3
      return [...prev, minutes];
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    soundManager.playPing();

    // Compute UTC startAt timestamp if startTime provided
    let startAtUtc: string | null = null;
    if (startTime) {
      try {
        const localDate = new Date(`${taskDate}T${startTime}:00`);
        startAtUtc = localDate.toISOString();
      } catch {
        startAtUtc = null;
      }
    }

    // Build reminders if notification enabled
    const reminderList = notifyPartner
      ? buildTaskReminders(
          startAtUtc,
          taskDate,
          selectedReminderOffsets,
          assignedTo === partnerUser.id ? partnerUser.id : currentUser.id,
          alsoRemindMe,
          personalMessage,
          customReminderTime || undefined
        )
      : [];

    const isDemo = useAuthStore.getState().isDemoMode;

    if (!isDemo && couple?.id) {
      try {
        await useTaskStore.getState().createTask(couple.id, {
          couple_id: couple.id,
          title: title.trim(),
          description: description.trim() || undefined,
          status: 'todo',
          task_date: taskDate,
          startAt: startAtUtc,
          timeZone: currentUser.timezone,
          priority,
          repeatRule,
          alarmSound: alarmSound === 'default' ? undefined : alarmSound,
          assigned_to: assignedTo,
          task_scope: 'personal',
          created_by: currentUser.id,
          reminders: reminderList,
          attachments,
          doodle_url: attachedDoodleUrl || undefined,
          completed_at: null,
        });

        if (assignedTo === partnerUser.id) {
          useNotificationStore.getState().sendNotification({
            coupleId: couple.id,
            senderId: currentUser.id,
            senderName: currentUser.displayName,
            type: 'task',
            title: 'New Task for You 📋',
            body: `${currentUser.displayName} assigned: "${title.trim()}"`,
            deepLink: '/?action=today',
          });
        }
      } catch (err) {
        console.error('Failed to add Firestore task via useTaskStore:', err);
      }
    } else {
      const newTask: TaskItem = {
        id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        couple_id: couple?.id || 'couple-duo-main',
        title: title.trim(),
        description: description.trim() || undefined,
        status: 'todo',
        task_date: taskDate,
        startAt: startAtUtc,
        timeZone: currentUser.timezone,
        priority,
        repeatRule,
        assigned_to: assignedTo,
        task_scope: 'personal',
        created_by: currentUser.id,
        reminders: reminderList,
        attachments,
        doodle_url: attachedDoodleUrl || undefined,
        updated_at: new Date().toISOString(),
      };

      const currentTasks = duoDataStore.getTasks();
      const updated = [newTask, ...currentTasks];
      duoDataStore.saveTasks(updated);

      broadcastEvent('TASK_MUTATION', { action: 'insert', task: newTask }, currentUser.id, couple?.id || '');

      if (assignedTo === partnerUser.id) {
        useNotificationStore.getState().sendNotification({
          coupleId: 'couple-duo-main',
          senderId: currentUser.id,
          senderName: currentUser.displayName,
          type: 'task',
          title: 'New Task for You 📋',
          body: `${currentUser.displayName} assigned: "${title.trim()}"`,
          deepLink: '/?action=today',
        });
      }
    }

    queryClient.invalidateQueries({ queryKey: ['tasks'] });

    // Reset form
    setTitle('');
    setDescription('');
    setStartTime('');
    setAttachments([]);
    setPersonalMessage('');
    setAssignedTo(currentUser.id);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[70] flex flex-col justify-end sm:justify-center sm:items-center p-0 sm:p-4 bg-[var(--overlay)] backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col w-full sm:max-w-lg max-h-[88vh] max-h-[88dvh] rounded-t-3xl sm:rounded-3xl bg-[var(--surface)] border-t-3 sm:border-3 border-[var(--border)] shadow-[0_8px_0_var(--shadow-color)] overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
      >
        {/* Top Decorative Border Accent */}
        <div className="absolute top-0 left-0 right-0 h-2 bg-[var(--partner-a)] z-20 pointer-events-none sm:rounded-t-3xl" />

        {/* Pinned Modal Header */}
        <div className="shrink-0 flex items-center justify-between px-5 pt-4 pb-3 sm:px-6 sm:pt-5 border-b-2 border-[var(--border)] bg-[var(--surface)] relative z-10">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-[var(--accent)] border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] text-[var(--text)] flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-chunky font-bold text-[var(--text)] leading-tight truncate">
                New Task
              </h2>
              <p className="text-xs font-ui text-[var(--text-muted)] truncate">
                Add something for yourself, your teammate, or both of you
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 min-w-[44px] min-h-[44px] rounded-2xl border-2 border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer flex items-center justify-center shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Container */}
        <form id="create-task-form" onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Scrollable Form Body */}
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5 overscroll-contain space-y-4">
            {/* Mission Title */}
          <div>
            <label className="block text-xs font-chunky font-bold text-[var(--text)] mb-1.5 uppercase tracking-wide">
              Task Title *
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Book train tickets for getaway 🚆"
              className="w-full px-4 py-2.5 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] font-body text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-chunky font-bold text-[var(--text)] mb-1.5 uppercase tracking-wide">
              Notes / Instructions
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add any helpful details or checklists..."
              className="w-full px-4 py-2 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] font-body text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] resize-none"
            />
          </div>

          {/* Date & Start Time Row (ONLY START TIME - NO END TIME, NO DURATION, NO RANGE) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-chunky font-bold text-[var(--text)] mb-1.5 uppercase tracking-wide flex items-center gap-1.5">
                <CalendarIcon className="w-3.5 h-3.5" />
                <span>Date</span>
              </label>
              <input
                type="date"
                required
                value={taskDate}
                onChange={(e) => setTaskDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[var(--surface-2)] border-2 border-[var(--border)] font-numeric text-xs text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            <div>
              <label className="block text-xs font-chunky font-bold text-[var(--text)] mb-1.5 uppercase tracking-wide flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Start Time (Optional)</span>
                </span>
                {startTime && (
                  <button
                    type="button"
                    onClick={() => setStartTime('')}
                    className="text-[11px] font-ui text-[var(--text-muted)] hover:text-[var(--urgent)] cursor-pointer"
                  >
                    Clear (Anytime)
                  </button>
                )}
              </label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[var(--surface-2)] border-2 border-[var(--border)] font-numeric text-xs text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>

          {/* Quick Time Chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-ui text-[var(--text-muted)] mr-1">Quick time:</span>
            {QUICK_TIME_CHIPS.map((chip) => (
              <button
                key={chip.time}
                type="button"
                onClick={() => {
                  soundEffects.playPop();
                  setStartTime(chip.time);
                }}
                className={`px-2.5 py-1 rounded-xl text-[11px] font-ui font-semibold border transition-all cursor-pointer ${
                  startTime === chip.time
                    ? 'bg-[var(--accent)] text-[var(--text)] border-[var(--border)] shadow-xs'
                    : 'bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] border-[var(--border)]'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {/* Live Section & Timezone Hint */}
          <div className="p-2.5 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] text-xs font-ui text-[var(--text)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-bold">
                {bucketDef.label === 'Anytime' ? '⏳ Anytime Section' : `⏰ Lands in ${bucketDef.label}`}
              </span>
              <span className="text-[var(--text-muted)]">({bucketDef.timeRange})</span>
            </div>
            {partnerTimeHint && (
              <span className="font-bold text-[var(--partner-b)] bg-[var(--surface)] px-2 py-0.5 rounded-lg border border-[var(--border)]">
                {partnerTimeHint}
              </span>
            )}
          </div>

          {/* Scope & Priority & Repeat Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-chunky font-bold text-[var(--text)] mb-1 uppercase tracking-wide">
                Assign Task
              </label>
              <div className="flex rounded-xl bg-[var(--surface-2)] p-1 border-2 border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => {
                    soundEffects.playPop();
                    setAssignedTo(currentUser.id);
                  }}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-ui font-bold transition-all cursor-pointer ${
                    assignedTo === currentUser.id
                      ? 'bg-[var(--partner-a)] text-white shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  For Me
                </button>
                <button
                  type="button"
                  onClick={() => {
                    soundEffects.playPop();
                    setAssignedTo(partnerUser.id);
                  }}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-ui font-bold transition-all cursor-pointer truncate px-2 ${
                    assignedTo === partnerUser.id
                      ? 'bg-[var(--partner-b)] text-white shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  For {partnerUser.displayName || 'Vidhi'}
                </button>
              </div>
            </div>

            {/* Priority */}
            <div>
              <label className="block text-xs font-chunky font-bold text-[var(--text)] mb-1 uppercase tracking-wide">
                Priority
              </label>
              <div className="flex rounded-xl bg-[var(--surface-2)] p-1 border-2 border-[var(--border)]">
                {(['normal', 'important', 'urgent'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      soundEffects.playPop();
                      setPriority(p);
                    }}
                    className={`flex-1 py-1.5 rounded-lg text-[11px] font-ui font-bold capitalize transition-all cursor-pointer ${
                      priority === p
                        ? p === 'urgent'
                          ? 'bg-[var(--urgent)] text-white'
                          : 'bg-[var(--accent)] text-[var(--text)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Repeat */}
            <div>
              <label className="block text-xs font-chunky font-bold text-[var(--text)] mb-1 uppercase tracking-wide">
                Repeat
              </label>
              <select
                value={repeatRule}
                onChange={(e) => setRepeatRule(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl bg-[var(--surface-2)] border-2 border-[var(--border)] font-ui text-xs text-[var(--text)] focus:outline-none"
              >
                <option value="once">Once</option>
                <option value="daily">Daily</option>
                <option value="weekdays">Weekdays</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
          </div>

          {/* Alarm Sound Chip Row (Part E4) */}
          <div>
            <label className="block text-xs font-chunky font-bold text-[var(--text)] mb-1.5 uppercase tracking-wide flex items-center justify-between">
              <span>Alarm Sound Override</span>
              {priority === 'urgent' && (
                <span className="text-[10px] text-[var(--urgent)] font-bold">
                  Urgent priority uses high-pitch alarm by default 🚨
                </span>
              )}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {[
                { id: 'default', label: 'Default' },
                { id: 'alarm-gentle-rise', label: 'Gentle 🌅' },
                { id: 'alarm-bells', label: 'Loud 🔔' },
                { id: 'alarm-digital', label: 'Digital ⚡' },
                { id: 'alarm-silent', label: 'Silent 🔕' },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    soundEffects.playPop();
                    setAlarmSound(s.id);
                  }}
                  className={`px-3 py-1.5 rounded-xl border-2 font-ui text-xs font-semibold cursor-pointer transition-all min-h-[36px] flex items-center justify-center ${
                    alarmSound === s.id
                      ? 'bg-[var(--accent)] text-[var(--text)] border-[var(--border)] font-bold shadow-xs'
                      : 'bg-[var(--surface-2)] border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Reminders & Notification Section */}
          <div className="p-3.5 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifyPartner}
                  onChange={(e) => setNotifyPartner(e.target.checked)}
                  className="rounded border-[var(--border)] text-[var(--accent)]"
                />
                <span className="font-chunky text-xs font-bold text-[var(--text)]">
                  Notify {partnerUser.displayName} about this task
                </span>
              </label>
              <Bell className="w-4 h-4 text-[var(--accent)]" />
            </div>

            {notifyPartner && (
              <div className="space-y-2.5 pt-1 border-t border-[var(--border)]">
                {/* Relative Offset Chips */}
                {startTime ? (
                  <div>
                    <span className="text-[11px] font-ui text-[var(--text-muted)] block mb-1.5">
                      Remind relative to start time (up to 3):
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {RELATIVE_REMINDER_OPTIONS.map((opt) => {
                        const isSelected = selectedReminderOffsets.includes(opt.minutes);
                        return (
                          <button
                            key={opt.minutes}
                            type="button"
                            onClick={() => toggleReminderOffset(opt.minutes)}
                            className={`px-2.5 py-1 rounded-xl text-[11px] font-ui font-semibold border transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-[var(--accent)] text-[var(--text)] border-[var(--border)] font-bold shadow-xs'
                                : 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)]'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div>
                    <span className="text-[11px] font-ui text-[var(--text-muted)] block mb-1">
                      Set a custom reminder time:
                    </span>
                    <input
                      type="time"
                      value={customReminderTime}
                      onChange={(e) => setCustomReminderTime(e.target.value)}
                      className="px-3 py-1.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] font-numeric text-xs text-[var(--text)]"
                    />
                  </div>
                )}

                {/* Personal Message & Emoji Row */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-ui text-[var(--text-muted)]">
                      Personal note for {partnerUser.displayName} (max 140 chars):
                    </span>
                    <div className="flex items-center gap-1">
                      {EMOJI_ROW.map((em) => (
                        <button
                          key={em}
                          type="button"
                          onClick={() => {
                            if (personalMessage.length < 138) {
                              setPersonalMessage((p) => p + em);
                            }
                          }}
                          className="text-xs hover:scale-125 transition-transform cursor-pointer"
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    type="text"
                    maxLength={140}
                    value={personalMessage}
                    onChange={(e) => setPersonalMessage(e.target.value)}
                    placeholder="e.g. Love you! Don't forget your warm scarf ❤️"
                    className="w-full px-3 py-1.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] font-body text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none"
                  />
                </div>

                {/* Also Remind Creator */}
                <label className="flex items-center gap-2 cursor-pointer pt-0.5">
                  <input
                    type="checkbox"
                    checked={alsoRemindMe}
                    onChange={(e) => setAlsoRemindMe(e.target.checked)}
                    className="rounded border-[var(--border)] text-[var(--accent)]"
                  />
                  <span className="font-ui text-xs text-[var(--text-muted)]">
                    Also send a reminder to me
                  </span>
                </label>
              </div>
            )}
          </div>

          {/* Attachments Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-chunky font-bold text-[var(--text)] uppercase tracking-wide flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5" />
                <span>Media & Documents ({attachments.length})</span>
              </label>

              <AttachmentPicker
                spaceId={couple?.id || 'couple-duo-main'}
                folder="tasks"
                parentId={`task-new-${Date.now()}`}
                uploadedBy={currentUser.id}
                onAttachmentsReady={(newAtts) => {
                  setAttachments((prev) => [...prev, ...newAtts]);
                }}
              />
            </div>

            {attachments.length > 0 && (
              <div className="p-2.5 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)]">
                <AttachmentPreview attachments={attachments} compactTaskChip />
              </div>
            )}
          </div>

          </div>

          {/* Pinned Sticky Footer */}
          <div className="shrink-0 flex items-center justify-end gap-2.5 px-5 py-3 sm:px-6 sm:py-3.5 border-t-2 border-[var(--border)] bg-[var(--surface)] pb-[calc(14px+env(safe-area-inset-bottom,0px))] sm:pb-3.5 relative z-10 shadow-[0_-2px_10px_rgba(0,0,0,0.03)]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 min-h-[44px] rounded-2xl border-2 border-[var(--border)] font-chunky text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 min-h-[44px] rounded-2xl bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] font-chunky text-xs font-bold shadow-[0_3px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none transition-transform cursor-pointer"
            >
              Add Shared Mission
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
