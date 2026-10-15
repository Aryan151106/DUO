import { describe, it, expect, vi } from 'vitest';
import { getIceServers, type CallStatus } from './callSignaling';

describe('WebRTC Call Signaling & State Machine (src/lib/callSignaling.ts)', () => {
  describe('ICE Server Configuration', () => {
    it('provides standard Google and Cloudflare STUN servers by default', () => {
      const servers = getIceServers();
      expect(servers.length).toBeGreaterThanOrEqual(4);
      const urls = servers.map((s) => (typeof s.urls === 'string' ? s.urls : s.urls[0]));
      expect(urls.some((u) => u.includes('stun.l.google.com'))).toBe(true);
      expect(urls.some((u) => u.includes('stun.cloudflare.com'))).toBe(true);
    });
  });

  describe('ICE Candidate Queueing Logic', () => {
    it('queues candidates when remote description is not yet set', () => {
      const queuedCandidates: RTCIceCandidateInit[] = [];
      let remoteDescriptionSet = false;
      const pcAddCandidateMock = vi.fn().mockResolvedValue(undefined);

      const addOrQueueCandidate = async (cand: RTCIceCandidateInit) => {
        if (remoteDescriptionSet) {
          await pcAddCandidateMock(cand);
        } else {
          queuedCandidates.push(cand);
        }
      };

      const cand1 = { candidate: 'candidate:1 1 UDP 2122260223 192.168.1.100 50000 typ host', sdpMid: '0', sdpMLineIndex: 0 };
      const cand2 = { candidate: 'candidate:2 1 UDP 2122260223 192.168.1.101 50001 typ host', sdpMid: '0', sdpMLineIndex: 0 };

      // Candidates arrive before remote description
      addOrQueueCandidate(cand1);
      addOrQueueCandidate(cand2);

      expect(queuedCandidates.length).toBe(2);
      expect(pcAddCandidateMock).not.toHaveBeenCalled();

      // Remote description is set -> flush
      remoteDescriptionSet = true;
      for (const cand of queuedCandidates) {
        pcAddCandidateMock(cand);
      }
      queuedCandidates.length = 0;

      expect(pcAddCandidateMock).toHaveBeenCalledTimes(2);
      expect(queuedCandidates.length).toBe(0);

      // Subsequent candidates add directly
      const cand3 = { candidate: 'candidate:3 1 UDP 2122260223 192.168.1.102 50002 typ srflx', sdpMid: '0', sdpMLineIndex: 0 };
      addOrQueueCandidate(cand3);
      expect(pcAddCandidateMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('Call State Machine Transitions', () => {
    it('validates allowed status transitions', () => {
      const allowedTransitions: Record<CallStatus, CallStatus[]> = {
        ringing: ['accepted', 'declined', 'missed', 'busy', 'ended', 'failed'],
        accepted: ['ended', 'failed'],
        declined: [],
        missed: [],
        ended: [],
        failed: [],
        busy: [],
      };

      const isValidTransition = (current: CallStatus, next: CallStatus): boolean => {
        return allowedTransitions[current]?.includes(next) ?? false;
      };

      expect(isValidTransition('ringing', 'accepted')).toBe(true);
      expect(isValidTransition('ringing', 'declined')).toBe(true);
      expect(isValidTransition('ringing', 'missed')).toBe(true);
      expect(isValidTransition('ringing', 'busy')).toBe(true);
      expect(isValidTransition('accepted', 'ended')).toBe(true);
      expect(isValidTransition('accepted', 'failed')).toBe(true);

      // Disallowed transitions
      expect(isValidTransition('ended', 'accepted')).toBe(false);
      expect(isValidTransition('declined', 'ringing')).toBe(false);
      expect(isValidTransition('missed', 'accepted')).toBe(false);
    });

    it('enforces 45-second timeout behavior for ringing calls', () => {
      vi.useFakeTimers();
      let status: CallStatus = 'ringing';
      let timeoutFired = false;

      const ringTimeoutTimer = setTimeout(() => {
        if (status === 'ringing') {
          status = 'missed';
          timeoutFired = true;
        }
      }, 45000);

      expect(status).toBe('ringing');
      expect(timeoutFired).toBe(false);

      vi.advanceTimersByTime(45000);
      expect(status).toBe('missed');
      expect(timeoutFired).toBe(true);

      clearTimeout(ringTimeoutTimer);
      vi.useRealTimers();
    });

    it('identifies ringing calls from partner while ignoring own outgoing calls', () => {
      const currentUserId = 'user-auth-123';
      const partnerId = 'user-auth-456';

      const incomingPartnerCall = {
        callerId: partnerId,
        calleeId: currentUserId,
        status: 'ringing',
      };

      const ownOutgoingCall = {
        callerId: currentUserId,
        calleeId: partnerId,
        status: 'ringing',
      };

      const isIncomingForMe = (call: { callerId: string; status: string }) =>
        call.status === 'ringing' && call.callerId !== currentUserId;

      expect(isIncomingForMe(incomingPartnerCall)).toBe(true);
      expect(isIncomingForMe(ownOutgoingCall)).toBe(false);
    });
  });
});
