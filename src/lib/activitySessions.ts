import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  query,
  where,
  limit,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db, auth } from './firebase';
import { duoBroadcast } from './supabase';
import { useAuthStore } from './store';

export type SessionType = 'study' | 'movie';
export type SessionStatus = 'open' | 'ended';

export interface StudyState {
  mode: 'focus' | 'break';
  durationMinutes: number;
  breakMinutes: number;
  timerSecondsRemaining: number;
  isRunning: boolean;
  taskName: string;
  partnerStatuses: Record<string, 'studying' | 'reading' | 'notes' | 'break'>;
  lastUpdated?: any;
}

export interface MovieState {
  mode: 'screen' | 'synced';
  title: string;
  sourceUrl?: string;
  isPlaying: boolean;
  currentTime: number;
  sharingUserId?: string | null;
  lastUpdated?: any;
}

export interface ActivitySession {
  id: string;
  coupleId: string;
  type: SessionType;
  status: SessionStatus;
  createdBy: string;
  createdByName?: string;
  createdAt: any;
  expiresAt: any;
  roomName?: string;
  livekitServerUrl?: string;
  dailyRoomName?: string;
  dailyRoomUrl?: string;
  dailyRoomManaged?: boolean;
  participants: string[];
  studyState?: StudyState;
  movieState?: MovieState;
}

/**
 * Checks if the current environment is running in demo mode or unauthenticated
 */
export const isDemoSession = (coupleId?: string | null): boolean => {
  if (typeof window !== 'undefined' && window.location.search.includes('demo=true')) return true;
  try {
    if (useAuthStore.getState().isDemoMode) return true;
  } catch {}
  if (!auth.currentUser) return true;
  if (!coupleId || coupleId === 'couple-duo-main' || coupleId.startsWith('demo')) return true;
  return false;
};

/**
 * Starts an activity session (Study Space or Movie Night).
 * 1. If in demo or offline mode, creates local broadcast session without Firestore errors.
 * 2. If signed in, saves session to Firestore with LiveKit configuration.
 */
export async function startActivitySession(
  coupleId: string,
  type: SessionType,
  initialTitle?: string
): Promise<{ sessionId: string; roomName: string; livekitUrl: string }> {
  const roomName = `duo-${type}-${(coupleId || 'av').substring(0, 6)}-${Date.now()}`.toLowerCase();
  const livekitUrl = 'wss://av-space-cgq1lsbg.livekit.cloud';
  const sessionId = `session-${Date.now()}`;

  // 1. If in demo or unauthenticated mode, bypass cloud endpoints and use local real-time broadcast
  if (isDemoSession(coupleId)) {
    if (duoBroadcast) {
      duoBroadcast.postMessage({
        type: 'SESSION_OPENED',
        coupleId,
        senderId: 'demo-user',
        payload: {
          sessionId,
          type,
          title: initialTitle,
          roomName,
          livekitUrl,
        },
      });
    }
    return { sessionId, roomName, livekitUrl };
  }

  // 2. Direct Firestore creation
  const currentUid = auth.currentUser?.uid || 'anonymous';
  const callerName = auth.currentUser?.displayName || 'Your partner';
  const sessionsCol = collection(db, 'couples', coupleId, 'sessions');
  const sessionRef = doc(sessionsCol);
  const realSessionId = sessionRef.id;

  const sessionDoc: ActivitySession = {
    id: realSessionId,
    coupleId,
    type,
    status: 'open',
    createdBy: currentUid,
    createdByName: callerName,
    createdAt: serverTimestamp(),
    expiresAt: new Date(Date.now() + 6 * 3600 * 1000),
    roomName,
    livekitServerUrl: livekitUrl,
    participants: [currentUid],
  };

  if (type === 'study') {
    sessionDoc.studyState = {
      mode: 'focus',
      durationMinutes: 25,
      breakMinutes: 5,
      timerSecondsRemaining: 25 * 60,
      isRunning: false,
      taskName: initialTitle || 'Deep Work & Cozy Study',
      partnerStatuses: {
        [currentUid]: 'studying',
      },
      lastUpdated: serverTimestamp(),
    };
  } else {
    sessionDoc.movieState = {
      mode: 'screen',
      title: initialTitle || 'Movie Night 🍿',
      isPlaying: false,
      currentTime: 0,
      sharingUserId: null,
      lastUpdated: serverTimestamp(),
    };
  }

  try {
    await setDoc(sessionRef, sessionDoc);
  } catch (firestoreErr) {
    console.warn('[ActivitySession] Firestore setDoc skipped in demo/offline mode:', firestoreErr);
  }

  // Broadcast real-time room notification
  if (duoBroadcast) {
    duoBroadcast.postMessage({
      type: 'SESSION_OPENED',
      coupleId,
      senderId: currentUid,
      payload: {
        sessionId: realSessionId,
        type,
        title: initialTitle,
        roomName,
        livekitUrl,
      },
    });
  }

  return { sessionId: realSessionId, roomName, livekitUrl };
}

/**
 * Joins an open activity session.
 * Obtains a short-lived meeting token from backend Cloud Function or direct session data.
 */
export async function joinActivitySession(
  coupleId: string,
  sessionId: string
): Promise<{
  roomUrl: string;
  token: string;
  displayName: string;
  sessionType: SessionType;
  sessionId: string;
  dailyRoomManaged?: boolean;
}> {
  if (isDemoSession(coupleId)) {
    return {
      roomUrl: '',
      token: '',
      displayName: 'Partner',
      sessionType: 'study',
      sessionId,
    };
  }

  // 1. Direct Firestore read
  if (auth.currentUser) {
    try {
      const snap = await getDoc(doc(db, 'couples', coupleId, 'sessions', sessionId));
      if (snap.exists()) {
        const data = snap.data() as ActivitySession;
        if (data.status === 'open') {
          return {
            roomUrl: data.dailyRoomUrl || data.livekitServerUrl || '',
            token: '',
            displayName: auth.currentUser?.displayName || 'Partner',
            sessionType: data.type,
            sessionId: data.id,
          };
        }
      }
    } catch (e) {
      console.warn('[ActivitySession] Firestore read error:', e);
    }
  }

  // 3. Demo / offline fallback
  return {
    roomUrl: '',
    token: '',
    displayName: 'Partner',
    sessionType: 'study',
    sessionId,
  };
}

/**
 * Ends an activity session for both partners.
 */
export async function endActivitySession(coupleId: string, sessionId: string): Promise<void> {
  const currentUid = auth.currentUser?.uid || 'anonymous';

  if (isDemoSession(coupleId)) {
    if (duoBroadcast) {
      duoBroadcast.postMessage({
        type: 'SESSION_ENDED',
        coupleId,
        senderId: currentUid,
        payload: { sessionId },
      });
    }
    return;
  }

  // Direct Firestore update
  try {
    await updateDoc(doc(db, 'couples', coupleId, 'sessions', sessionId), {
      status: 'ended',
      endedAt: serverTimestamp(),
      endedBy: currentUid,
    });
  } catch (e) {
    console.warn('[ActivitySession] Firestore end session update skipped:', e);
  }

  if (duoBroadcast) {
    duoBroadcast.postMessage({
      type: 'SESSION_ENDED',
      coupleId,
      senderId: currentUid,
      payload: { sessionId },
    });
  }
}

/**
 * Updates Study State (e.g. Focus Timer, Pomodoro Mode, Status).
 */
export async function updateStudyState(
  coupleId: string,
  sessionId: string,
  updates: Partial<StudyState>
): Promise<void> {
  if (isDemoSession(coupleId)) {
    if (duoBroadcast) {
      duoBroadcast.postMessage({
        type: 'STUDY_STATE_UPDATED',
        coupleId,
        senderId: auth.currentUser?.uid || 'demo-user',
        payload: { sessionId, updates },
      });
    }
    return;
  }

  try {
    const sessionRef = doc(db, 'couples', coupleId, 'sessions', sessionId);
    const snap = await getDoc(sessionRef);
    if (!snap.exists()) return;

    const currentStudy = snap.data().studyState || {};
    const merged: StudyState = {
      ...currentStudy,
      ...updates,
      partnerStatuses: {
        ...(currentStudy.partnerStatuses || {}),
        ...(updates.partnerStatuses || {}),
      },
      lastUpdated: serverTimestamp(),
    };

    await updateDoc(sessionRef, { studyState: merged });
  } catch (err) {
    console.warn('[ActivitySession] updateStudyState error:', err);
  }
}

/**
 * Updates Movie State (e.g. Mode, Title, Playback).
 */
export async function updateMovieState(
  coupleId: string,
  sessionId: string,
  updates: Partial<MovieState>
): Promise<void> {
  if (isDemoSession(coupleId)) {
    if (duoBroadcast) {
      duoBroadcast.postMessage({
        type: 'MOVIE_STATE_UPDATED',
        coupleId,
        senderId: auth.currentUser?.uid || 'demo-user',
        payload: { sessionId, updates },
      });
    }
    return;
  }

  try {
    const sessionRef = doc(db, 'couples', coupleId, 'sessions', sessionId);
    const snap = await getDoc(sessionRef);
    if (!snap.exists()) return;

    const currentMovie = snap.data().movieState || {};
    const merged: MovieState = {
      ...currentMovie,
      ...updates,
      lastUpdated: serverTimestamp(),
    };

    await updateDoc(sessionRef, { movieState: merged });
  } catch (err) {
    console.warn('[ActivitySession] updateMovieState error:', err);
  }
}

/**
 * React hook: Listens to the current open session in this couple space.
 */
export function useActiveSession(coupleId: string | null): ActivitySession | null {
  const [activeSession, setActiveSession] = useState<ActivitySession | null>(null);

  useEffect(() => {
    if (!coupleId) {
      setActiveSession(null);
      return;
    }

    // In demo mode or when unauthenticated, listen strictly to duoBroadcast instead of Firestore
    if (isDemoSession(coupleId)) {
      const handleBroadcast = (event: MessageEvent) => {
        const data = event.data;
        if (data?.type === 'SESSION_OPENED' && data?.payload) {
          const payload = data.payload;
          setActiveSession({
            id: payload.sessionId,
            coupleId,
            type: payload.type || 'study',
            status: 'open',
            createdBy: data.senderId || 'demo-user',
            createdByName: 'Partner',
            createdAt: Date.now(),
            expiresAt: Date.now() + 6 * 3600 * 1000,
            dailyRoomName: payload.dailyRoomName || `duo-${payload.type}-${payload.sessionId}`,
            dailyRoomUrl: payload.dailyRoomUrl || '',
            dailyRoomManaged: Boolean(payload.dailyRoomManaged),
            participants: [],
          });
        } else if (data?.type === 'SESSION_ENDED') {
          setActiveSession(null);
        }
      };

      if (duoBroadcast) {
        duoBroadcast.addEventListener('message', handleBroadcast);
      }
      return () => {
        if (duoBroadcast) {
          duoBroadcast.removeEventListener('message', handleBroadcast);
        }
      };
    }

    const q = query(
      collection(db, 'couples', coupleId, 'sessions'),
      where('status', '==', 'open'),
      limit(10)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!snapshot.empty) {
          const docs = snapshot.docs.map((docData) => ({
            id: docData.id,
            ...docData.data(),
          })) as ActivitySession[];

          // Sort in-memory descending by createdAt to eliminate hard composite index requirement
          const getMs = (val: any) => {
            if (typeof val === 'number') return val;
            if (val?.toMillis) return val.toMillis();
            if (val?.seconds) return val.seconds * 1000;
            return 0;
          };
          docs.sort((a, b) => getMs(b.createdAt) - getMs(a.createdAt));

          const now = Date.now();
          const valid = docs.filter((s) => {
            const createdMs = getMs(s.createdAt);
            const isExpired = Boolean(s.expiresAt && now > s.expiresAt);
            const isStale = createdMs <= 0 || (now - createdMs > 45 * 60 * 1000); // Auto-expire after 45m or invalid
            if (isExpired || isStale) {
              endActivitySession(coupleId, s.id).catch(() => {});
              return false;
            }
            return true;
          });

          setActiveSession(valid[0] || null);
        } else {
          setActiveSession(null);
        }
      },
      (error) => {
        console.warn('[useActiveSession] onSnapshot error:', error);
      }
    );

    return () => unsubscribe();
  }, [coupleId]);

  return activeSession;
}

/**
 * React hook: Listens to a specific session doc in real-time.
 */
export function useSessionDoc(coupleId: string | null, sessionId: string | null): ActivitySession | null {
  const [session, setSession] = useState<ActivitySession | null>(null);

  useEffect(() => {
    if (!coupleId || !sessionId || isDemoSession(coupleId)) {
      setSession(null);
      return;
    }

    const docRef = doc(db, 'couples', coupleId, 'sessions', sessionId);
    const unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setSession({ id: snapshot.id, ...snapshot.data() } as ActivitySession);
        } else {
          setSession(null);
        }
      },
      (error) => {
        console.warn('[useSessionDoc] onSnapshot error:', error);
      }
    );

    return () => unsubscribe();
  }, [coupleId, sessionId]);

  return session;
}
