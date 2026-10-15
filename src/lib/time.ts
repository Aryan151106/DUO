// Time & Two-Timezone Utilities for Duo

export function getTodayForTimezone(tz: string = 'UTC'): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  } catch (e) {
    return new Date().toISOString().split('T')[0];
  }
}

export function getCurrentTimeInTimezone(tz: string = 'UTC', now: Date = new Date()): { timeStr: string; hour: number; minute: number } {
  try {
    const timeStr = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(now);

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(now);

    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);

    return { timeStr, hour, minute };
  } catch (e) {
    return {
      timeStr: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      hour: now.getHours(),
      minute: now.getMinutes(),
    };
  }
}

export function getTimezoneDifference(myTz: string, partnerTz: string, now: Date = new Date()): string {
  try {
    const getOffsetMinutes = (tz: string, date: Date): number => {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        timeZoneName: 'shortOffset',
      }).formatToParts(date);
      const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value || '';
      const match = tzPart.match(/GMT([+-])(\d+)(?::(\d+))?/);
      if (!match) return 0;
      const sign = match[1] === '+' ? 1 : -1;
      const hours = parseInt(match[2], 10);
      const minutes = match[3] ? parseInt(match[3], 10) : 0;
      return sign * (hours * 60 + minutes);
    };

    const myOffset = getOffsetMinutes(myTz, now);
    const partnerOffset = getOffsetMinutes(partnerTz, now);
    const diffMinutes = partnerOffset - myOffset;

    if (diffMinutes === 0) return 'Same time';
    const absHours = Math.floor(Math.abs(diffMinutes) / 60);
    const absMinutes = Math.abs(diffMinutes) % 60;
    const timeStr = absMinutes > 0 ? `${absHours}h ${absMinutes}m` : `${absHours}h`;
    return diffMinutes > 0 ? `${timeStr} ahead of you` : `${timeStr} behind you`;
  } catch (e) {
    return 'Same time';
  }
}

export function isInQuietHours(
  quietStart: string = '23:00',
  quietEnd: string = '07:00',
  partnerTz: string = 'UTC',
  now: Date = new Date()
): boolean {
  try {
    const { hour, minute } = getCurrentTimeInTimezone(partnerTz, now);
    const currentMins = hour * 60 + minute;

    const [startH, startM] = quietStart.split(':').map(Number);
    const [endH, endM] = quietEnd.split(':').map(Number);
    const startMins = startH * 60 + (startM || 0);
    const endMins = endH * 60 + (endM || 0);

    if (startMins > endMins) {
      // Overnight range, e.g. 23:00 to 07:00
      return currentMins >= startMins || currentMins < endMins;
    } else {
      // Daytime range
      return currentMins >= startMins && currentMins < endMins;
    }
  } catch (e) {
    return false;
  }
}

export function formatRelativeTime(dateStr: string | number): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);

  if (diffSec < 30) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffDays = Math.floor(diffH / 24);
  if (diffDays === 1) return 'Yesterday';
  return `${diffDays}d ago`;
}
