import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Room,
  RoomEvent,
  VideoPresets,
  Track,
  ConnectionState,
  type RemoteParticipant,
  type RemoteTrackPublication,
  type LocalTrackPublication,
} from 'livekit-client';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  MonitorUp,
  MonitorOff,
  PhoneOff,
  RefreshCw,
  AlertCircle,
  Users,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { isMobileOrConstrainedDevice } from '../../lib/media';

export interface LiveKitMediaRoomProps {
  serverUrl: string;
  token: string;
  roomName: string;
  displayName: string;
  type: 'study' | 'movie';
  onLeave?: () => void;
  onError?: (err: Error) => void;
  onSwitchToWebRTC?: () => void;
  onScreenShareStarted?: () => void;
  onScreenShareStopped?: () => void;
  onBeforeScreenShare?: () => Promise<boolean>;
  screenShareNotice?: string | null;
  customControls?: React.ReactNode;
}

export const LiveKitMediaRoom: React.FC<LiveKitMediaRoomProps> = ({
  serverUrl,
  token,
  roomName: _roomName,
  displayName,
  type,
  onLeave,
  onError,
  onSwitchToWebRTC,
  onScreenShareStarted,
  onScreenShareStopped,
  onBeforeScreenShare,
  screenShareNotice,
  customControls,
}) => {
  const roomRef = useRef<Room | null>(null);

  // Video and audio DOM element refs
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const screenShareVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  // Connection & Media States
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Connecting);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isCamEnabled, setIsCamEnabled] = useState(type === 'study');
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [hasRemoteScreenShare, setHasRemoteScreenShare] = useState(false);
  const [remoteParticipantName, setRemoteParticipantName] = useState<string>('Partner');
  const [participantCount, setParticipantCount] = useState(1);
  const [retryCount, setRetryCount] = useState(0);
  const [mobileNotice, setMobileNotice] = useState<string | null>(null);

  // Check if screen sharing is supported by this client browser
  const isScreenShareSupported = typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function';

  // Attach track safely helper
  const attachTrack = useCallback((track: Track, element: HTMLMediaElement | null) => {
    if (!element) return;
    track.attach(element);
  }, []);

  // Detach track safely helper
  const detachTrack = useCallback((track: Track, element: HTMLMediaElement | null) => {
    if (!element) return;
    track.detach(element);
  }, []);

  useEffect(() => {
    if (!serverUrl || !token) {
      setErrorMsg('Missing LiveKit connection credentials.');
      setConnectionState(ConnectionState.Disconnected);
      return;
    }

    let isCancelled = false;
    setErrorMsg(null);
    setConnectionState(ConnectionState.Connecting);

    const isMobile = isMobileOrConstrainedDevice();
    const resolution = isMobile
      ? { width: 640, height: 480, frameRate: 24 }
      : VideoPresets.h720.resolution;

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: {
        resolution,
      },
    });
    roomRef.current = room;

    const updateParticipants = () => {
      if (isCancelled) return;
      const remoteCount = room.remoteParticipants.size;
      setParticipantCount(remoteCount + 1);

      if (remoteCount > 0) {
        const firstRemote = Array.from(room.remoteParticipants.values())[0];
        setRemoteParticipantName(firstRemote.name || firstRemote.identity || 'Partner');
      } else {
        setRemoteParticipantName('Partner');
        setHasRemoteVideo(false);
        setHasRemoteScreenShare(false);
      }
    };

    // ─── Setup Event Listeners ─────────────────────────────────────
    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      if (isCancelled) return;
      setConnectionState(state);
      if (state === ConnectionState.Connected) {
        setErrorMsg(null);
      }
    });

    room.on(RoomEvent.Connected, () => {
      if (isCancelled) return;
      updateParticipants();
    });

    room.on(RoomEvent.Disconnected, () => {
      if (isCancelled) return;
      setIsScreenSharing(false);
      setHasRemoteVideo(false);
      setHasRemoteScreenShare(false);
      updateParticipants();
    });

    room.on(RoomEvent.ParticipantConnected, () => {
      if (isCancelled) return;
      updateParticipants();
    });

    room.on(RoomEvent.ParticipantDisconnected, () => {
      if (isCancelled) return;
      updateParticipants();
    });

    room.on(RoomEvent.TrackSubscribed, (track: Track, _pub: RemoteTrackPublication, _participant: RemoteParticipant) => {
      if (isCancelled) return;
      if (track.kind === Track.Kind.Video) {
        if (track.source === Track.Source.ScreenShare) {
          setHasRemoteScreenShare(true);
          attachTrack(track, screenShareVideoRef.current);
        } else {
          setHasRemoteVideo(true);
          attachTrack(track, remoteVideoRef.current);
        }
      } else if (track.kind === Track.Kind.Audio) {
        attachTrack(track, remoteAudioRef.current);
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track: Track) => {
      if (isCancelled) return;
      if (track.kind === Track.Kind.Video) {
        if (track.source === Track.Source.ScreenShare) {
          setHasRemoteScreenShare(false);
          detachTrack(track, screenShareVideoRef.current);
        } else {
          setHasRemoteVideo(false);
          detachTrack(track, remoteVideoRef.current);
        }
      } else if (track.kind === Track.Kind.Audio) {
        detachTrack(track, remoteAudioRef.current);
      }
    });

    room.on(RoomEvent.LocalTrackPublished, (pub: LocalTrackPublication) => {
      if (isCancelled) return;
      if (pub.track) {
        if (pub.track.source === Track.Source.Camera && localVideoRef.current) {
          pub.track.attach(localVideoRef.current);
        } else if (pub.track.source === Track.Source.ScreenShare && screenShareVideoRef.current) {
          pub.track.attach(screenShareVideoRef.current);
        }
      }
    });

    room.on(RoomEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
      if (isCancelled) return;
      if (pub.track) {
        if (pub.track.source === Track.Source.Camera && localVideoRef.current) {
          pub.track.detach(localVideoRef.current);
        } else if (pub.track.source === Track.Source.ScreenShare && screenShareVideoRef.current) {
          pub.track.detach(screenShareVideoRef.current);
          setIsScreenSharing(false);
          onScreenShareStopped?.();
        }
      }
    });

    // Connect to LiveKit Cloud room
    (async () => {
      try {
        await room.connect(serverUrl, token, {
          autoSubscribe: true,
        });

        if (isCancelled) {
          await room.disconnect();
          return;
        }

        // Enable default media tracks on join
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          setIsMicEnabled(true);
        } catch (micErr) {
          console.warn('[LiveKit] Initial mic permission notice:', micErr);
          setIsMicEnabled(false);
        }

        if (type === 'study') {
          try {
            await room.localParticipant.setCameraEnabled(true);
            setIsCamEnabled(true);
          } catch (camErr) {
            console.warn('[LiveKit] Initial cam permission notice:', camErr);
            setIsCamEnabled(false);
          }
        } else {
          setIsCamEnabled(false);
        }

        updateParticipants();
      } catch (err: any) {
        if (isCancelled) return;
        console.error('[LiveKit] Room connection error:', err);
        setErrorMsg(err.message || 'Failed to connect to media server.');
        setConnectionState(ConnectionState.Disconnected);
        onError?.(err);
      }
    })();

    return () => {
      isCancelled = true;
      try {
        // Stop and detach local tracks
        room.localParticipant.trackPublications.forEach((pub) => {
          if (pub.track) {
            try {
              pub.track.detach();
              pub.track.stop();
            } catch {}
          }
        });
        // Detach remote tracks from media elements
        room.remoteParticipants.forEach((p) => {
          p.trackPublications.forEach((pub) => {
            if (pub.track) {
              try {
                pub.track.detach();
              } catch {}
            }
          });
        });
        if (localVideoRef.current) localVideoRef.current.srcObject = null;
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
        if (screenShareVideoRef.current) screenShareVideoRef.current.srcObject = null;
        if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;

        room.disconnect();
      } catch (e) {
        console.warn('[LiveKit] Disconnect cleanup notice:', e);
      }
      roomRef.current = null;
    };
  }, [serverUrl, token, retryCount, type, attachTrack, detachTrack, onError, onScreenShareStopped]);

  // ─── Control Handlers ────────────────────────────────────────────

  const toggleMic = async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      const nextState = !isMicEnabled;
      await room.localParticipant.setMicrophoneEnabled(nextState);
      setIsMicEnabled(nextState);
    } catch (err: any) {
      console.warn('[LiveKit] Toggle mic error:', err);
    }
  };

  const toggleCam = async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      const nextState = !isCamEnabled;
      await room.localParticipant.setCameraEnabled(nextState);
      setIsCamEnabled(nextState);
    } catch (err: any) {
      console.warn('[LiveKit] Toggle camera error:', err);
    }
  };

  const toggleScreenShare = async () => {
    const room = roomRef.current;
    if (!room) return;

    if (!isScreenShareSupported) {
      setMobileNotice('Screen sharing is not supported by this mobile browser. You can still watch your partner stream or share from a desktop/laptop browser.');
      setTimeout(() => setMobileNotice(null), 7000);
      return;
    }

    try {
      if (isScreenSharing) {
        await room.localParticipant.setScreenShareEnabled(false);
        setIsScreenSharing(false);
        onScreenShareStopped?.();
      } else {
        if (onBeforeScreenShare) {
          const allowed = await onBeforeScreenShare();
          if (!allowed) return;
        }

        const pub = await room.localParticipant.setScreenShareEnabled(true, {
          audio: true,
          surfaceSwitching: 'include',
        });

        setIsScreenSharing(true);
        onScreenShareStarted?.();

        // Listen for browser's native "Stop Sharing" button
        if (pub && pub.track) {
          const nativeTrack = (pub.track as any).mediaStreamTrack || (pub.track as any);
          if (nativeTrack && typeof nativeTrack.addEventListener === 'function') {
            nativeTrack.addEventListener('ended', () => {
              setIsScreenSharing(false);
              onScreenShareStopped?.();
            }, { once: true });
          } else if (nativeTrack) {
            nativeTrack.onended = () => {
              setIsScreenSharing(false);
              onScreenShareStopped?.();
            };
          }
        }
      }
    } catch (err: any) {
      setIsScreenSharing(false);
      onScreenShareStopped?.();
      if (err.name !== 'NotAllowedError') {
        console.warn('[LiveKit] Screen share notice:', err);
      }
    }
  };

  const isConnecting = connectionState === ConnectionState.Connecting || connectionState === ConnectionState.Reconnecting;
  const isConnected = connectionState === ConnectionState.Connected;

  return (
    <div className="relative w-full h-full min-h-[380px] sm:min-h-[460px] bg-stone-950 rounded-2xl sm:rounded-3xl border-2 border-white/10 overflow-hidden shadow-2xl flex flex-col justify-between select-none">
      {/* Hidden audio element for remote audio tracks */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Top Header Bar */}
      <div className="relative z-20 px-3 sm:px-4 py-2.5 bg-stone-900/80 backdrop-blur-md border-b border-white/10 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-stone-800/80 border border-white/10">
            <span
              className={`w-2 h-2 rounded-full ${
                isConnected
                  ? 'bg-emerald-400 animate-pulse'
                  : isConnecting
                  ? 'bg-amber-400 animate-ping'
                  : 'bg-rose-400'
              }`}
            />
            <span className="font-ui font-semibold text-white/90">
              {isConnected
                ? 'LiveKit Cloud Media'
                : isConnecting
                ? 'Connecting to LiveKit…'
                : 'Disconnected'}
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-full bg-stone-800/60 border border-white/5 text-[11px] text-stone-300">
            <Users className="w-3 h-3 text-stone-400" />
            <span>{participantCount} {participantCount === 1 ? 'user' : 'users'}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {customControls}

          {onSwitchToWebRTC && (
            <button
              type="button"
              onClick={onSwitchToWebRTC}
              className="hidden md:flex items-center gap-1 px-2.5 py-1 rounded-xl bg-stone-800/80 hover:bg-stone-700/80 border border-white/10 text-stone-300 hover:text-white font-ui text-[11px] font-semibold transition-all cursor-pointer"
              title="Switch to Duo's built-in WebRTC 1-on-1 mode"
            >
              <span>Built-in WebRTC</span>
            </button>
          )}

          <div className="flex items-center gap-1 text-[10px] text-emerald-400/90 font-mono bg-emerald-950/40 border border-emerald-500/20 px-2 py-0.5 rounded-md">
            <ShieldCheck className="w-3 h-3" />
            <span>E2EE Active</span>
          </div>
        </div>
      </div>

      {/* Main Viewport Grid */}
      <div className="relative flex-1 w-full h-full p-2 sm:p-3 flex items-center justify-center overflow-hidden">
        {/* Loading Overlay */}
        {isConnecting && (
          <div className="absolute inset-0 z-30 bg-stone-950/85 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center space-y-3">
            <div className="w-10 h-10 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <h4 className="font-chunky text-white text-sm font-bold tracking-wide">
              Joining {type === 'study' ? 'Study Space' : 'Movie Night'}…
            </h4>
            <p className="font-ui text-stone-400 text-xs max-w-xs">
              Securing high-definition LiveKit Cloud connection with low latency.
            </p>
          </div>
        )}

        {/* Error Overlay */}
        {errorMsg && (
          <div className="absolute inset-0 z-30 bg-stone-950/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h4 className="font-chunky text-white text-sm font-bold">Media Connection Notice</h4>
            <p className="font-ui text-stone-300 text-xs max-w-sm leading-relaxed">{errorMsg}</p>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRetryCount((c) => c + 1)}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-ui text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-md transition-all active:scale-95"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
              {onSwitchToWebRTC && (
                <button
                  type="button"
                  onClick={onSwitchToWebRTC}
                  className="px-4 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-white font-ui text-xs font-bold border border-white/10 flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
                >
                  <span>Use Built-in WebRTC</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Mobile Unsupported Notice Banner */}
        {mobileNotice && (
          <div className="absolute top-4 left-4 right-4 z-40 bg-amber-950/90 border border-amber-500/40 text-amber-200 p-3 rounded-2xl shadow-xl flex items-start gap-2.5 text-xs animate-in fade-in slide-in-from-top-2">
            <Smartphone className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 text-left leading-snug">
              <span className="font-bold block mb-0.5">Mobile Browser Restriction</span>
              <span>{mobileNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setMobileNotice(null)}
              className="text-amber-400 hover:text-white px-1.5 font-bold"
            >
              ✕
            </button>
          </div>
        )}

        {/* Screen Share Slot Notice from Partner */}
        {screenShareNotice && !mobileNotice && (
          <div className="absolute top-4 left-4 right-4 z-40 bg-stone-900/95 border border-white/20 text-stone-200 p-2.5 rounded-2xl shadow-xl flex items-center justify-between text-xs animate-in fade-in">
            <span className="font-ui">{screenShareNotice}</span>
          </div>
        )}

        {/* Video Layout: Movie Night with Screen Share vs Study Space Dual View */}
        {hasRemoteScreenShare || isScreenSharing ? (
          /* Movie Night Screen Share Layout: Primary Large Canvas + Small Floating Feeds */
          <div className="relative w-full h-full flex flex-col items-center justify-center">
            <div className="relative w-full h-full max-h-[75vh] bg-black rounded-2xl overflow-hidden border border-white/10 flex items-center justify-center">
              <video
                ref={screenShareVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-contain"
              />
              <div className="absolute top-2 left-2 px-2.5 py-1 rounded-md bg-stone-900/80 backdrop-blur-sm border border-white/10 text-[11px] font-ui text-white">
                {isScreenSharing ? 'Your Screen Share (Live to Partner)' : `${remoteParticipantName}'s Shared Screen 🍿`}
              </div>
            </div>

            {/* PiP Local / Remote Video Thumbnails */}
            <div className="absolute bottom-3 right-3 z-20 flex gap-2">
              <div className="relative w-28 h-20 sm:w-36 sm:h-24 bg-stone-900 rounded-xl overflow-hidden border border-white/20 shadow-lg">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${!isCamEnabled ? 'hidden' : ''}`}
                />
                {!isCamEnabled && (
                  <div className="w-full h-full flex items-center justify-center text-[10px] text-stone-400 font-ui">
                    Camera Off
                  </div>
                )}
                <span className="absolute bottom-1 left-1.5 text-[9px] font-ui font-bold text-white bg-black/60 px-1 rounded">
                  You
                </span>
              </div>
            </div>
          </div>
        ) : (
          /* Standard Dual Tiles Layout (Study Space & Movie Waiting Mode) */
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-3 w-full h-full max-h-[75vh]">
            {/* Local Video Tile */}
            <div className="relative w-full h-full min-h-[160px] bg-stone-900 rounded-2xl overflow-hidden border border-white/10 flex items-center justify-center">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${!isCamEnabled ? 'hidden' : ''}`}
              />
              {!isCamEnabled && (
                <div className="flex flex-col items-center justify-center gap-2 text-stone-400">
                  <div className="w-14 h-14 rounded-full bg-stone-800/80 border border-white/10 flex items-center justify-center text-stone-300">
                    <VideoOff className="w-6 h-6 text-stone-400" />
                  </div>
                  <span className="font-ui text-xs font-semibold text-stone-300">
                    Your Camera is Off
                  </span>
                  <button
                    type="button"
                    onClick={toggleCam}
                    className="mt-1 px-3 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-[11px] font-bold text-white border border-white/10 cursor-pointer"
                  >
                    Start Video
                  </button>
                </div>
              )}
              <div className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-stone-950/70 backdrop-blur-xs text-[10px] font-ui text-white">
                <span>{displayName || 'You'}</span>
                {!isMicEnabled && <MicOff className="w-3 h-3 text-rose-400" />}
              </div>
            </div>

            {/* Remote Partner Video Tile */}
            <div className="relative w-full h-full min-h-[160px] bg-stone-900 rounded-2xl overflow-hidden border border-white/10 flex items-center justify-center">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className={`w-full h-full object-cover ${!hasRemoteVideo ? 'hidden' : ''}`}
              />
              {!hasRemoteVideo && (
                <div className="flex flex-col items-center justify-center gap-2 p-4 text-center text-stone-400">
                  <div className="w-14 h-14 rounded-full bg-stone-800/80 border border-white/10 flex items-center justify-center text-stone-300">
                    <Users className="w-6 h-6 text-stone-400" />
                  </div>
                  <span className="font-ui text-xs font-semibold text-stone-300">
                    {participantCount > 1
                      ? `${remoteParticipantName}'s video is paused`
                      : 'Waiting for partner to join…'}
                  </span>
                  <span className="font-ui text-[11px] text-stone-500 max-w-xs">
                    {participantCount > 1
                      ? 'Audio is connected! Video stream will display when turned on.'
                      : 'Audio & video stream connects automatically when partner opens this space.'}
                  </span>
                </div>
              )}
              <div className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-stone-950/70 backdrop-blur-xs text-[10px] font-ui text-white">
                <span>{remoteParticipantName}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Floating Control Bar */}
      <div className="relative z-20 py-2.5 px-3 sm:px-4 bg-stone-900/90 backdrop-blur-md border-t border-white/10 flex items-center justify-center gap-2 sm:gap-3">
        {/* Microphone Toggle */}
        <button
          type="button"
          onClick={toggleMic}
          className={`p-2.5 sm:p-3 rounded-2xl border-2 font-ui text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
            !isMicEnabled
              ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30'
              : 'bg-stone-800 text-white border-white/10 hover:bg-stone-700'
          }`}
          title={isMicEnabled ? 'Mute microphone' : 'Unmute microphone'}
        >
          {!isMicEnabled ? <MicOff className="w-4 h-4 text-rose-400" /> : <Mic className="w-4 h-4" />}
          <span className="hidden sm:inline">{!isMicEnabled ? 'Unmute' : 'Mute'}</span>
        </button>

        {/* Camera Toggle */}
        <button
          type="button"
          onClick={toggleCam}
          className={`p-2.5 sm:p-3 rounded-2xl border-2 font-ui text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
            !isCamEnabled
              ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30'
              : 'bg-stone-800 text-white border-white/10 hover:bg-stone-700'
          }`}
          title={isCamEnabled ? 'Stop video' : 'Start video'}
        >
          {!isCamEnabled ? <VideoOff className="w-4 h-4 text-rose-400" /> : <Video className="w-4 h-4" />}
          <span className="hidden sm:inline">{!isCamEnabled ? 'Start Video' : 'Stop Video'}</span>
        </button>

        {/* Screen Share Toggle */}
        <button
          type="button"
          onClick={toggleScreenShare}
          className={`p-2.5 sm:p-3 rounded-2xl border-2 font-ui text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
            isScreenSharing
              ? 'bg-[var(--accent)] text-stone-950 border-white/30 hover:opacity-95'
              : 'bg-stone-800 text-white border-white/10 hover:bg-stone-700'
          }`}
          title={
            isScreenShareSupported
              ? 'Share screen with high frame rate and audio'
              : 'Screen sharing restricted on mobile browsers'
          }
        >
          {isScreenSharing ? <MonitorOff className="w-4 h-4" /> : <MonitorUp className="w-4 h-4" />}
          <span className="hidden sm:inline">{isScreenSharing ? 'Stop Sharing' : 'Share Screen'}</span>
        </button>

        {/* Leave Room Button */}
        <button
          type="button"
          onClick={onLeave}
          className="p-2.5 sm:p-3 px-3.5 sm:px-4 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white border-2 border-rose-400 flex items-center gap-1.5 font-chunky font-bold text-xs shadow-[0_2px_0_rgba(0,0,0,0.4)] active:translate-y-0.5 transition-all cursor-pointer"
          title="Leave Room"
        >
          <PhoneOff className="w-4 h-4" />
          <span>Leave</span>
        </button>
      </div>
    </div>
  );
};
