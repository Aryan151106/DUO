// Offline Queue Manager with local persistence and idempotency
export interface QueuedMutation {
  id: string;
  clientId: string;
  type: 'task_insert' | 'task_update' | 'task_delete' | 'message_send';
  payload: any;
  createdAt: number;
}

const STORAGE_KEY = 'duo_offline_mutation_queue_v1';

class OfflineQueue {
  private queue: QueuedMutation[] = [];
  private isProcessing: boolean = false;

  constructor() {
    this.loadFromStorage();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.replay());
    }
  }

  private loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.queue = JSON.parse(raw);
      }
    } catch (e) {
      this.queue = [];
    }
  }

  private saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
    } catch (e) {
      console.warn('Failed to save offline queue:', e);
    }
  }

  public enqueue(item: Omit<QueuedMutation, 'id' | 'createdAt'>): QueuedMutation {
    const mutation: QueuedMutation = {
      ...item,
      id: `queue-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      createdAt: Date.now(),
    };
    this.queue.push(mutation);
    this.saveToStorage();

    if (navigator.onLine) {
      this.replay();
    }
    return mutation;
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public async replay(executor?: (item: QueuedMutation) => Promise<boolean>) {
    if (this.isProcessing || this.queue.length === 0 || !navigator.onLine) return;
    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        const item = this.queue[0];
        if (executor) {
          try {
            await executor(item);
          } catch (e) {
            console.error('Error executing queued mutation:', e);
          }
        }

        this.queue.shift();
        this.saveToStorage();
      }
    } finally {
      this.isProcessing = false;
    }
  }
}

export const offlineQueue = new OfflineQueue();
