import React, { useState, useEffect, useRef } from 'react';
import {
  Track,
  ConnectionState,
} from 'livekit-client';
import { GoogleIcon } from '../../components/GoogleIcon';
import { useMediaRoomStore, type ActiveRoomInfo } from '../../lib/mediaRoomStore';

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
  roomName,
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
  const {
    room,
    activeRoomInfo,
    connectionState,
    isMicEnabled,
    isCamEnabled,
    isScreenSharing,
    hasRemoteVideo,
    hasRemoteScreenShare,
    localVideoTrack,
    remoteVideoTrack,
    remoteScreenShareTrack,
    remoteParticipantName,
    participantCount,
    remoteVolume,
    isRemoteMuted,
    errorMsg,
    pipMode,
    pipNotice,
    isPipSupported,
    diagnostics,
    joinRoom,
    leaveRoom,
    toggleMic,
    toggleCam,
    startScreenShare,
    stopScreenShare,
    setRemoteVolume,
    toggleRemoteMute,
    requestVideoPip,
    requestDocumentPip,
    closePip,
    setPipNotice,
    setErrorMsg,
    updateDiagnostics,
  } = useMediaRoomStore();

  // Video DOM element refs
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const screenShareVideoRef = useRef<HTMLVideoElement>(null);

  const [mobileNotice, setMobileNotice] = useState<string | null>(null);
  const [showVolumePopup, setShowVolumePopup] = useState(false);
  const [showDiagnosticsModal, setShowDiagnosticsModal] = useState(false);

  // 1. Persistent Room Join / Sync Lifecycle
  // If not yet connected to this room, initiate join through mediaRoomStore
  useEffect(() => {
    if (!serverUrl || !token) {
      setErrorMsg('Missing LiveKit connection credentials.');
      return;
    }

    const roomInfo: ActiveRoomInfo = {
      roomId: roomName,
      roomName,
      serverUrl,
      token,
      type,
      displayName,
    };

    // If already connected or connecting to this room, do not reconnect
    if (activeRoomInfo?.roomId === roomName && room) {
      return;
    }

    joinRoom(roomInfo, { enableCam: type === 'study' }).catch((err) => {
      onError?.(err);
    });
  }, [serverUrl, token, roomName, type, displayName, activeRoomInfo?.roomId, room, joinRoom, onError, setErrorMsg]);

  // 2. Track Attachment to Local Video Element
  useEffect(() => {
    const el = localVideoRef.current;
    if (!el) return;

    if (localVideoTrack && isCamEnabled) {
      localVideoTrack.attach(el);
    }

    return () => {
      if (localVideoTrack && el) {
        try {
          localVideoTrack.detach(el);
        } catch {}
      }
    };
  }, [localVideoTrack, isCamEnabled]);

  // 3. Track Attachment to Remote Video Element
  useEffect(() => {
    const el = remoteVideoRef.current;
    if (!el) return;

    if (remoteVideoTrack && hasRemoteVideo) {
      remoteVideoTrack.attach(el);
    }

    return () => {
      if (remoteVideoTrack && el) {
        try {
          remoteVideoTrack.detach(el);
        } catch {}
      }
    };
  }, [remoteVideoTrack, hasRemoteVideo]);

  // 4. Track Attachment to Screen Share Video Element
  useEffect(() => {
    const el = screenShareVideoRef.current;
    if (!el) return;

    // Attach remote screen share track if partner is sharing
    if (remoteScreenShareTrack && hasRemoteScreenShare) {
      remoteScreenShareTrack.attach(el);
      return () => {
        try {
          remoteScreenShareTrack.detach(el);
        } catch {}
      };
    }

    // If local user is screen sharing, attach local screen share track to preview canvas
    if (isScreenSharing && room) {
      const pub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
      if (pub && pub.track) {
        pub.track.attach(el);
        return () => {
          try {
            pub.track?.detach(el);
          } catch {}
        };
      }
    }
  }, [remoteScreenShareTrack, hasRemoteScreenShare, isScreenSharing, room]);

  // 5. Handle Desktop Screen Share with Immediate User Gesture
  const handleToggleScreenShare = async () => {
    if (!isPipSupported.getDisplayMedia) {
      setMobileNotice(
        'Screen sharing is not supported on this mobile browser. To share your screen, open this room on desktop (Chrome, Edge, or Safari). Watching your partner stream is fully supported here!'
      );
      setTimeout(() => setMobileNotice(null), 8000);
      return;
    }

    if (isScreenSharing) {
      await stopScreenShare();
      onScreenShareStopped?.();
    } else {
      // Synchronous user-gesture entry: start capture immediately, then claim slot post-picker
      const claimSlot = onBeforeScreenShare || (async () => true);
      const releaseSlot = onScreenShareStopped
        ? async () => {
            onScreenShareStopped();
          }
        : async () => {};

      const success = await startScreenShare(claimSlot, releaseSlot);
      if (success) {
        onScreenShareStarted?.();
      }
    }
  };

  // 6. Handle Direct Picture-in-Picture (OS Floating Window)
  const handleTogglePip = async () => {
    // If already in OS Picture-in-Picture, exit and return to normal room layout
    if (pipMode === 'video') {
      await closePip();
      return;
    }

    // Identify target video element:
    // 1. If screen share is active, use the remote screen-share video.
    // 2. Otherwise, use the remote participant video.
    let targetVideo: HTMLVideoElement | null = null;
    if (hasRemoteScreenShare && screenShareVideoRef.current) {
      targetVideo = screenShareVideoRef.current;
    } else if (hasRemoteVideo && remoteVideoRef.current) {
      targetVideo = remoteVideoRef.current;
    }

    // If no remote video track is available, show a clear message and do NOT pretend PiP opened
    if (!targetVideo) {
      const msg = hasRemoteScreenShare || hasRemoteVideo
        ? 'Video stream is initializing. Please try Picture-in-Picture again in a moment.'
        : participantCount > 1
        ? `${remoteParticipantName}'s camera is off. Picture-in-Picture requires an active video or screen share stream from your partner.`
        : 'Waiting for your partner to join. Picture-in-Picture opens when partner video or screen share is streaming.';
      setPipNotice(msg);
      setTimeout(() => setPipNotice(null), 6000);
      return;
    }

    // Directly request native OS Picture-in-Picture within the user gesture flow
    await requestVideoPip(targetVideo);
  };

  // Optional full room panel (Document PiP, if supported by browser)
  const handleToggleDocumentPip = async () => {
    await requestDocumentPip();
  };

  // 7. Handle Explicit Leave
  const handleLeave = async () => {
    await leaveRoom(true);
    onLeave?.();
  };

  const isConnecting =
    connectionState === ConnectionState.Connecting ||
    connectionState === ConnectionState.Reconnecting;
  const isConnected = connectionState === ConnectionState.Connected;

  return (
    <div className="relative w-full h-full min-h-[380px] sm:min-h-[460px] bg-stone-950 rounded-2xl sm:rounded-3xl border-2 border-white/10 overflow-hidden shadow-2xl flex flex-col justify-between select-none">
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
            <GoogleIcon name="group" size={14} className="text-stone-400" />
            <span>
              {participantCount} {participantCount === 1 ? 'user' : 'users'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Picture-in-Picture Button (Native OS Floating Window) */}
          <button
            type="button"
            onClick={handleTogglePip}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl border font-ui text-[11px] font-semibold transition-all cursor-pointer ${
              pipMode === 'video'
                ? 'bg-emerald-600 text-white border-emerald-400 shadow-sm'
                : 'bg-stone-800/80 hover:bg-stone-700/80 border-white/10 text-stone-300 hover:text-white'
            }`}
            title={
              pipMode === 'video'
                ? 'Exit floating Picture-in-Picture and return video to room layout'
                : isPipSupported.videoPip
                ? 'Open partner video in browser/OS floating PiP window (view over other windows/apps)'
                : 'Minimize room to in-app mini-player'
            }
          >
            <GoogleIcon name={pipMode === 'video' ? 'pip_exit' : 'picture_in_picture_alt'} size={15} />
            <span className="hidden sm:inline">
              {pipMode === 'video'
                ? 'Exit PiP'
                : isPipSupported.videoPip
                ? 'Picture-in-Picture'
                : 'In-App Mini-Player'}
            </span>
          </button>

          {/* Optional Floating Room Panel (Document PiP, if supported) */}
          {isPipSupported.documentPip && (
            <button
              type="button"
              onClick={handleToggleDocumentPip}
              className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-xl border font-ui text-[11px] font-semibold transition-all cursor-pointer ${
                pipMode === 'document'
                  ? 'bg-indigo-600 text-white border-indigo-400 shadow-sm'
                  : 'bg-stone-800/80 hover:bg-stone-700/80 border-white/10 text-stone-300 hover:text-white'
              }`}
              title={
                pipMode === 'document'
                  ? 'Close floating room panel'
                  : 'Open full room panel and controls in a floating desktop window'
              }
            >
              <GoogleIcon name="open_in_new" size={14} />
              <span className="hidden lg:inline">
                {pipMode === 'document' ? 'Close Panel' : 'Floating Panel'}
              </span>
            </button>
          )}

          {/* Diagnostics Button */}
          <button
            type="button"
            onClick={() => {
              updateDiagnostics();
              setShowDiagnosticsModal(true);
            }}
            className="p-1.5 rounded-lg hover:bg-white/10 text-stone-400 hover:text-white transition-colors cursor-pointer flex items-center justify-center"
            title="Inspect audio, video & network diagnostics"
          >
            <GoogleIcon name="tune" size={16} />
          </button>

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
            <GoogleIcon name="verified_user" size={14} />
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
              Connecting to {type === 'study' ? 'Study Space' : 'Movie Night'}…
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
              <GoogleIcon name="error" size={26} />
            </div>
            <h4 className="font-chunky text-white text-sm font-bold">Media Connection Notice</h4>
            <p className="font-ui text-stone-300 text-xs max-w-sm leading-relaxed">{errorMsg}</p>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  joinRoom(
                    {
                      roomId: roomName,
                      roomName,
                      serverUrl,
                      token,
                      type,
                      displayName,
                    },
                    { enableCam: type === 'study' }
                  );
                }}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-ui text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-md transition-all active:scale-95"
              >
                <GoogleIcon name="refresh" size={15} />
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
            <GoogleIcon name="smartphone" size={16} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 text-left leading-snug">
              <span className="font-bold block mb-0.5">Mobile Browser Restriction</span>
              <span>{mobileNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setMobileNotice(null)}
              className="text-amber-400 hover:text-white px-1.5 font-bold cursor-pointer"
            >
              <GoogleIcon name="close" size={14} />
            </button>
          </div>
        )}

        {/* Screen Share Slot Notice from Partner */}
        {screenShareNotice && !mobileNotice && (
          <div className="absolute top-4 left-4 right-4 z-40 bg-stone-900/95 border border-white/20 text-stone-200 p-2.5 rounded-2xl shadow-xl flex items-center justify-between text-xs animate-in fade-in">
            <span className="font-ui">{screenShareNotice}</span>
          </div>
        )}

        {/* Picture-in-Picture Notice Banner */}
        {pipNotice && (
          <div className="absolute top-4 left-4 right-4 z-40 bg-stone-900/95 border-2 border-indigo-500/60 text-stone-100 p-3 rounded-2xl shadow-2xl flex items-center justify-between gap-3 text-xs animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center gap-2 min-w-0">
              <GoogleIcon name="info" size={18} className="text-indigo-400 shrink-0" />
              <span className="font-ui font-medium leading-tight">{pipNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setPipNotice(null)}
              className="text-stone-400 hover:text-white p-1 rounded-md cursor-pointer shrink-0"
              title="Dismiss"
            >
              <GoogleIcon name="close" size={14} />
            </button>
          </div>
        )}

        {/* Video Layout: Screen Share Active vs Dual Tiles */}
        {hasRemoteScreenShare || isScreenSharing ? (
          /* Large Screen Share Canvas + Thumbnails */
          <div className="relative w-full h-full flex flex-col items-center justify-center">
            <div className="relative w-full h-full max-h-[75vh] bg-black rounded-2xl overflow-hidden border border-white/10 flex items-center justify-center">
              <video
                ref={screenShareVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-contain"
              />
              <div className="absolute top-2 left-2 px-2.5 py-1 rounded-md bg-stone-900/80 backdrop-blur-sm border border-white/10 text-[11px] font-ui text-white">
                {isScreenSharing
                  ? 'Your Screen Share (Live to Partner)'
                  : `${remoteParticipantName}'s Shared Screen 🍿`}
              </div>

              {/* In-PiP Overlay for Screen Share */}
              {pipMode === 'video' && hasRemoteScreenShare && (
                <div className="absolute inset-0 z-10 bg-black/65 backdrop-blur-xs flex flex-col items-center justify-center p-4 text-center gap-2">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-300">
                    <GoogleIcon name="picture_in_picture_alt" size={24} />
                  </div>
                  <span className="font-chunky text-white text-xs font-bold">
                    Streaming in Floating OS Window
                  </span>
                  <span className="font-ui text-[11px] text-stone-300 max-w-xs">
                    Screen share is playing in Picture-in-Picture over other apps.
                  </span>
                  <button
                    type="button"
                    onClick={closePip}
                    className="mt-1 px-3 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-white font-ui text-xs font-bold border border-white/20 cursor-pointer transition-all active:scale-95 flex items-center gap-1.5"
                  >
                    <GoogleIcon name="pip_exit" size={14} />
                    <span>Exit Picture-in-Picture</span>
                  </button>
                </div>
              )}
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
                    <GoogleIcon name="videocam_off" size={24} className="text-stone-400" />
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
                {!isMicEnabled && <GoogleIcon name="mic_off" size={13} className="text-rose-400" />}
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
                    <GoogleIcon name="group" size={24} className="text-stone-400" />
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

              {/* In-PiP Overlay for Remote Partner Video */}
              {pipMode === 'video' && hasRemoteVideo && (
                <div className="absolute inset-0 z-10 bg-black/65 backdrop-blur-xs flex flex-col items-center justify-center p-4 text-center gap-2">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-300">
                    <GoogleIcon name="picture_in_picture_alt" size={24} />
                  </div>
                  <span className="font-chunky text-white text-xs font-bold">
                    Partner Video in Floating Window
                  </span>
                  <span className="font-ui text-[11px] text-stone-300 max-w-xs">
                    Playing in Picture-in-Picture over other apps.
                  </span>
                  <button
                    type="button"
                    onClick={closePip}
                    className="mt-1 px-3 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-white font-ui text-xs font-bold border border-white/20 cursor-pointer transition-all active:scale-95 flex items-center gap-1.5"
                  >
                    <GoogleIcon name="pip_exit" size={14} />
                    <span>Exit Picture-in-Picture</span>
                  </button>
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
      <div className="relative z-20 py-2.5 px-3 sm:px-4 bg-stone-900/90 backdrop-blur-md border-t border-white/10 flex flex-wrap items-center justify-center gap-2 sm:gap-3">
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
          <GoogleIcon
            name={!isMicEnabled ? 'mic_off' : 'mic'}
            size={18}
            className={!isMicEnabled ? 'text-rose-400' : ''}
          />
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
          <GoogleIcon
            name={!isCamEnabled ? 'videocam_off' : 'videocam'}
            size={18}
            className={!isCamEnabled ? 'text-rose-400' : ''}
          />
          <span className="hidden sm:inline">{!isCamEnabled ? 'Start Video' : 'Stop Video'}</span>
        </button>

        {/* Screen Share Toggle */}
        <button
          type="button"
          onClick={handleToggleScreenShare}
          className={`p-2.5 sm:p-3 rounded-2xl border-2 font-ui text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
            isScreenSharing
              ? 'bg-[var(--accent)] text-stone-950 border-white/30 hover:opacity-95'
              : 'bg-stone-800 text-white border-white/10 hover:bg-stone-700'
          }`}
          title={
            isPipSupported.getDisplayMedia
              ? 'Share screen with high frame rate and audio'
              : 'Screen sharing requires supported desktop browser or native app'
          }
        >
          <GoogleIcon name={isScreenSharing ? 'stop_screen_share' : 'screen_share'} size={18} />
          <span className="hidden sm:inline">{isScreenSharing ? 'Stop Sharing' : 'Share Screen'}</span>
        </button>

        {/* In-Call Volume Control */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowVolumePopup(!showVolumePopup)}
            className="p-2.5 sm:p-3 rounded-2xl bg-stone-800 hover:bg-stone-700 text-white border-2 border-white/10 font-ui text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
            title="In-call remote volume level"
          >
            <GoogleIcon
              name={isRemoteMuted ? 'volume_off' : 'volume_up'}
              size={18}
              className={isRemoteMuted ? 'text-rose-400' : ''}
            />
            <span className="hidden md:inline">
              {isRemoteMuted ? 'Muted' : `${Math.round(remoteVolume * 100)}%`}
            </span>
          </button>

          {showVolumePopup && (
            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 p-3 bg-stone-900 border border-white/20 rounded-2xl shadow-xl w-48 text-white space-y-2 z-50 animate-in fade-in">
              <div className="flex items-center justify-between text-[11px] font-ui">
                <span className="font-bold">In-Call Volume</span>
                <span className="tabular-nums text-stone-400">
                  {isRemoteMuted ? '0%' : `${Math.round(remoteVolume * 100)}%`}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isRemoteMuted ? 0 : remoteVolume}
                onChange={(e) => setRemoteVolume(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-indigo-400"
              />
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={toggleRemoteMute}
                  className="text-[10px] text-stone-300 hover:text-white cursor-pointer underline"
                >
                  {isRemoteMuted ? 'Unmute' : 'Mute'}
                </button>
                <span className="text-[9px] text-stone-500">Call Audio Only</span>
              </div>
            </div>
          )}
        </div>

        {/* Leave Room Button */}
        <button
          type="button"
          onClick={handleLeave}
          className="p-2.5 sm:p-3 px-3.5 sm:px-4 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white border-2 border-rose-400 flex items-center gap-1.5 font-chunky font-bold text-xs shadow-[0_2px_0_rgba(0,0,0,0.4)] active:translate-y-0.5 transition-all cursor-pointer"
          title="Leave Room"
        >
          <GoogleIcon name="call_end" size={18} />
          <span>Leave</span>
        </button>
      </div>

      {/* Diagnostics Modal */}
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
                <span className="text-white">
                  {diagnostics?.rtt ? `${diagnostics.rtt} ms` : 'Measuring…'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-stone-400">Jitter:</span>
                <span className="text-white">
                  {diagnostics?.jitter ? `${diagnostics.jitter} ms` : 'Minimal'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-stone-400">Packets Lost:</span>
                <span className="text-white">{diagnostics?.packetsLost ?? 0}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-stone-400">Echo Cancellation:</span>
                <span className="text-emerald-400 font-bold">Enabled</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-stone-400">Noise Suppression:</span>
                <span className="text-emerald-400 font-bold">Enabled</span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-200/90 leading-relaxed font-sans">
              <p>
                <strong>System Notice:</strong> On some devices (Windows Communication Ducking, iOS CallKit), opening the microphone causes the OS to automatically quiet other app sounds. This is controlled by the system audio driver, not the web app.
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
    </div>
  );
};


