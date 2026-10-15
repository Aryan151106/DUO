/**
 * WebRTC Call Signaling Engine (src/lib/callSignaling.ts)
 * 
 * Provides:
 * 1. Robust Firestore signaling on spaces/{spaceId}/calls/{callId}
 * 2. Subcollections callerCandidates & calleeCandidates
 * 3. Pre-remoteDescription ICE candidate queueing
 * 4. STUN + TURN server configuration
 * 5. 45s missed call timeout
 * 6. ICE restart on disconnected state (15s timeout to failed)
 * 7. Candidate type logging (host, srflx, relay)
 * 8. Clean track & peer connection teardown
 */

import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  addDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
  runTransaction,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import { useAuthStore } from './store';
import { useNotificationStore } from './notifications';

export type CallType = 'video' | 'audio';
export type CallStatus =
  | 'ringing'
  | 'accepted'
  | 'declined'
  | 'missed'
  | 'ended'
  | 'failed'
  | 'busy';

export interface CallDocument {
  id: string;
  callerId: string;
  calleeId: string;
  callerName?: string;
  calleeName?: string;
  type: CallType;
  status: CallStatus;
  offer?: RTCSessionDescriptionInit | null;
  answer?: RTCSessionDescriptionInit | null;
  createdAt: any;
  answeredAt?: any;
  endedAt?: any;
  endedBy?: string;
  durationSec?: number;
  failureReason?: string;
}

// ICE Servers Configuration
export function getIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    // Standard Google STUN servers
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // Cloudflare STUN
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.cloudflare.com:19302' },
    // Open Relay by Metered.ca (STUN + TURN over UDP, TCP & TLS for cellular NAT traversal)
    { urls: 'stun:openrelay.metered.ca:80' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turns:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ];

  // Managed TURN credentials from environment if available
  const turnUrl = import.meta.env.VITE_TURN_URL;
  const turnUsername = import.meta.env.VITE_TURN_USERNAME;
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL;

  if (turnUrl && turnUsername && turnCredential) {
    servers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return servers;
}

export interface SignalingSession {
  callId: string;
  peerConnection: RTCPeerConnection;
  cleanup: () => void;
  hangup: (reason?: string) => Promise<void>;
}

export class CallSignalingManager {
  private activeSession: SignalingSession | null = null;
  private queuedRemoteCandidates: RTCIceCandidateInit[] = [];
  private remoteDescriptionSet: boolean = false;
  private ringTimeoutTimer: number | null = null;
  private reconnectTimer: number | null = null;

  public getActiveSession(): SignalingSession | null {
    return this.activeSession;
  }

  /**
   * Replace the active video track in the peer connection (e.g. for screen sharing or camera toggle)
   */
  public async replaceVideoTrack(newTrack: MediaStreamTrack | null) {
    if (!this.activeSession) return;
    const senders = this.activeSession.peerConnection.getSenders();
    const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
    if (videoSender) {
      await videoSender.replaceTrack(newTrack);
    }
  }

  /**
   * Replace the active audio track in the peer connection
   */
  public async replaceAudioTrack(newTrack: MediaStreamTrack | null) {
    if (!this.activeSession) return;
    const senders = this.activeSession.peerConnection.getSenders();
    const audioSender = senders.find((s) => s.track && s.track.kind === 'audio');
    if (audioSender) {
      await audioSender.replaceTrack(newTrack);
    }
  }

  // Helper to log candidate type
  private logCandidate(candidate: RTCIceCandidate) {
    const candidateType = candidate.type || (candidate.candidate.includes('typ relay') ? 'relay' : candidate.candidate.includes('typ srflx') ? 'srflx' : 'host');
    console.log(`[WebRTC ICE] Found ${candidateType} candidate:`, candidate.candidate.slice(0, 50));
  }

  /**
   * Start an outgoing call (Caller side)
   */
  public async startCall(params: {
    spaceId: string;
    callerId: string;
    callerName: string;
    calleeId: string;
    calleeName: string;
    callType: CallType;
    localStream: MediaStream;
    onRemoteStream: (stream: MediaStream) => void;
    onStatusChange: (status: CallStatus, message?: string) => void;
  }): Promise<SignalingSession> {
    const {
      spaceId,
      callerId,
      callerName,
      calleeId,
      calleeName,
      callType,
      localStream,
      onRemoteStream,
      onStatusChange,
    } = params;

    // Check if callee is busy
    const busyCheck = await this.checkUserBusy(spaceId, calleeId);
    if (busyCheck) {
      onStatusChange('busy', `${calleeName} is currently on another call.`);
      throw new Error('User is busy');
    }

    const unsubs: Unsubscribe[] = [];
    this.queuedRemoteCandidates = [];
    this.remoteDescriptionSet = false;

    // 1. Create RTCPeerConnection
    const pc = new RTCPeerConnection({ iceServers: getIceServers() });
    const remoteStream = new MediaStream();
    onRemoteStream(remoteStream);

    // Add local tracks
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    // Handle remote tracks
    pc.ontrack = (event) => {
      console.log('[WebRTC Caller] ontrack:', event.track?.kind, event.streams);
      const incoming = event.streams && event.streams[0] ? event.streams[0] : null;
      if (incoming) {
        incoming.getTracks().forEach((track) => {
          if (!remoteStream.getTracks().some((t) => t.id === track.id)) {
            remoteStream.addTrack(track);
          }
        });
      } else if (event.track) {
        if (!remoteStream.getTracks().some((t) => t.id === event.track.id)) {
          remoteStream.addTrack(event.track);
        }
      }
      // Always pass a new MediaStream instance wrapping current tracks so React/Zustand triggers
      onRemoteStream(new MediaStream(remoteStream.getTracks()));
    };

    // 2. Prepare call document in Firestore
    const callRef = doc(collection(db, 'couples', spaceId, 'calls'));
    const callId = callRef.id;

    // Gather ICE candidates and send to callerCandidates
    const callerCandidatesCol = collection(db, 'couples', spaceId, 'calls', callId, 'callerCandidates');
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.logCandidate(event.candidate);
        addDoc(callerCandidatesCol, event.candidate.toJSON()).catch((err) =>
          console.warn('[Signaling] Failed to write caller candidate:', err)
        );
      }
    };

    // Connection state monitor
    const checkCallerConnected = () => {
      console.log(`[WebRTC Caller] ConnectionState: ${pc.connectionState}, IceState: ${pc.iceConnectionState}`);
      if (
        pc.connectionState === 'connected' ||
        pc.iceConnectionState === 'connected' ||
        pc.iceConnectionState === 'completed'
      ) {
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        onStatusChange('accepted');
      } else if (pc.connectionState === 'disconnected' || pc.iceConnectionState === 'disconnected') {
        onStatusChange('accepted', 'Reconnecting...');
        try {
          pc.restartIce();
        } catch {}
        if (!this.reconnectTimer) {
          this.reconnectTimer = window.setTimeout(() => {
            if (pc.connectionState === 'disconnected' || pc.iceConnectionState === 'disconnected') {
              this.hangupCall(spaceId, callId, 'Connection lost after 35s');
              onStatusChange('failed', 'Call dropped due to network disconnection.');
            }
          }, 35000);
        }
      } else if (pc.connectionState === 'failed' || pc.iceConnectionState === 'failed') {
        try {
          pc.restartIce();
        } catch {}
        if (!this.reconnectTimer) {
          this.reconnectTimer = window.setTimeout(() => {
            if (pc.connectionState === 'failed' || pc.iceConnectionState === 'failed') {
              this.hangupCall(spaceId, callId, 'Connection failed');
              onStatusChange('failed', 'Connection failed.');
            }
          }, 10000);
        }
      }
    };
    pc.onconnectionstatechange = checkCallerConnected;
    pc.oniceconnectionstatechange = checkCallerConnected;

    // 3. Create Offer
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: callType === 'video',
    });
    await pc.setLocalDescription(offer);

    // 4. Save call document with status: 'ringing'
    await setDoc(callRef, {
      callerId,
      callerName,
      calleeId,
      calleeName,
      type: callType,
      status: 'ringing',
      offer: { sdp: offer.sdp, type: offer.type },
      createdAt: serverTimestamp(),
    });

    // Dispatch pop-up notification with incoming ringtone & OneSignal background push
    useNotificationStore.getState().sendNotification({
      coupleId: spaceId,
      senderId: callerId,
      senderName: callerName || 'Aryan',
      type: 'call',
      title: `Incoming ${callType === 'video' ? 'Video' : 'Voice'} Call 📞`,
      body: `${callerName || 'Aryan'} is calling you...`,
      deepLink: `/?action=call&callId=${callId}`,
      metadata: { targetUserId: calleeId, callId, callType },
    });

    onStatusChange('ringing');

    // 45s Missed Call timeout
    this.ringTimeoutTimer = window.setTimeout(async () => {
      try {
        await updateDoc(callRef, {
          status: 'missed',
          endedAt: serverTimestamp(),
          endedBy: callerId,
        });
        onStatusChange('missed', 'No answer after 45 seconds.');
        cleanup();
      } catch {}
    }, 45000);

    // 5. Watch for Callee's Answer & status updates
    const unsubCallDoc = onSnapshot(
      callRef,
      async (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as CallDocument;

        if (data.status === 'declined') {
          if (this.ringTimeoutTimer) clearTimeout(this.ringTimeoutTimer);
          onStatusChange('declined', `${calleeName} declined the call.`);
          cleanup();
        } else if (data.status === 'busy') {
          if (this.ringTimeoutTimer) clearTimeout(this.ringTimeoutTimer);
          onStatusChange('busy', `${calleeName} is currently busy.`);
          cleanup();
        } else if (data.status === 'ended') {
          if (this.ringTimeoutTimer) clearTimeout(this.ringTimeoutTimer);
          onStatusChange('ended', 'Call ended.');
          cleanup();
        } else if (data.status === 'accepted' && data.answer && !pc.currentRemoteDescription) {
          if (this.ringTimeoutTimer) clearTimeout(this.ringTimeoutTimer);
          try {
            const rtcAnswer = new RTCSessionDescription(data.answer);
            await pc.setRemoteDescription(rtcAnswer);
            this.remoteDescriptionSet = true;
            await this.flushQueuedCandidates(pc);
            onStatusChange('accepted');
          } catch (err) {
            console.error('[Signaling] Failed to set remote answer:', err);
          }
        }
      },
      (err) => {
        console.warn('[Signaling] Call doc watch error:', err);
      }
    );
    unsubs.push(unsubCallDoc);

    // 6. Listen for Callee's ICE candidates
    const calleeCandidatesCol = collection(db, 'couples', spaceId, 'calls', callId, 'calleeCandidates');
    const unsubCandidates = onSnapshot(
      calleeCandidatesCol,
      (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
          if (change.type === 'added') {
            const candData = change.doc.data() as RTCIceCandidateInit;
            await this.addOrQueueCandidate(pc, candData);
          }
        });
      },
      (err) => {
        console.warn('[Signaling] Callee candidates watch error:', err);
      }
    );
    unsubs.push(unsubCandidates);

    const cleanup = () => {
      if (this.ringTimeoutTimer) clearTimeout(this.ringTimeoutTimer);
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      unsubs.forEach((u) => u());
      pc.close();
      this.activeSession = null;
    };

    const session: SignalingSession = {
      callId,
      peerConnection: pc,
      cleanup,
      hangup: (reason) => this.hangupCall(spaceId, callId, reason, callerId),
    };

    this.activeSession = session;
    return session;
  }

  /**
   * Answer an incoming call (Callee side)
   */
  public async answerCall(params: {
    spaceId: string;
    callId: string;
    userId: string;
    localStream: MediaStream;
    onRemoteStream: (stream: MediaStream) => void;
    onStatusChange: (status: CallStatus, message?: string) => void;
  }): Promise<SignalingSession> {
    const { spaceId, callId, userId, localStream, onRemoteStream, onStatusChange } = params;

    const unsubs: Unsubscribe[] = [];
    this.queuedRemoteCandidates = [];
    this.remoteDescriptionSet = false;

    // 1. Create RTCPeerConnection
    const pc = new RTCPeerConnection({ iceServers: getIceServers() });
    const remoteStream = new MediaStream();
    onRemoteStream(remoteStream);

    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    pc.ontrack = (event) => {
      console.log('[WebRTC Callee] ontrack:', event.track?.kind, event.streams);
      const incoming = event.streams && event.streams[0] ? event.streams[0] : null;
      if (incoming) {
        incoming.getTracks().forEach((track) => {
          if (!remoteStream.getTracks().some((t) => t.id === track.id)) {
            remoteStream.addTrack(track);
          }
        });
      } else if (event.track) {
        if (!remoteStream.getTracks().some((t) => t.id === event.track.id)) {
          remoteStream.addTrack(event.track);
        }
      }
      onRemoteStream(new MediaStream(remoteStream.getTracks()));
    };

    // Write Callee's ICE candidates to calleeCandidates
    const calleeCandidatesCol = collection(db, 'couples', spaceId, 'calls', callId, 'calleeCandidates');
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.logCandidate(event.candidate);
        addDoc(calleeCandidatesCol, event.candidate.toJSON()).catch((err) =>
          console.warn('[Signaling] Failed to write callee candidate:', err)
        );
      }
    };

    const checkCalleeConnected = () => {
      console.log(`[WebRTC Callee] ConnectionState: ${pc.connectionState}, IceState: ${pc.iceConnectionState}`);
      if (
        pc.connectionState === 'connected' ||
        pc.iceConnectionState === 'connected' ||
        pc.iceConnectionState === 'completed'
      ) {
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        onStatusChange('accepted');
      } else if (pc.connectionState === 'disconnected' || pc.iceConnectionState === 'disconnected') {
        onStatusChange('accepted', 'Reconnecting...');
        try {
          pc.restartIce();
        } catch {}
        if (!this.reconnectTimer) {
          this.reconnectTimer = window.setTimeout(() => {
            if (pc.connectionState === 'disconnected' || pc.iceConnectionState === 'disconnected') {
              this.hangupCall(spaceId, callId, 'Connection lost after 35s');
              onStatusChange('failed', 'Call dropped due to network disconnection.');
            }
          }, 35000);
        }
      } else if (pc.connectionState === 'failed' || pc.iceConnectionState === 'failed') {
        try {
          pc.restartIce();
        } catch {}
        if (!this.reconnectTimer) {
          this.reconnectTimer = window.setTimeout(() => {
            if (pc.connectionState === 'failed' || pc.iceConnectionState === 'failed') {
              this.hangupCall(spaceId, callId, 'Connection failed');
              onStatusChange('failed', 'Connection failed.');
            }
          }, 10000);
        }
      }
    };
    pc.onconnectionstatechange = checkCalleeConnected;
    pc.oniceconnectionstatechange = checkCalleeConnected;

    // 2. Read Offer from call document
    const callRef = doc(db, 'couples', spaceId, 'calls', callId);

    // Watch for caller end/hangup
    const unsubCallDoc = onSnapshot(
      callRef,
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as CallDocument;
        if (data.status === 'ended' || data.status === 'missed') {
          onStatusChange('ended', 'Call ended by caller.');
          cleanup();
        }
      },
      (err) => {
        console.warn('[Signaling] Caller hangup watch error:', err);
      }
    );
    unsubs.push(unsubCallDoc);

    // 3. Listen for Caller's ICE candidates
    const callerCandidatesCol = collection(db, 'couples', spaceId, 'calls', callId, 'callerCandidates');
    const unsubCallerCandidates = onSnapshot(
      callerCandidatesCol,
      (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
          if (change.type === 'added') {
            const candData = change.doc.data() as RTCIceCandidateInit;
            await this.addOrQueueCandidate(pc, candData);
          }
        });
      },
      (err) => {
        console.warn('[Signaling] Caller candidates watch error:', err);
      }
    );
    unsubs.push(unsubCallerCandidates);

    const cleanup = () => {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      unsubs.forEach((u) => u());
      pc.close();
      this.activeSession = null;
    };

    // 4. Fetch the call doc directly using getDoc(callRef)
    const callDocSnap = await getDoc(callRef);
    let callDocData = callDocSnap.exists() ? (callDocSnap.data() as CallDocument) : null;

    if (!callDocData?.offer) {
      // If offer SDP is currently synchronizing over the network, wait briefly
      await new Promise<void>((resolve) => {
        const unsubPoll = onSnapshot(
          callRef,
          (snap) => {
            if (snap.exists() && snap.data()?.offer) {
              callDocData = snap.data() as CallDocument;
              unsubPoll();
              resolve();
            }
          },
          (err) => {
            console.warn('[Signaling] Offer poll notice:', err);
            unsubPoll();
            resolve();
          }
        );
        setTimeout(() => {
          unsubPoll();
          resolve();
        }, 3000);
      });
    }

    if (!callDocData?.offer) {
      cleanup();
      throw new Error('Call offer not found or call cancelled.');
    }

    await pc.setRemoteDescription(new RTCSessionDescription(callDocData.offer));
    this.remoteDescriptionSet = true;
    await this.flushQueuedCandidates(pc);

    // 5. Create Answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // 6. Update call document with status: 'accepted'
    await updateDoc(callRef, {
      status: 'accepted',
      answer: { sdp: answer.sdp, type: answer.type },
      answeredAt: serverTimestamp(),
    });

    onStatusChange('accepted');

    const session: SignalingSession = {
      callId,
      peerConnection: pc,
      cleanup,
      hangup: (reason) => this.hangupCall(spaceId, callId, reason, userId),
    };

    this.activeSession = session;
    return session;
  }

  /**
   * Decline an incoming call
   */
  public async declineCall(spaceId: string, callId: string, userId: string) {
    try {
      const callRef = doc(db, 'couples', spaceId, 'calls', callId);
      await runTransaction(db, async (transaction) => {
        const currentCall = await transaction.get(callRef);
        if (!currentCall.exists() || currentCall.data().status !== 'ringing') {
          return;
        }
        transaction.update(callRef, {
          status: 'declined',
          endedAt: serverTimestamp(),
          endedBy: userId,
        });
      });
    } catch (e) {
      console.warn('Decline call error:', e);
    }
  }

  /**
   * Hang up an active or ringing call
   */
  public async hangupCall(spaceId: string, callId: string, reason?: string, userId?: string) {
    try {
      const callRef = doc(db, 'couples', spaceId, 'calls', callId);
      await updateDoc(callRef, {
        status: 'ended',
        endedAt: serverTimestamp(),
        endedBy: userId || 'unknown',
        failureReason: reason || null,
      });
    } catch (e) {
      console.warn('Hangup call error:', e);
    } finally {
      if (this.activeSession) {
        this.activeSession.cleanup();
      }
    }
  }

  /**
   * Candidate Queueing: queue candidates if arriving before setRemoteDescription
   */
  private async addOrQueueCandidate(pc: RTCPeerConnection, cand: RTCIceCandidateInit) {
    if (!cand || !cand.candidate) return;
    if (this.remoteDescriptionSet && pc.remoteDescription) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (e) {
        console.warn('[WebRTC] Failed to add ICE candidate:', e);
      }
    } else {
      this.queuedRemoteCandidates.push(cand);
    }
  }

  private async flushQueuedCandidates(pc: RTCPeerConnection) {
    const candidates = [...this.queuedRemoteCandidates];
    this.queuedRemoteCandidates = [];
    for (const cand of candidates) {
      if (!cand || !cand.candidate) continue;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (e) {
        console.warn('[WebRTC] Flush candidate error:', e);
      }
    }
  }

  /**
   * Check if a user is currently in an active/ringing call
   */
  private async checkUserBusy(spaceId: string, userId: string): Promise<boolean> {
    if (!userId) return false;
    try {
      const q = query(
        collection(db, 'couples', spaceId, 'calls'),
        where('status', '==', 'accepted')
      );
      const snap = await getDocs(q);
      if (snap.empty) return false;

      const now = Date.now();
      return snap.docs.some((d) => {
        const data = d.data();
        if (data.calleeId !== userId && data.callerId !== userId) return false;
        // If endedAt is set or status changed, user is free
        if (data.endedAt || data.status === 'ended' || data.status === 'declined' || data.status === 'missed') {
          return false;
        }
        const createdMs = data.createdAt?.toDate ? data.createdAt.toDate().getTime() : now;
        return Math.abs(now - createdMs) < 30000;
      });
    } catch {
      return false;
    }
  }

  /**
   * Global listener for incoming ringing calls aimed at current user
   */
  public listenForIncomingCalls(
    spaceId: string,
    currentUserId: string,
    onIncomingCall: (call: CallDocument) => void
  ): Unsubscribe {
    if (useAuthStore.getState().isDemoMode || !spaceId || spaceId === 'couple-duo-main') {
      return () => {};
    }

    // Listen for any ringing call in this couple space without requiring composite indexes
    const q = query(
      collection(db, 'couples', spaceId, 'calls'),
      where('status', '==', 'ringing')
    );

    return onSnapshot(
      q,
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added' || change.type === 'modified') {
            const callData = { id: change.doc.id, ...change.doc.data() } as CallDocument;
            // Any ringing call not made by this user belongs to this user in a 2-person couple space
            if (callData.status === 'ringing' && callData.callerId && callData.callerId !== currentUserId) {
              const createdAtDate = callData.createdAt?.toDate ? callData.createdAt.toDate() : new Date();
              const diffMs = Math.abs(Date.now() - createdAtDate.getTime());
              // Allow if created recently (< 60s) or if createdAt server timestamp is still pending
              if (diffMs < 60000 || !callData.createdAt) {
                onIncomingCall(callData);
              }
            }
          }
        });
      },
      (err) => {
        console.warn('[Signaling] Incoming call listener error:', err);
      }
    );
  }
}

export const callSignaling = new CallSignalingManager();
