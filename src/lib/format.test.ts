import { describe, it, expect } from 'vitest';
import { formatFriendlyDate, formatUpcomingDate, formatTimeOnly, safeToDate, safeToIsoString } from './format';
import { addDays, subDays } from 'date-fns';

describe('format.ts', () => {
  const now = new Date(2026, 9, 10, 15, 30); // Oct 10, 2026

  it('formats Today, Tomorrow, Yesterday correctly', () => {
    expect(formatFriendlyDate(now, now)).toBe('Today');
    expect(formatFriendlyDate(addDays(now, 1), now)).toBe('Tomorrow');
    expect(formatFriendlyDate(subDays(now, 1), now)).toBe('Yesterday');
  });

  it('formats other dates with short weekday and month', () => {
    const futureDate = addDays(now, 5); // Oct 15, 2026
    const formatted = formatFriendlyDate(futureDate, now);
    expect(formatted).toContain('Oct');
    expect(formatted).toContain('15');
  });

  it('formats upcoming dates similarly', () => {
    expect(formatUpcomingDate(now, now)).toBe('Today');
    expect(formatUpcomingDate(addDays(now, 1), now)).toBe('Tomorrow');
  });

  it('formats time cleanly without crashing', () => {
    const timeStr = formatTimeOnly(now, 'UTC');
    expect(typeof timeStr).toBe('string');
    expect(timeStr.length).toBeGreaterThan(0);
  });

  it('safeToDate and safeToIsoString never throw on invalid/corrupt dates', () => {
    expect(() => safeToDate(null)).not.toThrow();
    expect(() => safeToDate(undefined)).not.toThrow();
    expect(() => safeToDate('invalid-string')).not.toThrow();
    expect(() => safeToDate({ seconds: 1728556800, nanoseconds: 0 })).not.toThrow();
    expect(() => safeToIsoString(null)).not.toThrow();
    expect(() => safeToIsoString('not-a-date')).not.toThrow();
    expect(() => safeToIsoString({ toDate: () => new Date('invalid') })).not.toThrow();
  });

  it('formatFriendlyDate never throws on invalid inputs', () => {
    expect(() => formatFriendlyDate(null)).not.toThrow();
    expect(() => formatFriendlyDate(undefined)).not.toThrow();
    expect(() => formatFriendlyDate('garbage')).not.toThrow();
  });
});
