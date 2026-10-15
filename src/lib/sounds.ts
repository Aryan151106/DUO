/**
 * Duo Sound System (src/lib/sounds.ts)
 * 
 * Provides:
 * 1. Built-in sound registry for Messages, Ringtones, and Alarms synthesized
 *    via Web Audio API (zero external network dependencies, offline-ready).
 * 2. Playback engine with single shared AudioContext, category volume, looping,
 *    and automatic unlocking.
 * 3. Custom user sound upload validation (<2 MB, duration verification via decodeAudioData).
 * 4. Mute scheduler (1h, 8h, tomorrow morning, indefinite).
 * 5. Device-synced settings structure with localStorage caching.
 */

export interface BuiltinSound {
  id: string;
  name: string;
  category: 'message' | 'ringtone' | 'alarm';
  description: string;
}

export interface CustomSoundItem {
  id: string;
  name: string;
  category: 'message' | 'ringtone' | 'alarm';
  url: string;
  duration: number; // in seconds
  size: number; // in bytes
  storagePath: string;
  createdAt: string;
}

export interface SoundSettings {
  // Global
  muteAll: boolean;
  mutedUntil: string | null; // ISO timestamp or 'indefinite' | null
  
  // Messages
  messageSoundId: string;
  messageVolume: number; // 0 to 1
  messageVibration: 'off' | 'short' | 'double' | 'long';
  messagePreviewMode: 'full' | 'sender_only' | 'hidden';
  messageNotifyOn: {
    messages: boolean;
    reactions: boolean;
    media: boolean;
    voice: boolean;
    doodles: boolean;
  };
  reactionSoundId: string;

  // Calls
  incomingRingtoneId: string;
  ringbackToneId: string;
  callVolume: number; // 0 to 1
  callVibration: 'off' | 'pulse' | 'long' | 'heartbeat';
  playCallConnectSound: boolean;
  ringDuringQuietHours: boolean;

  // Tasks & Alarms
  taskAlarmSoundId: string;
  urgentTaskAlarmSoundId: string;
  alarmVolume: number; // 0 to 1
  alarmStyle: 'once' | 'repeat_2min' | 'escalating';
  alarmVibration: boolean;
}

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  muteAll: false,
  mutedUntil: null,

  messageSoundId: 'msg-pop',
  messageVolume: 0.85,
  messageVibration: 'short',
  messagePreviewMode: 'full',
  messageNotifyOn: {
    messages: true,
    reactions: true,
    media: true,
    voice: true,
    doodles: true,
  },
  reactionSoundId: 'msg-bubble',

  incomingRingtoneId: 'ring-heartbeat',
  ringbackToneId: 'ring-classic',
  callVolume: 0.9,
  callVibration: 'pulse',
  playCallConnectSound: true,
  ringDuringQuietHours: true,

  taskAlarmSoundId: 'alarm-gentle-rise',
  urgentTaskAlarmSoundId: 'alarm-bells',
  alarmVolume: 0.95,
  alarmStyle: 'repeat_2min',
  alarmVibration: true,
};

// Built-in sounds registry
export const BUILTIN_SOUNDS: BuiltinSound[] = [
  // Messages
  { id: 'msg-pop', name: 'Pop', category: 'message', description: 'Crisp playful bubble pop' },
  { id: 'msg-chime', name: 'Chime', category: 'message', description: 'Gentle bell chime' },
  { id: 'msg-bubble', name: 'Bubble', category: 'message', description: 'Subtle water droplet' },
  { id: 'msg-ding', name: 'Ding', category: 'message', description: 'Classic pleasant bell ding' },
  { id: 'msg-knock', name: 'Knock', category: 'message', description: 'Two light door knocks' },
  { id: 'msg-soft-bell', name: 'Soft Bell', category: 'message', description: 'Melodic soft harp chime' },
  { id: 'msg-silent', name: 'Silent', category: 'message', description: 'Visual only, no sound' },

  // Ringtones
  { id: 'ring-classic', name: 'Classic', category: 'ringtone', description: 'Vintage telephone ring' },
  { id: 'ring-marimba', name: 'Marimba', category: 'ringtone', description: 'Cheerful acoustic rhythm' },
  { id: 'ring-heartbeat', name: 'Heartbeat', category: 'ringtone', description: 'Warm romantic pulse' },
  { id: 'ring-sunrise', name: 'Sunrise', category: 'ringtone', description: 'Inspiring uplifting melody' },
  { id: 'ring-playful', name: 'Playful', category: 'ringtone', description: 'Bouncy duo theme' },
  { id: 'ring-retro', name: 'Retro', category: 'ringtone', description: '8-bit nostalgic tune' },
  { id: 'ring-silent', name: 'Silent', category: 'ringtone', description: 'Vibrate only' },

  // Alarms
  { id: 'alarm-gentle-rise', name: 'Gentle Rise', category: 'alarm', description: 'Soft gradual wake-up harmony' },
  { id: 'alarm-beep-beep', name: 'Beep Beep', category: 'alarm', description: 'Modern energetic double beep' },
  { id: 'alarm-bells', name: 'Bells', category: 'alarm', description: 'Resonant rich brass bells' },
  { id: 'alarm-rooster', name: 'Rooster Call', category: 'alarm', description: 'Sunny morning melody' },
  { id: 'alarm-digital', name: 'Digital', category: 'alarm', description: 'Crisp electronic alarm pattern' },
  { id: 'alarm-wake-up', name: 'Wake Up', category: 'alarm', description: 'Playful upbeat fanfare' },
  { id: 'alarm-silent', name: 'Silent', category: 'alarm', description: 'Banner only, no alarm tone' },
];

class SoundEngine {
  private ctx: AudioContext | null = null;
  private isUnlocked: boolean = false;
  private activeLoops: Map<string, { stop: () => void }> = new Map();
  private settings: SoundSettings = { ...DEFAULT_SOUND_SETTINGS };
  private customSounds: CustomSoundItem[] = [];

  constructor() {
    this.loadSettings();
  }

  public getAudioContext(): AudioContext {
    if (typeof window === 'undefined') {
      throw new Error('AudioContext unavailable in server environment');
    }
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public isAudioLocked(): boolean {
    if (typeof window === 'undefined') return true;
    if (!this.ctx) return true;
    return this.ctx.state === 'suspended' || !this.isUnlocked;
  }

  public async unlockAudio(): Promise<boolean> {
    try {
      const ctx = this.getAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      // Play a short silent buffer to unlock browser autoplay policy
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
      this.isUnlocked = true;
      return true;
    } catch (e) {
      console.warn('[SoundEngine] Unlock failed:', e);
      return false;
    }
  }

  // Settings persistence
  public loadSettings(): SoundSettings {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('duo_sound_settings_v2');
        if (stored) {
          this.settings = { ...DEFAULT_SOUND_SETTINGS, ...JSON.parse(stored) };
        }
        const custom = localStorage.getItem('duo_custom_sounds_v2');
        if (custom) {
          this.customSounds = JSON.parse(custom);
        }
      } catch (e) {
        console.warn('Failed to load sound settings:', e);
      }
    }
    return this.settings;
  }

  public saveSettings(updates: Partial<SoundSettings>) {
    this.settings = { ...this.settings, ...updates };
    if (typeof window !== 'undefined') {
      localStorage.setItem('duo_sound_settings_v2', JSON.stringify(this.settings));
    }
  }

  public getSettings(): SoundSettings {
    return this.settings;
  }

  public getCustomSounds(): CustomSoundItem[] {
    return this.customSounds;
  }

  public setCustomSounds(sounds: CustomSoundItem[]) {
    this.customSounds = sounds;
    if (typeof window !== 'undefined') {
      localStorage.setItem('duo_custom_sounds_v2', JSON.stringify(sounds));
    }
  }

  // Mute logic
  public isMuted(): boolean {
    if (this.settings.muteAll) return true;
    if (!this.settings.mutedUntil) return false;
    if (this.settings.mutedUntil === 'indefinite') return true;
    const expiry = new Date(this.settings.mutedUntil).getTime();
    if (isNaN(expiry)) return false;
    return Date.now() < expiry;
  }

  public setMuteDuration(mode: 'off' | '1h' | '8h' | 'tomorrow' | 'indefinite') {
    if (mode === 'off') {
      this.saveSettings({ muteAll: false, mutedUntil: null });
      return;
    }
    if (mode === 'indefinite') {
      this.saveSettings({ muteAll: true, mutedUntil: 'indefinite' });
      return;
    }

    const now = new Date();
    let untilDate: Date;
    if (mode === '1h') {
      untilDate = new Date(now.getTime() + 60 * 60 * 1000);
    } else if (mode === '8h') {
      untilDate = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    } else {
      // Tomorrow 08:00 AM
      untilDate = new Date(now);
      untilDate.setDate(untilDate.getDate() + 1);
      untilDate.setHours(8, 0, 0, 0);
    }
    this.saveSettings({ muteAll: false, mutedUntil: untilDate.toISOString() });
  }

  public vibrate(pattern: number | number[]) {
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch {}
    }
  }

  // Custom audio upload validator
  public async validateAudioUpload(
    file: File,
    category: 'message' | 'ringtone' | 'alarm'
  ): Promise<{ valid: boolean; duration: number; error?: string }> {
    // 1. File size check (max 2 MB)
    const MAX_SIZE = 2 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return { valid: false, duration: 0, error: 'Audio file must be under 2 MB.' };
    }

    // 2. Format validation
    const allowedTypes = ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/ogg', 'audio/webm'];
    const hasValidExt = /\.(mp3|m4a|wav|ogg|webm)$/i.test(file.name);
    if (!allowedTypes.includes(file.type) && !hasValidExt) {
      return { valid: false, duration: 0, error: 'Please choose an MP3, M4A, WAV, OGG, or WebM audio file.' };
    }

    // 3. Duration check via AudioContext decoding
    try {
      const ctx = this.getAudioContext();
      const arrayBuffer = await file.arrayBuffer();
      const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
      const duration = decodedBuffer.duration;

      const maxDuration = category === 'message' ? 5.5 : 31;
      if (duration > maxDuration) {
        return {
          valid: false,
          duration,
          error: category === 'message'
            ? `Message sounds must be 5 seconds or shorter (yours is ${Math.round(duration)}s).`
            : `Ringtones and alarms must be 30 seconds or shorter (yours is ${Math.round(duration)}s).`,
        };
      }

      return { valid: true, duration };
    } catch (err: any) {
      console.warn('Audio decoding failed:', err);
      return { valid: false, duration: 0, error: 'Unable to decode audio format. Please try another file.' };
    }
  }

  // Playback execution
  public async play(
    soundId: string,
    options?: {
      category?: 'message' | 'ringtone' | 'alarm';
      volume?: number;
      loop?: boolean;
      force?: boolean;
    }
  ): Promise<{ stop: () => void }> {
    if (typeof window === 'undefined') return { stop: () => {} };
    if (soundId.endsWith('-silent')) return { stop: () => {} };

    if (!options?.force && this.isMuted()) {
      return { stop: () => {} };
    }

    const category = options?.category || (soundId.startsWith('ring-') ? 'ringtone' : soundId.startsWith('alarm-') ? 'alarm' : 'message');
    const categoryVolume =
      options?.volume !== undefined
        ? options.volume
        : category === 'ringtone'
        ? this.settings.callVolume
        : category === 'alarm'
        ? this.settings.alarmVolume
        : this.settings.messageVolume;

    // Check if it is a custom upload
    const custom = this.customSounds.find((c) => c.id === soundId);
    if (custom) {
      return this.playCustomAudioUrl(custom.url, categoryVolume, options?.loop);
    }

    // Synthesize built-in sound via Web Audio API
    return this.synthesizeBuiltinSound(soundId, categoryVolume, options?.loop);
  }

  private playCustomAudioUrl(url: string, volume: number, loop: boolean = false): { stop: () => void } {
    try {
      const audio = new Audio(url);
      audio.volume = Math.max(0, Math.min(1, volume));
      audio.loop = loop;
      audio.play().catch((err) => console.warn('Audio element play error:', err));
      return {
        stop: () => {
          audio.pause();
          audio.currentTime = 0;
        },
      };
    } catch {
      return { stop: () => {} };
    }
  }

  public stopAllLoops() {
    this.activeLoops.forEach((item) => item.stop());
    this.activeLoops.clear();
  }

  // Built-in Sound Synthesizer via Web Audio API
  private synthesizeBuiltinSound(soundId: string, volume: number, loop: boolean = false): { stop: () => void } {
    try {
      const ctx = this.getAudioContext();
      let stopped = false;
      let loopTimer: number | null = null;

      const runOnce = () => {
        if (stopped) return;
        const now = ctx.currentTime;
        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(Math.max(0.01, volume), now);
        masterGain.connect(ctx.destination);

        switch (soundId) {
          case 'msg-pop': {
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(440, now);
            osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
            g.gain.setValueAtTime(0.3, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
            osc.connect(g);
            g.connect(masterGain);
            osc.start(now);
            osc.stop(now + 0.12);
            break;
          }
          case 'msg-chime': {
            const freqs = [587.33, 880, 1174.66]; // D5, A5, D6
            freqs.forEach((f, i) => {
              const osc = ctx.createOscillator();
              const g = ctx.createGain();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(f, now + i * 0.06);
              g.gain.setValueAtTime(0.2, now + i * 0.06);
              g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.06 + 0.4);
              osc.connect(g);
              g.connect(masterGain);
              osc.start(now + i * 0.06);
              osc.stop(now + i * 0.06 + 0.4);
            });
            break;
          }
          case 'msg-bubble': {
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(600, now);
            osc.frequency.exponentialRampToValueAtTime(1200, now + 0.06);
            osc.frequency.exponentialRampToValueAtTime(800, now + 0.15);
            g.gain.setValueAtTime(0.25, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
            osc.connect(g);
            g.connect(masterGain);
            osc.start(now);
            osc.stop(now + 0.15);
            break;
          }
          case 'msg-ding': {
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(1046.5, now); // C6
            g.gain.setValueAtTime(0.25, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
            osc.connect(g);
            g.connect(masterGain);
            osc.start(now);
            osc.stop(now + 0.45);
            break;
          }
          case 'msg-knock': {
            [0, 0.12].forEach((offset) => {
              const osc = ctx.createOscillator();
              const g = ctx.createGain();
              osc.type = 'triangle';
              osc.frequency.setValueAtTime(180, now + offset);
              osc.frequency.exponentialRampToValueAtTime(80, now + offset + 0.05);
              g.gain.setValueAtTime(0.3, now + offset);
              g.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.05);
              osc.connect(g);
              g.connect(masterGain);
              osc.start(now + offset);
              osc.stop(now + offset + 0.05);
            });
            break;
          }
          case 'msg-soft-bell': {
            const notes = [659.25, 783.99, 987.77]; // E5, G5, B5
            notes.forEach((f, idx) => {
              const osc = ctx.createOscillator();
              const g = ctx.createGain();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(f, now + idx * 0.05);
              g.gain.setValueAtTime(0.18, now + idx * 0.05);
              g.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.05 + 0.5);
              osc.connect(g);
              g.connect(masterGain);
              osc.start(now + idx * 0.05);
              osc.stop(now + idx * 0.05 + 0.5);
            });
            break;
          }
          case 'ring-heartbeat': {
            // Warm double-pulse heartbeat: lub-dub
            const pulses = [0, 0.16];
            pulses.forEach((offset) => {
              const osc = ctx.createOscillator();
              const g = ctx.createGain();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(75, now + offset);
              osc.frequency.exponentialRampToValueAtTime(45, now + offset + 0.14);
              g.gain.setValueAtTime(0.4, now + offset);
              g.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.14);
              osc.connect(g);
              g.connect(masterGain);
              osc.start(now + offset);
              osc.stop(now + offset + 0.14);
            });
            break;
          }
          case 'ring-marimba': {
            const pattern = [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25];
            pattern.forEach((f, i) => {
              const osc = ctx.createOscillator();
              const g = ctx.createGain();
              osc.type = 'triangle';
              osc.frequency.setValueAtTime(f, now + i * 0.11);
              g.gain.setValueAtTime(0.25, now + i * 0.11);
              g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.11 + 0.22);
              osc.connect(g);
              g.connect(masterGain);
              osc.start(now + i * 0.11);
              osc.stop(now + i * 0.11 + 0.22);
            });
            break;
          }
          case 'ring-classic': {
            // Two alternating 440/480 telephone tones
            [440, 480].forEach((freq) => {
              const osc = ctx.createOscillator();
              const g = ctx.createGain();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(freq, now);
              g.gain.setValueAtTime(0.18, now);
              g.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
              osc.connect(g);
              g.connect(masterGain);
              osc.start(now);
              osc.stop(now + 1.2);
            });
            break;
          }
          case 'alarm-gentle-rise': {
            const chords = [440, 554.37, 659.25]; // A major
            chords.forEach((freq, idx) => {
              const osc = ctx.createOscillator();
              const g = ctx.createGain();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(freq, now + idx * 0.1);
              g.gain.setValueAtTime(0.2, now + idx * 0.1);
              g.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.8);
              osc.connect(g);
              g.connect(masterGain);
              osc.start(now + idx * 0.1);
              osc.stop(now + idx * 0.1 + 0.8);
            });
            break;
          }
          case 'alarm-beep-beep': {
            [0, 0.14, 0.28].forEach((offset) => {
              const osc = ctx.createOscillator();
              const g = ctx.createGain();
              osc.type = 'square';
              osc.frequency.setValueAtTime(880, now + offset);
              g.gain.setValueAtTime(0.15, now + offset);
              g.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.08);
              osc.connect(g);
              g.connect(masterGain);
              osc.start(now + offset);
              osc.stop(now + offset + 0.08);
            });
            break;
          }
          default: {
            // General melodious tone
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(660, now);
            osc.frequency.exponentialRampToValueAtTime(880, now + 0.2);
            g.gain.setValueAtTime(0.2, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
            osc.connect(g);
            g.connect(masterGain);
            osc.start(now);
            osc.stop(now + 0.35);
            break;
          }
        }
      };

      runOnce();

      if (loop) {
        const intervalMs = soundId.startsWith('ring-') ? 2400 : 1800;
        loopTimer = window.setInterval(runOnce, intervalMs);
      }

      const stopHandle = () => {
        stopped = true;
        if (loopTimer) {
          clearInterval(loopTimer);
          loopTimer = null;
        }
      };

      return { stop: stopHandle };
    } catch {
      return { stop: () => {} };
    }
  }
}

export const soundEngine = new SoundEngine();
