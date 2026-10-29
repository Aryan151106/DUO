// Web Audio API Synthesizer for Silly Game Arcade
// Generates instant, zero-asset, dependency-free retro arcade sound effects

let AC: AudioContext | null = null;
let muted = false;
let userActivated = false;

// Initialize muted state from storage if available
if (typeof window !== 'undefined') {
  try {
    const saved = localStorage.getItem('duo_arcade_muted');
    if (saved !== null) {
      muted = saved === 'true';
    }
  } catch {
    // Ignore localStorage access failures
  }

  const markActive = () => {
    userActivated = true;
  };
  window.addEventListener('pointerdown', markActive, { capture: true });
  window.addEventListener('keydown', markActive, { capture: true });
}

export function isArcadeMuted(): boolean {
  return muted;
}

export function setArcadeMuted(val: boolean) {
  muted = val;
  try {
    localStorage.setItem('duo_arcade_muted', String(val));
  } catch {
    // Ignore
  }
}

export function toggleArcadeMuted(): boolean {
  const next = !muted;
  setArcadeMuted(next);
  return next;
}

function tone(
  f1: number,
  f2: number,
  d: number,
  type: OscillatorType = 'sine',
  v = 0.2,
  t0 = 0
) {
  if (muted || (!userActivated && typeof window !== 'undefined')) return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    AC = AC || new AudioCtx();
    if (AC.state === 'suspended') {
      AC.resume();
    }
    const o = AC.createOscillator();
    const g = AC.createGain();
    const t = AC.currentTime + t0;
    o.type = type;
    o.frequency.setValueAtTime(f1, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f2, 1), t + d);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(g);
    g.connect(AC.destination);
    o.start(t);
    o.stop(t + d);
  } catch (e) {
    console.debug('Arcade tone error:', e);
  }
}

export const SF = {
  pop: () => tone(700, 200, 0.12),
  boing: () => {
    tone(150, 550, 0.25, 'sine', 0.25);
    tone(550, 110, 0.3, 'triangle', 0.2, 0.2);
  },
  plop: () => {
    tone(500, 120, 0.18);
    tone(300, 90, 0.15, 'sine', 0.2, 0.2);
  },
  bonk: () => tone(220, 60, 0.15, 'square', 0.2),
  slide: () => tone(1500, 200, 0.5, 'sine', 0.15),
  quack: () => {
    tone(450, 250, 0.12, 'sawtooth', 0.15);
    tone(420, 220, 0.15, 'sawtooth', 0.15, 0.14);
  },
  win: () =>
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) =>
      tone(f, f, 0.15, 'square', 0.12, i * 0.12)
    ),
  sad: () =>
    [392, 370, 349, 330].forEach((f, i) =>
      tone(f, f * 0.96, i === 3 ? 0.8 : 0.35, 'sawtooth', 0.14, i * 0.35)
    ),
  buzz: () => tone(120, 100, 0.3, 'sawtooth', 0.2),
  alarm: () => {
    tone(600, 900, 0.2, 'square', 0.1);
    tone(900, 600, 0.2, 'square', 0.1, 0.2);
  },
  ding: () => tone(1200, 1200, 0.3, 'sine', 0.2),
  phew: () => tone(700, 200, 0.8, 'sine', 0.12),
  evil: () =>
    [300, 260, 300, 260].forEach((f, i) =>
      tone(f, f * 0.8, 0.12, 'sawtooth', 0.12, i * 0.15)
    ),
  wah: () => tone(400, 200, 0.5, 'sawtooth', 0.15),
};

export type SoundName = keyof typeof SF;

export function sfx(n: SoundName) {
  if (SF[n]) {
    SF[n]();
  }
}
