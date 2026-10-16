import React, { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  PhoneOff,
  Users,
  Settings,
  RefreshCw,
  AlertTriangle,
  X,
  Check,
} from 'lucide-react';
import { auth } from '../../lib/firebase';
import { getIceServers } from '../../lib/callSignaling';
import { soundEffects } from '../../lib/sound';
import { getSocketServerUrl, setCustomSocketServerUrl } from '../../lib/socketConfig';

interface SocketVideoRoomProps {
  roomId: string;
  userName: string;
  userId: string;
  isHost?: boolean;
  onLeave?: () => void;
  onSwitchToDaily?: () => void;
  onSwitchToWebRTC?: () => void;
  customControls?: React.ReactNode;
  onScreenShareStarted?: () => void;
  onScreenShareStopped?: () => void;
}

export const SocketVideoRoom: React.FC<SocketVideoRoomProps> = ({
  roomId,
  userName,
  userId,
  isHost = false,
  onLeave,
  onSwitchToDaily,
  onSwitchToWebRTC,
  customControls,
  onScreenShareStarted,
  onScreenShareStopped,
}) => {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remoteUser, setRemoteUser] = useState<{ name: string; audioEnabled: boolean; videoEnabled: boolean } | null>(null);

  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Connecting to Socket.IO video room…');
  const [isConnected, setIsConnected] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [activeServerUrl, setActiveServerUrl] = useState(() => getSocketServerUrl());
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [urlInputValue, setUrlInputValue] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('duo_socket_url') || getSocketServerUrl();
    }
    return '';
  });
  const [retryNonce, setRetryNonce] = useState(0);

  // Initialize WebRTC PeerConnection helper
  const createPeerConnection = useCallback((targetSocketId: string) => {
    const pc = new RTCPeerConnection({
      iceServers: getIceServers(),
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', {
          targetSocketId,
          senderSocketId: socketRef.current.id,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) {
        setRemoteStream(stream);
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
        }
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[SocketWebRTC] PC state with ${targetSocketId}:`, pc.connectionState);
      if (pc.connectionState === 'connected') {
        setStatusMessage('');
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setStatusMessage('Partner disconnected');
      }
    };

    return pc;
  }, []);

  // Main lifecycle
  useEffect(() => {
    let isMounted = true;
    const serverUrl = getSocketServerUrl();
    setActiveServerUrl(serverUrl);
    setConnectError(null);

    async function init() {
      try {
        if (!serverUrl) {
          setIsConnected(false);
          setConnectError('Socket server URL is not configured.');
          setStatusMessage('Socket server URL is not configured for this domain. Tap Settings below to enter your server URL.');
          return;
        }

        // 1. Get user media
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // 2. Connect to Socket.IO server
        const token = (await auth.currentUser?.getIdToken()) || `demo-token-${userId}`;
        const socket = io(serverUrl, {
          transports: ['websocket', 'polling'],
          auth: { token },
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1500,
          timeout: 10000,
        });

        socketRef.current = socket;

        socket.on('connect', () => {
          console.log('[SocketWebRTC] Connected to socket server:', socket.id);
          setIsConnected(true);
          setConnectError(null);
          setStatusMessage('Waiting for partner to join…');

          // Join room (event from user socket.js)
          socket.emit('join-room', {
            roomId,
            user: { id: userId, name: userName, isHost },
            audioEnabled: true,
            videoEnabled: true,
          });
        });

        socket.on('connect_error', (err) => {
          if (!isMounted) return;
          console.warn('[SocketWebRTC] Socket connect error:', err.message);
          setIsConnected(false);
          setConnectError(err.message);
          setStatusMessage(
            `Unable to reach Socket.IO server at ${serverUrl}. Ensure 'npm run socket-server:dev' is running on port 3001.`
          );
        });

        // Event from socket.js: all-users (caller makes offers to existing peers)
        socket.on('all-users', async (existingUsers: any[]) => {
          console.log('[SocketWebRTC] Existing users in room:', existingUsers);
          for (const peer of existingUsers) {
            if (peer.socketId === socket.id) continue;
            setRemoteUser({
              name: peer.userName || 'Partner',
              audioEnabled: peer.audioEnabled !== false,
              videoEnabled: peer.videoEnabled !== false,
            });

            const pc = createPeerConnection(peer.socketId);
            peerConnectionsRef.current.set(peer.socketId, pc);

            // Add local tracks
            stream.getTracks().forEach((track) => pc.addTrack(track, stream));

            // Create offer
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            socket.emit('offer', {
              targetSocketId: peer.socketId,
              callerSocketId: socket.id,
              sdp: offer,
            });
          }
        });

        // Event from socket.js: user-joined (informational when partner enters)
        socket.on('user-joined', (newcomer: any) => {
          console.log('[SocketWebRTC] Partner joined room:', newcomer);
          soundEffects.playPop();
          setRemoteUser({
            name: newcomer.userName || 'Partner',
            audioEnabled: newcomer.audioEnabled !== false,
            videoEnabled: newcomer.videoEnabled !== false,
          });
          setStatusMessage('');
        });

        // Event from socket.js: offer (receive caller's offer, create answer)
        socket.on('offer', async ({ callerSocketId, sdp, callerUser }: any) => {
          console.log('[SocketWebRTC] Received offer from:', callerSocketId);
          if (callerUser) {
            setRemoteUser({
              name: callerUser.userName || 'Partner',
              audioEnabled: callerUser.audioEnabled !== false,
              videoEnabled: callerUser.videoEnabled !== false,
            });
          }

          let pc = peerConnectionsRef.current.get(callerSocketId);
          if (!pc) {
            const newPc = createPeerConnection(callerSocketId);
            peerConnectionsRef.current.set(callerSocketId, newPc);
            stream.getTracks().forEach((track) => newPc.addTrack(track, stream));
            pc = newPc;
          }

          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          socket.emit('answer', {
            targetSocketId: callerSocketId,
            responderSocketId: socket.id,
            sdp: answer,
          });
        });

        // Event from socket.js: answer (receive responder's answer)
        socket.on('answer', async ({ responderSocketId, sdp }: any) => {
          console.log('[SocketWebRTC] Received answer from:', responderSocketId);
          const pc = peerConnectionsRef.current.get(responderSocketId);
          if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          }
        });

        // Event from socket.js: ice-candidate
        socket.on('ice-candidate', async ({ senderSocketId, candidate }: any) => {
          const pc = peerConnectionsRef.current.get(senderSocketId);
          if (pc && candidate) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
              console.warn('[SocketWebRTC] ICE candidate error:', err);
            }
          }
        });

        // Event from socket.js: audio toggle
        socket.on('user-toggled-audio', ({ audioEnabled }: any) => {
          setRemoteUser((prev) => (prev ? { ...prev, audioEnabled } : null));
        });

        // Event from socket.js: video toggle
        socket.on('user-toggled-video', ({ videoEnabled }: any) => {
          setRemoteUser((prev) => (prev ? { ...prev, videoEnabled } : null));
        });

        // Event from socket.js: user-left
        socket.on('user-left', ({ socketId }: any) => {
          console.log('[SocketWebRTC] User left:', socketId);
          const pc = peerConnectionsRef.current.get(socketId);
          if (pc) {
            pc.close();
            peerConnectionsRef.current.delete(socketId);
          }
          setRemoteStream(null);
          setRemoteUser(null);
          setStatusMessage('Partner left the room. Waiting for reconnect…');
        });

        // Event from socket.js: meeting-ended
        socket.on('meeting-ended', ({ message }: any) => {
          alert(message || 'The meeting has been ended.');
          onLeave?.();
        });
      } catch (err) {
        console.error('[SocketWebRTC] Initialization error:', err);
        setStatusMessage('Camera or microphone permission was denied.');
      }
    }

    init();

    return () => {
      isMounted = false;
      // Cleanup streams
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());

      // Cleanup peer connections
      peerConnectionsRef.current.forEach((pc) => pc.close());
      peerConnectionsRef.current.clear();

      // Disconnect socket
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [roomId, userId, userName, isHost, createPeerConnection, onLeave, retryNonce]);

  // Audio Toggle
  const toggleMic = () => {
    if (!localStreamRef.current) return;
    const audioTrack = localStreamRef.current.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      const nextMuted = !audioTrack.enabled;
      setIsAudioMuted(nextMuted);

      if (socketRef.current) {
        socketRef.current.emit('toggle-audio', {
          roomId,
          audioEnabled: !nextMuted,
        });
      }
    }
  };

  // Video Toggle
  const toggleCamera = () => {
    if (!localStreamRef.current) return;
    const videoTrack = localStreamRef.current.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      const nextMuted = !videoTrack.enabled;
      setIsVideoMuted(nextMuted);

      if (socketRef.current) {
        socketRef.current.emit('toggle-video', {
          roomId,
          videoEnabled: !nextMuted,
        });
      }
    }
  };

  // Screen Sharing
  const toggleScreenShare = async () => {
    try {
      if (isScreenSharing && screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
        setIsScreenSharing(false);
        onScreenShareStopped?.();

        // Revert peer connections back to camera video track
        const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
        if (cameraTrack) {
          peerConnectionsRef.current.forEach((pc) => {
            const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
            if (sender) sender.replaceTrack(cameraTrack);
          });
        }
        return;
      }

      // Start screen share
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
        setConnectError('Screen sharing is not supported by this mobile browser.');
        setTimeout(() => setConnectError(null), 5000);
        return;
      }

      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      screenStreamRef.current = screenStream;
      setIsScreenSharing(true);
      onScreenShareStarted?.();

      const screenTrack = screenStream.getVideoTracks()[0];

      // Replace video track in peer connections
      peerConnectionsRef.current.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender && screenTrack) {
          sender.replaceTrack(screenTrack);
        }
      });

      screenTrack.onended = () => {
        setIsScreenSharing(false);
        onScreenShareStopped?.();
        const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
        if (cameraTrack) {
          peerConnectionsRef.current.forEach((pc) => {
            const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
            if (sender) sender.replaceTrack(cameraTrack);
          });
        }
      };
    } catch (err) {
      console.warn('[SocketWebRTC] Screen share cancelled or denied:', err);
    }
  };

  return (
    <div className="w-full h-full relative bg-stone-950 rounded-3xl overflow-hidden border-2 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)] flex flex-col min-h-[380px]">
      {/* Top Header Badge & Custom Controls */}
      <div className="absolute top-3 left-3 right-3 z-30 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-stone-900/80 backdrop-blur-md border border-white/10 text-white font-ui text-xs font-semibold shadow-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                isConnected
                  ? 'bg-emerald-500 animate-pulse'
                  : connectError
                  ? 'bg-rose-500'
                  : 'bg-amber-500'
              }`}
            />
            <span>{isConnected ? 'Socket.IO WebRTC' : connectError ? 'Socket Disconnected' : 'Connecting…'}</span>
          </div>

          <button
            type="button"
            onClick={() => setShowSettingsModal(true)}
            className="p-1.5 rounded-full bg-stone-900/80 hover:bg-stone-800 backdrop-blur-md border border-white/10 text-white/80 hover:text-white transition-all cursor-pointer shadow-xs"
            title="Configure Socket Server URL"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>

          {onSwitchToWebRTC && (
            <button
              type="button"
              onClick={onSwitchToWebRTC}
              className="px-3 py-1 rounded-full bg-emerald-600/90 hover:bg-emerald-500 text-white font-ui text-xs font-semibold border border-emerald-400/30 shadow-xs transition-all cursor-pointer flex items-center gap-1"
            >
              <Video className="w-3 h-3" />
              <span>Built-in WebRTC</span>
            </button>
          )}

          {onSwitchToDaily && (
            <button
              type="button"
              onClick={onSwitchToDaily}
              className="px-3 py-1 rounded-full bg-indigo-600/80 hover:bg-indigo-600 text-white font-ui text-xs font-semibold border border-indigo-400/30 shadow-xs transition-all cursor-pointer"
            >
              Daily.co
            </button>
          )}
        </div>

        {customControls && (
          <div className="pointer-events-auto flex items-center gap-2">
            {customControls}
          </div>
        )}
      </div>

      {/* Main Video Stage */}
      <div className="relative flex-1 w-full bg-stone-950 flex items-center justify-center overflow-hidden">
        {/* Remote Partner Video */}
        {remoteStream ? (
          <div className="w-full h-full relative flex items-center justify-center">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
            <div className="absolute bottom-3 left-3 px-3 py-1 rounded-full bg-stone-900/80 backdrop-blur-md border border-white/10 text-white text-xs font-ui font-semibold flex items-center gap-2">
              <span>{remoteUser?.name || 'Partner'}</span>
              {remoteUser?.audioEnabled === false && (
                <span className="text-rose-400 flex items-center gap-1">
                  <MicOff className="w-3 h-3" /> Muted
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-6 text-center text-stone-400 gap-3 max-w-md">
            <div
              className={`w-16 h-16 rounded-3xl border flex items-center justify-center shadow-md ${
                connectError
                  ? 'bg-rose-950/40 border-rose-500/30 text-rose-400'
                  : 'bg-stone-900 border-white/10 text-stone-300'
              }`}
            >
              {connectError ? (
                <AlertTriangle className="w-8 h-8 text-rose-400 animate-bounce" />
              ) : (
                <Users className="w-8 h-8 text-[var(--accent)] animate-pulse" />
              )}
            </div>
            <div>
              <p className="font-chunky text-base sm:text-lg text-white font-bold">
                {statusMessage || 'Waiting for your partner to join…'}
              </p>
              <p className="font-ui text-xs text-stone-400 mt-1">
                {connectError
                  ? `Active target: ${activeServerUrl || 'none'}`
                  : 'Connected over Socket.IO WebRTC signaling. Video stream connects automatically when partner enters!'}
              </p>

              {connectError && (
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  {onSwitchToWebRTC && (
                    <button
                      type="button"
                      onClick={onSwitchToWebRTC}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-ui text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-md transition-all active:scale-95 animate-pulse"
                    >
                      <Video className="w-3.5 h-3.5" />
                      <span>Switch to Built-in WebRTC Call (Works Everywhere)</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setRetryNonce((n) => n + 1)}
                    className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-ui text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-md transition-all active:scale-95"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Retry</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSettingsModal(true)}
                    className="px-3.5 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-white font-ui text-xs font-bold border border-white/20 flex items-center gap-1.5 cursor-pointer shadow-md transition-all active:scale-95"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    <span>Configure Server</span>
                  </button>
                  {onSwitchToDaily && (
                    <button
                      type="button"
                      onClick={onSwitchToDaily}
                      className="px-3.5 py-2 rounded-xl bg-indigo-600/80 hover:bg-indigo-600 text-white font-ui text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-md transition-all active:scale-95"
                    >
                      <span>Try Daily.co</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Local Webcam Picture-in-Picture (PiP) */}
        <div className="absolute bottom-4 right-4 w-32 sm:w-44 aspect-video rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl bg-stone-900 z-20">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${isVideoMuted ? 'hidden' : ''}`}
          />
          {isVideoMuted && (
            <div className="w-full h-full flex flex-col items-center justify-center bg-stone-900 text-stone-400 text-xs gap-1">
              <VideoOff className="w-5 h-5 text-rose-400" />
              <span>Camera Off</span>
            </div>
          )}
          <div className="absolute bottom-1.5 left-2 px-2 py-0.5 rounded-md bg-stone-950/70 text-white text-[10px] font-ui font-semibold">
            You {isAudioMuted && '(Muted)'}
          </div>
        </div>
      </div>

      {/* Floating Bottom Media Toolbar */}
      <div className="relative z-20 py-3 px-4 bg-stone-900/90 border-t border-white/10 flex items-center justify-center gap-3">
        {/* Mic Toggle */}
        <button
          type="button"
          onClick={toggleMic}
          className={`p-3 rounded-2xl border-2 font-ui text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
            isAudioMuted
              ? 'bg-rose-600/30 text-rose-400 border-rose-500/50 shadow-inner'
              : 'bg-stone-800 text-white border-white/10 hover:bg-stone-700'
          }`}
          title={isAudioMuted ? 'Unmute Microphone' : 'Mute Microphone'}
        >
          {isAudioMuted ? <MicOff className="w-4 h-4 text-rose-400" /> : <Mic className="w-4 h-4" />}
          <span className="hidden sm:inline">{isAudioMuted ? 'Unmute' : 'Mute'}</span>
        </button>

        {/* Camera Toggle */}
        <button
          type="button"
          onClick={toggleCamera}
          className={`p-3 rounded-2xl border-2 font-ui text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
            isVideoMuted
              ? 'bg-rose-600/30 text-rose-400 border-rose-500/50 shadow-inner'
              : 'bg-stone-800 text-white border-white/10 hover:bg-stone-700'
          }`}
          title={isVideoMuted ? 'Turn Camera On' : 'Turn Camera Off'}
        >
          {isVideoMuted ? <VideoOff className="w-4 h-4 text-rose-400" /> : <Video className="w-4 h-4" />}
          <span className="hidden sm:inline">{isVideoMuted ? 'Camera Off' : 'Camera On'}</span>
        </button>

        {/* Screen Share */}
        <button
          type="button"
          onClick={toggleScreenShare}
          className={`p-3 rounded-2xl border-2 font-ui text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
            isScreenSharing
              ? 'bg-indigo-600 text-white border-indigo-500 shadow-md animate-pulse'
              : 'bg-stone-800 text-white border-white/10 hover:bg-stone-700'
          }`}
          title={isScreenSharing ? 'Stop Screen Share' : 'Share Screen'}
        >
          <MonitorUp className="w-4 h-4" />
          <span className="hidden sm:inline">{isScreenSharing ? 'Sharing Screen' : 'Share Screen'}</span>
        </button>

        {/* Leave Room Button */}
        <button
          type="button"
          onClick={onLeave}
          className="p-3 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-ui text-xs font-bold flex items-center gap-1.5 shadow-md transition-all cursor-pointer active:scale-95"
          title="Leave video call"
        >
          <PhoneOff className="w-4 h-4" />
          <span className="hidden sm:inline">Leave</span>
        </button>
      </div>

      {/* Socket Server Settings Modal */}
      {showSettingsModal && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-stone-900 border border-white/20 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2 text-white">
                <Settings className="w-5 h-5 text-indigo-400" />
                <h3 className="font-chunky text-base font-bold">Socket.IO Server Settings</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="p-1 rounded-xl text-stone-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <p className="font-ui text-xs text-stone-300 leading-relaxed">
                Configure the target URL for live WebRTC signaling, timers, and reactions.
              </p>

              <div>
                <label className="block font-ui text-xs font-bold text-stone-400 uppercase tracking-wider mb-1.5">
                  Server URL
                </label>
                <input
                  type="text"
                  value={urlInputValue}
                  onChange={(e) => setUrlInputValue(e.target.value)}
                  placeholder="http://localhost:3001 or https://your-server.onrender.com"
                  className="w-full px-4 py-2.5 rounded-xl bg-stone-950 border border-white/20 text-white font-ui text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setUrlInputValue('http://localhost:3001')}
                  className="px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 font-ui text-xs border border-white/10 transition-colors cursor-pointer"
                >
                  Localhost (3001)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== 'undefined') {
                      setUrlInputValue(`http://${window.location.hostname}:3001`);
                    }
                  }}
                  className="px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 font-ui text-xs border border-white/10 transition-colors cursor-pointer"
                >
                  Current Host ({typeof window !== 'undefined' ? window.location.hostname : 'host'}:3001)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUrlInputValue('');
                    setCustomSocketServerUrl('');
                    setActiveServerUrl(getSocketServerUrl());
                  }}
                  className="px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-400 font-ui text-xs border border-white/10 transition-colors cursor-pointer"
                >
                  Reset Default
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="px-4 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-white font-ui text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setCustomSocketServerUrl(urlInputValue);
                  const updated = getSocketServerUrl();
                  setActiveServerUrl(updated);
                  setShowSettingsModal(false);
                  setRetryNonce((n) => n + 1);
                }}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-ui text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-md"
              >
                <Check className="w-4 h-4" />
                <span>Save & Connect</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
