// Web Audio API Sound Synthesizer & Vibration Manager for Duo
// Operates without external audio asset downloads for instant zero-latency playback

class SoundManager {
  private ctx: AudioContext | null = null;
  private alarmInterval: number | null = null;
  private ringtoneInterval: number | null = null;
  private ambientSource: AudioNode | null = null;

  constructor() {
    // Will be lazily initialized on user interaction
  }

  public getAudioContext(): AudioContext {
    if (typeof window === 'undefined') {
      throw new Error('AudioContext unavailable in non-browser environment');
    }
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  // One-time unlock handler on user gesture
  public async unlockAudio(): Promise<boolean> {
    try {
      const ctx = this.getAudioContext();
      // Play a short silent buffer to unlock browser audio policy
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);

      // Soft confirmation beep
      this.playGentleChime();
      this.vibrate([40, 40, 40]);
      return true;
    } catch (e) {
      console.warn('AudioContext unlock failed:', e);
      return false;
    }
  }

  public vibrate(pattern: number | number[] = 200) {
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {
        // Ignore if blocked
      }
    }
  }

  // Soft ping for notifications / Level 1 nudge
  public playPing() {
    if (typeof window === 'undefined') return;
    try {
      const ctx = this.getAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);

      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
      this.vibrate(80);
    } catch (e) {
      console.warn(e);
    }
  }

  // Gentle chime for task done & positive rewards
  public playGentleChime() {
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);

        gain.gain.setValueAtTime(0.18, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.5);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.5);
      });
      this.vibrate([50, 50, 100]);
    } catch (e) {
      console.warn(e);
    }
  }

  // Soft pop sound
  public playPop() {
    this.playPing();
  }

  // Play success chime
  public playSuccess() {
    this.playGentleChime();
  }

  // Level 3 urgent alert
  public playUrgentAlert() {
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(950, now + i * 0.15);
        osc.frequency.setValueAtTime(750, now + i * 0.15 + 0.07);

        gain.gain.setValueAtTime(0.3, now + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.15 + 0.13);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.15);
        osc.stop(now + i * 0.15 + 0.14);
      }
      this.vibrate([200, 100, 200, 100, 300]);
    } catch (e) {
      console.warn(e);
    }
  }

  // Level 4 Nudge Alarm: persistent pulsating siren + vibration
  public startLevel4Alarm() {
    this.stopLevel4Alarm();
    try {
      const ctx = this.getAudioContext();
      const playPulse = () => {
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.linearRampToValueAtTime(1400, now + 0.25);
        osc.frequency.linearRampToValueAtTime(800, now + 0.5);

        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.55);

        this.vibrate([300, 100, 300]);
      };

      playPulse();
      this.alarmInterval = window.setInterval(playPulse, 900);
    } catch (e) {
      console.warn(e);
    }
  }

  public stopLevel4Alarm() {
    if (this.alarmInterval !== null) {
      clearInterval(this.alarmInterval);
      this.alarmInterval = null;
    }
  }

  // Call ringtone (outgoing / incoming)
  public startRingtone() {
    this.stopRingtone();
    try {
      const ctx = this.getAudioContext();
      const ring = () => {
        const now = ctx.currentTime;
        // Two dual-frequency pulses (US/UK phone ring style)
        [0, 0.4].forEach(offset => {
          const osc1 = ctx.createOscillator();
          const osc2 = ctx.createOscillator();
          const gain = ctx.createGain();

          osc1.type = 'sine';
          osc1.frequency.setValueAtTime(440, now + offset);
          osc2.type = 'sine';
          osc2.frequency.setValueAtTime(480, now + offset);

          gain.gain.setValueAtTime(0.2, now + offset);
          gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.35);

          osc1.connect(gain);
          osc2.connect(gain);
          gain.connect(ctx.destination);

          osc1.start(now + offset);
          osc1.stop(now + offset + 0.35);
          osc2.start(now + offset);
          osc2.stop(now + offset + 0.35);
        });
        this.vibrate([400, 200, 400]);
      };

      ring();
      this.ringtoneInterval = window.setInterval(ring, 2600);
    } catch (e) {
      console.warn(e);
    }
  }

  public stopRingtone() {
    if (this.ringtoneInterval !== null) {
      clearInterval(this.ringtoneInterval);
      this.ringtoneInterval = null;
    }
  }

  // Lo-Fi Ambient Generator for Focus Room
  public startAmbient(type: 'rain' | 'waves' | 'cafe') {
    this.stopAmbient();
    try {
      const ctx = this.getAudioContext();
      // Generate soothing noise using pink/brown noise algorithm
      const bufferSize = ctx.sampleRate * 2;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      let b0 = 0, b1 = 0;

      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        if (type === 'rain') {
          // Rain / pink noise
          b0 = 0.99 * b0 + white * 0.05;
          output[i] = b0 * 0.4;
        } else if (type === 'waves') {
          // Soft rolling low-frequency waves
          b0 = 0.995 * b0 + white * 0.03;
          output[i] = b0 * 0.5 * (Math.sin(i / (ctx.sampleRate * 0.8)) + 1);
        } else {
          // Cafe warm murmur
          b0 = 0.98 * b0 + white * 0.04;
          b1 = 0.95 * b1 + white * 0.02;
          output[i] = (b0 + b1) * 0.3;
        }
      }

      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;
      whiteNoise.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(type === 'rain' ? 800 : 500, ctx.currentTime);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.12, ctx.currentTime);

      whiteNoise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      whiteNoise.start();
      this.ambientSource = whiteNoise;
    } catch (e) {
      console.warn(e);
    }
  }

  public stopAmbient() {
    if (this.ambientSource) {
      try {
        (this.ambientSource as any).stop();
      } catch (e) {}
      this.ambientSource = null;
    }
  }
}

export const soundManager = new SoundManager();

export const soundEffects = {
  playPop: () => soundManager.playPing(),
  playSuccess: () => soundManager.playGentleChime(),
  playTaskDone: () => soundManager.playGentleChime(),
  playHeart: () => soundManager.playPing(),
  playMessageSent: () => soundManager.playPing(),
  playAlert: () => soundManager.playUrgentAlert(),
};
