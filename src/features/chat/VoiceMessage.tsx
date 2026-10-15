import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Loader2, Download, AlertCircle } from 'lucide-react';
import { voicePlayer, type VoicePlaybackState } from '../../lib/voice';

interface VoiceMessageProps {
  id: string;
  audioUrl?: string;
  durationMs?: number;
  waveform?: number[];
  isMe: boolean;
  onMarkListened?: () => void;
}

export const VoiceMessage: React.FC<VoiceMessageProps> = ({
  id,
  audioUrl,
  durationMs = 5000,
  waveform,
  isMe,
  onMarkListened,
}) => {
  const [playerState, setPlayerState] = useState<VoicePlaybackState>(voicePlayer.getState());
  const progressBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = voicePlayer.subscribe((state) => {
      setPlayerState(state);
    });
    return unsub;
  }, []);

  const isThisPlaying = playerState.currentMsgId === id && playerState.isPlaying;
  const isThisBuffering = playerState.currentMsgId === id && playerState.isBuffering;
  const isThisActive = playerState.currentMsgId === id;

  const totalDurationSec = (durationMs || 5000) / 1000;
  const currentSec = isThisActive ? playerState.currentTime : 0;
  const progressRatio = isThisActive && totalDurationSec > 0 ? Math.min(1, currentSec / totalDurationSec) : 0;

  // Waveform bars (default to pleasant wave if missing)
  const bars = waveform && waveform.length >= 10
    ? waveform
    : [0.3, 0.45, 0.7, 0.85, 0.6, 0.4, 0.65, 0.9, 0.75, 0.5, 0.35, 0.6, 0.8, 0.95, 0.7, 0.4, 0.5, 0.8, 0.6, 0.4];

  const handlePlayToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!audioUrl) return;
    if (!isMe && onMarkListened) onMarkListened();

    if (isThisPlaying) {
      voicePlayer.pause();
    } else {
      voicePlayer.play(id, audioUrl);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!progressBarRef.current || !audioUrl) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const targetSeconds = ratio * totalDurationSec;

    if (!isThisActive) {
      voicePlayer.play(id, audioUrl).then(() => {
        voicePlayer.seek(targetSeconds);
      });
    } else {
      voicePlayer.seek(targetSeconds);
    }
  };

  const handleSpeedToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const speeds = [1.0, 1.5, 2.0];
    const currentIndex = speeds.indexOf(playerState.playbackRate);
    const nextSpeed = speeds[(currentIndex + 1) % speeds.length];
    voicePlayer.setSpeed(nextSpeed);
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`flex flex-col gap-1.5 p-2 rounded-2xl select-none ${
        isMe ? 'text-[var(--text)]' : 'text-[var(--text)]'
      }`}
      style={{ minWidth: '220px', maxWidth: '300px' }}
    >
      <div className="flex items-center gap-2.5">
        {/* Play/Pause Button - 44px tap target */}
        <button
          type="button"
          onClick={handlePlayToggle}
          disabled={!audioUrl}
          aria-label={isThisPlaying ? 'Pause voice message' : 'Play voice message'}
          className="w-11 h-11 shrink-0 rounded-2xl bg-[var(--surface)] border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] flex items-center justify-center hover:scale-105 active:scale-95 transition-transform cursor-pointer"
        >
          {isThisBuffering ? (
            <Loader2 className="w-5 h-5 animate-spin text-[var(--accent)]" />
          ) : isThisPlaying ? (
            <Pause className="w-5 h-5 fill-current text-[var(--text)]" />
          ) : (
            <Play className="w-5 h-5 fill-current translate-x-0.5 text-[var(--text)]" />
          )}
        </button>

        {/* Interactive Waveform / Scrubber */}
        <div
          ref={progressBarRef}
          onClick={handleSeek}
          className="flex-1 flex items-center gap-[2.5px] h-9 cursor-pointer relative py-1"
          role="slider"
          aria-valuenow={Math.round(progressRatio * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Audio scrubber"
        >
          {bars.map((barLevel, index) => {
            const barRatio = index / bars.length;
            const isFilled = barRatio <= progressRatio;
            const heightPx = Math.max(6, Math.round(barLevel * 28));

            return (
              <span
                key={index}
                className="flex-1 rounded-full transition-all duration-75"
                style={{
                  height: `${heightPx}px`,
                  backgroundColor: isFilled
                    ? 'var(--accent)'
                    : 'var(--border)',
                  opacity: isFilled ? 1 : 0.45,
                }}
              />
            );
          })}
        </div>

        {/* Speed Multiplier Pill (1x, 1.5x, 2x) */}
        {isThisActive && (
          <button
            type="button"
            onClick={handleSpeedToggle}
            className="px-1.5 py-0.5 rounded-lg text-[10px] font-chunky font-bold bg-[var(--surface-2)] border border-[var(--border)] hover:bg-[var(--accent)] transition-colors cursor-pointer"
          >
            {playerState.playbackRate}x
          </button>
        )}
      </div>

      {/* Duration & Error / Fallback Row */}
      <div className="flex items-center justify-between px-1 text-[11px] font-numeric text-[var(--text-muted)]">
        <span>{formatTime(isThisActive ? currentSec : totalDurationSec)}</span>

        {playerState.currentMsgId === id && playerState.error ? (
          <div className="flex items-center gap-1 text-[var(--urgent)] font-ui text-[10px]">
            <AlertCircle className="w-3 h-3" />
            <span>{playerState.error}</span>
            {audioUrl && (
              <a
                href={audioUrl}
                download={`voice_note_${id}.webm`}
                className="underline hover:text-[var(--text)] ml-1 flex items-center gap-0.5"
                onClick={(e) => e.stopPropagation()}
              >
                <Download className="w-3 h-3" />
                <span>Save</span>
              </a>
            )}
          </div>
        ) : (
          <span className="text-[10px] uppercase font-ui tracking-wider opacity-70">
            Voice Note
          </span>
        )}
      </div>
    </div>
  );
};
