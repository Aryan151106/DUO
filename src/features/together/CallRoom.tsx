import React, { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Hand, Mic, MicOff, MonitorUp, PhoneOff, Settings2, Sparkles, Users, Video } from 'lucide-react';
import { useAuthStore, useCallStore } from '../../lib/store';
import { broadcastEvent, duoBroadcast } from '../../lib/supabase';
import { callSignaling } from '../../lib/callSignaling';
import { soundEffects } from '../../lib/sound';
import { sendMessage } from '../../lib/firestore';

export type CallRoomKind = 'study' | 'movie';

interface CallRoomProps {
  kind: CallRoomKind;
  title: string;
  subtitle: string;
  activity?: React.ReactNode;
  onLeave?: () => void;
}

type Reaction = { id: string; emoji: string; x: number };

export const CallRoom: React.FC<CallRoomProps> = ({ kind, title, subtitle, activity, onLeave }) => {
  const { currentUser, partnerUser, couple, isDemoMode } = useAuthStore();
  const { callState, localStream, remoteStream, isMuted, isCameraOff, startCall, endCall, toggleMute, toggleCamera } = useCallStore();
  const [lobby, setLobby] = useState(callState === 'idle' || callState === 'outgoing');
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [panel, setPanel] = useState<'people' | 'chat' | 'activities' | null>(null);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [status, setStatus] = useState('');
  const previewRef = useRef<HTMLVideoElement>(null);
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (callState === 'active') setLobby(false);
    if (callState === 'idle' || callState === 'ended') setLobby(true);
  }, [callState]);

  useEffect(() => {
    if (previewRef.current) previewRef.current.srcObject = previewStream;
  }, [previewStream]);
  useEffect(() => {
    if (localRef.current) localRef.current.srcObject = localStream;
  }, [localStream]);
  useEffect(() => {
    if (remoteRef.current) {
      remoteRef.current.srcObject = remoteStream;
      remoteRef.current.play().catch(() => {});
    }
  }, [remoteStream]);

  useEffect(() => {
    const channel = duoBroadcast;
    if (!channel || !couple?.id) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data?.coupleId !== couple.id || data.senderId === currentUser.id) return;
      if (data.type === 'CINEMA_REACTION' && data.payload?.room === kind) {
        const reaction = { id: `remote-${Date.now()}`, emoji: data.payload.emoji, x: 20 + Math.random() * 60 };
        setReactions((items) => [...items, reaction]);
        window.setTimeout(() => setReactions((items) => items.filter((item) => item.id !== reaction.id)), 2600);
      }
      if (data.type === 'FOCUS_UPDATE' && kind === 'study' && data.payload?.room === kind) {
        setStatus(`${data.payload.startedBy || partnerUser.displayName} updated the shared timer`);
      }
    };
    channel.addEventListener('message', onMessage);
    return () => channel.removeEventListener('message', onMessage);
  }, [couple?.id, currentUser.id, kind, partnerUser.displayName]);

  useEffect(() => {
    return () => {
      previewStream?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [previewStream]);

  const prepareLobby = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: cameraEnabled,
        audio: micEnabled,
      });
      setPreviewStream(stream);
      setStatus('');
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      setStatus(name === 'NotAllowedError' ? 'Camera or microphone permission was denied. You can still join with both turned off.' : 'We could not access your camera or microphone.');
    }
  };

  const joinRoom = async () => {
    previewStream?.getTracks().forEach((track) => track.stop());
    setLobby(false);
    setStatus(`Calling ${partnerUser.displayName}…`);
    if (isDemoMode) {
      startCall('video', true);
      return;
    }
    startCall('video', true);
  };

  const leaveRoom = async () => {
    const duration = useCallStore.getState().durationSec;
    const session = callSignaling.getActiveSession();
    await session?.hangup('room-leave').catch(() => {});
    endCall('room-leave');
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setScreenSharing(false);
    if (couple?.id && duration > 0) {
      await sendMessage(couple.id, {
        senderId: currentUser.id,
        content: `Video call ended (${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')})`,
        messageType: 'call_card',
        metadata: { callDuration: `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`, callType: 'video' },
        status: 'sent',
      }).catch(() => {});
    }
    onLeave?.();
  };

  const toggleScreenShare = async () => {
    if (screenStreamRef.current) {
      const cameraTrack = localStream?.getVideoTracks()[0] || null;
      await callSignaling.replaceVideoTrack(cameraTrack);
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
      setScreenSharing(false);
      return;
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      setStatus('Screen sharing is not supported by this mobile browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      screenStreamRef.current = stream;
      await callSignaling.replaceVideoTrack(stream.getVideoTracks()[0]);
      setScreenSharing(true);
      stream.getVideoTracks()[0].onended = () => void toggleScreenShare();
    } catch (error) {
      if ((error as DOMException)?.name !== 'NotAllowedError') setStatus('Screen sharing could not start.');
    }
  };

  const sendReaction = (emoji: string) => {
    const reaction = { id: `${Date.now()}`, emoji, x: 20 + Math.random() * 60 };
    setReactions((items) => [...items, reaction]);
    window.setTimeout(() => setReactions((items) => items.filter((item) => item.id !== reaction.id)), 2600);
    soundEffects.playPop();
    broadcastEvent('CINEMA_REACTION', { emoji, room: kind }, currentUser.id, couple?.id || '');
  };

  const toggleHand = () => {
    setHandRaised((raised) => !raised);
    broadcastEvent('FOCUS_UPDATE', { room: kind, handRaised: !handRaised, startedBy: currentUser.displayName }, currentUser.id, couple?.id || '');
  };

  if (lobby) {
    return (
      <section className="call-room space-y-4">
        <div className="rounded-3xl bg-[var(--surface)] border-2 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)] p-5 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-ui text-xs uppercase tracking-widest text-[var(--partner-a)] font-bold">Google Meet-style room</p>
              <h2 className="font-romantic text-3xl sm:text-4xl text-[var(--text)]">{title}</h2>
              <p className="mt-1 text-sm font-ui text-[var(--text-muted)]">{subtitle}</p>
            </div>
            <div className="rounded-2xl bg-[var(--accent)]/30 p-3 text-[var(--text)]"><Video /></div>
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
            <div className="relative aspect-video overflow-hidden rounded-3xl bg-[#101827] border-2 border-[var(--border)]">
              <video ref={previewRef} autoPlay muted playsInline className={`h-full w-full object-cover ${cameraEnabled ? 'scale-x-[-1]' : 'hidden'}`} />
              {!cameraEnabled && <div className="absolute inset-0 flex items-center justify-center text-5xl text-white">{currentUser.displayName.slice(0, 1)}</div>}
              <span className="absolute bottom-3 left-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white">{currentUser.displayName} (You)</span>
            </div>
            <div className="flex flex-col justify-center gap-3">
              <div className="rounded-2xl bg-[var(--surface-2)] p-4">
                <p className="font-chunky font-bold text-[var(--text)]">Ready to join?</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">Your room is private to you and {partnerUser.displayName}.</p>
              </div>
              {status && <p role="alert" className="rounded-xl bg-[var(--urgent)]/15 p-3 text-xs text-[var(--text)]">{status}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => { setCameraEnabled((enabled) => !enabled); previewStream?.getVideoTracks().forEach((track) => (track.enabled = !cameraEnabled)); }} className="flex-1 rounded-2xl border-2 border-[var(--border)] bg-[var(--surface-2)] p-3 text-[var(--text)]" aria-label="Toggle camera">
                  {cameraEnabled ? <Camera className="mx-auto" /> : <CameraOff className="mx-auto" />}
                </button>
                <button type="button" onClick={() => { setMicEnabled((enabled) => !enabled); previewStream?.getAudioTracks().forEach((track) => (track.enabled = !micEnabled)); }} className="flex-1 rounded-2xl border-2 border-[var(--border)] bg-[var(--surface-2)] p-3 text-[var(--text)]" aria-label="Toggle microphone">
                  {micEnabled ? <Mic className="mx-auto" /> : <MicOff className="mx-auto" />}
                </button>
              </div>
              <button type="button" onClick={prepareLobby} className="rounded-2xl border-2 border-[var(--border)] bg-[var(--surface-2)] p-3 font-chunky text-sm text-[var(--text)]">Check camera & microphone</button>
              <button type="button" onClick={joinRoom} className="rounded-2xl border-2 border-[var(--border)] bg-[var(--partner-a)] p-3 font-chunky font-bold text-white shadow-[0_3px_0_var(--shadow-color)]">Join now</button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="call-room relative space-y-3">
      {status && <div className="rounded-2xl bg-[var(--accent)]/20 px-4 py-2 text-sm font-ui text-[var(--text)]">{status}</div>}
      <div className="relative grid min-h-0 h-full gap-3 overflow-hidden rounded-3xl bg-[#101827] p-3 sm:p-4 lg:grid-cols-2">
        <div className="relative min-h-0 aspect-video overflow-hidden rounded-2xl bg-[#1b2940]">
          <video ref={remoteRef} autoPlay playsInline className={`h-full w-full object-cover ${remoteStream ? '' : 'hidden'}`} />
          {!remoteStream && <div className="absolute inset-0 flex flex-col items-center justify-center text-white"><div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--partner-b)] text-3xl">{partnerUser.displayName.slice(0, 1)}</div><span className="mt-2 text-sm">{partnerUser.displayName}</span></div>}
          <span className="absolute bottom-3 left-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white">{partnerUser.displayName}</span>
        </div>
        <div className="relative min-h-0 aspect-video overflow-hidden rounded-2xl bg-[#182338]">
          <video ref={localRef} autoPlay muted playsInline className={`h-full w-full object-cover ${localStream && !isCameraOff ? 'scale-x-[-1]' : 'hidden'}`} />
          {(isCameraOff || !localStream) && <div className="absolute inset-0 flex items-center justify-center text-4xl text-white">{currentUser.displayName.slice(0, 1)}</div>}
          <span className="absolute bottom-3 left-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white">You</span>
          {handRaised && <span className="absolute right-3 top-3 rounded-full bg-[var(--accent)] px-2 py-1 text-lg">✋</span>}
        </div>
        <div className="pointer-events-none absolute inset-0 overflow-hidden">{reactions.map((reaction) => <span key={reaction.id} className="call-reaction absolute bottom-16 text-3xl" style={{ left: `${reaction.x}%` }}>{reaction.emoji}</span>)}</div>
      </div>
      {activity}
      <div className="flex flex-wrap items-center justify-center gap-2 rounded-3xl bg-[var(--surface)] p-3 border-2 border-[var(--border)] shadow-[0_3px_0_var(--shadow-color)]">
        <button type="button" onClick={toggleMute} className="room-control" aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}>{isMuted ? <MicOff /> : <Mic />}</button>
        <button type="button" onClick={toggleCamera} className="room-control" aria-label={isCameraOff ? 'Turn camera on' : 'Turn camera off'}>{isCameraOff ? <CameraOff /> : <Camera />}</button>
        <button type="button" onClick={toggleScreenShare} className={`room-control ${screenSharing ? 'bg-[var(--accent)]' : ''}`} aria-label="Share screen"><MonitorUp /></button>
        <button type="button" onClick={toggleHand} className={`room-control ${handRaised ? 'bg-[var(--accent)]' : ''}`} aria-label="Raise hand"><Hand /></button>
        {['❤️', '👏', '😂', '🎉', '😮', '👍'].map((emoji) => <button type="button" key={emoji} onClick={() => sendReaction(emoji)} className="room-emoji" aria-label={`Send ${emoji}`}>{emoji}</button>)}
        <button type="button" onClick={() => setPanel(panel === 'people' ? null : 'people')} className="room-control" aria-label="People"><Users /></button>
        <button type="button" onClick={() => setPanel(panel === 'activities' ? null : 'activities')} className="room-control" aria-label="Activities"><Settings2 /></button>
        <button type="button" onClick={leaveRoom} className="room-control bg-[var(--urgent)] text-white" aria-label="Leave call"><PhoneOff /></button>
      </div>
      {panel && <aside className="rounded-3xl border-2 border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--text)] shadow-[0_3px_0_var(--shadow-color)]"><div className="flex items-center gap-2 font-chunky font-bold"><Sparkles className="text-[var(--accent)]" />{panel === 'people' ? 'People' : 'Activities'}</div>{panel === 'people' ? <p className="mt-3 text-sm">{currentUser.displayName} and {partnerUser.displayName}</p> : <div className="mt-3">{activity || <p className="text-sm text-[var(--text-muted)]">Room activities are ready.</p>}</div>}</aside>}
    </section>
  );
};
