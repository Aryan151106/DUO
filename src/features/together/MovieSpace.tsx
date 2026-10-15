import React, { useState } from 'react';
import { Film, Moon, Play, Plus, Sun } from 'lucide-react';
import { CallRoom } from './CallRoom';

export const MovieSpace: React.FC = () => {
  const [movieTitle, setMovieTitle] = useState('SCREEN TIME: ABSOLUTE CINEMA 🍿');
  const [cinemaMode, setCinemaMode] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [queue, setQueue] = useState<string[]>([]);
  const [mode, setMode] = useState<'screen' | 'synced'>('screen');

  return (
    <div className={`space-y-4 ${cinemaMode ? 'bg-black/30 p-2' : ''}`}>
      <div className="rounded-3xl border-2 border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_4px_0_var(--shadow-color)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-[var(--accent)]/30 p-3 text-[var(--text)]"><Film /></div>
            <div>
              <p className="font-ui text-xs uppercase tracking-widest text-[var(--partner-a)] font-bold">Ticket stub · tonight</p>
              <input value={movieTitle} onChange={(event) => setMovieTitle(event.target.value)} className="w-full bg-transparent font-romantic text-2xl text-[var(--text)] outline-none" aria-label="Movie night title" />
            </div>
          </div>
          <button type="button" onClick={() => setCinemaMode((value) => !value)} className="rounded-xl border-2 border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text)]" aria-label="Toggle cinema mode">
            {cinemaMode ? <Sun /> : <Moon />}
          </button>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={() => setMode('screen')} className={`rounded-xl px-3 py-2 text-xs font-bold ${mode === 'screen' ? 'bg-[var(--partner-a)] text-white' : 'bg-[var(--surface-2)] text-[var(--text)]'}`}>Screen share mode</button>
          <button type="button" onClick={() => setMode('synced')} className={`rounded-xl px-3 py-2 text-xs font-bold ${mode === 'synced' ? 'bg-[var(--partner-a)] text-white' : 'bg-[var(--surface-2)] text-[var(--text)]'}`}>Synced player mode</button>
        </div>
        {mode === 'synced' && (
          <div className="mt-3 flex flex-wrap gap-2">
            <input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="Paste a YouTube or direct video URL" className="min-w-[220px] flex-1 rounded-xl border-2 border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] outline-none" />
            <button type="button" onClick={() => sourceUrl.trim() && setQueue((items) => [...items, sourceUrl.trim()])} className="rounded-xl bg-[var(--accent)] px-3 py-2 font-bold text-[var(--text)]"><Plus /></button>
          </div>
        )}
        {!!queue.length && <p className="mt-2 text-xs text-[var(--text-muted)]">Queue: {queue.join(' · ')}</p>}
      </div>
      <CallRoom
        kind="movie"
        title="Movie Night"
        subtitle={mode === 'screen' ? 'Share a browser tab with audio. DRM-protected services may show a black screen; synced player mode is the fallback.' : 'Both partners load the same source. Use Sync now if playback drifts by more than a second.'}
        activity={
          <div className="rounded-3xl border-2 border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--text)]">
            <div className="flex items-center gap-2 font-chunky font-bold"><Play className="text-[var(--accent)]" /> {mode === 'screen' ? 'Share tab audio' : 'Synced playback'}</div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">{mode === 'screen' ? 'Choose a browser tab and enable “Share tab audio” for the best experience. Headphones are recommended.' : 'Playback controls and drift correction stay ready for the shared player.'}</p>
            {mode === 'synced' && <button type="button" className="mt-3 rounded-xl bg-[var(--partner-a)] px-3 py-2 text-xs font-bold text-white">Sync now</button>}
          </div>
        }
      />
    </div>
  );
};
