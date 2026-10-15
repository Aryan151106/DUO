import { useEffect, useRef, useState, useCallback } from 'react';
import {
  doc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  collection,
  query,
  where,
  limit,
} from 'firebase/firestore';

import { io, Socket } from 'socket.io-client';
import { db, auth } from './firebase';
import { useAuthStore } from './store';
import { duoBroadcast } from './supabase';
import { getSocketServerUrl } from './socketConfig';

export type RoomType = 'study' | 'movie';
export type RoomStatus = 'waiting' | 'active' | 'ended';

export interface StudyTimerState {
  mode: 'focus' | 'break';
  durationSeconds: number;
  startedAt: any | null;
  pausedRemainingSeconds: number | null;
}

export interface MovieRoomState {
  screenShareOwnerUid: string | null;
  title?: string;
}

export interface TogetherRoom {
  roomId: string;
  type: RoomType;
  status: RoomStatus;
  hostUid: string;
  memberUids: string[];
  coupleId: string;
  roomName?: string;
  serverUrl?: string;
  dailyRoomName?: string;
  dailyRoomUrl?: string;
  createdAt: any;
  endedAt: any | null;
  revision: number;
  study: StudyTimerState | null;
  movie: MovieRoomState | null;
}

export interface RoomParticipant {
  uid: string;
  displayName: string;
  role: 'host' | 'participant';
  joinedAt?: any;
  lastSeenAt?: any;
}

export interface RoomReaction {
  id: string;
  uid: string;
  emoji: string;
  timestamp: number;
}

export interface RoomMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: number;
}

// Re-export Socket configuration helper
export { getSocketServerUrl } from './socketConfig';

// ─── LiveKit Cloud Token & Room Operations ────────────────────────

export async function requestLiveKitToken(roomId: string, coupleId: string): Promise<{
  token: string;
  serverUrl: string;
  roomName: string;
  identity: string;
  displayName: string;
  isHost: boolean;
}> {
  const socketUrl = getSocketServerUrl();
  if (!socketUrl) {
    throw new Error('LiveKit backend server URL is not configured. Please configure your server URL in Settings.');
  }

  if (!auth.currentUser) {
    throw new Error('You must be signed in to request a LiveKit media token.');
  }

  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch(`${socketUrl}/api/livekit/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ roomId, coupleId }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `Failed to obtain LiveKit media token (HTTP ${res.status}).`);
  }

  const data = await res.json();
  if (!data.token) {
    throw new Error('LiveKit server did not return a valid media token.');
  }

  return data;
}

export async function createTogetherRoom(
  type: RoomType,
  initialTitle?: string
): Promise<{ roomId: string; roomName: string; serverUrl: string; token: string }> {
  const isDemo = useAuthStore.getState().isDemoMode || !auth.currentUser;
  const couple = useAuthStore.getState().couple;

  if (isDemo || !couple?.id || couple.id.startsWith('demo')) {
    const demoRoomId = `demo-${type}-${Date.now()}`;
    if (duoBroadcast) {
      duoBroadcast.postMessage({
        type: 'TOGETHER_ROOM_CREATED',
        payload: { roomId: demoRoomId, type },
      });
    }

    return {
      roomId: demoRoomId,
      roomName: demoRoomId,
      serverUrl: 'wss://av-space-cgq1lsbg.livekit.cloud',
      token: 'demo-local-token',
    };
  }

  const socketUrl = getSocketServerUrl();
  if (!socketUrl) {
    throw new Error('LiveKit server URL is not configured. Please set your server URL in Settings to start a room.');
  }

  if (!auth.currentUser) {
    throw new Error('You must be signed in to create a together room.');
  }

  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch(`${socketUrl}/api/livekit/create-room`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ type, initialTitle }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `Failed to create together room (HTTP ${res.status}).`);
  }

  const data = await res.json();
  if (!data.token) {
    throw new Error('Backend failed to issue a LiveKit token for this session.');
  }

  return {
    roomId: data.roomId,
    roomName: data.roomName,
    serverUrl: data.serverUrl,
    token: data.token,
  };
}

export async function joinTogetherRoom(
  roomId: string
): Promise<{ roomId: string; roomName: string; serverUrl: string; token: string; type: RoomType }> {
  const isDemo = useAuthStore.getState().isDemoMode || !auth.currentUser;

  if (isDemo || roomId.startsWith('demo')) {
    return {
      roomId,
      roomName: roomId,
      serverUrl: 'wss://av-space-cgq1lsbg.livekit.cloud',
      token: 'demo-local-token',
      type: roomId.includes('movie') ? 'movie' : 'study',
    };
  }

  const socketUrl = getSocketServerUrl();
  if (!socketUrl) {
    throw new Error('LiveKit server URL is not configured. Please set your server URL in Settings.');
  }

  if (!auth.currentUser) {
    throw new Error('You must be signed in to join a together room.');
  }

  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch(`${socketUrl}/api/livekit/join-room`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ roomId }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `Failed to join together room (HTTP ${res.status}).`);
  }

  const data = await res.json();
  if (!data.token) {
    throw new Error('Backend did not return a LiveKit token for this room.');
  }

  return {
    roomId: data.roomId,
    roomName: data.roomName,
    serverUrl: data.serverUrl,
    token: data.token,
    type: data.type || 'study',
  };
}

export async function endTogetherRoom(roomId: string): Promise<void> {
  const isDemo = useAuthStore.getState().isDemoMode || !auth.currentUser;

  if (isDemo || roomId.startsWith('demo')) {
    if (duoBroadcast) {
      duoBroadcast.postMessage({
        type: 'TOGETHER_ROOM_ENDED',
        payload: { roomId },
      });
    }
    return;
  }

  const socketUrl = getSocketServerUrl();
  if (socketUrl && auth.currentUser) {
    try {
      const idToken = await auth.currentUser.getIdToken();
      await fetch(`${socketUrl}/api/livekit/end-room`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ roomId }),
      });
      return;
    } catch (serverErr) {
      console.warn('[TogetherRooms] Server end-room notice, updating Firestore doc directly:', serverErr);
    }
  }

  try {
    await updateDoc(doc(db, 'togetherRooms', roomId), {
      status: 'ended',
      endedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('[TogetherRooms] endTogetherRoom error:', err);
  }
}


// ─── Phase 1 & 5: Durable Firestore Room Document Hook ───────────────

export function useTogetherRoomDoc(roomId: string | null): {
  room: TogetherRoom | null;
  loading: boolean;
} {
  const [room, setRoom] = useState<TogetherRoom | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!roomId || roomId.startsWith('demo')) {
      setLoading(false);
      return;
    }

    const unsub = onSnapshot(
      doc(db, 'togetherRooms', roomId),
      (snap) => {
        if (snap.exists()) {
          setRoom({ roomId: snap.id, ...snap.data() } as TogetherRoom);
        } else {
          setRoom(null);
        }
        setLoading(false);
      },
      (error) => {
        console.warn('[TogetherRooms] Room doc listener error:', error);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [roomId]);

  return { room, loading };
}

// ─── Active Together Room for Current Couple Space ────────────────────

export function useActiveTogetherRoom(coupleId: string | null, type: RoomType): TogetherRoom | null {
  const [activeRoom, setActiveRoom] = useState<TogetherRoom | null>(null);

  useEffect(() => {
    if (!coupleId || coupleId.startsWith('demo') || coupleId === 'couple-duo-main') {
      setActiveRoom(null);
      return;
    }

    // Query on single indexed field 'coupleId' to guarantee no missing composite index error
    const q = query(
      collection(db, 'togetherRooms'),
      where('coupleId', '==', coupleId),
      limit(10)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const found = snap.docs
          .map((d) => ({ roomId: d.id, ...d.data() } as TogetherRoom))
          .find((r) => r.type === type && (r.status === 'waiting' || r.status === 'active'));
        setActiveRoom(found || null);
      },
      (err) => {
        console.warn('[TogetherRooms] useActiveTogetherRoom query notice:', err);
      }
    );

    return () => unsub();
  }, [coupleId, type]);

  return activeRoom;
}

export function useAnyActiveTogetherRoom(coupleId: string | null): TogetherRoom | null {
  const [activeRoom, setActiveRoom] = useState<TogetherRoom | null>(null);

  useEffect(() => {
    if (!coupleId || coupleId.startsWith('demo') || coupleId === 'couple-duo-main') {
      setActiveRoom(null);
      return;
    }

    const q = query(
      collection(db, 'togetherRooms'),
      where('coupleId', '==', coupleId),
      limit(10)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const now = Date.now();
        const found = snap.docs
          .map((d) => ({ roomId: d.id, ...d.data() } as TogetherRoom))
          .find((r) => {
            if (r.status !== 'waiting' && r.status !== 'active') return false;
            const createdMs = typeof r.createdAt === 'number'
              ? r.createdAt
              : (r.createdAt as any)?.toMillis
              ? (r.createdAt as any).toMillis()
              : (r.createdAt as any)?.seconds
              ? (r.createdAt as any).seconds * 1000
              : 0;
            const isStale = createdMs <= 0 || (now - createdMs > 45 * 60 * 1000); // Auto-expire after 45m or invalid
            if (isStale) {
              endTogetherRoom(r.roomId).catch(() => {});
              return false;
            }
            return true;
          });
        setActiveRoom(found || null);
      },
      (err) => {
        console.warn('[TogetherRooms] useAnyActiveTogetherRoom notice:', err);
      }
    );

    return () => unsub();
  }, [coupleId]);

  return activeRoom;
}

// ─── Phase 3, 4, 6, 7: Socket.IO Live Room Coordination Hook ──────────

export function useTogetherRoomSocket(
  roomId: string | null,
  initialRoom?: TogetherRoom | null
) {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  // Live state overrides from Socket.IO events
  const [studyState, setStudyState] = useState<StudyTimerState | null>(
    initialRoom?.study || null
  );
  const [shareOwnerUid, setShareOwnerUid] = useState<string | null>(
    initialRoom?.movie?.screenShareOwnerUid || null
  );
  const [partnerPresent, setPartnerPresent] = useState(false);
  const [recentReactions, setRecentReactions] = useState<RoomReaction[]>([]);
  const [messages, setMessages] = useState<RoomMessage[]>([]);

  // Update initial states if room doc updates from Firestore
  useEffect(() => {
    if (initialRoom?.study) {
      setStudyState((prev) => {
        if (!prev || initialRoom.revision > (prev as any)?.revision) {
          return initialRoom.study;
        }
        return prev;
      });
    }
    if (initialRoom?.movie) {
      setShareOwnerUid(initialRoom.movie.screenShareOwnerUid);
    }
  }, [initialRoom?.revision, initialRoom?.study, initialRoom?.movie]);

  // Connect to Socket.IO Server
  useEffect(() => {
    if (!roomId) return;

    let isMounted = true;
    const serverUrl = getSocketServerUrl();
    if (!serverUrl) {
      console.info('[SocketIO] No socket server URL configured; relying on Firestore state.');
      return;
    }

    const currentUid = auth.currentUser?.uid || useAuthStore.getState().currentUser.id || 'guest';

    const socketInstance = io(serverUrl, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
      auth: async (callback) => {
        try {
          let token = '';
          if (auth.currentUser) {
            token = await auth.currentUser.getIdToken();
          } else {
            token = `demo-token-${currentUid}`;
          }
          callback({ token });
        } catch (e) {
          console.warn('[SocketIO] Error getting auth token:', e);
          callback({ token: `demo-token-${currentUid}` });
        }
      },
    });

    socketRef.current = socketInstance;

    socketInstance.on('connect', () => {
      if (!isMounted) return;
      setIsConnected(true);
      setIsReconnecting(false);

      // Emit room:join with acknowledgment
      socketInstance.emit('room:join', { roomId }, (res: any) => {
        if (!isMounted) return;
        if (res?.success && res.liveState) {
          if (res.liveState.study) {
            setStudyState(res.liveState.study);
          }
          if (res.liveState.movie) {
            setShareOwnerUid(res.liveState.movie.screenShareOwnerUid);
          }
        }
      });
    });

    socketInstance.on('reconnect_attempt', () => {
      if (isMounted) setIsReconnecting(true);
    });

    socketInstance.on('disconnect', (reason) => {
      if (!isMounted) return;
      setIsConnected(false);
      if (reason === 'io server disconnect') {
        socketInstance.connect();
      }
    });

    socketInstance.on('connect_error', (err) => {
      if (!isMounted) return;
      setIsConnected(false);
      console.warn('[SocketIO] Connection notice:', err.message);
    });

    // ─── Room Events ──────────────────────────────────────────────
    socketInstance.on('room:participant-joined', (data) => {
      if (!isMounted) return;
      if (data.uid !== currentUid) {
        setPartnerPresent(true);
      }
    });

    socketInstance.on('room:participant-left', (data) => {
      if (!isMounted) return;
      if (data.uid !== currentUid) {
        setPartnerPresent(false);
      }
    });

    socketInstance.on('study:timer-state', (data) => {
      if (!isMounted) return;
      if (data?.study) {
        setStudyState(data.study);
      }
    });

    socketInstance.on('movie:share-state', (data) => {
      if (!isMounted) return;
      setShareOwnerUid(data?.screenShareOwnerUid || null);
    });

    socketInstance.on('room:reaction', (reaction: RoomReaction) => {
      if (!isMounted) return;
      setRecentReactions((prev) => [...prev.slice(-10), reaction]);
    });

    socketInstance.on('room:message', (msg: RoomMessage) => {
      if (!isMounted) return;
      setMessages((prev) => [...prev.slice(-50), msg]);
    });

    socketInstance.connect();

    return () => {
      isMounted = false;
      socketInstance.emit('room:leave', { roomId });
      socketInstance.disconnect();
      socketRef.current = null;
    };
  }, [roomId]);

  // ─── Local Countdown Calculation (Phase 6) ────────────────────────
  const [secondsRemaining, setSecondsRemaining] = useState<number>(() => {
    return studyState?.pausedRemainingSeconds ?? studyState?.durationSeconds ?? 25 * 60;
  });

  const isTimerRunning = Boolean(studyState?.startedAt);

  useEffect(() => {
    if (!studyState) return;

    if (!studyState.startedAt) {
      setSecondsRemaining(studyState.pausedRemainingSeconds ?? studyState.durationSeconds ?? 25 * 60);
      return;
    }

    const startMs = studyState.startedAt.toMillis
      ? studyState.startedAt.toMillis()
      : studyState.startedAt.seconds
      ? studyState.startedAt.seconds * 1000
      : typeof studyState.startedAt === 'number'
      ? studyState.startedAt
      : Date.now();

    const duration = studyState.durationSeconds || 25 * 60;

    const tick = () => {
      const elapsedSec = Math.floor((Date.now() - startMs) / 1000);
      const rem = Math.max(0, duration - elapsedSec);
      setSecondsRemaining(rem);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [studyState]);

  // ─── Room Control Methods ─────────────────────────────────────────

  const sendTimerCommand = useCallback(
    (action: 'start' | 'pause' | 'resume' | 'reset' | 'switch-mode', mode?: 'focus' | 'break', durationSeconds?: number) => {
      if (!roomId) return;
      if (socketRef.current?.connected) {
        socketRef.current.emit(
          'study:timer-command',
          { roomId, action, mode, durationSeconds },
          (res: any) => {
            if (res?.study) {
              setStudyState(res.study);
            }
          }
        );
      } else {
        // Fallback: update local state & broadcast channel if socket is offline
        const nowMs = Date.now();
        const curDur = durationSeconds || (mode === 'break' ? 5 * 60 : 25 * 60);
        let fallbackStudy: StudyTimerState;

        if (action === 'start' || action === 'resume') {
          fallbackStudy = {
            mode: mode || studyState?.mode || 'focus',
            durationSeconds: curDur,
            startedAt: nowMs,
            pausedRemainingSeconds: null,
          };
        } else if (action === 'pause') {
          fallbackStudy = {
            mode: mode || studyState?.mode || 'focus',
            durationSeconds: curDur,
            startedAt: null,
            pausedRemainingSeconds: secondsRemaining,
          };
        } else {
          fallbackStudy = {
            mode: mode || studyState?.mode || 'focus',
            durationSeconds: curDur,
            startedAt: null,
            pausedRemainingSeconds: curDur,
          };
        }

        setStudyState(fallbackStudy);

        if (duoBroadcast) {
          duoBroadcast.postMessage({
            type: 'STUDY_TIMER_STATE',
            payload: { study: fallbackStudy, roomId },
          });
        }
      }
    },
    [roomId, secondsRemaining, studyState?.mode]
  );

  const claimScreenShare = useCallback(async (): Promise<boolean> => {
    if (!roomId) return false;
    const uid = auth.currentUser?.uid || useAuthStore.getState().currentUser.id;

    if (socketRef.current?.connected) {
      return new Promise((resolve) => {
        socketRef.current?.emit('movie:share-claim', { roomId }, (res: any) => {
          if (res?.success) {
            setShareOwnerUid(uid);
            resolve(true);
          } else {
            resolve(false);
          }
        });
      });
    } else {
      // Local / demo fallback
      setShareOwnerUid(uid);
      return true;
    }
  }, [roomId]);

  const releaseScreenShare = useCallback(async (): Promise<void> => {
    if (!roomId) return;
    if (socketRef.current?.connected) {
      socketRef.current.emit('movie:share-release', { roomId });
    }
    setShareOwnerUid(null);
  }, [roomId]);

  const sendReaction = useCallback(
    (emoji: string) => {
      if (!roomId || !emoji) return;
      const uid = auth.currentUser?.uid || useAuthStore.getState().currentUser.id;
      const reaction: RoomReaction = {
        id: `rx-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        uid,
        emoji,
        timestamp: Date.now(),
      };

      setRecentReactions((prev) => [...prev.slice(-10), reaction]);

      if (socketRef.current?.connected) {
        socketRef.current.emit('room:reaction', { roomId, emoji });
      } else if (duoBroadcast) {
        duoBroadcast.postMessage({
          type: 'ROOM_REACTION',
          payload: { roomId, reaction },
        });
      }
    },
    [roomId]
  );

  const sendRoomMessage = useCallback(
    (text: string) => {
      if (!roomId || !text.trim()) return;
      const user = useAuthStore.getState().currentUser;
      const msg: RoomMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        senderId: user.id,
        senderName: user.displayName || 'Me',
        text: text.trim(),
        createdAt: Date.now(),
      };

      setMessages((prev) => [...prev.slice(-50), msg]);

      if (socketRef.current?.connected) {
        socketRef.current.emit('room:message', {
          roomId,
          text: text.trim(),
          senderName: user.displayName,
        });
      }
    },
    [roomId]
  );

  return {
    isConnected,
    isReconnecting,
    studyState,
    shareOwnerUid,
    partnerPresent,
    secondsRemaining,
    isTimerRunning,
    recentReactions,
    messages,
    sendTimerCommand,
    claimScreenShare,
    releaseScreenShare,
    sendReaction,
    sendRoomMessage,
  };
}
