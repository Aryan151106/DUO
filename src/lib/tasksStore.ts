/**
 * Realtime Task Store & Synchronizer (src/lib/tasksStore.ts)
 * 
 * Provides:
 * 1. Single shared Firestore subscription across the whole app shell
 * 2. Strict sanitization of undefined fields (preventing Firestore 400 errors)
 * 3. Accurate snapshot docChanges reducer (added, modified, removed)
 * 4. Optimistic updates with automatic rollback on network failure
 * 5. Live partner activity toast ("Sam just completed [Task Title]")
 * 6. "Live" / "Reconnecting..." status chip tracking
 */

import { create } from 'zustand';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type { TaskItem } from './dataStore';
import { useNotificationStore } from './notifications';
import { useAuthStore } from './store';

export type TaskSyncStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error';

export interface PartnerActivity {
  id: string;
  message: string;
  taskId: string;
  action: 'completed' | 'created' | 'updated';
  timestamp: number;
}

interface TaskStoreState {
  tasks: TaskItem[];
  status: TaskSyncStatus;
  partnerActivity: PartnerActivity | null;
  newPartnerTasksCount: number;
  lastSyncTime: number;

  // Actions
  initSubscription: (coupleId: string, currentUserId: string, partnerName?: string) => Unsubscribe;
  createTask: (coupleId: string, task: Omit<TaskItem, 'id' | 'created_at' | 'updated_at'>) => Promise<string>;
  updateTask: (coupleId: string, taskId: string, updates: Partial<TaskItem>) => Promise<void>;
  deleteTask: (coupleId: string, taskId: string) => Promise<void>;
  clearPartnerActivity: () => void;
  resetNewPartnerTasksCount: () => void;
}

function isPlainObject(val: any): boolean {
  if (typeof val !== 'object' || val === null) return false;
  const proto = Object.getPrototypeOf(val);
  return proto === null || proto === Object.prototype;
}

/**
 * Remove undefined values so Firestore SDK never rejects documents
 */
export function sanitizeFirestoreData<T extends Record<string, any>>(obj: T): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      if (isPlainObject(value)) {
        result[key] = sanitizeFirestoreData(value);
      } else if (Array.isArray(value)) {
        result[key] = value.map((item) => (isPlainObject(item) ? sanitizeFirestoreData(item) : item));
      } else {
        result[key] = value;
      }
    }
  }
  return result;
}

export const useTaskStore = create<TaskStoreState>((set, get) => {
  let activeUnsubscribe: Unsubscribe | null = null;
  let isFirstLoad = true;

  return {
    tasks: [],
    status: 'idle',
    partnerActivity: null,
    newPartnerTasksCount: 0,
    lastSyncTime: Date.now(),

    initSubscription: (coupleId: string, currentUserId: string, partnerName = 'Vidhi') => {
      if (activeUnsubscribe) {
        activeUnsubscribe();
        activeUnsubscribe = null;
      }

      set({ status: 'connecting' });
      isFirstLoad = true;

      const colRef = collection(db, 'couples', coupleId, 'tasks');
      const q = query(colRef, orderBy('createdAt', 'desc'));

      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const currentTasks = [...get().tasks];
          let updatedTasks = [...currentTasks];
          let newPartnerCount = get().newPartnerTasksCount;
          let latestActivity: PartnerActivity | null = null;

          snapshot.docChanges().forEach((change) => {
            const data = change.doc.data();
            const taskItem: TaskItem = {
              id: change.doc.id,
              couple_id: coupleId,
              title: data.title || '',
              description: data.description || '',
              status: data.status || 'todo',
              task_date: data.taskDate || data.task_date || '',
              startAt: data.startAt || null,
              timeZone: data.timeZone || 'UTC',
              priority: data.priority || 'normal',
              repeatRule: data.repeatRule || 'once',
              alarmSound: data.alarmSound,
              assigned_to: data.assignedTo || data.assigned_to || '',
              task_scope: data.taskScope || data.task_scope || 'personal',
              created_by: data.createdBy || data.created_by || '',
              reminders: data.reminders || [],
              attachments: data.attachments || [],
              doodle_url: data.doodleUrl || data.doodle_url,
              completed_at: data.completedAt || data.completed_at,
              completed_by: data.completedBy || data.completed_by,
              snoozedUntil: data.snoozedUntil,
              lastNudgedAt: data.lastNudgedAt,
              updated_at: data.updatedAt ? new Date().toISOString() : new Date().toISOString(),
            };

            if (change.type === 'added') {
              const existingIdx = updatedTasks.findIndex((t) => t.id === taskItem.id);
              if (existingIdx >= 0) {
                updatedTasks[existingIdx] = taskItem;
              } else {
                updatedTasks.unshift(taskItem);
                if (!isFirstLoad && taskItem.created_by !== currentUserId) {
                  newPartnerCount++;
                  latestActivity = {
                    id: `act-${Date.now()}`,
                    message: `${partnerName} added mission "${taskItem.title}"`,
                    taskId: taskItem.id,
                    action: 'created',
                    timestamp: Date.now(),
                  };
                }
              }
            } else if (change.type === 'modified') {
              const idx = updatedTasks.findIndex((t) => t.id === taskItem.id);
              if (idx >= 0) {
                const prev = updatedTasks[idx];
                updatedTasks[idx] = taskItem;

                if (!isFirstLoad && taskItem.status === 'done' && prev.status !== 'done') {
                  latestActivity = {
                    id: `act-${Date.now()}`,
                    message: `${partnerName} completed "${taskItem.title}"! 🎉`,
                    taskId: taskItem.id,
                    action: 'completed',
                    timestamp: Date.now(),
                  };
                }
              } else {
                updatedTasks.push(taskItem);
              }
            } else if (change.type === 'removed') {
              updatedTasks = updatedTasks.filter((t) => t.id !== change.doc.id);
            }
          });

          isFirstLoad = false;
          set({
            tasks: updatedTasks,
            status: 'live',
            lastSyncTime: Date.now(),
            newPartnerTasksCount: newPartnerCount,
            partnerActivity: latestActivity || get().partnerActivity,
          });
        },
        (error) => {
          console.warn('[TasksStore] Subscription error:', error);
          set({ status: 'reconnecting' });
        }
      );

      activeUnsubscribe = unsubscribe;
      return unsubscribe;
    },

    createTask: async (coupleId, taskData) => {
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const optimisticTask: TaskItem = {
        ...taskData,
        id: tempId,
        couple_id: coupleId,
        updated_at: new Date().toISOString(),
      };

      // Optimistic insert
      const previousTasks = get().tasks;
      set({ tasks: [optimisticTask, ...previousTasks] });

      try {
        const sanitized = sanitizeFirestoreData({
          title: taskData.title.trim(),
          description: taskData.description?.trim(),
          status: taskData.status || 'todo',
          taskDate: taskData.task_date,
          startAt: taskData.startAt,
          timeZone: taskData.timeZone,
          priority: taskData.priority || 'normal',
          repeatRule: taskData.repeatRule || 'once',
          alarmSound: taskData.alarmSound,
          assignedTo: taskData.assigned_to,
          taskScope: taskData.task_scope || 'personal',
          createdBy: taskData.created_by,
          reminders: taskData.reminders || [],
          attachments: taskData.attachments || [],
          doodleUrl: taskData.doodle_url,
          completedAt: taskData.completed_at || null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        const docRef = await addDoc(collection(db, 'couples', coupleId, 'tasks'), sanitized);

        // Dispatch pop-up notification for partner
        useNotificationStore.getState().sendNotification({
          coupleId,
          senderId: taskData.created_by,
          senderName: useAuthStore.getState().currentUser?.displayName || 'Aryan',
          type: 'task',
          title: 'New Shared Task 📋',
          body: taskData.title,
          deepLink: '/?action=today',
        });

        return docRef.id;
      } catch (err) {
        console.error('[TasksStore] Failed to create task, rolling back:', err);
        set({ tasks: previousTasks });
        throw err;
      }
    },

    updateTask: async (coupleId, taskId, updates) => {
      const previousTasks = get().tasks;
      // Optimistic update
      set({
        tasks: previousTasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t)),
      });

      try {
        const sanitized = sanitizeFirestoreData({
          ...updates,
          taskDate: updates.task_date,
          assignedTo: updates.assigned_to,
          doodleUrl: updates.doodle_url,
          completedAt: updates.completed_at,
          completedBy: updates.completed_by,
          updatedAt: serverTimestamp(),
        });

        await updateDoc(doc(db, 'couples', coupleId, 'tasks', taskId), sanitized);

        const taskBeingUpdated = previousTasks.find((t) => t.id === taskId);
        const authUser = useAuthStore.getState().currentUser;
        if (taskBeingUpdated && taskBeingUpdated.assigned_to && taskBeingUpdated.assigned_to !== authUser.id) {
          const statusText = updates.status === 'done' ? 'completed your task! 🎉' : 'updated your task ✏️';
          useNotificationStore.getState().sendNotification({
            coupleId,
            senderId: authUser.id,
            senderName: authUser.displayName,
            type: 'task',
            title: `${authUser.displayName} ${statusText}`,
            body: `"${updates.title || taskBeingUpdated.title}"`,
            deepLink: '/?action=today',
          });
        }
      } catch (err) {
        console.error('[TasksStore] Failed to update task, rolling back:', err);
        set({ tasks: previousTasks });
        throw err;
      }
    },

    deleteTask: async (coupleId, taskId) => {
      const previousTasks = get().tasks;
      set({ tasks: previousTasks.filter((t) => t.id !== taskId) });

      try {
        await deleteDoc(doc(db, 'couples', coupleId, 'tasks', taskId));

        const taskBeingDeleted = previousTasks.find((t) => t.id === taskId);
        const authUser = useAuthStore.getState().currentUser;
        if (taskBeingDeleted && taskBeingDeleted.assigned_to && taskBeingDeleted.assigned_to !== authUser.id) {
          useNotificationStore.getState().sendNotification({
            coupleId,
            senderId: authUser.id,
            senderName: authUser.displayName,
            type: 'task',
            title: `${authUser.displayName} deleted a task 🗑️`,
            body: `"${taskBeingDeleted.title}" was removed`,
            deepLink: '/?action=today',
          });
        }
      } catch (err) {
        console.error('[TasksStore] Failed to delete task, rolling back:', err);
        set({ tasks: previousTasks });
        throw err;
      }
    },

    clearPartnerActivity: () => set({ partnerActivity: null }),
    resetNewPartnerTasksCount: () => set({ newPartnerTasksCount: 0 }),
  };
});
