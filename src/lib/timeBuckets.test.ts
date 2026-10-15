import { describe, it, expect } from 'vitest';
import { getBucket, getBucketFromMinutes, TIME_BUCKET_CONFIG } from './timeBuckets';

describe('Time Buckets - Edge Minutes & Classification', () => {
  it('correctly maps all exact boundary minutes via getBucketFromMinutes', () => {
    // 00:00 = 0 mins -> late_night
    expect(getBucketFromMinutes(0)).toBe('late_night');

    // 05:59 = 359 mins -> late_night
    expect(getBucketFromMinutes(359)).toBe('late_night');

    // 06:00 = 360 mins -> morning
    expect(getBucketFromMinutes(360)).toBe('morning');

    // 11:59 = 719 mins -> morning
    expect(getBucketFromMinutes(719)).toBe('morning');

    // 12:00 = 720 mins -> afternoon
    expect(getBucketFromMinutes(720)).toBe('afternoon');

    // 14:59 = 899 mins -> afternoon
    expect(getBucketFromMinutes(899)).toBe('afternoon');

    // 15:00 = 900 mins -> evening
    expect(getBucketFromMinutes(900)).toBe('evening');

    // 18:59 = 1139 mins -> evening
    expect(getBucketFromMinutes(1139)).toBe('evening');

    // 19:00 = 1140 mins -> night
    expect(getBucketFromMinutes(1140)).toBe('night');

    // 23:59 = 1439 mins -> night
    expect(getBucketFromMinutes(1439)).toBe('night');
  });

  it('correctly classifies string times (HH:mm)', () => {
    expect(getBucket('00:00')).toBe('late_night');
    expect(getBucket('05:59')).toBe('late_night');
    expect(getBucket('06:00')).toBe('morning');
    expect(getBucket('09:30')).toBe('morning');
    expect(getBucket('11:59')).toBe('morning');
    expect(getBucket('12:00')).toBe('afternoon');
    expect(getBucket('13:45')).toBe('afternoon');
    expect(getBucket('14:59')).toBe('afternoon');
    expect(getBucket('15:00')).toBe('evening');
    expect(getBucket('17:15')).toBe('evening');
    expect(getBucket('18:59')).toBe('evening');
    expect(getBucket('19:00')).toBe('night');
    expect(getBucket('21:00')).toBe('night');
    expect(getBucket('23:59')).toBe('night');
  });

  it('handles null, undefined, and empty string as anytime', () => {
    expect(getBucket(null)).toBe('anytime');
    expect(getBucket(undefined)).toBe('anytime');
    expect(getBucket('')).toBe('anytime');
  });

  it('correctly derives bucket across different timezones', () => {
    // 2026-10-10T14:30:00.000Z
    // In UTC: 14:30 -> afternoon (12:00 - 14:59)
    expect(getBucket('2026-10-10T14:30:00.000Z', 'UTC')).toBe('afternoon');

    // In America/New_York (UTC-4 in Oct): 10:30 AM -> morning (06:00 - 11:59)
    expect(getBucket('2026-10-10T14:30:00.000Z', 'America/New_York')).toBe('morning');

    // In Asia/Tokyo (UTC+9): 23:30 -> night (19:00 - 23:59)
    expect(getBucket('2026-10-10T14:30:00.000Z', 'Asia/Tokyo')).toBe('night');

    // In Europe/London (UTC+1 BST in Oct): 15:30 -> evening (15:00 - 18:59)
    expect(getBucket('2026-10-10T14:30:00.000Z', 'Europe/London')).toBe('evening');
  });

  it('keeps boundaries in ONE central config object', () => {
    expect(TIME_BUCKET_CONFIG.morning.startMinute).toBe(360);
    expect(TIME_BUCKET_CONFIG.morning.endMinute).toBe(719);
    expect(TIME_BUCKET_CONFIG.afternoon.startMinute).toBe(720);
    expect(TIME_BUCKET_CONFIG.afternoon.endMinute).toBe(899);
    expect(TIME_BUCKET_CONFIG.evening.startMinute).toBe(900);
    expect(TIME_BUCKET_CONFIG.evening.endMinute).toBe(1139);
    expect(TIME_BUCKET_CONFIG.night.startMinute).toBe(1140);
    expect(TIME_BUCKET_CONFIG.night.endMinute).toBe(1439);
    expect(TIME_BUCKET_CONFIG.late_night.startMinute).toBe(0);
    expect(TIME_BUCKET_CONFIG.late_night.endMinute).toBe(359);
  });
});
