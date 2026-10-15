import React, { useMemo } from 'react';
import { useNow } from './useNow';
import { useAuthStore } from './store';

export interface LiveClockProps {
  timeZone?: string;
  showSeconds?: boolean;
  className?: string;
}

export const LiveClock: React.FC<LiveClockProps> = ({
  timeZone,
  showSeconds = true,
  className = '',
}) => {
  const now = useNow();
  const timeFormat = useAuthStore((s) => s.timeFormat);

  // Fallback to local timezone if not specified or invalid
  const resolvedTz = useMemo(() => {
    if (timeZone) {
      try {
        Intl.DateTimeFormat(undefined, { timeZone }).format(now);
        return timeZone;
      } catch (e) {
        console.warn(`Invalid timezone: ${timeZone}, falling back to system timezone.`);
      }
    }
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }, [timeZone, now]);

  // Determine hour12 behavior
  const hour12Config = useMemo(() => {
    if (timeFormat === '12h') return true;
    if (timeFormat === '24h') return false;
    return undefined; // default follows device locale
  }, [timeFormat]);

  // Display time (with or without seconds, updates every tick)
  const displayTime = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(undefined, {
        timeZone: resolvedTz,
        hour: 'numeric',
        minute: '2-digit',
        second: showSeconds ? '2-digit' : undefined,
        hour12: hour12Config,
      }).format(now);
    } catch (e) {
      return now.toLocaleTimeString();
    }
  }, [now, resolvedTz, showSeconds, hour12Config]);

  // Screen reader label (updates only once per minute to avoid reading every second tick)
  const screenReaderTime = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(undefined, {
        timeZone: resolvedTz,
        hour: 'numeric',
        minute: '2-digit',
        hour12: hour12Config,
      }).format(now);
    } catch (e) {
      return '';
    }
    // Only recompute when the minute rolls over
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.floor(now.getTime() / 60000), resolvedTz, hour12Config]);

  return (
    <span className={`inline-flex items-baseline ${className}`}>
      {/* Hidden label for screen readers that only announces on minute rollover */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {screenReaderTime}
      </span>
      {/* Visible digits with tabular-nums so characters never jump */}
      <span
        aria-hidden="true"
        className="font-numeric"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {displayTime}
      </span>
    </span>
  );
};
