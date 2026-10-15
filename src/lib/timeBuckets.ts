/**
 * Time-of-day buckets configuration and derivation for Duo.
 * 
 * Morning:    06:00 - 11:59 (360 to 719 minutes)
 * Afternoon:  12:00 - 14:59 (720 to 899 minutes)
 * Evening:    15:00 - 18:59 (900 to 1139 minutes)
 * Night:      19:00 - 23:59 (1140 to 1439 minutes)
 * Late Night: 00:00 - 05:59 (0 to 359 minutes) [shown only if tasks exist]
 * Anytime:    no time set [shown only if tasks exist]
 */

export type TimeBucketId = 'morning' | 'afternoon' | 'evening' | 'night' | 'late_night' | 'anytime';

export interface TimeBucketDefinition {
  id: TimeBucketId;
  label: string;
  timeRange: string;
  startMinute: number; // minutes from 00:00 (0..1439)
  endMinute: number;   // inclusive minute
  defaultTime: string; // HH:mm format for pre-filling
  icon: 'sunrise' | 'sun' | 'sunset' | 'moon' | 'sparkles' | 'clock';
}

/**
 * Boundaries and configuration stored in ONE central configuration object.
 */
export const TIME_BUCKET_CONFIG: Record<Exclude<TimeBucketId, 'anytime'>, TimeBucketDefinition> = {
  late_night: {
    id: 'late_night',
    label: 'Late Night',
    timeRange: '12 AM - 6 AM',
    startMinute: 0,
    endMinute: 359,
    defaultTime: '02:00',
    icon: 'moon',
  },
  morning: {
    id: 'morning',
    label: 'Morning',
    timeRange: '6 AM - 12 PM',
    startMinute: 360,
    endMinute: 719,
    defaultTime: '09:00',
    icon: 'sunrise',
  },
  afternoon: {
    id: 'afternoon',
    label: 'Afternoon',
    timeRange: '12 PM - 3 PM',
    startMinute: 720,
    endMinute: 899,
    defaultTime: '13:00',
    icon: 'sun',
  },
  evening: {
    id: 'evening',
    label: 'Evening',
    timeRange: '3 PM - 7 PM',
    startMinute: 900,
    endMinute: 1139,
    defaultTime: '17:00',
    icon: 'sunset',
  },
  night: {
    id: 'night',
    label: 'Night',
    timeRange: '7 PM - 12 AM',
    startMinute: 1140,
    endMinute: 1439,
    defaultTime: '20:00',
    icon: 'moon',
  },
};

export const ANYTIME_BUCKET: TimeBucketDefinition = {
  id: 'anytime',
  label: 'Anytime',
  timeRange: 'No time set',
  startMinute: -1,
  endMinute: -1,
  defaultTime: '09:00',
  icon: 'clock',
};

/**
 * Chronological order of standard sections.
 */
export const STANDARD_BUCKET_ORDER: TimeBucketId[] = [
  'morning',
  'afternoon',
  'evening',
  'night',
];

/**
 * Derive the time-of-day bucket for a given date / time string in a specific IANA timezone.
 * Returns 'anytime' if date is null, undefined, or empty.
 */
export function getBucket(
  dateOrIso: Date | string | null | undefined,
  timeZone?: string
): TimeBucketId {
  if (!dateOrIso) return 'anytime';

  let date: Date;
  if (typeof dateOrIso === 'string') {
    // If it's a simple HH:mm string e.g. "09:30"
    if (/^\d{1,2}:\d{2}$/.test(dateOrIso)) {
      const [h, m] = dateOrIso.split(':').map(Number);
      const totalMinutes = h * 60 + m;
      return getBucketFromMinutes(totalMinutes);
    }
    date = new Date(dateOrIso);
  } else {
    date = dateOrIso;
  }

  if (isNaN(date.getTime())) return 'anytime';

  // Extract hours and minutes in the requested IANA timezone using Intl.DateTimeFormat
  const resolvedTz = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: resolvedTz,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    let hour = 0;
    let minute = 0;
    for (const part of parts) {
      if (part.type === 'hour') hour = parseInt(part.value, 10);
      if (part.type === 'minute') minute = parseInt(part.value, 10);
    }
    // Handle 24-hour edge if formatted as 24
    if (hour === 24) hour = 0;

    const totalMinutes = hour * 60 + minute;
    return getBucketFromMinutes(totalMinutes);
  } catch (err) {
    // Fallback to local getHours / getMinutes
    const totalMinutes = date.getHours() * 60 + date.getMinutes();
    return getBucketFromMinutes(totalMinutes);
  }
}

/**
 * Helper to match total minutes of day (0..1439) into the configured buckets.
 */
export function getBucketFromMinutes(totalMinutes: number): TimeBucketId {
  // Normalize minutes into 0..1439
  const m = ((totalMinutes % 1440) + 1440) % 1440;

  if (m >= TIME_BUCKET_CONFIG.morning.startMinute && m <= TIME_BUCKET_CONFIG.morning.endMinute) {
    return 'morning';
  }
  if (m >= TIME_BUCKET_CONFIG.afternoon.startMinute && m <= TIME_BUCKET_CONFIG.afternoon.endMinute) {
    return 'afternoon';
  }
  if (m >= TIME_BUCKET_CONFIG.evening.startMinute && m <= TIME_BUCKET_CONFIG.evening.endMinute) {
    return 'evening';
  }
  if (m >= TIME_BUCKET_CONFIG.night.startMinute && m <= TIME_BUCKET_CONFIG.night.endMinute) {
    return 'night';
  }
  // Otherwise late night (0..359)
  return 'late_night';
}

/**
 * Get bucket metadata by ID.
 */
export function getBucketDefinition(id: TimeBucketId): TimeBucketDefinition {
  if (id === 'anytime') return ANYTIME_BUCKET;
  return TIME_BUCKET_CONFIG[id];
}
