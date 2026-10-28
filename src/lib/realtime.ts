import { QueryClient } from '@tanstack/react-query';
import { duoBroadcast, broadcastEvent } from './supabase';
import type { RealtimeEnvelope } from './supabase';
import { useAuthStore, useCallStore, useNudgeStore, usePresenceStore } from './store';
import { soundManager } from './sound';
import { duoDataStore } from './dataStore';
import type { TaskItem, ChatMessage } from './dataStore';

export function startRealtimeRouter(coupleId: string, queryClient: QueryClient) {
  // Listen to BroadcastChannel for local/cross-tab multi-user events
  const handleBroadcastMessage = (event: MessageEvent<RealtimeEnvelope>) => {
    const data = event.data;
    if (!data || data.coupleId !== coupleId) return;

    const { currentUser } = useAuthStore.getState();
    const isFromPartner = data.senderId !== currentUser.id;

    switch (data.type) {
      case 'TASK_MUTATION': {
        const { action, task } = data.payload as { action: 'insert' | 'update' | 'delete'; task: TaskItem };
        const currentTasks = duoDataStore.getTasks();
        let updated: TaskItem[] = [];

        if (action === 'insert') {
          updated = [task, ...currentTasks.filter((t) => t.id !== task.id)];
        } else if (action === 'update') {
          updated = currentTasks.map((t) => (t.id === task.id ? { ...t, ...task } : t));
        } else if (action === 'delete') {
          updated = currentTasks.filter((t) => t.id !== task.id);
        }

        duoDataStore.saveTasks(updated);
        queryClient.setQueryData(['tasks', coupleId], updated);
        queryClient.invalidateQueries({ queryKey: ['tasks'] });

        if (isFromPartner && action === 'insert') {
          soundManager.playPing();
          usePresenceStore.getState().setLastPartnerActivity(`Added: "${task.title}"`);
        }
        break;
      }

      case 'MESSAGE_SENT': {
        const message = data.payload as ChatMessage;
        const currentMsgs = duoDataStore.getMessages();
        const updated = [...currentMsgs.filter((m) => m.id !== message.id), message];
        duoDataStore.saveMessages(updated);
        queryClient.setQueryData(['messages', coupleId], updated);

        if (isFromPartner) {
          soundManager.playPing();
          usePresenceStore.getState().setLastPartnerActivity('Sent a message');
        }
        break;
      }

      case 'NUDGE_TRIGGERED': {
        const nudgePayload = data.payload;
        if (isFromPartner) {
          // Open the nudge overlay on receiver's device!
          useNudgeStore.getState().openNudge({
            id: nudgePayload.id,
            taskId: nudgePayload.taskId,
            taskTitle: nudgePayload.taskTitle,
            senderName:
              nudgePayload?.senderName ||
              (data.senderId === 'user-aryan-1' || data.senderId === 'user-alex-1' ? 'Aryan' : 'Vidhi'),
            level: nudgePayload.level || 1,
            level4Count: nudgePayload.level4Count || 0,
            createdAt: new Date().toISOString(),
          });

          // Play appropriate sound & vibration based on escalation level
          if (nudgePayload.level >= 4) {
            soundManager.startLevel4Alarm();
          } else if (nudgePayload.level === 3) {
            soundManager.playUrgentAlert();
          } else {
            soundManager.playPing();
          }
        }
        break;
      }

      case 'NUDGE_RESOLVED': {
        const { taskId } = data.payload;
        const currentNudge = useNudgeStore.getState().activeNudge;
        if (currentNudge && currentNudge.taskId === taskId) {
          soundManager.stopLevel4Alarm();
          useNudgeStore.getState().closeNudge();
          soundManager.playGentleChime();
        }
        break;
      }

      case 'TYPING_STATUS': {
        if (isFromPartner) {
          usePresenceStore.getState().setPartnerTyping(Boolean(data.payload.isTyping));
          usePresenceStore.getState().setPartnerRecording(Boolean(data.payload.isRecording));
          if (data.payload.isTyping) {
            usePresenceStore.getState().setPartnerPresence(true);
            window.setTimeout(() => {
              usePresenceStore.getState().setPartnerTyping(false);
              usePresenceStore.getState().setPartnerRecording(false);
            }, 5000);
          }
        }
        break;
      }

      case 'PRESENCE_SYNC': {
        if (isFromPartner) {
          usePresenceStore.getState().setPartnerPresence(true);
        }
        break;
      }

      case 'PRESENCE_UPDATE': {
        if (isFromPartner) {
          const payload = data.payload as { online: boolean; lastSeen: number };
          usePresenceStore.getState().setPartnerPresence(payload.online, payload.lastSeen);
        }
        break;
      }

      case 'CALL_SIGNAL': {
        const signal = data.payload;
        const callStore = useCallStore.getState();

        if (signal.action === 'offer' && isFromPartner) {
          // Incoming call!
          callStore.startCall(signal.callType || 'video', false, signal.callId);
          soundManager.startRingtone();
        } else if (signal.action === 'answer' && isFromPartner) {
          soundManager.stopRingtone();
          callStore.answerCall();
        } else if (signal.action === 'hangup' && isFromPartner) {
          soundManager.stopRingtone();
          callStore.endCall(signal.reason);
        }
        break;
      }

      default:
        break;
    }
  };

  if (duoBroadcast) {
    duoBroadcast.addEventListener('message', handleBroadcastMessage);
  }

  // Periodic heartbeat presence ping
  const announcePresence = (online: boolean) => {
    if (localStorage.getItem('duo_show_active_status') === 'false') return;
    const { currentUser } = useAuthStore.getState();
    broadcastEvent(
      online ? 'PRESENCE_SYNC' : 'PRESENCE_UPDATE',
      online ? { status: 'online' } : { online: false, lastSeen: Date.now() },
      currentUser.id,
      coupleId
    );
  };
  announcePresence(true);
  const presenceInterval = setInterval(() => {
    if (document.visibilityState === 'visible') {
      announcePresence(true);
    }
  }, 25000);

  const announceOffline = () => {
    announcePresence(false);
  };
  window.addEventListener('beforeunload', announceOffline);
  const handleVisibility = () => {
    if (document.visibilityState === 'hidden') announceOffline();
    else announcePresence(true);
  };
  document.addEventListener('visibilitychange', handleVisibility);

  return () => {
    if (duoBroadcast) {
      duoBroadcast.removeEventListener('message', handleBroadcastMessage);
    }
    clearInterval(presenceInterval);
    window.removeEventListener('beforeunload', announceOffline);
    document.removeEventListener('visibilitychange', handleVisibility);
  };
}
