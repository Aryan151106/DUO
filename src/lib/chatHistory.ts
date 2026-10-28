/**
 * chatHistory.ts
 * Core logic for progressive day-by-day chat history loading, deterministic
 * sorting, deduplication, day boundary computation, and scroll anchor preservation.
 */


export interface DayGroup<T = any> {
  dateKey: string; // YYYY-MM-DD
  label: string;   // e.g. "Today", "Yesterday", or "Oct 15, 2026"
  startOfDayMs: number;
  endOfDayMs: number;
  messages: T[];
}

/**
 * Normalizes any timestamp representation found across DUO's Firestore messages
 * (Firestore Timestamp, ISO 8601 string, numeric epoch ms, or legacy field).
 */
export function normalizeMessageTimestamp(m: any): number {
  if (!m) return Date.now();

  const parseValue = (val: any): number | null => {
    if (!val) return null;
    if (typeof val.toMillis === 'function') {
      const ms = val.toMillis();
      if (!isNaN(ms) && ms > 0) return ms;
    }
    if (typeof val._seconds === 'number' && val._seconds > 0) {
      const ms = val._seconds * 1000 + (val._nanoseconds ? Math.round(val._nanoseconds / 1e6) : 0);
      if (!isNaN(ms) && ms > 0) return ms;
    }
    if (val instanceof Date && !isNaN(val.getTime())) {
      return val.getTime();
    }
    if (typeof val === 'number' && !isNaN(val) && val > 0) {
      // If seconds instead of ms (10 digits), convert to ms
      return val > 1e9 && val < 1e11 ? val * 1000 : val;
    }
    if (typeof val === 'string') {
      const parsed = new Date(val).getTime();
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return null;
  };

  // 1. Preferred canonical timestamp: createdAt
  const fromCreatedAt = parseValue(m.createdAt);
  if (fromCreatedAt) return fromCreatedAt;

  // 2. ISO string format: created_at
  const fromCreatedAtSnake = parseValue(m.created_at);
  if (fromCreatedAtSnake) return fromCreatedAtSnake;

  // 3. Client timestamp: clientTimestamp
  const fromClientTimestamp = parseValue(m.clientTimestamp);
  if (fromClientTimestamp) return fromClientTimestamp;

  // 4. Legacy timestamp field: timestamp
  const fromTimestamp = parseValue(m.timestamp);
  if (fromTimestamp) return fromTimestamp;

  // 5. Client ID or ID with embedded epoch (e.g. msg-1760548123456-...)
  const idToCheck = m.clientId || m.client_id || m.id;
  if (typeof idToCheck === 'string' && idToCheck.startsWith('msg-')) {
    const parts = idToCheck.split('-');
    const ts = parseInt(parts[1], 10);
    if (!isNaN(ts) && ts > 1e11) return ts;
  }

  // 6. Delivery or Read timestamps as fallback
  const fromDelivered = parseValue(m.deliveredAt);
  if (fromDelivered) return fromDelivered;

  const fromRead = parseValue(m.readAt);
  if (fromRead) return fromRead;

  // Pinned deterministic fallback
  try {
    if ((m as any)._pinnedTime) return (m as any)._pinnedTime;
    (m as any)._pinnedTime = Date.now();
    return (m as any)._pinnedTime;
  } catch {
    return Date.now();
  }
}

/**
 * Returns formatted date key YYYY-MM-DD for a timestamp under a specified timezone.
 */
export function getDateKeyForTimestamp(timestampMs: number, timeZone?: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date(timestampMs));
  } catch {
    const d = new Date(timestampMs);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}

/**
 * Computes the exact offset in milliseconds between UTC and a target timeZone at a given moment.
 */
function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    fractionalSecondDigits: 3,
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  let year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0, millisecond = 0;
  for (const part of parts) {
    if (part.type === 'year') year = parseInt(part.value, 10);
    else if (part.type === 'month') month = parseInt(part.value, 10);
    else if (part.type === 'day') day = parseInt(part.value, 10);
    else if (part.type === 'hour') hour = parseInt(part.value, 10);
    else if (part.type === 'minute') minute = parseInt(part.value, 10);
    else if (part.type === 'second') second = parseInt(part.value, 10);
    else if (part.type === 'fractionalSecond') millisecond = parseInt(part.value, 10);
  }
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  return asUtc - date.getTime();
}

/**
 * Computes start-of-day epoch milliseconds for a given timestamp in a specified timezone.
 * Accurately accounts for hours, minutes (e.g. UTC+5:30, UTC+9:30), and daylight saving time.
 */
export function getStartOfDayMs(timestampMs: number, timeZone?: string): number {
  const dateKey = getDateKeyForTimestamp(timestampMs, timeZone);
  const [y, m, d] = dateKey.split('-').map(Number);
  
  if (timeZone) {
    try {
      const targetUtcMidnight = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
      const initialOffset = getTimeZoneOffsetMs(new Date(targetUtcMidnight), timeZone);
      const candidateMs = targetUtcMidnight - initialOffset;
      // Refine across possible DST transitions near midnight
      const refinedOffset = getTimeZoneOffsetMs(new Date(candidateMs), timeZone);
      return targetUtcMidnight - refinedOffset;
    } catch {
      // Fallback to local
    }
  }

  const local = new Date(y, m - 1, d, 0, 0, 0, 0);
  return local.getTime();
}

/**
 * Computes end-of-day epoch milliseconds for a given timestamp in a specified timezone.
 */
export function getEndOfDayMs(timestampMs: number, timeZone?: string): number {
  const start = getStartOfDayMs(timestampMs, timeZone);
  // Target next day's midnight minus 1 millisecond
  const nextDayStart = getStartOfDayMs(start + 26 * 3600000, timeZone);
  return nextDayStart - 1;
}

/**
 * Generates user-friendly label for a day group (Today, Yesterday, or formatted date).
 * Avoids browser device timezone shifts by formatting the resolved date components consistently.
 */
export function getFriendlyDayLabel(dateKey: string, timeZone?: string): string {
  const todayKey = getDateKeyForTimestamp(Date.now(), timeZone);
  const yesterdayKey = getDateKeyForTimestamp(Date.now() - 86400000, timeZone);

  if (dateKey === todayKey) return 'Today';
  if (dateKey === yesterdayKey) return 'Yesterday';

  const [y, m, d] = dateKey.split('-').map(Number);
  // Construct date at UTC noon to avoid any timezone boundary crossings
  const utcDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      year: y !== new Date().getFullYear() ? 'numeric' : undefined,
    }).format(utcDate);
  } catch {
    return dateKey;
  }
}

/**
 * Groups messages into chronologically sorted calendar days with day separator headers.
 */
export function groupMessagesByDay<T extends { id: string }>(messages: T[], timeZone?: string): DayGroup<T>[] {
  const groupsMap = new Map<string, DayGroup<T>>();

  for (const msg of messages) {
    const ts = normalizeMessageTimestamp(msg);
    const dateKey = getDateKeyForTimestamp(ts, timeZone);

    let group = groupsMap.get(dateKey);
    if (!group) {
      group = {
        dateKey,
        label: getFriendlyDayLabel(dateKey, timeZone),
        startOfDayMs: getStartOfDayMs(ts, timeZone),
        endOfDayMs: getEndOfDayMs(ts, timeZone),
        messages: [],
      };
      groupsMap.set(dateKey, group);
    }
    group.messages.push(msg);
  }

  // Sort groups chronologically (oldest day to newest day)
  const sortedGroups = Array.from(groupsMap.values()).sort((a, b) => a.startOfDayMs - b.startOfDayMs);

  // Sort messages inside each group chronologically
  for (const group of sortedGroups) {
    group.messages.sort((a, b) => {
      const tA = normalizeMessageTimestamp(a);
      const tB = normalizeMessageTimestamp(b);
      if (tA !== tB) return tA - tB;
      const idA = a.id || (a as any).clientId || '';
      const idB = b.id || (b as any).clientId || '';
      return idA.localeCompare(idB);
    });
  }

  return sortedGroups;
}

/**
 * Merges historical messages and live snapshot messages without duplicates,
 * maintaining strict chronological order with deterministic tie-breaking.
 */
export function mergeAndDeduplicateMessages<T extends { id: string }>(
  existingMessages: T[],
  incomingMessages: T[]
): T[] {
  const map = new Map<string, T>();

  // Helper to extract canonical deduplication key
  const getKeys = (m: T): string[] => {
    const keys: string[] = [];
    if (m.id) keys.push(`id:${m.id}`);
    const clientKey = (m as any).clientId || (m as any).client_id;
    if (clientKey) keys.push(`client:${clientKey}`);
    return keys;
  };

  // 1. Insert existing messages
  for (const msg of existingMessages) {
    const keys = getKeys(msg);
    if (keys.length > 0) {
      map.set(keys[0], msg);
    } else {
      map.set(`fallback:${Math.random()}`, msg);
    }
  }

  // 2. Merge incoming messages (prefer server version with definitive id and status)
  for (const msg of incomingMessages) {
    let matched = false;
    for (const k of getKeys(msg)) {
      if (map.has(k)) {
        // Update existing record with incoming data
        map.set(k, { ...map.get(k)!, ...msg });
        matched = true;
        break;
      }
    }
    if (!matched) {
      const keys = getKeys(msg);
      map.set(keys[0] || `fallback:${Math.random()}`, msg);
    }
  }

  const merged = Array.from(map.values());

  // 3. Deterministic sort: ascending by normalized timestamp, tie-break by ID
  merged.sort((a, b) => {
    const tA = normalizeMessageTimestamp(a);
    const tB = normalizeMessageTimestamp(b);
    if (tA !== tB) return tA - tB;
    const idA = a.id || (a as any).clientId || (a as any).client_id || '';
    const idB = b.id || (b as any).clientId || (b as any).client_id || '';
    return idA.localeCompare(idB);
  });

  return merged;
}

/**
 * Reconciles optimistic messages against server messages by stable clientId or document ID.
 * Returns only optimistic messages that have NOT yet arrived from the server.
 */
export function reconcileOptimisticMessages<T extends { id: string }>(
  optimisticMessages: T[],
  serverMessages: any[]
): T[] {
  if (optimisticMessages.length === 0) return [];

  const serverIds = new Set<string>();
  const serverClientIds = new Set<string>();

  for (const s of serverMessages) {
    if (s.id) serverIds.add(s.id);
    const cId = (s as any).clientId || (s as any).client_id;
    if (cId) serverClientIds.add(cId);
  }

  return optimisticMessages.filter((opt) => {
    const optId = opt.id;
    const optClientId = (opt as any).clientId || (opt as any).client_id || optId;

    if (serverIds.has(optId)) return false;
    if (serverClientIds.has(optId)) return false;
    if (serverIds.has(optClientId)) return false;
    if (serverClientIds.has(optClientId)) return false;

    return true;
  });
}

/**
 * Calculates new scroll position after older messages are prepended to the top of the container.
 * Keeps the previously visible message anchored without visual jumping.
 */
export function calculateScrollCompensation(
  prevScrollHeight: number,
  newScrollHeight: number,
  currentScrollTop: number
): number {
  const heightDifference = newScrollHeight - prevScrollHeight;
  if (heightDifference <= 0) return currentScrollTop;
  return currentScrollTop + heightDifference;
}
