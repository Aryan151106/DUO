import { useState, useEffect } from 'react';

/**
 * Singleton timer that updates once per second for the entire application.
 *
 * Characteristics:
 * - One shared timer for the whole app (not one timer per component).
 * - Aligns ticks directly to the boundary of each whole second.
 * - Pauses when the tab is hidden (saving CPU/battery).
 * - Resyncs immediately when the tab becomes visible.
 */

type TickListener = (now: Date) => void;

class SharedClockManager {
  private listeners = new Set<TickListener>();
  private timeoutId: number | null = null;
  private currentNow: Date = new Date();
  private isRunning = false;

  constructor() {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  public getNow(): Date {
    return this.currentNow;
  }

  public subscribe(listener: TickListener): () => void {
    this.listeners.add(listener);
    // Immediately notify new subscriber with latest time
    listener(this.currentNow);

    if (this.listeners.size === 1) {
      this.startClock();
    }

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stopClock();
      }
    };
  }

  private handleVisibilityChange = () => {
    if (document.hidden) {
      // Pause clock while tab is in background
      this.stopClock();
    } else {
      // Instantly resync when visible
      this.currentNow = new Date();
      this.notifyListeners();
      this.startClock();
    }
  };

  private startClock() {
    if (this.isRunning && this.timeoutId !== null) return;
    this.isRunning = true;
    this.scheduleNextTick();
  }

  private stopClock() {
    if (this.timeoutId !== null) {
      if (typeof window !== 'undefined') {
        window.clearTimeout(this.timeoutId);
      } else {
        clearTimeout(this.timeoutId as any);
      }
      this.timeoutId = null;
    }
    this.isRunning = false;
  }

  private scheduleNextTick = () => {
    if (!this.isRunning) return;

    // Align tick to the next whole second with sub-second drift compensation
    const nowMs = Date.now();
    const delay = 1000 - (nowMs % 1000);

    const schedule = typeof window !== 'undefined' ? window.setTimeout : setTimeout;
    this.timeoutId = schedule(() => {
      this.currentNow = new Date();
      this.notifyListeners();
      this.scheduleNextTick();
    }, delay) as any;
  };

  private notifyListeners() {
    for (const listener of this.listeners) {
      try {
        listener(this.currentNow);
      } catch (err) {
        console.error('Error in clock tick listener:', err);
      }
    }
  }
}

export const sharedClock = new SharedClockManager();

/**
 * Hook to subscribe to the single application-wide second tick.
 */
export function useNow(): Date {
  const [now, setNow] = useState<Date>(() => sharedClock.getNow());

  useEffect(() => {
    return sharedClock.subscribe((updatedNow) => {
      setNow(updatedNow);
    });
  }, []);

  return now;
}

/**
 * Hook to subscribe to time ticks ONLY when the minute changes.
 * Prevents heavy components (Calendar, Task lists) from re-rendering 60 times a minute.
 */
export function useMinuteNow(): Date {
  const [now, setNow] = useState<Date>(() => sharedClock.getNow());

  useEffect(() => {
    return sharedClock.subscribe((updatedNow) => {
      setNow((prev) => {
        if (Math.floor(updatedNow.getTime() / 60000) !== Math.floor(prev.getTime() / 60000)) {
          return updatedNow;
        }
        return prev;
      });
    });
  }, []);

  return now;
}

