import { format, isSameDay, addDays, subDays } from 'date-fns';

/**
 * Safely converts any value (Firestore Timestamp, ISO string, epoch number, null, undefined)
 * into a valid JavaScript Date. Never returns an Invalid Date or throws RangeError.
 */
export function safeToDate(val: any): Date {
  if (!val) return new Date();
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? new Date() : val;
  }
  // Firestore Timestamp instance with toDate() or toMillis()
  if (typeof val?.toMillis === 'function') {
    try {
      const ms = val.toMillis();
      if (typeof ms === 'number' && !isNaN(ms) && ms > 0) return new Date(ms);
    } catch {}
  }
  if (typeof val?.toDate === 'function') {
    try {
      const d = val.toDate();
      if (d instanceof Date && !isNaN(d.getTime())) return d;
    } catch {}
  }
  // Serialized Firestore Timestamp object { seconds, nanoseconds } or { _seconds, _nanoseconds }
  if (typeof val === 'object' && val !== null) {
    const sec = typeof val.seconds === 'number' ? val.seconds : (typeof val._seconds === 'number' ? val._seconds : null);
    if (sec !== null && !isNaN(sec) && sec > 0) {
      const nano = typeof val.nanoseconds === 'number' ? val.nanoseconds : (typeof val._nanoseconds === 'number' ? val._nanoseconds : 0);
      const d = new Date(sec * 1000 + Math.round(nano / 1e6));
      if (!isNaN(d.getTime())) return d;
    }
  }
  // ISO string or numeric milliseconds / seconds
  if (typeof val === 'string' || typeof val === 'number') {
    try {
      // If epoch in seconds (e.g. 1792061844)
      if (typeof val === 'number' && val > 1e9 && val < 1e11) {
        return new Date(val * 1000);
      }
      const d = new Date(val);
      if (!isNaN(d.getTime())) return d;
    } catch {}
  }
  return new Date();
}

/**
 * Safely converts any timestamp to an ISO string. Never throws RangeError.
 */
export function safeToIsoString(val: any): string {
  return safeToDate(val).toISOString();
}

/**
 * Formats a date into a friendly human-readable label:
 * - "Today"
 * - "Tomorrow"
 * - "Yesterday"
 * - Otherwise "Fri, Oct 9" (includes year only if different from current year, e.g. "Fri, Oct 9, 2025")
 */
export function formatFriendlyDate(
  dateInput: Date | string | any,
  referenceDateInput: Date | string | any = new Date()
): string {
  const date = safeToDate(dateInput);
  const referenceDate = safeToDate(referenceDateInput);

  if (isSameDay(date, referenceDate)) return 'Today';
  if (isSameDay(date, addDays(referenceDate, 1))) return 'Tomorrow';
  if (isSameDay(date, subDays(referenceDate, 1))) return 'Yesterday';

  const currentYear = referenceDate.getFullYear();
  const dateYear = date.getFullYear();

  try {
    const locale = typeof navigator !== 'undefined' ? navigator.language : undefined;
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      ...(dateYear !== currentYear ? { year: 'numeric' } : {}),
    };
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return dateYear === currentYear
      ? format(date, 'EEE, MMM d')
      : format(date, 'EEE, MMM d, yyyy');
  }
}

/**
 * Formats dates for Upcoming Moments rows:
 * - "Today"
 * - "Tomorrow"
 * - Otherwise "Sun, Oct 11"
 */
export function formatUpcomingDate(
  dateInput: Date | string | any,
  referenceDateInput: Date | string | any = new Date()
): string {
  const date = safeToDate(dateInput);
  const referenceDate = safeToDate(referenceDateInput);

  if (isSameDay(date, referenceDate)) return 'Today';
  if (isSameDay(date, addDays(referenceDate, 1))) return 'Tomorrow';
  if (isSameDay(date, subDays(referenceDate, 1))) return 'Yesterday';

  const currentYear = referenceDate.getFullYear();
  const dateYear = date.getFullYear();

  try {
    const locale = typeof navigator !== 'undefined' ? navigator.language : undefined;
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      ...(dateYear !== currentYear ? { year: 'numeric' } : {}),
    };
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return dateYear === currentYear
      ? format(date, 'EEE, MMM d')
      : format(date, 'EEE, MMM d, yyyy');
  }
}

/**
 * Formats time for header and status without heavy fonts:
 * e.g., "5:38 PM"
 */
export function formatTimeOnly(
  dateInput: Date | string | any = new Date(),
  timeZone?: string,
  options?: { showSeconds?: boolean; hour12?: boolean }
): string {
  const date = safeToDate(dateInput);

  try {
    const locale = typeof navigator !== 'undefined' ? navigator.language : undefined;
    return new Intl.DateTimeFormat(locale, {
      timeZone: timeZone || undefined,
      hour: 'numeric',
      minute: '2-digit',
      second: options?.showSeconds ? '2-digit' : undefined,
      hour12: options?.hour12 ?? true,
    }).format(date);
  } catch {
    return date.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      second: options?.showSeconds ? '2-digit' : undefined,
    });
  }
}
