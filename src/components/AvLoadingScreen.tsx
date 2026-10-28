import React, { useEffect, useState, useRef } from 'react';

interface AvLoadingScreenProps {
  onComplete?: () => void;
  soundEnabled?: boolean;
}

export const AvLoadingScreen: React.FC<AvLoadingScreenProps> = ({
  onComplete,
  soundEnabled = true,
}) => {
  const [progressIndex, setProgressIndex] = useState(0);
  const [statusText, setStatusText] = useState('SCOOPING… 0%');
  const [isOut, setIsOut] = useState(false);
  const [sprinkles, setSprinkles] = useState<
    Array<{ left: string; top: string; bg: string; rotate: number; delay: string }>
  >([]);

  const audioCtxRef = useRef<AudioContext | null>(null);

  // Synthesize soft retro chime tones
  const playBeep = (freq: number, duration = 0.08, type: OscillatorType = 'square', vol = 0.035, delay = 0) => {
    if (!soundEnabled || typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.value = vol;
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + duration);
    } catch {}
  };

  const playWin = () => {
    [523, 659, 784, 1046].forEach((f, i) => playBeep(f, 0.15, 'triangle', 0.06, i * 0.09));
  };

  // Generate 9 sprinkles
  useEffect(() => {
    const sc = ['var(--a)', 'var(--b)', 'var(--c)', 'var(--d)'];
    const list = Array.from({ length: 9 }, (_, i) => ({
      left: `${18 + Math.random() * 64}%`,
      top: `${4 + Math.random() * 34}%`,
      bg: sc[i % 4],
      rotate: Math.floor(Math.random() * 180),
      delay: `${2.1 + i * 0.07}s`,
    }));
    setSprinkles(list);
  }, []);

  // 12-step scooping progress sequence
  useEffect(() => {
    const totalBlocks = 12;
    let n = 0;

    const interval = setInterval(() => {
      n++;
      setProgressIndex(n);

      if (n < totalBlocks) {
        playBeep(300 + n * 60, 0.08, 'square', 0.04);
        const pct = Math.round((n / totalBlocks) * 100);
        const prefix = n < 5 ? 'SCOOPING… ' : n < 10 ? 'ADDING SPRINKLES… ' : 'ALMOST… ';
        setStatusText(`${prefix}${pct}%`);
      } else {
        clearInterval(interval);
        setStatusText('ENJOY! 🍦');
        playWin();

        setTimeout(() => {
          setIsOut(true);
          setTimeout(() => {
            onComplete?.();
          }, 800);
        }, 500);
      }
    }, 180);

    return () => clearInterval(interval);
  }, []);

  return (
    <div id="ld" className={isOut ? 'out' : ''} role="status" aria-label="Loading AV">
      {/* Single-color sliding background pillars */}
      <i className="p" />
      <i className="p" />
      <i className="p" />
      <i className="p" />

      {/* Main loading container */}
      <div className="lw">
        <div className="lr">
          {/* Animated Sprinkles */}
          {sprinkles.map((sp, i) => (
            <s
              key={i}
              className="sp"
              style={{
                left: sp.left,
                top: sp.top,
                background: sp.bg,
                transform: `rotate(${sp.rotate}deg)`,
                animationDelay: sp.delay,
              }}
            />
          ))}

          {/* AV Ice Cream (Aryan & Vidhi: A on top of V) */}
          <svg viewBox="-10 -30 220 380" role="img" aria-label="AV ice cream">
            {/* The Cone: 'V' for Vidhi */}
            <g id="lv">
              <path d="M30 124Q62 245 100 318Q138 245 170 124Z" fill="#E9A23B" />
              <clipPath id="cc-app">
                <path d="M30 124Q62 245 100 318Q138 245 170 124Z" />
              </clipPath>
              <g clipPath="url(#cc-app)" stroke="#B8651B" strokeWidth="4">
                <path d="M0 150L200 250M0 190L200 290M0 230L200 330M0 270L200 370M200 150L0 250M200 190L0 290M200 230L0 330M200 270L0 370" />
              </g>
              <path
                d="M30 124Q62 245 100 318Q138 245 170 124"
                fill="none"
                stroke="var(--ink)"
                strokeWidth="16"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </g>

            {/* The Scoop: 'A' for Aryan */}
            <g id="la" style={{ color: 'var(--a)' }}>
              <path
                fill="currentColor"
                d="M22 130C14 70 50 18 100 18C150 18 186 70 178 130L178 158Q178 172 164 172Q150 172 150 158L150 140Q150 130 138 130L62 130Q50 130 50 140L50 158Q50 172 36 172Q22 172 22 158Z"
              />
              <polygon
                points="100,60 89,84 111,84"
                fill="var(--card)"
                stroke="var(--card)"
                strokeWidth="16"
                strokeLinejoin="round"
              />

              {/* Drips */}
              <g className="dg" style={{ ['--L' as any]: '12px', ['--d' as any]: '2.1s', ['--t' as any]: '3.4s' }}>
                <path className="dt" d="M80 130v12" />
                <circle className="dd" cx="80" cy="130" r="10" />
              </g>
              <g className="dg" style={{ ['--L' as any]: '18px', ['--d' as any]: '2.9s', ['--t' as any]: '3.8s' }}>
                <path className="dt" d="M118 130v18" />
                <circle className="dd" cx="118" cy="130" r="10" />
              </g>
              <g className="dg" style={{ ['--L' as any]: '14px', ['--d' as any]: '2.5s', ['--t' as any]: '3.2s' }}>
                <path className="dt" d="M36 172v14" />
                <circle className="dd" cx="36" cy="172" r="10" />
              </g>
              <g className="dg" style={{ ['--L' as any]: '20px', ['--d' as any]: '3.1s', ['--t' as any]: '4s' }}>
                <path className="dt" d="M164 172v20" />
                <circle className="dd" cx="164" cy="172" r="10" />
              </g>

              {/* Cherry on top */}
              <g className="cg">
                <circle cx="100" cy="12" r="14" fill="#E11D2E" />
                <path d="M100 -2Q102 -16 116 -22" stroke="#8A4A12" strokeWidth="4" fill="none" strokeLinecap="round" />
              </g>
            </g>
          </svg>
        </div>

        {/* 12-block progress boxes */}
        <div className="lb">
          {Array.from({ length: 12 }, (_, i) => (
            <u
              key={i}
              className={i < progressIndex ? 'f' : ''}
              style={{
                background: i < progressIndex ? 'var(--a)' : undefined,
              }}
            />
          ))}
        </div>

        {/* Status text */}
        <div id="lt">{statusText}</div>
      </div>
    </div>
  );
};
