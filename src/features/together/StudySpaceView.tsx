import React, { useState, useEffect, useRef } from 'react';
import {
  BookOpen,
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Volume2,
  LogOut,
  User,
  Zap,
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
import { soundManager, soundEffects } from '../../lib/sound';
import { LiveKitMediaRoom } from './LiveKitMediaRoom';
import { SocketVideoRoom } from './SocketVideoRoom';
import { CallRoom } from './CallRoom';
import confetti from 'canvas-confetti';

interface StudySpaceViewProps {
  activeSession?: any;
  onSessionEnded?: () => void;
}

export const StudySpaceView: React.FC<StudySpaceViewProps> = ({
  activeSession,
  onSessionEnded,
}) => {
  const { currentUser, partnerUser, couple, isDemoMode } = useAuthStore();
  const coupleId =
    !isDemoMode && couple?.id && !couple.id.startsWith('demo')
      ? couple.id
      : 'demo-couple';

  // 1. Durable Firestore room tracking
  const activeTogetherRoom = useActiveTogetherRoom(coupleId, 'study');
  const activeRoomId = activeTogetherRoom?.roomId || (activeSession?.id ? String(activeSession.id) : null);
  const { room: durableRoom } = useTogetherRoomDoc(activeRoomId);
  const currentRoom = durableRoom || activeTogetherRoom;

  // 2. Real-time Socket.IO room coordination
  const {
    isConnected: isSocketConnected,
    isReconnecting: isSocketReconnecting,
    studyState: socketStudyState,
    partnerPresent,
    secondsRemaining,
    isTimerRunning,
    recentReactions,
    sendTimerCommand,
    sendReaction,
  } = useTogetherRoomSocket(activeRoomId, currentRoom);

  // Fallback study timer state (Socket.IO override or durable Firestore state)
  const effectiveStudy = socketStudyState || currentRoom?.study || {
    mode: 'focus',
    durationSeconds: 25 * 60,
    startedAt: null,
    pausedRemainingSeconds: 25 * 60,
  };

  const mode = effectiveStudy.mode || 'focus';
  const durationSec = effectiveStudy.durationSeconds || (mode === 'focus' ? 25 * 60 : 5 * 60);

  // Local state for launching a new room
  const [isStarting, setIsStarting] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [taskNameInput, setTaskNameInput] = useState('Deep Work & Cozy Study');
  const [focusMinutes, setFocusMinutes] = useState(25);
  const [breakMinutes, setBreakMinutes] = useState(5);

  const [myStatus, setMyStatus] = useState<'studying' | 'reading' | 'notes' | 'break'>('studying');
  const partnerStatus = partnerPresent ? 'Focusing ✨' : 'Waiting in room…';

  const handleStatusChange = (st: 'studying' | 'reading' | 'notes' | 'break') => {
    soundEffects.playPop();
    setMyStatus(st);
    sendReaction(st === 'break' ? '☕' : '✍️');
  };

  // LiveKit join parameters
  const [livekitData, setLivekitData] = useState<{
    serverUrl: string;
    token: string;
    roomName: string;
    displayName: string;
  } | null>(null);
  const [isJoined, setIsJoined] = useState(false);
  const [callType, setCallType] = useState<'livekit' | 'socket' | 'webrtc'>('livekit');

  // Web Audio Lo-Fi Generator
  const [ambientSound, setAmbientSound] = useState<'none' | 'rain' | 'waves' | 'cafe'>('none');
  const audioContextRef = useRef<AudioContext | null>(null);
  const noiseNodeRef = useRef<AudioNode | null>(null);

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
      console.error('[StudySpace] Error joining room:', err);
      setCallType('webrtc');
      setIsJoined(true);
    } finally {
      setIsJoining(false);
    }
  };

  // Auto-join active room if open
  useEffect(() => {
    if (currentRoom && currentRoom.status !== 'ended' && !isJoined && !isJoining) {
      handleJoinRoom(currentRoom.roomId);
    }
  }, [currentRoom?.roomId, currentRoom?.status, isJoined]);

  // Trigger celebratory confetti when timer hits 0
  const hasTriggeredCompleteRef = useRef(false);
  useEffect(() => {
    if (isTimerRunning && secondsRemaining <= 0 && !hasTriggeredCompleteRef.current) {
      hasTriggeredCompleteRef.current = true;
      soundEffects.playSuccess();
      confetti({ particleCount: 75, spread: 80, origin: { y: 0.6 } });
    } else if (secondsRemaining > 0) {
      hasTriggeredCompleteRef.current = false;
    }
  }, [isTimerRunning, secondsRemaining]);

  // Trigger confetti for incoming floating reactions
  const lastReactionIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (recentReactions.length > 0) {
      const latest = recentReactions[recentReactions.length - 1];
      if (latest && latest.id !== lastReactionIdRef.current && latest.uid !== currentUser.id) {
        lastReactionIdRef.current = latest.id;
        soundEffects.playPop();
        confetti({
          particleCount: 20,
          spread: 45,
          origin: { x: 0.7, y: 0.7 },
        });
      }
    }
  }, [recentReactions, currentUser.id]);

  // Start new Study Space room (or join if already active)
  const handleStartSession = async () => {
    try {
      setIsStarting(true);
      soundEffects.playPop();
      if (currentRoom && currentRoom.status !== 'ended') {
        await handleJoinRoom(currentRoom.roomId);
        return;
      }
      const res = await createTogetherRoom('study', taskNameInput.trim());
      setLivekitData({
        serverUrl: res.serverUrl,
        token: res.token,
        roomName: res.roomName,
        displayName: currentUser.displayName || 'Partner',
      });
      setCallType(res.token ? 'livekit' : 'webrtc');
      setIsJoined(true);
    } catch (err) {
      console.error('[StudySpace] Error starting together room:', err);
      setCallType('webrtc');
      setIsJoined(true);
    } finally {
      setIsStarting(false);
    }
  };

  // Toggle Timer (Phase 6: Server Authoritative Command)
  const handleToggleTimer = () => {
    soundEffects.playPop();
    if (isTimerRunning) {
      sendTimerCommand('pause', mode, durationSec);
    } else {
      sendTimerCommand('start', mode, durationSec);
    }
  };

  // Switch between Focus and Break Mode
  const handleSwitchMode = (nextMode: 'focus' | 'break') => {
    soundEffects.playPop();
    const nextDuration = nextMode === 'focus' ? focusMinutes * 60 : breakMinutes * 60;
    sendTimerCommand('switch-mode', nextMode, nextDuration);
  };

  // Reset Timer
  const handleResetTimer = () => {
    soundManager.playPing();
    sendTimerCommand('reset', mode, durationSec);
  };

  // Leave room (keeps room active for partner)
  const handleLeaveRoom = () => {
    soundManager.playPing();
    setIsJoined(false);
    setLivekitData(null);
    stopAmbientSound();
  };

  // End session for both partners
  const handleEndSession = async () => {
    soundEffects.playPop();
    if (activeRoomId) {
      await endTogetherRoom(activeRoomId);
    }
    handleLeaveRoom();
    onSessionEnded?.();
  };

  // Lo-Fi Web Audio Ambient Synthesis
  const playAmbientSound = (type: 'rain' | 'waves' | 'cafe') => {
    stopAmbientSound();
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;

      // Generate pink/white noise buffer for rain & waves
      const bufferSize = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        data[i] = (b0 + b1 + b2) * 0.1;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;

      const filter = ctx.createBiquadFilter();
      if (type === 'rain') {
        filter.type = 'lowpass';
        filter.frequency.value = 800;
      } else if (type === 'waves') {
        filter.type = 'bandpass';
        filter.frequency.value = 450;
      } else {
        filter.type = 'lowpass';
        filter.frequency.value = 1200;
      }

      const gain = ctx.createGain();
      gain.gain.value = 0.15;

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      noise.start();
      noiseNodeRef.current = noise;
      setAmbientSound(type);
    } catch (e) {
      console.warn('[LoFi] Audio context error:', e);
    }
  };

  const stopAmbientSound = () => {
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (e) {}
      audioContextRef.current = null;
      noiseNodeRef.current = null;
    }
    setAmbientSound('none');
  };

  // If an active room exists and user is not joined: Show "Join Partner" Hero Card
  if (currentRoom && currentRoom.status !== 'ended' && !isJoined) {
    const hostName = (currentRoom as any).hostName || (currentRoom.hostUid === currentUser.id ? 'You' : partnerUser.displayName || 'Partner');
    const isFromPartner = currentRoom.hostUid !== currentUser.id;

    return (
      <div className="w-full max-w-2xl mx-auto bg-[var(--surface)] border-3 border-[var(--border)] rounded-3xl p-6 sm:p-8 shadow-[0_4px_0_var(--shadow-color)] relative overflow-hidden space-y-6 animate-in fade-in duration-300">
        <div className="absolute top-0 left-0 right-0 h-2 bg-indigo-500" />

        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-500/20 text-indigo-500 border-2 border-[var(--border)] flex items-center justify-center p-3 shrink-0 shadow-[0_2px_0_var(--shadow-color)]">
            <BookOpen className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-ui text-xs font-bold">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Live Focus Space</span>
              </span>
            </div>
            <h3 className="font-chunky text-2xl font-bold text-[var(--text)] mt-1">
              {isFromPartner ? `${hostName} is studying right now!` : 'Your Study Space is Live!'}
            </h3>
            <p className="font-ui text-xs text-[var(--text-muted)] mt-0.5">
              {isFromPartner
                ? `Join ${hostName} in the shared focus session.`
                : 'Waiting for your partner to connect.'}
            </p>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] space-y-2">
          <div className="flex items-center justify-between text-xs font-ui">
            <span className="text-[var(--text-muted)] font-semibold">LiveKit Room:</span>
            <span className="font-mono font-bold text-indigo-500">{currentRoom.roomName || `duo-${coupleId}-study`}</span>
          </div>
          <div className="flex items-center justify-between text-xs font-ui">
            <span className="text-[var(--text-muted)] font-semibold">Mode:</span>
            <span className="font-bold text-[var(--text)] capitalize">{currentRoom.study?.mode || 'Focus'}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => handleJoinRoom(currentRoom.roomId)}
          disabled={isJoining}
          className="w-full py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-chunky font-bold text-base border-2 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)] active:translate-y-1 active:shadow-none transition-all cursor-pointer flex items-center justify-center gap-2"
        >
          <Sparkles className="w-5 h-5 fill-current animate-pulse" />
          <span>{isJoining ? 'Connecting to Room…' : isFromPartner ? `Join ${hostName}'s Study Room 🎧` : 'Enter Study Room 🚪'}</span>
        </button>
      </div>
    );
  }

  // If no room is open and not joined: Show Start Card
  if ((!currentRoom || currentRoom.status === 'ended') && !isJoined) {
    return (
      <div className="w-full bg-[var(--surface)] border-3 border-[var(--border)] rounded-3xl p-6 sm:p-8 shadow-[0_4px_0_var(--shadow-color)] relative overflow-hidden space-y-6">
        <div className="absolute top-0 left-0 right-0 h-2 bg-indigo-500" />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 text-indigo-500 border-2 border-[var(--border)] flex items-center justify-center p-2.5">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-chunky text-2xl font-bold text-[var(--text)]">
                Study Space & Dual Focus
              </h3>
              <p className="font-ui text-xs text-[var(--text-muted)] mt-0.5">
                A private body-doubling room for focus sessions, shared timers, and lo-fi vibes.
              </p>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--surface-2)] border border-[var(--border)] font-ui text-xs font-semibold text-[var(--text-muted)]">
            <Zap className={`w-3.5 h-3.5 ${isSocketConnected ? 'text-emerald-500 fill-current' : 'text-amber-500'}`} />
            <span>{isSocketConnected ? 'Socket.IO Ready' : 'Durable Sync'}</span>
          </div>
        </div>

        <div className="space-y-4 pt-2">
          <div>
            <label className="block font-ui text-xs font-bold text-[var(--text)] uppercase tracking-wider mb-2">
              Focus Goal / Topic
            </label>
            <input
              type="text"
              value={taskNameInput}
              onChange={(e) => setTaskNameInput(e.target.value)}
              placeholder="e.g. Preparing for exams, reading, creative writing"
              className="w-full px-4 py-3 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] text-[var(--text)] font-romantic text-lg focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className="block font-ui text-xs font-bold text-[var(--text)] uppercase tracking-wider mb-2">
                Focus Time
              </label>
              <div className="flex gap-1.5">
                {[25, 45, 60].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setFocusMinutes(m)}
                    className={`flex-1 py-2 rounded-xl border-2 font-numeric text-xs font-bold transition-all cursor-pointer ${
                      focusMinutes === m
                        ? 'bg-indigo-600 text-white border-indigo-700 shadow-[0_2px_0_var(--shadow-color)]'
                        : 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--border)]'
                    }`}
                  >
                    {m}m
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block font-ui text-xs font-bold text-[var(--text)] uppercase tracking-wider mb-2">
                Break Time
              </label>
              <div className="flex gap-1.5">
                {[5, 10, 15].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setBreakMinutes(m)}
                    className={`flex-1 py-2 rounded-xl border-2 font-numeric text-xs font-bold transition-all cursor-pointer ${
                      breakMinutes === m
                        ? 'bg-emerald-600 text-white border-emerald-700 shadow-[0_2px_0_var(--shadow-color)]'
                        : 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--border)]'
                    }`}
                  >
                    {m}m
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleStartSession}
          disabled={isStarting}
          className="w-full py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-chunky font-bold text-base border-2 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)] active:translate-y-1 active:shadow-none transition-all cursor-pointer flex items-center justify-center gap-2"
        >
          <Sparkles className="w-5 h-5 fill-current" />
          <span>{isStarting ? 'Creating Room…' : 'Start Study Space'}</span>
        </button>
      </div>
    );
  }

  // Active Session View
  return (
    <div className="w-full animate-in fade-in duration-300 min-w-0">
      {livekitData && isJoined ? (
        <div className="w-full min-h-[calc(100dvh-13rem)] lg:h-[calc(100dvh-13rem)] grid grid-cols-1 lg:grid-cols-[minmax(0,1.25fr)_minmax(340px,1fr)] gap-4 sm:gap-6 items-stretch">
          {/* 1. Video Call Area - Dynamic Screen Height on Desktop */}
          <div className="w-full h-[clamp(360px,62dvh,760px)] lg:h-full lg:sticky lg:top-2 min-h-0">
            {callType === 'livekit' ? (
              <LiveKitMediaRoom
                serverUrl={livekitData.serverUrl}
                token={livekitData.token}
                roomName={livekitData.roomName}
                displayName={livekitData.displayName}
                type="study"
                onLeave={handleLeaveRoom}
                onSwitchToWebRTC={() => setCallType('webrtc')}
                customControls={
                  <button
                    type="button"
                    onClick={handleEndSession}
                    className="px-3 py-1.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white font-ui text-xs font-bold shadow-md cursor-pointer flex items-center gap-1.5"
                    title="End study session for both partners"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">End Session</span>
                  </button>
                }
              />
            ) : callType === 'socket' ? (
              <SocketVideoRoom
                roomId={activeRoomId || currentRoom?.roomId || 'study-duo'}
                userId={currentUser.id}
                userName={currentUser.displayName || 'Partner'}
                isHost={currentRoom?.hostUid === currentUser.id}
                onLeave={handleLeaveRoom}
                onSwitchToWebRTC={() => setCallType('webrtc')}
                customControls={
                  <button
                    type="button"
                    onClick={handleEndSession}
                    className="px-3 py-1.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white font-ui text-xs font-bold shadow-md cursor-pointer flex items-center gap-1.5"
                    title="End study session for both partners"
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
                    kind="study"
                    title="Study Space 📚"
                    subtitle="Focusing together"
                    onLeave={handleLeaveRoom}
                  />
                </div>
              </div>
            )}
          </div>

          {/* 2. Controls Column: Timer + Partner Status + Ambient Lo-Fi + Live Reactions */}
          <div className="w-full h-full space-y-4 min-w-0 overflow-y-auto overscroll-contain pr-1">
            {/* Synchronized Pomodoro & Break Timer */}
            <div className="bg-[var(--surface)] border-3 border-[var(--border)] rounded-3xl p-4 sm:p-5 text-center relative overflow-hidden shadow-[0_4px_0_var(--shadow-color)]">
              {/* Header with Socket.IO Live Status */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 mb-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-3 py-0.5 rounded-full text-xs font-chunky font-bold border-2 ${
                      mode === 'focus'
                        ? 'bg-indigo-500/20 text-indigo-500 border-indigo-500/40'
                        : 'bg-emerald-500/20 text-emerald-500 border-emerald-500/40'
                    }`}
                  >
                    {mode === 'focus' ? '🎯 Focus Mode' : '☕ Break Mode'}
                  </span>
                  <span className="font-ui text-[11px] text-[var(--text-muted)] font-semibold hidden sm:inline flex items-center gap-1">
                    <Zap className={`w-3 h-3 ${isSocketConnected ? 'text-emerald-500 fill-current' : 'text-amber-500'}`} />
                    {isSocketConnected ? 'Live Socket Sync' : isSocketReconnecting ? 'Reconnecting…' : 'Durable'}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleSwitchMode('focus')}
                    className={`px-3 py-1 rounded-xl text-xs font-ui font-bold border cursor-pointer transition-all ${
                      mode === 'focus' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--surface)]'
                    }`}
                  >
                    Focus
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwitchMode('break')}
                    className={`px-3 py-1 rounded-xl text-xs font-ui font-bold border cursor-pointer transition-all ${
                      mode === 'break' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--surface)]'
                    }`}
                  >
                    Break
                  </button>
                </div>
              </div>

              {/* Circular Display */}
              <div className="relative w-40 h-40 sm:w-48 sm:h-48 mx-auto my-1 flex items-center justify-center">
                <svg className="w-full h-full transform -rotate-90">
                  <circle
                    cx="96"
                    cy="96"
                    r="82"
                    className="text-[var(--surface-2)]"
                    strokeWidth="8"
                    stroke="currentColor"
                    fill="transparent"
                  />
                  <circle
                    cx="96"
                    cy="96"
                    r="82"
                    className={mode === 'focus' ? 'text-indigo-500' : 'text-emerald-500'}
                    strokeWidth="8"
                    strokeDasharray={2 * Math.PI * 82}
                    strokeDashoffset={2 * Math.PI * 82 * (1 - Math.max(0, secondsRemaining) / durationSec)}
                    strokeLinecap="round"
                    stroke="currentColor"
                    fill="transparent"
                  />
                </svg>

                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="text-3xl sm:text-4xl font-numeric font-bold tracking-tight text-[var(--text)] tabular-nums">
                    {Math.floor(Math.max(0, secondsRemaining) / 60)
                      .toString()
                      .padStart(2, '0')}
                    :
                    {(Math.max(0, secondsRemaining) % 60).toString().padStart(2, '0')}
                  </div>
                  <div className="font-ui text-[10px] font-semibold text-[var(--text-muted)] mt-0.5">
                    {isTimerRunning ? '✨ Both focusing together ✨' : 'Ready / Tap Play'}
                  </div>
                </div>
              </div>

              {/* Timer Action Buttons */}
              <div className="flex items-center justify-center gap-3 mt-2">
                <button
                  type="button"
                  onClick={handleResetTimer}
                  className="p-2.5 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] text-[var(--text)] hover:opacity-80 shadow-[0_2px_0_var(--shadow-color)] active:translate-y-1 active:shadow-none transition-all cursor-pointer"
                  title="Reset timer"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={handleToggleTimer}
                  className={`px-6 py-2.5 rounded-2xl font-chunky font-bold text-sm text-white border-2 border-[var(--border)] shadow-[0_3px_0_var(--shadow-color)] flex items-center gap-2 active:translate-y-1 active:shadow-none transition-all cursor-pointer ${
                    mode === 'focus' ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-emerald-600 hover:bg-emerald-500'
                  }`}
                >
                  {isTimerRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
                  <span>{isTimerRunning ? 'Pause Timer' : 'Start Timer'}</span>
                </button>
              </div>

              {/* Fast Room Reactions Toolbar */}
              <div className="mt-3 pt-3 border-t border-[var(--border)] flex items-center justify-center gap-2">
                <span className="font-ui text-[11px] font-semibold text-[var(--text-muted)] mr-1">React:</span>
                {['❤️', '☕', '🎯', '🔥', '👏'].map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => sendReaction(emoji)}
                    className="p-1.5 rounded-xl hover:bg-[var(--surface-2)] active:scale-125 transition-transform cursor-pointer text-base"
                    title={`Send ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            {/* Partner Statuses & Ambient Vibes Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Status Badges */}
              <div className="bg-[var(--surface)] border-2 border-[var(--border)] rounded-3xl p-4 shadow-[0_2px_0_var(--shadow-color)] space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="font-chunky text-sm font-bold text-[var(--text)] flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Partner Status</span>
                  </h4>
                  <span className="font-ui text-[10px] text-[var(--text-muted)] font-medium">Live</span>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between p-2 rounded-xl bg-[var(--surface-2)]">
                    <span className="font-ui text-xs font-semibold text-[var(--text)]">
                      {currentUser.displayName || 'You'}:
                    </span>
                    <span className="font-chunky text-xs font-bold text-indigo-600 dark:text-indigo-400 capitalize">
                      {myStatus}
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-xl bg-[var(--surface-2)]">
                    <span className="font-ui text-xs font-semibold text-[var(--text)]">
                      {partnerUser.displayName || 'Partner'}:
                    </span>
                    <span className="font-chunky text-xs font-bold text-indigo-600 dark:text-indigo-400 capitalize">
                      {partnerStatus}
                    </span>
                  </div>
                </div>

                <div className="pt-1">
                  <span className="block font-ui text-[10px] font-bold uppercase text-[var(--text-muted)] mb-1">
                    Your Status:
                  </span>
                  <div className="grid grid-cols-2 gap-1">
                    {[
                      { key: 'studying', label: 'Studying ✍️' },
                      { key: 'reading', label: 'Reading 📖' },
                      { key: 'notes', label: 'Notes 📝' },
                      { key: 'break', label: 'Break ☕' },
                    ].map((st) => (
                      <button
                        key={st.key}
                        type="button"
                        onClick={() => handleStatusChange(st.key as any)}
                        className={`px-2 py-1 rounded-xl border text-[11px] font-ui font-semibold transition-all cursor-pointer text-center ${
                          myStatus === st.key
                            ? 'bg-indigo-600 text-white border-indigo-700'
                            : 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--border)] hover:bg-[var(--surface)]'
                        }`}
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Ambient Vibes */}
              <div className="bg-[var(--surface)] border-2 border-[var(--border)] rounded-3xl p-4 shadow-[0_2px_0_var(--shadow-color)] space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="font-chunky text-sm font-bold text-[var(--text)] flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Lo-Fi Vibes</span>
                  </h4>
                  {ambientSound !== 'none' && (
                    <button
                      type="button"
                      onClick={stopAmbientSound}
                      className="text-xs text-rose-500 font-ui font-bold hover:underline cursor-pointer"
                    >
                      Mute 🔕
                    </button>
                  )}
                </div>

                <p className="font-ui text-[11px] text-[var(--text-muted)] leading-tight">
                  Synthesized offline background soundscapes for deep focus.
                </p>

                <div className="flex flex-col gap-1.5 pt-0.5">
                  {[
                    { key: 'rain', label: 'Rain 🌧️' },
                    { key: 'waves', label: 'Ocean Tide 🌊' },
                    { key: 'cafe', label: 'Cafe Chatter ☕' },
                  ].map((amb) => (
                    <button
                      key={amb.key}
                      type="button"
                      onClick={() => (ambientSound === amb.key ? stopAmbientSound() : playAmbientSound(amb.key as any))}
                      className={`w-full py-2 px-3 rounded-xl border-2 font-chunky text-xs font-bold transition-all cursor-pointer ${
                        ambientSound === amb.key
                          ? 'bg-emerald-600 text-white border-emerald-700 shadow-[0_2px_0_var(--shadow-color)]'
                          : 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--border)] hover:bg-[var(--surface)]'
                      }`}
                    >
                      {amb.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="w-full max-w-2xl mx-auto bg-[var(--surface)] border-3 border-[var(--border)] rounded-3xl p-6 text-center space-y-4 shadow-[0_4px_0_var(--shadow-color)]">
          <p className="font-chunky text-lg text-[var(--text)]">
            Study Space is active: "{currentRoom?.study?.mode === 'break' ? 'Short Break' : 'Focus Session'}"
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
            className="px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-chunky font-bold text-sm border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] cursor-pointer"
          >
            Enter Study Room 🚪
          </button>
        </div>
      )}
    </div>
  );
};
