import React, { useMemo, useState } from 'react';
import { addDays, format, parseISO, differenceInDays } from 'date-fns';
import { CalendarHeart, Check, Droplets, Heart } from 'lucide-react';
import type { PeriodTracker } from '../../lib/dataStore';
import { DedicatedPeriodCalendar } from './DedicatedPeriodCalendar';
import { soundEffects } from '../../lib/sound';

interface PeriodTrackerCardProps {
  tracker: PeriodTracker | null;
  onSave: (tracker: PeriodTracker) => Promise<void> | void;
  currentUserId: string;
}

export const PeriodTrackerCard: React.FC<PeriodTrackerCardProps> = ({
  tracker,
  onSave,
  currentUserId,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isDedicatedOpen, setIsDedicatedOpen] = useState(false);
  const [lastPeriodDate, setLastPeriodDate] = useState(tracker?.lastPeriodDate || '');
  const [cycleLength, setCycleLength] = useState(String(tracker?.cycleLength || 28));
  const [periodLength, setPeriodLength] = useState(String(tracker?.periodLength || 5));

  const nextDate = useMemo(() => {
    if (!tracker?.lastPeriodDate) return null;
    return addDays(parseISO(tracker.lastPeriodDate), tracker.cycleLength);
  }, [tracker]);

  // Compute current cycle day and phase
  const cycleInfo = useMemo(() => {
    if (!tracker?.lastPeriodDate) return null;
    const lastStart = parseISO(tracker.lastPeriodDate);
    const day = differenceInDays(new Date(), lastStart) + 1;
    const cycle = tracker.cycleLength || 28;
    const flow = tracker.periodLength || 5;

    let phase = 'Follicular Phase';
    let emoji = '🌿';
    if (day <= flow) {
      phase = 'Menstrual Phase';
      emoji = '🩸';
    } else if (day < Math.round(cycle / 2) - 2) {
      phase = 'Follicular Phase';
      emoji = '🌿';
    } else if (day <= Math.round(cycle / 2) + 2) {
      phase = 'Ovulation Window';
      emoji = '🌸';
    } else {
      phase = 'Luteal Phase';
      emoji = '🌙';
    }

    return { day, phase, emoji };
  }, [tracker]);

  const latestLog = tracker?.logs && tracker.logs.length > 0 ? tracker.logs[0] : null;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!lastPeriodDate) return;
    await onSave({
      lastPeriodDate,
      cycleLength: Math.min(60, Math.max(15, Number(cycleLength) || 28)),
      periodLength: Math.min(14, Math.max(1, Number(periodLength) || 5)),
      updatedAt: new Date().toISOString(),
      updatedBy: currentUserId,
      femaleUserId: tracker?.femaleUserId,
      logs: tracker?.logs || [],
    });
    setIsEditing(false);
  };

  return (
    <>
      <section className="card p-5 border-2 border-[var(--border)] space-y-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-rose-500/20 border-2 border-rose-500/40 flex items-center justify-center text-rose-500 shrink-0">
              <CalendarHeart className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-chunky font-bold text-[var(--text)]">Period tracker</h3>
                {cycleInfo && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-chunky font-bold bg-rose-500/15 text-rose-500">
                    Day {cycleInfo.day} {cycleInfo.emoji}
                  </span>
                )}
              </div>
              <p className="text-xs font-ui text-[var(--text-muted)] mt-0.5">
                Shared privately between the two members of this space
              </p>
            </div>
          </div>
          {!isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="text-xs font-ui font-bold text-[var(--partner-a)] hover:underline cursor-pointer"
            >
              {tracker ? 'Settings' : 'Set up'}
            </button>
          )}
        </div>

        {isEditing ? (
          <form onSubmit={save} className="mt-3 space-y-3">
            <label className="block text-xs font-ui font-bold text-[var(--text)]">
              First day of the latest period
              <input
                type="date"
                required
                value={lastPeriodDate}
                onChange={(e) => setLastPeriodDate(e.target.value)}
                className="mt-1 w-full rounded-xl border-2 border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)]"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-ui font-bold text-[var(--text)]">
                Cycle length (days)
                <input
                  type="number"
                  min="15"
                  max="60"
                  value={cycleLength}
                  onChange={(e) => setCycleLength(e.target.value)}
                  className="mt-1 w-full rounded-xl border-2 border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)]"
                />
              </label>
              <label className="text-xs font-ui font-bold text-[var(--text)]">
                Period length (days)
                <input
                  type="number"
                  min="1"
                  max="14"
                  value={periodLength}
                  onChange={(e) => setPeriodLength(e.target.value)}
                  className="mt-1 w-full rounded-xl border-2 border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)]"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-3 py-2 rounded-xl text-xs font-ui text-[var(--text-muted)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--partner-a)] text-white text-xs font-ui font-bold border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" /> Save
              </button>
            </div>
          </form>
        ) : tracker && nextDate ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-2xl bg-[var(--surface-2)] p-3">
                <div className="flex items-center gap-1.5 text-xs font-ui text-[var(--text-muted)]">
                  <Droplets className="w-3.5 h-3.5 text-rose-500" /> Latest start
                </div>
                <div className="mt-1 font-chunky font-bold text-[var(--text)]">
                  {format(parseISO(tracker.lastPeriodDate), 'MMM d, yyyy')}
                </div>
              </div>
              <div className="rounded-2xl bg-rose-500/10 border border-rose-500/30 p-3">
                <div className="text-xs font-ui text-rose-500 font-bold">Estimated next start</div>
                <div className="mt-1 font-chunky font-bold text-[var(--text)]">
                  {format(nextDate, 'MMM d, yyyy')}
                </div>
              </div>
            </div>

            {/* Latest Feeling & Craving Pill */}
            {latestLog && (
              <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs font-ui flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 truncate">
                  <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500 shrink-0" />
                  <span className="truncate text-[var(--text)]">
                    {latestLog.cravings?.length ? `Craving: ${latestLog.cravings[0]}` : latestLog.feelings?.[0] || 'Period log'}
                  </span>
                </div>
                <span className="text-[10px] text-[var(--text-muted)] shrink-0 font-bold">
                  {format(parseISO(latestLog.date), 'MMM d')}
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                soundEffects.playPop();
                setIsDedicatedOpen(true);
              }}
              className="w-full py-2.5 rounded-xl bg-[var(--surface-2)] hover:bg-rose-500/20 text-[var(--text)] font-chunky font-bold text-xs border-2 border-[var(--border)] shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <CalendarHeart className="w-4 h-4 text-rose-500" />
              <span>Open Dedicated Period Calendar 🌸</span>
            </button>
          </div>
        ) : (
          <div className="mt-2 space-y-2.5">
            <div className="rounded-2xl bg-[var(--surface-2)] p-3 text-xs font-ui text-[var(--text-muted)]">
              Add a date to start tracking her cycle together with shared predictions, cravings, and feelings.
            </div>
            <button
              type="button"
              onClick={() => {
                soundEffects.playPop();
                setIsDedicatedOpen(true);
              }}
              className="w-full py-2.5 rounded-xl bg-rose-500 text-white font-chunky font-bold text-xs border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] flex items-center justify-center gap-2 cursor-pointer"
            >
              <CalendarHeart className="w-4 h-4" />
              <span>Set Up Dedicated Period Calendar 🌸</span>
            </button>
          </div>
        )}
      </section>

      {/* FULL DEDICATED PERIOD CALENDAR MODAL */}
      <DedicatedPeriodCalendar
        isOpen={isDedicatedOpen}
        onClose={() => setIsDedicatedOpen(false)}
        tracker={tracker}
        onSave={onSave}
      />
    </>
  );
};
