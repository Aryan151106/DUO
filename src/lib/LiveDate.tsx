import React, { useMemo } from 'react';
import { useNow } from './useNow';

export interface LiveDateProps {
  timeZone?: string;
  variant?: 'full' | 'compact';
  className?: string;
}

export const LiveDate: React.FC<LiveDateProps> = ({
  timeZone,
  variant = 'full',
  className = '',
}) => {
  const now = useNow();

  const resolvedTz = useMemo(() => {
    if (timeZone) {
      try {
        Intl.DateTimeFormat(undefined, { timeZone }).format(now);
        return timeZone;
      } catch (e) {
        console.warn(`Invalid timezone: ${timeZone}`);
      }
    }
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }, [timeZone, now]);

  const formattedDate = useMemo(() => {
    try {
      if (variant === 'compact') {
        // e.g. "Sat, 10 Oct"
        return new Intl.DateTimeFormat(undefined, {
          timeZone: resolvedTz,
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        }).format(now);
      }

      // full variant: e.g. "Saturday, 10 October 2026"
      return new Intl.DateTimeFormat(undefined, {
        timeZone: resolvedTz,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(now);
    } catch (e) {
      return now.toLocaleDateString();
    }
  }, [now, resolvedTz, variant]);

  return (
    <span className={`inline-block font-ui ${className}`} title={formattedDate}>
      {formattedDate}
    </span>
  );
};
