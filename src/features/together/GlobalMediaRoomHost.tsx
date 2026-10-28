import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  useMediaRoomStore,
} from '../../lib/mediaRoomStore';
import { useAuthStore } from '../../lib/store';
import { GoogleIcon } from '../../components/GoogleIcon';

export const GlobalMediaRoomHost: React.FC = () => {
  const {
    room,
    activeRoomInfo,
    connectionState,
    remoteAudioTrack,
    remoteVideoTrack,
    remoteScreenShareTrack,
    localVideoTrack,
    hasRemoteVideo,
    hasRemoteScreenShare,
    isMicEnabled,
    isCamEnabled,
    remoteVolume,
    isRemoteMuted,
    remoteParticipantName,
    pipMode,
    pipWindow,
    toggleMic,
    toggleCam,
    setRemoteVolume,
    toggleRemoteMute,
    closePip,
    leaveRoom,
    diagnostics,
    updateDiagnostics,
  } = useMediaRoomStore();

  const { activeTab, togetherSubTab, setTab, setTogetherSubTab } = useAuthStore();

  // Persistent hidden audio element for remote audio
  const persistentAudioRef = useRef<HTMLAudioElement>(null);

  // Floating mini panel video element
  const miniVideoRef = useRef<HTMLVideoElement>(null);

  // PiP portal video element
  const pipVideoRef = useRef<HTMLVideoElement>(null);

  const [showDiagnosticsModal, setShowDiagnosticsModal] = useState(false);

  // Attach persistent remote audio track whenever it changes
  useEffect(() => {
    const audioEl = persistentAudioRef.current;
    if (!audioEl) return;

    if (remoteAudioTrack) {
      remoteAudioTrack.attach(audioEl);
    }

    return () => {
      if (remoteAudioTrack) {
        try {
          remoteAudioTrack.detach(audioEl);
        } catch {}
      }
    };
  }, [remoteAudioTrack]);

  // Synchronize in-call remote volume on persistent audio element
  useEffect(() => {
    const audioEl = persistentAudioRef.current;
    if (!audioEl) return;
    audioEl.volume = isRemoteMuted ? 0 : remoteVolume;
  }, [remoteVolume, isRemoteMuted]);

  // Determine if the full room UI is currently visible on screen
  const isFullRoomVisible =
    activeTab === 'together' &&
    ((activeRoomInfo?.type === 'study' && togetherSubTab === 'focus') ||
      (activeRoomInfo?.type === 'movie' && togetherSubTab === 'movie'));

  // Should we show the in-app floating mini player?
  // Only when pipMode is explicitly 'in-app' (e.g. on browsers lacking native OS PiP)
  const shouldShowInAppMini = Boolean(room && activeRoomInfo) && pipMode === 'in-app';

  // Attach video to floating mini preview element
  useEffect(() => {
    const videoEl = miniVideoRef.current;
    if (!videoEl || !shouldShowInAppMini) return;

    const displayTrack = remoteScreenShareTrack || remoteVideoTrack || localVideoTrack;
    if (displayTrack) {
      displayTrack.attach(videoEl);
    }

    return () => {
      if (displayTrack && videoEl) {
        try {
          displayTrack.detach(videoEl);
        } catch {}
      }
    };
  }, [
    shouldShowInAppMini,
    remoteScreenShareTrack,
    remoteVideoTrack,
    localVideoTrack,
  ]);

  // Attach video in Document PiP window when document PiP is active
  useEffect(() => {
    const videoEl = pipVideoRef.current;
    if (!videoEl || pipMode !== 'document') return;

    const displayTrack = remoteScreenShareTrack || remoteVideoTrack || localVideoTrack;
    if (displayTrack) {
      displayTrack.attach(videoEl);
    }

    return () => {
      if (displayTrack && videoEl) {
        try {
          displayTrack.detach(videoEl);
        } catch {}
      }
    };
  }, [pipMode, remoteScreenShareTrack, remoteVideoTrack, localVideoTrack]);

  // Jump back to the full room screen
  const handleReturnToRoom = () => {
    if (!activeRoomInfo) return;
    setTab('together');
    setTogetherSubTab(activeRoomInfo.type === 'study' ? 'focus' : 'movie');
    if (pipMode === 'in-app') {
      closePip();
    }
  };

  // If no room is connected, return early
  if (!room || !activeRoomInfo) {
    return <audio ref={persistentAudioRef} autoPlay playsInline />;
  }

  return (
    <>
      {/* Persistent Audio Engine for Remote Sound across entire application */}
      <audio ref={persistentAudioRef} autoPlay playsInline />

      {/* ─── 1. Document Picture-in-Picture Portal (Desktop Chrome/Edge 111+) ─── */}
      {pipMode === 'document' &&
        pipWindow &&
        createPortal(
          <div className="w-full h-full bg-stone-950 text-white flex flex-col justify-between p-2 select-none font-sans">
            <div className="relative w-full flex-1 rounded-xl overflow-hidden bg-black/60 flex items-center justify-center">
              {hasRemoteScreenShare || hasRemoteVideo ? (
                <video
                  ref={pipVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 p-4 text-center">
                  <div className="w-14 h-14 rounded-full bg-indigo-500/20 border-2 border-indigo-400 flex items-center justify-center text-xl">
                    {activeRoomInfo.type === 'study' ? '📚' : '🍿'}
                  </div>
                  <span className="text-xs font-bold text-stone-200">
                    {remoteParticipantName}
                  </span>
                  <span className="text-[10px] text-stone-400">
                    Voice Connected 🎧
                  </span>
                </div>
              )}
            </div>

            {/* PiP In-Window Controls */}
            <div className="mt-2 flex items-center justify-between gap-1.5 px-1 py-1.5 bg-stone-900/90 rounded-xl border border-white/10 text-xs">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={toggleMic}
                  className={`p-1.5 rounded-lg border cursor-pointer ${
                    isMicEnabled
                      ? 'bg-stone-800 text-white border-white/20'
                      : 'bg-rose-600 text-white border-rose-400'
                  }`}
                  title={isMicEnabled ? 'Mute Mic' : 'Unmute Mic'}
                >
                  <GoogleIcon name={isMicEnabled ? 'mic' : 'mic_off'} size={15} />
                </button>

                <button
                  type="button"
                  onClick={toggleCam}
                  className={`p-1.5 rounded-lg border cursor-pointer ${
                    isCamEnabled
                      ? 'bg-stone-800 text-white border-white/20'
                      : 'bg-stone-700/60 text-stone-300 border-white/10'
                  }`}
                  title={isCamEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
                >
                  <GoogleIcon name={isCamEnabled ? 'videocam' : 'videocam_off'} size={15} />
                </button>

                <button
                  type="button"
                  onClick={toggleRemoteMute}
                  className="p-1.5 rounded-lg bg-stone-800 text-white border border-white/20 cursor-pointer"
                  title={isRemoteMuted ? 'Unmute Speaker' : 'Mute Speaker'}
                >
                  <GoogleIcon
                    name={isRemoteMuted ? 'volume_off' : 'volume_up'}
                    size={15}
                    className={isRemoteMuted ? 'text-rose-400' : ''}
                  />
                </button>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleReturnToRoom}
                  className="px-2 py-1 rounded-lg bg-indigo-600 text-white text-[11px] font-bold border border-indigo-400 flex items-center gap-1 cursor-pointer"
                  title="Return to app"
                >
                  <GoogleIcon name="open_in_full" size={13} />
                  <span>Open</span>
                </button>

                <button
                  type="button"
                  onClick={() => leaveRoom(true)}
                  className="p-1.5 rounded-lg bg-rose-600 text-white border border-rose-400 cursor-pointer"
                  title="Leave Room"
                >
                  <GoogleIcon name="call_end" size={15} />
                </button>
              </div>
            </div>
          </div>,
          pipWindow.document.body
        )}

      {/* ─── 2. Floating Status Bar for Native OS Picture-in-Picture ─── */}
      {pipMode === 'video' && !isFullRoomVisible && (
        <div className="fixed bottom-20 lg:bottom-6 right-3 sm:right-6 z-50 flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl bg-stone-900/95 backdrop-blur-md border-2 border-emerald-500/50 shadow-2xl text-white text-xs font-ui animate-in slide-in-from-bottom-2 select-none">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <div className="flex flex-col">
              <span className="font-chunky text-xs font-bold text-stone-100 flex items-center gap-1.5">
                <GoogleIcon name="picture_in_picture_alt" size={14} className="text-emerald-400" />
                <span>Picture-in-Picture Active</span>
              </span>
              <span className="text-[10px] text-stone-400">
                Playing in OS floating window
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleReturnToRoom}
            className="px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-ui text-[11px] font-bold cursor-pointer transition-all active:scale-95 flex items-center gap-1"
            title="Return to room layout"
          >
            <GoogleIcon name="open_in_full" size={13} />
            <span>Return to Room</span>
          </button>
          <button
            type="button"
            onClick={closePip}
            className="p-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-white cursor-pointer transition-colors"
            title="Exit Picture-in-Picture"
          >
            <GoogleIcon name="close" size={14} />
          </button>
        </div>
      )}

      {/* ─── 3. In-App Mini-Player (Fallback for Browsers without Native PiP) ─── */}
      {shouldShowInAppMini && (
        <div className="fixed bottom-20 lg:bottom-6 right-3 sm:right-6 z-50 w-72 sm:w-80 rounded-2xl bg-stone-900/95 backdrop-blur-xl border-2 border-[var(--border)] shadow-2xl p-3 text-white flex flex-col gap-2.5 animate-in slide-in-from-bottom-4 duration-200 select-none">
          {/* Top Bar */}
          <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <div className="min-w-0 truncate">
                <div className="flex items-center gap-1.5">
                  <span className="font-chunky text-xs font-bold text-white truncate">
                    {activeRoomInfo.type === 'study' ? 'Study Space' : 'Movie Night'}
                  </span>
                  <span className="px-1.5 py-0.2 rounded bg-indigo-500/20 border border-indigo-400/30 text-[9px] font-bold text-indigo-300 shrink-0">
                    In-App Mini-Player
                  </span>
                </div>
                <span className="text-[10px] text-stone-400 block truncate">
                  With {remoteParticipantName}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => {
                  updateDiagnostics();
                  setShowDiagnosticsModal(!showDiagnosticsModal);
                }}
                className="p-1 rounded-lg hover:bg-white/10 text-stone-400 hover:text-white transition-colors cursor-pointer flex items-center justify-center"
                title="Connection Diagnostics"
              >
                <GoogleIcon name="tune" size={15} />
              </button>
              <button
                type="button"
                onClick={handleReturnToRoom}
                className="p-1 rounded-lg hover:bg-white/10 text-stone-300 hover:text-white transition-colors cursor-pointer flex items-center justify-center"
                title="Expand Room View"
              >
                <GoogleIcon name="open_in_full" size={16} />
              </button>
            </div>
          </div>

          {/* Mini Video / Audio State Area */}
          <div className="relative w-full h-36 rounded-xl bg-black/60 overflow-hidden border border-white/10 flex items-center justify-center">
            {hasRemoteScreenShare || hasRemoteVideo ? (
              <video
                ref={miniVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-1.5 p-3 text-center">
                <div className="w-12 h-12 rounded-full bg-indigo-500/20 border-2 border-indigo-400 flex items-center justify-center text-lg">
                  {activeRoomInfo.type === 'study' ? '✍️' : '🎬'}
                </div>
                <span className="text-xs font-bold text-stone-200">
                  {remoteParticipantName}
                </span>
                <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                  <GoogleIcon name="graphic_eq" size={13} className="animate-pulse" /> Audio Live
                </span>
              </div>
            )}

            {/* Screen share badge */}
            {hasRemoteScreenShare && (
              <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-indigo-600/90 text-white text-[9px] font-bold border border-white/20">
                Screen Share Active
              </div>
            )}
          </div>

          {/* Mini Volume Bar & Quick Controls */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 px-1">
              <button
                type="button"
                onClick={toggleRemoteMute}
                className="text-stone-400 hover:text-white transition-colors cursor-pointer"
                title={isRemoteMuted ? 'Unmute Speaker' : 'Mute Speaker'}
              >
                <GoogleIcon
                  name={isRemoteMuted ? 'volume_off' : 'volume_up'}
                  size={15}
                  className={isRemoteMuted ? 'text-rose-400' : ''}
                />
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isRemoteMuted ? 0 : remoteVolume}
                onChange={(e) => setRemoteVolume(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-indigo-400"
                title={`Call Volume: ${Math.round((isRemoteMuted ? 0 : remoteVolume) * 100)}% (In-call level, does not alter device system volume)`}
              />
              <span className="text-[10px] text-stone-400 min-w-[28px] text-right tabular-nums">
                {isRemoteMuted ? '0%' : `${Math.round(remoteVolume * 100)}%`}
              </span>
            </div>

            <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-white/10">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={toggleMic}
                  className={`p-2 rounded-xl border transition-all cursor-pointer ${
                    isMicEnabled
                      ? 'bg-stone-800 text-white border-white/20 hover:bg-stone-700'
                      : 'bg-rose-600 text-white border-rose-400 hover:bg-rose-500'
                  }`}
                  title={isMicEnabled ? 'Mute Mic' : 'Unmute Mic'}
                >
                  <GoogleIcon
                    name={isMicEnabled ? 'mic' : 'mic_off'}
                    size={15}
                    className={!isMicEnabled ? 'text-white' : ''}
                  />
                </button>

                <button
                  type="button"
                  onClick={toggleCam}
                  className={`p-2 rounded-xl border transition-all cursor-pointer ${
                    isCamEnabled
                      ? 'bg-stone-800 text-white border-white/20 hover:bg-stone-700'
                      : 'bg-stone-800/60 text-stone-400 border-white/10 hover:text-white'
                  }`}
                  title={isCamEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
                >
                  <GoogleIcon
                    name={isCamEnabled ? 'videocam' : 'videocam_off'}
                    size={15}
                  />
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleReturnToRoom}
                  className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-ui text-xs font-bold border border-indigo-400 flex items-center gap-1 cursor-pointer shadow-md"
                >
                  <GoogleIcon name="open_in_new" size={14} />
                  <span>Return</span>
                </button>

                <button
                  type="button"
                  onClick={() => leaveRoom(true)}
                  className="p-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white border border-rose-400 transition-all cursor-pointer shadow-md"
                  title="Leave Call"
                >
                  <GoogleIcon name="call_end" size={15} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── 3. Connection Diagnostics Modal (Hidden by default, available for dev inspection) ─── */}
      {showDiagnosticsModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-sm rounded-3xl bg-stone-900 border-2 border-white/20 shadow-2xl p-5 text-white space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <GoogleIcon name="tune" size={18} className="text-indigo-400" />
                <h3 className="font-chunky text-sm font-bold">Call Diagnostics</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowDiagnosticsModal(false)}
                className="p-1 rounded-lg hover:bg-white/10 text-stone-400 hover:text-white cursor-pointer flex items-center justify-center"
              >
                <GoogleIcon name="close" size={16} />
              </button>
            </div>

            <div className="space-y-2 text-xs font-mono">
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-stone-400">Connection:</span>
                <span className="text-emerald-400 font-bold">{connectionState}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-stone-400">Round Trip Time (RTT):</span>
                <span className="text-white">{diagnostics?.rtt ? `${diagnostics.rtt} ms` : 'Testing…'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-stone-400">Jitter:</span>
                <span className="text-white">{diagnostics?.jitter ? `${diagnostics.jitter} ms` : 'Minimal'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-stone-400">Packets Lost:</span>
                <span className="text-white">{diagnostics?.packetsLost ?? 0}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-stone-400">Echo Cancellation:</span>
                <span className="text-emerald-400 font-bold">Active (Hardware/WebRTC)</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-stone-400">Noise Suppression:</span>
                <span className="text-emerald-400 font-bold">Active</span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-200/90 leading-relaxed font-sans">
              <p>
                <strong>Audio Notice:</strong> On some devices (Windows Communication Ducking, iOS CallKit), opening the microphone causes the OS to automatically quiet other app sounds. This is controlled by the system audio driver, not the web app.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowDiagnosticsModal(false)}
              className="w-full py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-white font-ui font-bold text-xs cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
};
