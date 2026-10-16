import React, { useState, useEffect, useRef } from 'react';
import {
  Film,
  Moon,
  Sun,
  Sparkles,
  MonitorUp,
  LogOut,
  MessageSquare,
  Send,
} from 'lucide-react';
import {
  createTogetherRoom,
  joinTogetherRoom,
  endTogetherRoom,
  useActiveTogetherRoom,
  useTogetherRoomDoc,
  useTogetherRoomSocket,
} from '../../lib/togetherRooms';
import { useAuthStore } from '../../lib/store';
import { soundEffects, soundManager } from '../../lib/sound';
import { LiveKitMediaRoom } from './LiveKitMediaRoom';
import { SocketVideoRoom } from './SocketVideoRoom';
import { CallRoom } from './CallRoom';
import confetti from 'canvas-confetti';

interface MovieNightViewProps {
  activeSession?: any;
  onSessionEnded?: () => void;
}

type FloatingReaction = { id: string; emoji: string; x: number };

export const MovieNightView: React.FC<MovieNightViewProps> = ({
  activeSession,
  onSessionEnded,
}) => {
  const { currentUser, partnerUser, couple, isDemoMode } = useAuthStore();
  const coupleId =
    !isDemoMode && couple?.id && !couple.id.startsWith('demo')
      ? couple.id
      : 'demo-couple';

  // 1. Durable Firestore room tracking
  const activeTogetherRoom = useActiveTogetherRoom(coupleId, 'movie');
  const activeRoomId = activeTogetherRoom?.roomId || (activeSession?.id ? String(activeSession.id) : null);
  const { room: durableRoom } = useTogetherRoomDoc(activeRoomId);
  const currentRoom = durableRoom || activeTogetherRoom;

  // 2. Real-time Socket.IO room coordination
  const {
    isConnected: isSocketConnected,
    isReconnecting: isSocketReconnecting,
    shareOwnerUid,
    claimScreenShare,
    releaseScreenShare,
    recentReactions,
    sendReaction: socketSendReaction,
    messages,
    sendRoomMessage,
  } = useTogetherRoomSocket(activeRoomId, currentRoom);

  // Local state for setup
  const [isStarting, setIsStarting] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [movieTitleInput, setMovieTitleInput] = useState('SCREEN TIME: ABSOLUTE CINEMA 🍿');
  const [cinemaMode, setCinemaMode] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [mode, setMode] = useState<'screen' | 'synced'>('screen');
  const [sourceUrl, setSourceUrl] = useState('');
  const [queue, setQueue] = useState<string[]>([]);

  // LiveKit join data
  const [livekitData, setLivekitData] = useState<{
    serverUrl: string;
    token: string;
    roomName: string;
    displayName: string;
  } | null>(null);
  const [isJoined, setIsJoined] = useState(false);
  const [callType, setCallType] = useState<'livekit' | 'socket' | 'webrtc'>('livekit');

  // Floating Reactions
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);

  const handleJoinRoom = async (roomIdToJoin?: string) => {
    const targetRoomId = roomIdToJoin || currentRoom?.roomId;
    if (!targetRoomId || isJoined) return;
    try {
      setIsJoining(true);
      soundEffects.playPop();
      const res = await joinTogetherRoom(targetRoomId);
      setLivekitData({
        serverUrl: res.serverUrl,
        token: res.token,
        roomName: res.roomName,
        displayName: currentUser.displayName || 'Partner',
      });
      setCallType(res.token ? 'livekit' : 'webrtc');
      setIsJoined(true);
    } catch (err) {
      console.error('[MovieNight] Error joining room:', err);
      setCallType('webrtc');
      setIsJoined(true);
    } finally {
      setIsJoining(false);
    }
  };

  // Auto join room if active
  useEffect(() => {
    if (currentRoom && currentRoom.status !== 'ended' && !isJoined && !isJoining) {
      handleJoinRoom(currentRoom.roomId);
    }
  }, [currentRoom?.roomId, currentRoom?.status, isJoined]);

  // Sync incoming Socket.IO reactions to floating emojis
  const lastReactionIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (recentReactions.length > 0) {
      const latest = recentReactions[recentReactions.length - 1];
      if (latest && latest.id !== lastReactionIdRef.current) {
        lastReactionIdRef.current = latest.id;
        const reaction: FloatingReaction = {
          id: latest.id,
          emoji: latest.emoji,
          x: 20 + Math.random() * 60,
        };
        setReactions((items) => [...items, reaction]);
        window.setTimeout(() => {
          setReactions((items) => items.filter((item) => item.id !== reaction.id));
        }, 2500);

        if (latest.uid !== currentUser.id) {
          soundEffects.playPop();
          confetti({
            particleCount: 25,
            spread: 50,
            origin: { x: 0.5, y: 0.7 },
          });
        }
      }
    }
  }, [recentReactions, currentUser.id]);

  // Send reaction via Socket.IO
  const sendReaction = (emoji: string) => {
    soundEffects.playPop();
    const localId = `local-${Date.now()}-${Math.random()}`;
    const reaction = {
      id: localId,
      emoji,
      x: 20 + Math.random() * 60,
    };
    setReactions((items) => [...items, reaction]);
    window.setTimeout(() => {
      setReactions((items) => items.filter((item) => item.id !== reaction.id));
    }, 2500);

    socketSendReaction(emoji);
  };

  // Start new Movie Room (or join if already active)
  const handleStartSession = async () => {
    try {
      setIsStarting(true);
      soundEffects.playPop();
      if (currentRoom && currentRoom.status !== 'ended') {
        await handleJoinRoom(currentRoom.roomId);
        return;
      }
      const res = await createTogetherRoom('movie', movieTitleInput.trim());
      setLivekitData({
        serverUrl: res.serverUrl,
        token: res.token,
        roomName: res.roomName,
        displayName: currentUser.displayName || 'Partner',
      });
      setCallType(res.token ? 'livekit' : 'webrtc');
      setIsJoined(true);
    } catch (err) {
      console.error('[MovieNight] Error starting movie room:', err);
      setCallType('webrtc');
      setIsJoined(true);
    } finally {
      setIsStarting(false);
    }
  };

  const handleLeaveRoom = () => {
    soundManager.playPing();
    setIsJoined(false);
    setLivekitData(null);
  };

  const handleEndSession = async () => {
    soundEffects.playPop();
    if (activeRoomId) {
      await endTogetherRoom(activeRoomId);
    }
    handleLeaveRoom();
    onSessionEnded?.();
  };

  const handleSendChatMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    sendRoomMessage(chatInput.trim());
    setChatInput('');
  };

  // Phase 7: Screen share ownership coordination
  const isPartnerSharing = Boolean(shareOwnerUid && shareOwnerUid !== currentUser.id);
  const screenShareNotice = isPartnerSharing
    ? `${partnerUser.displayName || 'Partner'} is sharing screen 📺`
    : null;

  // If an active room exists and user is not joined: Show "Join Partner" Hero Card
  if (currentRoom && currentRoom.status !== 'ended' && !isJoined) {
    const hostName = (currentRoom as any).hostName || (currentRoom.hostUid === currentUser.id ? 'You' : partnerUser.displayName || 'Partner');
    const isFromPartner = currentRoom.hostUid !== currentUser.id;

    return (
      <div className="w-full max-w-2xl mx-auto bg-[var(--surface)] border-3 border-[var(--border)] rounded-3xl p-6 sm:p-8 shadow-[0_4px_0_var(--shadow-color)] relative overflow-hidden space-y-6 animate-in fade-in duration-300">
        <div className="absolute top-0 left-0 right-0 h-2 bg-rose-500" />

        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-rose-500/20 text-rose-500 border-2 border-[var(--border)] flex items-center justify-center p-3 shrink-0 shadow-[0_2px_0_var(--shadow-color)]">
            <Film className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-ui text-xs font-bold">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Theater Open & Live</span>
              </span>
            </div>
            <h3 className="font-chunky text-2xl font-bold text-[var(--text)] mt-1">
              {isFromPartner ? `${hostName} started Movie Night! 🍿` : 'Your Movie Night is Live!'}
            </h3>
            <p className="font-ui text-xs text-[var(--text-muted)] mt-0.5">
              {isFromPartner
                ? `Join ${hostName} for screen sharing, synced video, and cozy vibes.`
                : 'Waiting for your partner to join the theater.'}
            </p>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] space-y-2">
          <div className="flex items-center justify-between text-xs font-ui">
            <span className="text-[var(--text-muted)] font-semibold">LiveKit Room:</span>
            <span className="font-mono font-bold text-rose-500">{currentRoom.roomName || `duo-${coupleId}-movie`}</span>
          </div>
          <div className="flex items-center justify-between text-xs font-ui">
            <span className="text-[var(--text-muted)] font-semibold">Movie / Stream:</span>
            <span className="font-bold text-[var(--text)]">{currentRoom.movie?.title || movieTitleInput}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => handleJoinRoom(currentRoom.roomId)}
          disabled={isJoining}
          className="w-full py-4 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-chunky font-bold text-base border-2 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)] active:translate-y-1 active:shadow-none transition-all cursor-pointer flex items-center justify-center gap-2"
        >
          <Sparkles className="w-5 h-5 fill-current animate-pulse" />
          <span>{isJoining ? 'Entering Theater…' : isFromPartner ? `Join ${hostName}'s Theater 🍿` : 'Enter Theater 🚪'}</span>
        </button>
      </div>
    );
  }

  // If no session is open and not joined: Show Start Card
  if ((!currentRoom || currentRoom.status === 'ended') && !isJoined) {
    return (
      <div className="w-full bg-[var(--surface)] border-3 border-[var(--border)] rounded-3xl p-6 sm:p-8 shadow-[0_4px_0_var(--shadow-color)] relative overflow-hidden space-y-6">
        <div className="absolute top-0 left-0 right-0 h-2 bg-rose-500" />

        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-500 border-2 border-[var(--border)] flex items-center justify-center p-2.5">
            <Film className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-chunky text-2xl font-bold text-[var(--text)]">
              Movie Night & Screen Party
            </h3>
            <p className="font-ui text-xs text-[var(--text-muted)] mt-0.5">
              Watch movies, shows, and videos together with Daily audio, video, and tab screen sharing.
            </p>
          </div>
        </div>

        <div className="space-y-4 pt-2">
          <div>
            <label className="block font-ui text-xs font-bold text-[var(--text)] uppercase tracking-wider mb-2">
              Ticket Stub / Tonight's Watch
            </label>
            <input
              type="text"
              value={movieTitleInput}
              onChange={(e) => setMovieTitleInput(e.target.value)}
              placeholder="e.g. Studio Ghibli Marathon, Spider-Man, Anime Night"
              className="w-full px-4 py-3 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] text-[var(--text)] font-romantic text-lg focus:outline-none focus:border-rose-500 transition-colors"
            />
          </div>

          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-[var(--text)] space-y-1">
            <p className="font-chunky text-xs font-bold flex items-center gap-1.5 text-rose-500">
              <Sparkles className="w-3.5 h-3.5" />
              <span>How Movie Night Works</span>
            </p>
            <p className="font-ui text-xs text-[var(--text-muted)] leading-relaxed">
              One partner shares their browser tab with "Share tab audio" checked. The other partner watches prominently with webcam & reactions alongside!
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleStartSession}
          disabled={isStarting}
          className="w-full py-4 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-chunky font-bold text-base border-2 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)] active:translate-y-1 active:shadow-none transition-all cursor-pointer flex items-center justify-center gap-2"
        >
          <Film className="w-5 h-5 fill-current" />
          <span>{isStarting ? 'Setting up Theater…' : 'Start Movie Night'}</span>
        </button>
      </div>
    );
  }

  // Active Movie Session
  return (
    <div
      className={`w-full space-y-6 animate-in fade-in duration-300 relative ${
        cinemaMode ? 'bg-stone-950/90 -m-4 p-4 rounded-3xl' : ''
      }`}
    >
      {/* Floating Reaction Overlay */}
      <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
        {reactions.map((r) => (
          <div
            key={r.id}
            style={{ left: `${r.x}%` }}
            className="absolute bottom-20 text-4xl animate-in slide-in-from-bottom duration-1000 fade-out-50 transform -translate-x-1/2"
          >
            {r.emoji}
          </div>
        ))}
      </div>

      {/* Top Header Card */}
      <div className="w-full bg-[var(--surface)] border-2 border-[var(--border)] rounded-3xl p-4 sm:p-5 shadow-[0_4px_0_var(--shadow-color)] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-rose-500/20 text-rose-500 border border-rose-500/30 flex items-center justify-center p-2">
            <Film className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-ui text-[10px] font-bold uppercase tracking-widest text-rose-500">
                Admission for Two · Live
              </p>
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--surface-2)] border border-[var(--border)] text-[10px] font-ui">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isSocketConnected
                      ? 'bg-emerald-500 animate-pulse'
                      : isSocketReconnecting
                      ? 'bg-amber-500 animate-spin'
                      : 'bg-stone-400'
                  }`}
                />
                <span className="text-[var(--text-muted)] font-medium">
                  {isSocketConnected ? 'Live Synced' : isSocketReconnecting ? 'Reconnecting…' : 'Connecting…'}
                </span>
              </div>
            </div>
            <h3 className="font-romantic text-xl text-[var(--text)]">
              {currentRoom?.movie?.title || movieTitleInput}
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Cinema mode toggle */}
          <button
            type="button"
            onClick={() => setCinemaMode(!cinemaMode)}
            className={`p-2.5 rounded-xl border-2 font-ui text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              cinemaMode
                ? 'bg-amber-400 text-stone-950 border-amber-500 shadow-xs'
                : 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--border)]'
            }`}
            title="Toggle Cinema Dimming Mode"
          >
            {cinemaMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            <span className="hidden sm:inline">{cinemaMode ? 'Normal Mode' : 'Cinema Mode'}</span>
          </button>

          <button
            type="button"
            onClick={handleEndSession}
            className="p-2.5 px-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-chunky font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
            title="End Movie Night for both"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">End Night</span>
          </button>
        </div>
      </div>

      {/* LiveKit Cloud Video Area */}
      {livekitData && isJoined ? (
        <div className="w-full min-h-[calc(100dvh-13rem)] lg:h-[calc(100dvh-13rem)] lg:grid lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,1fr)] gap-4 sm:gap-6 items-stretch">
          {/* LEFT: Live Video Theater Frame */}
          <div className="w-full flex flex-col gap-2 min-w-0">
            {/* Screenshare instruction banner */}
            <div className="px-4 py-2.5 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-between text-xs font-ui text-[var(--text)]">
              <span className="flex items-center gap-1.5">
                <MonitorUp className="w-4 h-4 text-indigo-400 shrink-0" />
                <span>
                  <strong>Screen Share Movie:</strong> Click screen share in the frame below to stream your tab.
                </span>
              </span>
            </div>

            <div className="w-full h-[clamp(360px,62dvh,760px)] lg:h-full lg:sticky lg:top-2 min-h-0">
              {callType === 'livekit' ? (
                <LiveKitMediaRoom
                  serverUrl={livekitData.serverUrl}
                  token={livekitData.token}
                  roomName={livekitData.roomName}
                  displayName={livekitData.displayName}
                  type="movie"
                  onLeave={handleLeaveRoom}
                  onSwitchToWebRTC={() => setCallType('webrtc')}
                  onBeforeScreenShare={claimScreenShare}
                  onScreenShareStopped={releaseScreenShare}
                  screenShareNotice={screenShareNotice}
                  customControls={
                    <button
                      type="button"
                      onClick={handleEndSession}
                      className="px-3 py-1.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white font-ui text-xs font-bold shadow-md cursor-pointer flex items-center gap-1.5"
                      title="End movie session for both partners"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">End Session</span>
                    </button>
                  }
                />
              ) : callType === 'socket' ? (
                <SocketVideoRoom
                  roomId={activeRoomId || currentRoom?.roomId || 'movie-duo'}
                  userId={currentUser.id}
                  userName={currentUser.displayName || 'Partner'}
                  isHost={currentRoom?.hostUid === currentUser.id}
                  onLeave={handleLeaveRoom}
                  onSwitchToWebRTC={() => setCallType('webrtc')}
                  onScreenShareStarted={claimScreenShare}
                  onScreenShareStopped={releaseScreenShare}
                  customControls={
                    <button
                      type="button"
                      onClick={handleEndSession}
                      className="px-3 py-1.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white font-ui text-xs font-bold shadow-md cursor-pointer flex items-center gap-1.5"
                      title="End movie session for both partners"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">End Session</span>
                    </button>
                  }
                />
              ) : (
                <div className="w-full h-full flex flex-col gap-2">
                  <div className="flex items-center justify-between px-3 py-1 rounded-xl bg-[var(--surface)] border border-[var(--border)]">
                    <span className="font-ui text-xs font-semibold text-emerald-500 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      Built-in Duo WebRTC Call
                    </span>
                    <button
                      type="button"
                      onClick={() => setCallType('socket')}
                      className="text-xs font-ui text-[var(--accent)] hover:underline cursor-pointer font-bold"
                    >
                      Switch to Socket.IO Call
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    <CallRoom
                      kind="movie"
                      title="Movie Night 🍿"
                      subtitle={currentRoom?.movie?.title || movieTitleInput}
                      onLeave={handleLeaveRoom}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Live Reactions, Mode Switcher, and Synced Whispers/Chat */}
          <div className="w-full h-full flex flex-col gap-4 mt-4 lg:mt-0 min-w-0 overflow-y-auto overscroll-contain pr-1">
            {/* Live Reactions Bar */}
            <div className="bg-[var(--surface)] border-2 border-[var(--border)] rounded-3xl p-4 shadow-[0_2px_0_var(--shadow-color)] space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-ui text-xs font-bold text-[var(--text)] flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>Send Live Reaction:</span>
                </span>
                <span className="text-[11px] font-ui text-[var(--text-muted)]">Floats on partner's screen</span>
              </div>
              <div className="grid grid-cols-6 gap-2">
                {[
                  { emoji: '🍿', label: 'Popcorn' },
                  { emoji: '💖', label: 'Love' },
                  { emoji: '😂', label: 'Laugh' },
                  { emoji: '😱', label: 'Shocked' },
                  { emoji: '🥺', label: 'Aww' },
                  { emoji: '🔥', label: 'Fire' },
                ].map((em) => (
                  <button
                    key={em.emoji}
                    type="button"
                    onClick={() => sendReaction(em.emoji)}
                    className="h-12 rounded-2xl bg-[var(--surface-2)] hover:bg-[var(--accent)]/30 border border-[var(--border)] text-2xl flex items-center justify-center transition-transform active:scale-125 cursor-pointer shadow-2xs"
                    title={em.label}
                  >
                    {em.emoji}
                  </button>
                ))}
              </div>
            </div>

            {/* Mode Switcher */}
            <div className="bg-[var(--surface)] border-2 border-[var(--border)] rounded-3xl p-4 shadow-[0_2px_0_var(--shadow-color)] space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-ui text-xs font-bold text-[var(--text)]">Playback Mode:</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMode('screen')}
                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-chunky font-bold border-2 transition-all cursor-pointer text-center ${
                    mode === 'screen'
                      ? 'bg-rose-600 text-white border-rose-700 shadow-xs'
                      : 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--border)]'
                  }`}
                >
                  Screen Share
                </button>

                <button
                  type="button"
                  onClick={() => setMode('synced')}
                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-chunky font-bold border-2 transition-all cursor-pointer text-center ${
                    mode === 'synced'
                      ? 'bg-rose-600 text-white border-rose-700 shadow-xs'
                      : 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--border)]'
                  }`}
                >
                  Synced Link Fallback
                </button>
              </div>

              {/* Screen Sharing Tip Alert */}
              {mode === 'screen' && (
                <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-[var(--text)] flex items-start gap-2.5 text-xs">
                  <MonitorUp className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="font-ui leading-relaxed">
                    <strong className="text-amber-500">Audio tip:</strong> When browser asks what to share, pick a <strong>Browser Tab</strong> and check <strong className="underline">"Also share tab audio"</strong>.
                  </p>
                </div>
              )}

              {/* Synced Player Input Mode */}
              {mode === 'synced' && (
                <div className="space-y-2 pt-1">
                  <p className="font-ui text-xs text-[var(--text-muted)]">
                    Paste a direct MP4, WebM, or video link:
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={sourceUrl}
                      onChange={(e) => setSourceUrl(e.target.value)}
                      placeholder="https://example.com/movie.mp4"
                      className="flex-1 px-3 py-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-xs text-[var(--text)] outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (sourceUrl.trim()) {
                          setQueue((q) => [...q, sourceUrl.trim()]);
                          setSourceUrl('');
                        }
                      }}
                      className="px-3 py-2 rounded-xl bg-rose-600 text-white font-chunky font-bold text-xs shrink-0 cursor-pointer"
                    >
                      Queue
                    </button>
                  </div>
                  {queue.length > 0 && (
                    <p className="font-ui text-xs text-[var(--text-muted)]">
                      Queue: {queue.join(' · ')}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* In-Room Movie Whispers & Chat */}
            <div className="bg-[var(--surface)] border-2 border-[var(--border)] rounded-3xl p-4 shadow-[0_2px_0_var(--shadow-color)] flex flex-col gap-3 min-h-[220px]">
              <div className="flex items-center justify-between pb-1 border-b border-[var(--border)]">
                <span className="font-ui text-xs font-bold text-[var(--text)] flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-rose-500" />
                  <span>Movie Whispers & Chat</span>
                </span>
                <span className="text-[10px] font-ui text-[var(--text-muted)]">
                  {messages.length} {messages.length === 1 ? 'message' : 'messages'}
                </span>
              </div>

              {/* Message history */}
              <div className="flex-1 max-h-48 overflow-y-auto space-y-2 pr-1 text-xs">
                {messages.length === 0 ? (
                  <p className="text-[11px] font-ui text-[var(--text-muted)] italic text-center py-4">
                    Send a whisper or funny thought while watching 🍿
                  </p>
                ) : (
                  messages.map((m) => {
                    const isMe = m.senderId === currentUser.id;
                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                      >
                        <div
                          className={`max-w-[85%] px-3 py-1.5 rounded-2xl text-xs font-ui ${
                            isMe
                              ? 'bg-rose-600 text-white rounded-br-none'
                              : 'bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] rounded-bl-none'
                          }`}
                        >
                          {!isMe && (
                            <span className="text-[10px] font-bold block text-rose-400 mb-0.5">
                              {m.senderName}
                            </span>
                          )}
                          <p className="break-words">{m.text}</p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Input box */}
              <form onSubmit={handleSendChatMessage} className="flex gap-2 pt-1">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Whisper something..."
                  className="flex-1 px-3 py-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-xs text-[var(--text)] outline-none focus:border-rose-500"
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim()}
                  className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white cursor-pointer font-bold flex items-center justify-center shadow-xs"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : (
        <div className="w-full bg-[var(--surface)] border-3 border-[var(--border)] rounded-3xl p-6 text-center space-y-4 shadow-[0_4px_0_var(--shadow-color)]">
          <p className="font-chunky text-lg text-[var(--text)]">
            Movie Night is open: "{currentRoom?.movie?.title || 'Screen Party'}"
          </p>
          <button
            type="button"
            onClick={() => {
              if (currentRoom) {
                joinTogetherRoom(currentRoom.roomId).then((res) => {
                  setLivekitData({
                    roomName: res.roomName,
                    token: res.token,
                    serverUrl: res.serverUrl,
                    displayName: currentUser.displayName || 'Partner',
                  });
                  setCallType(res.token ? 'livekit' : 'webrtc');
                  setIsJoined(true);
                });
              }
            }}
            className="px-6 py-3 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-chunky font-bold text-sm border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] cursor-pointer"
          >
            Enter Movie Theater 🍿
          </button>
        </div>
      )}
    </div>
  );
};
