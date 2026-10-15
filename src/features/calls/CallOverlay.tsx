import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useCallStore, useAuthStore, type CallState } from '../../lib/store';
import { soundEngine } from '../../lib/sounds';
import { callSignaling, type CallDocument } from '../../lib/callSignaling';
import { sendMessage } from '../../lib/firestore';
import { requestCamera, stopMediaStream } from '../../lib/media';
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Maximize2,
  Minimize2,
  RefreshCw,
  AlertCircle,
  ScreenShare,
  ScreenShareOff,
  Lock,
  MessageSquare,
  Move,
  X,
  Volume2,
  VolumeX,
} from 'lucide-react';

const QUICK_DECLINE_MESSAGES = [
  "Can't talk now. Call you later?",
  'In a meeting right now. Text me?',
  "Can't talk right now. What's up?",
  "Can't talk now. Love you! ❤️",
];

export const CallOverlay: React.FC = () => {
  const {
    callState,
    callId,
    callType,
    isCaller,
    localStream,
    remoteStream,
    isMuted,
    isCameraOff,
    durationSec,
    setCallState,
    setLocalStream,
    setRemoteStream,
    endCall,
    toggleMute,
    toggleCamera,
    tickDuration,
    startCall,
  } = useCallStore();

  const { currentUser, partnerUser, couple, isDemoMode } = useAuthStore();

  const [isMinimized, setIsMinimized] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);

  // Floating PiP position state
  const [pipPos, setPipPos] = useState<{ x: number; y: number }>({ x: 20, y: 80 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const pipRemoteVideoRef = useRef<HTMLVideoElement>(null);
  const outgoingPreviewVideoRef = useRef<HTMLVideoElement>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const durationTimerRef = useRef<number | null>(null);
  const ringtoneStopRef = useRef<(() => void) | null>(null);
  const summaryPostedRef = useRef<boolean>(false);

  // 1. GLOBAL REAL-TIME LISTENER FOR INCOMING CALLS
  useEffect(() => {
    if (!couple?.id || !currentUser?.id || isDemoMode) return;

    const unsubscribe = callSignaling.listenForIncomingCalls(
      couple.id,
      currentUser.id,
      (incomingCall: CallDocument) => {
        const currentStore = useCallStore.getState();

        // If this is the call we are already currently handling or in, do not touch it!
        if (incomingCall.id === currentStore.callId) {
          return;
        }

        // If already in another active or outgoing call, ignore
        if (currentStore.callState !== 'idle') {
          return;
        }

        // Trigger Incoming Call state
        startCall(incomingCall.type, false, incomingCall.id);
        setStatusMessage(`Incoming ${incomingCall.type} call from ${incomingCall.callerName || partnerUser.displayName}`);
      }
    );

    return () => unsubscribe();
  }, [couple?.id, currentUser?.id, startCall, partnerUser.displayName]);

  // 1b. Deep-link handler for incoming call push clicks (?action=call&callId=...)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');
    const paramCallId = urlParams.get('callId');
    const paramType = (urlParams.get('callType') as any) || 'video';

    if (action === 'call' && paramCallId && couple?.id) {
      const currentStore = useCallStore.getState();
      if (currentStore.callState === 'idle') {
        startCall(paramType, false, paramCallId);
        setStatusMessage(`Incoming ${paramType} call from ${partnerUser.displayName}`);
        urlParams.delete('action');
        urlParams.delete('callId');
        urlParams.delete('callType');
        const newUrl = `${window.location.pathname}${urlParams.toString() ? `?${urlParams.toString()}` : ''}`;
        window.history.replaceState({}, '', newUrl);
      }
    }
  }, [couple?.id, startCall, partnerUser.displayName]);

  // 2. STOP AUDIO RINGTONE HELPER
  const stopAudioRingtone = useCallback(() => {
    if (ringtoneStopRef.current) {
      ringtoneStopRef.current();
      ringtoneStopRef.current = null;
    }
  }, []);

  // 3. RINGTONE & VIBRATION LIFECYCLE
  useEffect(() => {
    const settings = soundEngine.getSettings();

    if (callState === 'incoming') {
      stopAudioRingtone();
      soundEngine
        .play(settings.incomingRingtoneId || 'ring-heartbeat', {
          category: 'ringtone',
          loop: true,
          force: settings.ringDuringQuietHours,
        })
        .then((handle) => {
          ringtoneStopRef.current = handle.stop;
        });

      if (settings.callVibration !== 'off') {
        const pattern =
          settings.callVibration === 'heartbeat'
            ? [100, 100, 100, 400]
            : settings.callVibration === 'long'
            ? [800, 400]
            : [300, 200, 300, 400];
        soundEngine.vibrate(pattern);
      }
    } else if (callState === 'outgoing') {
      stopAudioRingtone();
      soundEngine
        .play(settings.ringbackToneId || 'ring-classic', {
          category: 'ringtone',
          loop: true,
        })
        .then((handle) => {
          ringtoneStopRef.current = handle.stop;
        });
    } else {
      stopAudioRingtone();
    }

    return () => {
      stopAudioRingtone();
    };
  }, [callState, stopAudioRingtone]);

  // 4. WEBRTC SIGNALING EXECUTION (CALLER)
  useEffect(() => {
    if (callState !== 'outgoing' || !isCaller) return;
    let active = true;

    async function initCallerSession() {
      const spaceId = couple?.id;
      const uid = currentUser?.id;
      if (!spaceId || !uid) return;
      summaryPostedRef.current = false;
      setStatusMessage('Calling...');

      try {
        const { stream, error } = await requestCamera({
          video: callType === 'video',
          audio: true,
          facingMode,
        });

        if (!active) {
          stopMediaStream(stream);
          return;
        }

        if (error || !stream) {
          setCameraError(error?.message || 'Unable to access microphone/camera');
          setCallState('failed');
          return;
        }

        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        if (outgoingPreviewVideoRef.current) {
          outgoingPreviewVideoRef.current.srcObject = stream;
        }

        // In Demo Mode: Simulate quick auto-pickup after 2.5 seconds
        if (isDemoMode) {
          const demoPickupTimer = window.setTimeout(() => {
            if (!active) return;
            setCallState('active');
            stopAudioRingtone();
            setStatusMessage('');
            // Use local stream as simulated remote partner stream for testing
            setRemoteStream(stream);
            setHasRemoteVideo(callType === 'video');
          }, 2500);

          return () => clearTimeout(demoPickupTimer);
        }

        // Authenticated Firestore WebRTC signaling
        const session = await callSignaling.startCall({
          spaceId,
          callerId: uid,
          callerName: currentUser.displayName || 'You',
          calleeId: partnerUser.id,
          calleeName: partnerUser.displayName || 'Vidhi',
          callType,
          localStream: stream,
          onRemoteStream: (remStream) => {
            setRemoteStream(remStream);
            if (remStream.getVideoTracks().length > 0) {
              setHasRemoteVideo(true);
            }
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = remStream;
              remoteVideoRef.current.play().catch(() => {});
            }
            if (remoteAudioRef.current) {
              remoteAudioRef.current.srcObject = remStream;
              remoteAudioRef.current.play().catch(() => {});
            }
            if (pipRemoteVideoRef.current) {
              pipRemoteVideoRef.current.srcObject = remStream;
              pipRemoteVideoRef.current.play().catch(() => {});
            }
          },
          onStatusChange: (status, msg) => {
            if (status === 'accepted') {
              setCallState('active');
              stopAudioRingtone();
              setStatusMessage('');
            } else if (status === 'declined' || status === 'missed' || status === 'busy') {
              setCallState(status as CallState);
              stopAudioRingtone();
              setStatusMessage(msg || `Call ${status}`);
              setTimeout(() => {
                handleCleanHangup(false);
              }, 3000);
            } else if (status === 'failed') {
              stopAudioRingtone();
              setStatusMessage(msg || 'Connection lost. Reconnecting...');
              setTimeout(() => {
                const current = useCallStore.getState().callState;
                if (current !== 'active') {
                  setCallState('failed');
                  setTimeout(() => handleCleanHangup(false), 2500);
                }
              }, 5000);
            } else if (status === 'ended') {
              handleCleanHangup(false);
            }
          },
        });

        if (session && session.callId) {
          useCallStore.setState({ callId: session.callId });
        }
      } catch (err: any) {
        console.error('[CallOverlay] Outgoing call initiation error:', err);
        setCallState('failed');
        setStatusMessage(err?.message || 'Failed to start call');
      }
    }

    initCallerSession();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callState, isCaller, couple?.id, currentUser?.id, callType, facingMode, isDemoMode]);

  // 5. ATTACH STREAMS TO VIDEO ELEMENTS
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch(() => {});
    }
    if (outgoingPreviewVideoRef.current && localStream) {
      outgoingPreviewVideoRef.current.srcObject = localStream;
      outgoingPreviewVideoRef.current.play().catch(() => {});
    }
  }, [localStream, callState]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch(() => {});
    }
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(() => {});
    }
    if (pipRemoteVideoRef.current && remoteStream) {
      pipRemoteVideoRef.current.srcObject = remoteStream;
      pipRemoteVideoRef.current.play().catch(() => {});
    }

    // Monitor remote video tracks
    if (remoteStream) {
      const checkRemoteVideo = () => {
        const vTracks = remoteStream.getVideoTracks();
        const hasLiveTrack = vTracks.some((t) => t.readyState === 'live');
        setHasRemoteVideo(hasLiveTrack || vTracks.length > 0);
      };
      checkRemoteVideo();
      const onAdd = () => checkRemoteVideo();
      remoteStream.addEventListener('addtrack', onAdd);
      remoteStream.addEventListener('removetrack', onAdd);
      return () => {
        remoteStream.removeEventListener('addtrack', onAdd);
        remoteStream.removeEventListener('removetrack', onAdd);
      };
    } else {
      setHasRemoteVideo(false);
    }
  }, [remoteStream, callState, isMinimized]);

  // 6. TRACK MUTING / CAMERA TOGGLES
  useEffect(() => {
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = !isMuted;
      });
    }
  }, [localStream, isMuted]);

  useEffect(() => {
    if (localStream) {
      localStream.getVideoTracks().forEach((track) => {
        track.enabled = !isCameraOff;
      });
    }
  }, [localStream, isCameraOff]);

  useEffect(() => {
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = !isSpeakerOn;
    }
  }, [isSpeakerOn]);

  // 7. CALL DURATION TIMER
  useEffect(() => {
    if (callState === 'active') {
      durationTimerRef.current = window.setInterval(() => {
        tickDuration();
      }, 1000);
    } else {
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }
    }
    return () => {
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    };
  }, [callState, tickDuration]);

  const formatDuration = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins}:${s.toString().padStart(2, '0')}`;
  };

  // 8. SCREEN SHARING TOGGLE (GOOGLE MEET / WHATSAPP DESKTOP STYLE)
  const handleToggleScreenShare = async () => {
    if (isScreenSharing) {
      if (screenStreamRef.current) {
        stopMediaStream(screenStreamRef.current);
        screenStreamRef.current = null;
      }
      setIsScreenSharing(false);

      if (localStream) {
        const cameraTrack = localStream.getVideoTracks()[0] || null;
        await callSignaling.replaceVideoTrack(cameraTrack);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
        }
      }
    } else {
      try {
        if (!navigator.mediaDevices?.getDisplayMedia) {
          alert('Screen sharing is not supported by your current browser.');
          return;
        }

        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });

        screenStreamRef.current = screenStream;
        setIsScreenSharing(true);

        const screenVideoTrack = screenStream.getVideoTracks()[0];
        if (screenVideoTrack) {
          await callSignaling.replaceVideoTrack(screenVideoTrack);

          screenVideoTrack.onended = () => {
            handleToggleScreenShare();
          };

          if (localVideoRef.current) {
            localVideoRef.current.srcObject = screenStream;
          }
        }
      } catch (err: any) {
        if (err.name !== 'NotAllowedError') {
          console.warn('Screen share error:', err);
        }
      }
    }
  };

  // 9. ANSWER HANDLER (CALLEE)
  const handleAnswer = async () => {
    stopAudioRingtone();
    if (!couple?.id || !callId || !currentUser?.id) return;

    try {
      setStatusMessage('Connecting...');

      const { stream, error } = await requestCamera({
        video: callType === 'video',
        audio: true,
        facingMode,
      });

      if (error || !stream) {
        setCameraError(error?.message || 'Unable to access camera/microphone');
        return;
      }

      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch(() => {});
      }

      // Demo mode answer simulation
      if (isDemoMode) {
        setCallState('active');
        setRemoteStream(stream);
        setHasRemoteVideo(callType === 'video');
        setStatusMessage('');
        return;
      }

      // Transition call state to active early so video elements mount in DOM
      setCallState('active');

      if (remoteAudioRef.current) {
        remoteAudioRef.current.play().catch(() => {});
      }

      await callSignaling.answerCall({
        spaceId: couple.id,
        callId,
        userId: currentUser.id,
        localStream: stream,
        onRemoteStream: (remStream) => {
          setRemoteStream(remStream);
          if (remStream.getVideoTracks().length > 0) {
            setHasRemoteVideo(true);
          }
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remStream;
            remoteVideoRef.current.play().catch(() => {});
          }
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = remStream;
            remoteAudioRef.current.play().catch(() => {});
          }
          if (pipRemoteVideoRef.current) {
            pipRemoteVideoRef.current.srcObject = remStream;
            pipRemoteVideoRef.current.play().catch(() => {});
          }
        },
        onStatusChange: (status, msg) => {
          if (status === 'accepted') {
            setCallState('active');
            setStatusMessage('');
          } else if (status === 'ended') {
            setStatusMessage(msg || 'Call ended.');
            handleCleanHangup(false);
          } else if (status === 'failed') {
            setStatusMessage(msg || 'Connection lost. Reconnecting...');
            setTimeout(() => {
              const current = useCallStore.getState().callState;
              if (current !== 'active') {
                handleCleanHangup(false);
              }
            }, 5000);
          }
        },
      });

      setCallState('active');
    } catch (err: any) {
      console.error('[CallOverlay] Answer call error:', err);
      setStatusMessage(err?.message || 'Failed to answer call');
    }
  };

  // 10. DECLINE HANDLER (CALLEE)
  const handleDecline = async (quickMessage?: string) => {
    stopAudioRingtone();
    if (couple?.id && callId && currentUser?.id) {
      await callSignaling.declineCall(couple.id, callId, currentUser.id);

      if (quickMessage) {
        sendMessage(couple.id, {
          senderId: currentUser.id,
          content: quickMessage,
          messageType: 'text',
          status: 'sent',
        }).catch((e) => console.warn('Failed to send quick decline message:', e));
      }
    }
    setShowQuickReplies(false);
    handleCleanHangup(false);
  };

  // 11. CLEAN HANGUP & SUMMARY POSTING
  const handleCleanHangup = async (postSummary: boolean = true) => {
    stopAudioRingtone();

    if (screenStreamRef.current) {
      stopMediaStream(screenStreamRef.current);
      screenStreamRef.current = null;
      setIsScreenSharing(false);
    }

    if (localStream) {
      stopMediaStream(localStream);
      setLocalStream(null);
    }
    if (remoteStream) {
      stopMediaStream(remoteStream);
      setRemoteStream(null);
    }
    setHasRemoteVideo(false);

    const activeSession = callSignaling.getActiveSession();
    if (activeSession) {
      await activeSession.hangup('ended');
      activeSession.cleanup();
    }

    if (postSummary && durationSec > 0 && !summaryPostedRef.current && couple?.id && currentUser?.id) {
      summaryPostedRef.current = true;
      const formatted = formatDuration(durationSec);
      sendMessage(couple.id, {
        senderId: currentUser.id,
        content: `${callType === 'video' ? 'Video' : 'Voice'} call ended (${formatted})`,
        messageType: 'call_card',
        metadata: {
          callDuration: formatted,
          callType,
          durationSec,
        },
        status: 'sent',
      }).catch((e) => console.warn('Failed to post call summary message:', e));
    }

    endCall('hangup');
  };

  const handleSwitchCamera = () => {
    setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'));
  };

  // DRAG HANDLERS FOR FLOATING PiP
  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX - pipPos.x, y: e.clientY - pipPos.y };
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      isDraggingRef.current = true;
      dragStartRef.current = {
        x: e.touches[0].clientX - pipPos.x,
        y: e.touches[0].clientY - pipPos.y,
      };
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const newX = Math.max(10, Math.min(window.innerWidth - 180, e.clientX - dragStartRef.current.x));
      const newY = Math.max(10, Math.min(window.innerHeight - 240, e.clientY - dragStartRef.current.y));
      setPipPos({ x: newX, y: newY });
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDraggingRef.current || e.touches.length === 0) return;
      const touch = e.touches[0];
      const newX = Math.max(10, Math.min(window.innerWidth - 180, touch.clientX - dragStartRef.current.x));
      const newY = Math.max(10, Math.min(window.innerHeight - 240, touch.clientY - dragStartRef.current.y));
      setPipPos({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('touchend', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [pipPos]);

  if (callState === 'idle') return null;

  // 12. WHATSAPP-STYLE DRAGGABLE PICTURE-IN-PICTURE (PiP)
  if (isMinimized && callState === 'active') {
    return (
      <div
        style={{ left: `${pipPos.x}px`, top: `${pipPos.y}px` }}
        className="fixed z-50 w-48 h-64 rounded-3xl bg-[#111b21] border-2 border-white/20 overflow-hidden shadow-2xl flex flex-col cursor-move select-none animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Top PiP Drag Bar */}
        <div
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          className="px-3 py-1.5 bg-[#1f2c34] flex items-center justify-between text-xs font-semibold text-white"
        >
          <div className="flex items-center gap-1.5 truncate">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="truncate">{partnerUser.displayName}</span>
          </div>
          <Move className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
        </div>

        {/* Video / Avatar Viewport */}
        <div className="relative flex-1 bg-black overflow-hidden flex items-center justify-center">
          {callType === 'video' && hasRemoteVideo ? (
            <video
              ref={(el) => {
                (pipRemoteVideoRef as any).current = el;
                if (el && remoteStream && el.srcObject !== remoteStream) {
                  el.srcObject = remoteStream;
                  el.play().catch(() => {});
                }
              }}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="flex flex-col items-center justify-center p-2 text-center">
              <img
                src={partnerUser.avatarUrl}
                alt={partnerUser.displayName}
                className="w-14 h-14 rounded-full border-2 border-emerald-500 object-cover shadow-md mb-1"
              />
              <span className="text-[11px] text-neutral-300 font-medium truncate max-w-[140px]">
                {partnerUser.displayName}
              </span>
            </div>
          )}

          {/* Duration badge */}
          <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-full bg-black/70 text-white font-mono text-[10px] tabular-nums font-bold pointer-events-none">
            {formatDuration(durationSec)}
          </div>
        </div>

        {/* Quick Bottom Controls */}
        <div className="p-2 bg-[#1f2c34] flex items-center justify-between gap-1.5">
          <button
            type="button"
            onClick={toggleMute}
            className={`p-2 rounded-full cursor-pointer transition-all ${
              isMuted ? 'bg-rose-600 text-white' : 'bg-neutral-700 text-white hover:bg-neutral-600'
            }`}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={() => setIsMinimized(false)}
            className="p-2 rounded-full bg-neutral-700 text-white hover:bg-neutral-600 cursor-pointer"
            title="Maximize call"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => handleCleanHangup(true)}
            className="p-2 rounded-full bg-rose-600 text-white hover:bg-rose-700 cursor-pointer"
            title="End call"
          >
            <PhoneOff className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // 13. WHATSAPP FULLSCREEN CALL EXPERIENCE
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md animate-in fade-in select-none">
      {/* Audio element for crystal-clear remote audio in audio & video calls */}
      <audio
        ref={(el) => {
          (remoteAudioRef as any).current = el;
          if (el && remoteStream && el.srcObject !== remoteStream) {
            el.srcObject = remoteStream;
            el.play().catch(() => {});
          }
        }}
        autoPlay
        playsInline
        className="hidden"
      />

      <div className="relative w-full h-full max-w-md sm:max-h-[92vh] sm:rounded-[36px] bg-[#0b141a] overflow-hidden flex flex-col justify-between shadow-2xl border border-white/10">
        
        {/* =====================================================================
            TOP HEADER BAR (WHATSAPP CALL HEADER)
           ===================================================================== */}
        <div className="relative z-30 pt-6 sm:pt-5 px-5 flex flex-col items-center pointer-events-auto">
          {/* Top Row: Lock / Security & Minimize */}
          <div className="w-full flex items-center justify-between text-neutral-400 mb-2">
            <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide">
              <Lock className="w-3 h-3 text-emerald-400" />
              <span>End-to-end encrypted</span>
            </div>

            {callState === 'active' && (
              <button
                type="button"
                onClick={() => setIsMinimized(true)}
                className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition-colors"
                title="Minimize call"
              >
                <Minimize2 className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Partner Name & Live Status */}
          <div className="text-center">
            <h2 className="text-2xl font-bold text-white tracking-tight drop-shadow-md">
              {partnerUser.displayName}
            </h2>
            <p className="text-xs font-semibold tracking-wider uppercase mt-1 text-emerald-400">
              {callState === 'active' ? (
                <span className="font-mono text-sm tracking-normal text-white">
                  {formatDuration(durationSec)}
                </span>
              ) : callState === 'outgoing' ? (
                <span className="animate-pulse">Ringing...</span>
              ) : callState === 'incoming' ? (
                <span className="animate-pulse">
                  Incoming {callType === 'video' ? 'Video' : 'Voice'} Call
                </span>
              ) : (
                statusMessage || callState
              )}
            </p>
          </div>

          {cameraError && (
            <div className="mt-2 flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[11px]">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{cameraError}</span>
            </div>
          )}
        </div>

        {/* =====================================================================
            CENTER VIEWPORT: VIDEO FEED / WHATSAPP AVATAR PULSE
           ===================================================================== */}
        <div className="relative flex-1 min-h-0 w-full overflow-hidden flex items-center justify-center">
          
          {/* A. ACTIVE VIDEO CALL: REMOTE STREAM + PIP LOCAL */}
          {callState === 'active' && callType === 'video' ? (
            <div className="relative w-full h-full bg-black flex items-center justify-center">
              {/* Remote Video Stream */}
              <video
                ref={(el) => {
                  (remoteVideoRef as any).current = el;
                  if (el && remoteStream && el.srcObject !== remoteStream) {
                    el.srcObject = remoteStream;
                    el.play().catch(() => {});
                  }
                }}
                autoPlay
                playsInline
                muted
                onLoadedMetadata={() => setHasRemoteVideo(true)}
                onPlay={() => setHasRemoteVideo(true)}
                onPlaying={() => setHasRemoteVideo(true)}
                className="w-full h-full object-cover"
              />

              {/* Connecting / Remote Camera Off Placeholder (Prevents Blank Screen!) */}
              {!hasRemoteVideo && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#111b21] z-10 text-white space-y-4">
                  <div className="relative">
                    <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-emerald-500 shadow-2xl bg-neutral-800 flex items-center justify-center">
                      <img
                        src={partnerUser.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${partnerUser.id || 'duo'}`}
                        alt={partnerUser.displayName}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${partnerUser.id || 'duo'}`;
                        }}
                      />
                    </div>
                    <div className="absolute -inset-3 rounded-full border-2 border-emerald-400/40 animate-ping pointer-events-none" />
                  </div>
                  <div className="text-center px-4">
                    <h3 className="text-xl font-bold text-white">{partnerUser.displayName}</h3>
                    <p className="text-xs text-neutral-400 animate-pulse mt-1">
                      Connecting video feed...
                    </p>
                  </div>
                </div>
              )}

              {/* Local Video Stream Picture-in-Picture Tile (WhatsApp Style) */}
              <div className="absolute top-4 right-4 w-28 h-40 sm:w-32 sm:h-44 rounded-2xl border-2 border-white/30 overflow-hidden bg-[#1f2c34] shadow-2xl z-20">
                <video
                  ref={(el) => {
                    (localVideoRef as any).current = el;
                    if (el && localStream && el.srcObject !== localStream) {
                      el.srcObject = localStream;
                      el.play().catch(() => {});
                    }
                  }}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${
                    !isScreenSharing && facingMode === 'user' ? 'scale-x-[-1]' : ''
                  }`}
                />
                {isCameraOff && !isScreenSharing && (
                  <div className="absolute inset-0 bg-[#1f2c34] flex flex-col items-center justify-center text-neutral-300 text-[10px]">
                    <VideoOff className="w-5 h-5 mb-1 text-rose-400" />
                    <span>Camera off</span>
                  </div>
                )}
                {isScreenSharing && (
                  <div className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-md bg-emerald-500 text-white font-bold text-[10px] shadow-sm">
                    Sharing Screen
                  </div>
                )}
              </div>
            </div>
          ) : callState === 'outgoing' && callType === 'video' ? (
            /* B. OUTGOING VIDEO CALL: LOCAL CAMERA PREVIEW (WHATSAPP VIDEO CALLING SCREEN) */
            <div className="relative w-full h-full bg-black flex items-center justify-center">
              <video
                ref={(el) => {
                  (outgoingPreviewVideoRef as any).current = el;
                  if (el && localStream && el.srcObject !== localStream) {
                    el.srcObject = localStream;
                    el.play().catch(() => {});
                  }
                }}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
              />
              {/* Subtle darkened vignette over camera preview */}
              <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center text-center p-6">
                <div className="relative mb-3">
                  <div className="w-24 h-24 rounded-full overflow-hidden border-3 border-white/50 shadow-2xl bg-neutral-800 flex items-center justify-center">
                    <img
                      src={partnerUser.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${partnerUser.id || 'duo'}`}
                      alt={partnerUser.displayName}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${partnerUser.id || 'duo'}`;
                      }}
                    />
                  </div>
                  <div className="absolute -inset-2 rounded-full border-2 border-emerald-400 animate-ping opacity-40 pointer-events-none" />
                </div>
                <span className="text-xs text-neutral-200 font-medium tracking-wide">
                  Waiting for partner to accept...
                </span>
              </div>
            </div>
          ) : (
            /* C. AUDIO CALL / INCOMING CALL / DIALING SCREEN (WHATSAPP AVATAR RADAR) */
            <div className="flex flex-col items-center justify-center p-6 text-center z-10 space-y-6">
              <div className="relative flex items-center justify-center">
                {/* Concentric Pulsing Radar Rings */}
                {(callState === 'incoming' || callState === 'outgoing') && (
                  <>
                    <div className="absolute w-52 h-52 rounded-full border border-emerald-500/20 animate-ping pointer-events-none" />
                    <div className="absolute w-44 h-44 rounded-full border-2 border-emerald-500/30 animate-pulse pointer-events-none" />
                  </>
                )}

                <div className="w-36 h-36 rounded-full border-4 border-emerald-500/60 overflow-hidden bg-[#1f2c34] shadow-2xl flex items-center justify-center z-10">
                  <img
                    src={partnerUser.avatarUrl}
                    alt={partnerUser.displayName}
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>

              <div>
                <h3 className="text-xl font-bold text-white">
                  {partnerUser.displayName}
                </h3>
                <p className="text-xs text-neutral-400 mt-1">
                  {callState === 'incoming'
                    ? `Duo ${callType === 'video' ? 'Video' : 'Voice'} Call`
                    : callState === 'outgoing'
                    ? 'Ringing...'
                    : callState === 'active'
                    ? 'Connected 🎧'
                    : statusMessage || 'Call in progress'}
                </p>
              </div>
            </div>
          )}

          {/* Quick Decline Message Tray (WhatsApp Style) */}
          {showQuickReplies && callState === 'incoming' && (
            <div className="absolute inset-x-4 bottom-4 z-40 p-4 rounded-3xl bg-[#1f2c34] border border-white/10 shadow-2xl animate-in slide-in-from-bottom duration-200 text-white">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/10">
                <span className="font-bold text-xs text-white">
                  Decline & Reply with Message
                </span>
                <button
                  type="button"
                  onClick={() => setShowQuickReplies(false)}
                  className="p-1 rounded-lg text-neutral-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-1.5">
                {QUICK_DECLINE_MESSAGES.map((msg, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleDecline(msg)}
                    className="w-full text-left px-3.5 py-2.5 rounded-xl bg-white/5 hover:bg-emerald-600/30 border border-white/10 text-xs font-medium text-white transition-colors cursor-pointer"
                  >
                    "{msg}"
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* =====================================================================
            BOTTOM CALL CONTROLS DOCK (WHATSAPP ROUND BUTTONS DOCK)
           ===================================================================== */}
        <div className="relative z-30 p-6 bg-[#0b141a]/90 backdrop-blur-sm border-t border-white/10">
          {callState === 'incoming' ? (
            /* Incoming Call: WhatsApp Accept, Decline & Message Row */
            <div className="w-full flex items-center justify-around gap-6 max-w-xs mx-auto">
              {/* Decline (Red Circle) */}
              <div className="flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleDecline()}
                  className="w-16 h-16 rounded-full bg-rose-600 hover:bg-rose-700 active:scale-95 text-white flex items-center justify-center shadow-lg transition-transform cursor-pointer"
                  aria-label="Decline call"
                >
                  <PhoneOff className="w-7 h-7" />
                </button>
                <span className="text-xs text-neutral-300 font-medium">Decline</span>
              </div>

              {/* Quick Message (Slate Circle) */}
              <div className="flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowQuickReplies(!showQuickReplies)}
                  className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white flex items-center justify-center shadow-md transition-transform cursor-pointer"
                  title="Reply with message"
                  aria-label="Reply with message"
                >
                  <MessageSquare className="w-5 h-5" />
                </button>
                <span className="text-[11px] text-neutral-400 font-medium">Message</span>
              </div>

              {/* Accept (Green Circle) */}
              <div className="flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleAnswer}
                  className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white flex items-center justify-center shadow-lg transition-transform cursor-pointer animate-pulse"
                  aria-label="Accept call"
                >
                  <Phone className="w-7 h-7" />
                </button>
                <span className="text-xs text-neutral-300 font-medium">Accept</span>
              </div>
            </div>
          ) : (
            /* Outgoing or Active Call Controls Bar */
            <div className="w-full flex items-center justify-around max-w-sm mx-auto">
              {/* Speaker Toggle (for audio calls) */}
              {callType === 'audio' && (
                <button
                  type="button"
                  onClick={() => setIsSpeakerOn(!isSpeakerOn)}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                    isSpeakerOn ? 'bg-white/20 text-white' : 'bg-white/10 text-neutral-400'
                  }`}
                  title={isSpeakerOn ? 'Speaker On' : 'Speaker Off'}
                >
                  {isSpeakerOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
                </button>
              )}

              {/* Flip Camera (for video calls) */}
              {callType === 'video' && (
                <button
                  type="button"
                  onClick={handleSwitchCamera}
                  className="w-12 h-12 rounded-full bg-white/15 hover:bg-white/25 active:scale-95 text-white flex items-center justify-center transition-all cursor-pointer shadow-md"
                  title="Switch Camera"
                >
                  <RefreshCw className="w-5 h-5" />
                </button>
              )}

              {/* Camera Off / On Toggle (for video calls) */}
              {callType === 'video' && (
                <button
                  type="button"
                  onClick={toggleCamera}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-md ${
                    isCameraOff
                      ? 'bg-rose-600 text-white'
                      : 'bg-white/15 hover:bg-white/25 text-white'
                  }`}
                  title={isCameraOff ? 'Turn Camera On' : 'Turn Camera Off'}
                >
                  {isCameraOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                </button>
              )}

              {/* Screen Share (Google Meet / WhatsApp Desktop Style) */}
              {callState === 'active' && (
                <button
                  type="button"
                  onClick={handleToggleScreenShare}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-md ${
                    isScreenSharing
                      ? 'bg-emerald-500 text-white'
                      : 'bg-white/15 hover:bg-white/25 text-white'
                  }`}
                  title={isScreenSharing ? 'Stop Screen Share' : 'Share Screen'}
                >
                  {isScreenSharing ? (
                    <ScreenShareOff className="w-5 h-5" />
                  ) : (
                    <ScreenShare className="w-5 h-5" />
                  )}
                </button>
              )}

              {/* Mute Mic Toggle */}
              <button
                type="button"
                onClick={toggleMute}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-md ${
                  isMuted
                    ? 'bg-rose-600 text-white'
                    : 'bg-white/15 hover:bg-white/25 text-white'
                }`}
                title={isMuted ? 'Unmute Mic' : 'Mute Mic'}
              >
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              {/* End Call Button (Large Crimson Red Circle) */}
              <button
                type="button"
                onClick={() => handleCleanHangup(true)}
                className="w-14 h-14 rounded-full bg-rose-600 hover:bg-rose-700 active:scale-95 text-white flex items-center justify-center shadow-lg transition-transform cursor-pointer"
                title="End Call"
                aria-label="End Call"
              >
                <PhoneOff className="w-6 h-6" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
