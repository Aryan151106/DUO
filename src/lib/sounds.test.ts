import { describe, it, expect, beforeEach } from 'vitest';
import { soundEngine, DEFAULT_SOUND_SETTINGS } from './sounds';

describe('Sound System & Notification Settings (src/lib/sounds.ts)', () => {
  beforeEach(() => {
    soundEngine.saveSettings(DEFAULT_SOUND_SETTINGS);
  });

  it('validates sound settings defaults', () => {
    const settings = soundEngine.getSettings();
    expect(settings.messageSoundId).toBe('msg-pop');
    expect(settings.incomingRingtoneId).toBe('ring-heartbeat');
    expect(settings.taskAlarmSoundId).toBe('alarm-gentle-rise');
    expect(settings.urgentTaskAlarmSoundId).toBe('alarm-bells');
    expect(settings.muteAll).toBe(false);
  });

  describe('Audio File Upload Validation', () => {
    it('rejects files exceeding 2 MB size limit', async () => {
      // 2.5 MB fake file
      const largeFile = new File([new ArrayBuffer(2.5 * 1024 * 1024)], 'song.mp3', {
        type: 'audio/mpeg',
      });
      const result = await soundEngine.validateAudioUpload(largeFile, 'ringtone');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('under 2 MB');
    });

    it('rejects non-audio formats', async () => {
      const textFile = new File(['hello world'], 'doc.pdf', {
        type: 'application/pdf',
      });
      const result = await soundEngine.validateAudioUpload(textFile, 'message');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('MP3, M4A, WAV, OGG, or WebM');
    });
  });

  describe('Mute Scheduler & Duration Logic', () => {
    it('sets mute duration for 1 hour correctly', () => {
      const before = Date.now();
      soundEngine.setMuteDuration('1h');
      const settings = soundEngine.getSettings();
      expect(settings.mutedUntil).not.toBeNull();
      const expiry = new Date(settings.mutedUntil!).getTime();
      expect(expiry).toBeGreaterThanOrEqual(before + 59 * 60 * 1000);
      expect(expiry).toBeLessThanOrEqual(before + 61 * 60 * 1000);
      expect(soundEngine.isMuted()).toBe(true);
    });

    it('sets mute duration for 8 hours correctly', () => {
      const before = Date.now();
      soundEngine.setMuteDuration('8h');
      const settings = soundEngine.getSettings();
      expect(settings.mutedUntil).not.toBeNull();
      const expiry = new Date(settings.mutedUntil!).getTime();
      expect(expiry).toBeGreaterThanOrEqual(before + 7.9 * 60 * 60 * 1000);
      expect(soundEngine.isMuted()).toBe(true);
    });

    it('clears mute when set to off', () => {
      soundEngine.setMuteDuration('1h');
      expect(soundEngine.isMuted()).toBe(true);
      soundEngine.setMuteDuration('off');
      expect(soundEngine.isMuted()).toBe(false);
      expect(soundEngine.getSettings().mutedUntil).toBeNull();
    });

    it('handles indefinite mute switch', () => {
      soundEngine.setMuteDuration('indefinite');
      expect(soundEngine.isMuted()).toBe(true);
      expect(soundEngine.getSettings().muteAll).toBe(true);
    });
  });
});
