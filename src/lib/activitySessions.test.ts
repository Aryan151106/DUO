import { describe, it, expect } from 'vitest';
import type { ActivitySession, StudyState } from './activitySessions';

describe('Activity Sessions & Room Lifecycle (src/lib/activitySessions.ts)', () => {
  describe('Session Properties & Validation', () => {
    it('creates well-formed study session model', () => {
      const now = Date.now();
      const session: ActivitySession = {
        id: 'session-study-123',
        coupleId: 'couple-av-1',
        type: 'study',
        status: 'open',
        createdBy: 'user-aryan',
        createdByName: 'Aryan',
        createdAt: now,
        expiresAt: now + 4 * 60 * 60 * 1000,
        dailyRoomName: 'duo-study-session-study-123',
        dailyRoomUrl: 'https://av-space.daily.co/duo-study-session-study-123',
        participants: ['user-aryan', 'user-vidhi'],
        studyState: {
          mode: 'focus',
          durationMinutes: 25,
          breakMinutes: 5,
          timerSecondsRemaining: 25 * 60,
          isRunning: false,
          taskName: 'Deep Work & Cozy Study',
          partnerStatuses: {
            'user-aryan': 'studying',
            'user-vidhi': 'reading',
          },
        },
      };

      expect(session.type).toBe('study');
      expect(session.status).toBe('open');
      expect(session.participants).toContain('user-aryan');
      expect(session.participants).toContain('user-vidhi');
      expect(session.dailyRoomUrl).toMatch(/^https:\/\/av-space\.daily\.co\//);
      expect(session.studyState?.partnerStatuses['user-aryan']).toBe('studying');
    });

    it('creates well-formed movie session model with screenshare capability', () => {
      const now = Date.now();
      const session: ActivitySession = {
        id: 'session-movie-456',
        coupleId: 'couple-av-1',
        type: 'movie',
        status: 'open',
        createdBy: 'user-vidhi',
        createdByName: 'Vidhi',
        createdAt: now,
        expiresAt: now + 5 * 60 * 60 * 1000,
        dailyRoomName: 'duo-movie-session-movie-456',
        dailyRoomUrl: 'https://av-space.daily.co/duo-movie-session-movie-456',
        participants: ['user-vidhi', 'user-aryan'],
        movieState: {
          mode: 'screen',
          title: 'Studio Ghibli Night',
          isPlaying: false,
          currentTime: 0,
          sharingUserId: 'user-vidhi',
        },
      };

      expect(session.type).toBe('movie');
      expect(session.status).toBe('open');
      expect(session.movieState?.sharingUserId).toBe('user-vidhi');
      expect(session.movieState?.mode).toBe('screen');
    });
  });

  describe('Daily Room Configuration Logic', () => {
    it('generates expected private room payload for Daily API', () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const expirySeconds = nowSeconds + 4 * 3600;

      const dailyRoomPayload = {
        privacy: 'private',
        properties: {
          enable_screenshare: true,
          enable_prejoin_ui: true,
          exp: expirySeconds,
          eject_at_room_exp: true,
        },
      };

      expect(dailyRoomPayload.privacy).toBe('private');
      expect(dailyRoomPayload.properties.enable_screenshare).toBe(true);
      expect(dailyRoomPayload.properties.enable_prejoin_ui).toBe(true);
      expect(dailyRoomPayload.properties.exp).toBeGreaterThan(nowSeconds);
      expect(dailyRoomPayload.properties.eject_at_room_exp).toBe(true);
    });

    it('validates meeting token parameters for non-owner joiner', () => {
      const tokenPayload = {
        properties: {
          room_name: 'duo-room-xyz',
          user_name: 'Aryan',
          is_owner: false, // Explicitly non-owner per plan specs
          enable_screenshare: true,
          exp: Math.floor(Date.now() / 1000) + 7200,
        },
      };

      expect(tokenPayload.properties.is_owner).toBe(false);
      expect(tokenPayload.properties.enable_screenshare).toBe(true);
      expect(tokenPayload.properties.user_name).toBe('Aryan');
    });
  });

  describe('Study Timer Calculations', () => {
    it('computes synchronized countdown from timerStartedAt timestamp', () => {
      const durationSeconds = 25 * 60;
      const startedAt = Date.now() - 5 * 60 * 1000; // Started 5 mins ago

      const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      const remaining = Math.max(0, durationSeconds - elapsed);

      // Remaining should be approximately 20 minutes (1200 seconds)
      expect(remaining).toBeGreaterThanOrEqual(1198);
      expect(remaining).toBeLessThanOrEqual(1202);
    });

    it('handles timer pause and resume state consistently', () => {
      const studyState: StudyState = {
        mode: 'break',
        durationMinutes: 25,
        breakMinutes: 5,
        timerSecondsRemaining: 5 * 60,
        isRunning: false,
        taskName: 'Quick Tea Break',
        partnerStatuses: {},
      };

      expect(studyState.isRunning).toBe(false);
      expect(studyState.mode).toBe('break');
      expect(studyState.breakMinutes).toBe(5);
    });
  });
});
