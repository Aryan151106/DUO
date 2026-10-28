import { create } from 'zustand';
import {
  Room,
  RoomEvent,
  VideoPresets,
  Track,
  ConnectionState,
  createLocalScreenTracks,
  type RemoteParticipant,
  type RemoteTrackPublication,
  type LocalTrackPublication,
  type LocalTrack,
  type LocalVideoTrack,
  type RemoteVideoTrack,
  type RemoteAudioTrack,
} from 'livekit-client';
import { isMobileOrConstrainedDevice } from './media';

export interface ActiveRoomInfo {
  roomId: string;
  roomName: string;
  serverUrl: string;
  token: string;
  type: 'study' | 'movie';
  displayName: string;
  title?: string;
}

export interface MediaDiagnostics {
  rtt?: number;
  jitter?: number;
  packetsLost?: number;
  bitrate?: number;
  resolution?: string;
  audioEchoCancellation?: boolean;
  audioNoiseSuppression?: boolean;
  audioAutoGainControl?: boolean;
  connectionQuality?: string;
  captureState?: string;
  lastUpdated: number;
}

export type PipMode = 'none' | 'document' | 'video' | 'in-app';

interface MediaRoomState {
  // LiveKit Room instance & active connection info
  room: Room | null;
  activeRoomInfo: ActiveRoomInfo | null;
  connectionState: ConnectionState;

  // Media flags
  isMicEnabled: boolean;
  isCamEnabled: boolean;
  isScreenSharing: boolean;
  hasRemoteVideo: boolean;
  hasRemoteScreenShare: boolean;

  // LiveKit tracks
  localVideoTrack: LocalVideoTrack | null;
  remoteVideoTrack: RemoteVideoTrack | null;
  remoteAudioTrack: RemoteAudioTrack | null;
  remoteScreenShareTrack: RemoteVideoTrack | null;

  // Participant info
  remoteParticipantName: string;
  participantCount: number;

  // Volume & Audio control (In-call only, does not claim system volume)
  remoteVolume: number;
  isRemoteMuted: boolean;

  // Screen share & Notices
  screenShareNotice: string | null;
  errorMsg: string | null;

  // Explicit leave tracking: prevents unwanted auto-join loops
  explicitlyLeftRoomIds: string[];

  // PiP & UI minimization state
  pipMode: PipMode;
  pipWindow: Window | null;
  pipNotice: string | null;
  isPipSupported: {
    documentPip: boolean;
    videoPip: boolean;
    getDisplayMedia: boolean;
  };

  // Diagnostics
  diagnostics: MediaDiagnostics | null;

  // Actions
  joinRoom: (info: ActiveRoomInfo, options?: { enableCam?: boolean }) => Promise<void>;
  leaveRoom: (explicit?: boolean) => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCam: () => Promise<void>;
  startScreenShare: (
    claimSlot: () => Promise<boolean>,
    releaseSlot: () => Promise<void>
  ) => Promise<boolean>;
  stopScreenShare: () => Promise<void>;
  setRemoteVolume: (volume: number) => void;
  toggleRemoteMute: () => void;
  requestVideoPip: (targetVideoElement: HTMLVideoElement) => Promise<boolean>;
  requestDocumentPip: () => Promise<boolean>;
  toggleInAppMini: () => void;
  requestPip: (targetVideoElement?: HTMLVideoElement | null) => Promise<void>;
  closePip: () => Promise<void>;
  setPipNotice: (notice: string | null) => void;
  setMinimized: (minimized: boolean) => void;
  setErrorMsg: (msg: string | null) => void;
  clearExplicitlyLeft: (roomId: string) => void;
  updateDiagnostics: () => Promise<void>;
}

// Check platform capabilities at runtime
const checkCapabilities = () => {
  const isBrowser = typeof window !== 'undefined';
  const hasNavigator = typeof navigator !== 'undefined';

  const documentPip =
    isBrowser &&
    'documentPictureInPicture' in window &&
    typeof (window as any).documentPictureInPicture?.requestWindow === 'function';

  const videoPip =
    typeof document !== 'undefined' &&
    'pictureInPictureEnabled' in document &&
    Boolean(document.pictureInPictureEnabled);

  const getDisplayMedia =
    hasNavigator &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function';

  return { documentPip, videoPip, getDisplayMedia };
};

// Internal reference to active release callback for screen share
let activeScreenReleaseCallback: (() => Promise<void>) | null = null;
let activeScreenTracks: LocalTrack[] = [];

export const useMediaRoomStore = create<MediaRoomState>((set, get) => ({
  room: null,
  activeRoomInfo: null,
  connectionState: ConnectionState.Disconnected,

  isMicEnabled: true,
  isCamEnabled: false,
  isScreenSharing: false,
  hasRemoteVideo: false,
  hasRemoteScreenShare: false,

  localVideoTrack: null,
  remoteVideoTrack: null,
  remoteAudioTrack: null,
  remoteScreenShareTrack: null,

  remoteParticipantName: 'Partner',
  participantCount: 1,

  remoteVolume: 1.0,
  isRemoteMuted: false,

  screenShareNotice: null,
  errorMsg: null,
  explicitlyLeftRoomIds: [],

  pipMode: 'none',
  pipWindow: null,
  pipNotice: null,
  isPipSupported: checkCapabilities(),

  diagnostics: null,

  joinRoom: async (info, options) => {
    const state = get();

    // If already connected or connecting to this same room, do not create a duplicate connection
    if (state.activeRoomInfo?.roomId === info.roomId && state.room) {
      if (
        state.connectionState === ConnectionState.Connected ||
        state.connectionState === ConnectionState.Connecting
      ) {
        console.log('[MediaRoomStore] Room already active, attaching to existing session:', info.roomId);
        return;
      }
    }

    // If connected to a different room, cleanly leave that room first
    if (state.room && state.activeRoomInfo?.roomId !== info.roomId) {
      await state.leaveRoom(false);
    }

    // Clear explicitly-left flag for this room if user initiated join
    get().clearExplicitlyLeft(info.roomId);

    set({
      activeRoomInfo: info,
      connectionState: ConnectionState.Connecting,
      errorMsg: null,
      screenShareNotice: null,
    });

    const isMobile = isMobileOrConstrainedDevice();
    const resolution = isMobile
      ? { width: 640, height: 480, frameRate: 20 }
      : VideoPresets.h720.resolution;

    // Initialize Room with explicitly configured audio/video defaults
    // Keep echoCancellation, noiseSuppression, and autoGainControl enabled to avoid feedback
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      videoCaptureDefaults: {
        resolution,
      },
    });

    const updateParticipants = () => {
      const currentRoom = get().room;
      if (!currentRoom) return;

      const remoteCount = currentRoom.remoteParticipants.size;
      const count = remoteCount + 1;

      if (remoteCount > 0) {
        const firstRemote = Array.from(currentRoom.remoteParticipants.values())[0];
        set({
          participantCount: count,
          remoteParticipantName: firstRemote.name || firstRemote.identity || 'Partner',
        });
      } else {
        set({
          participantCount: count,
          remoteParticipantName: 'Partner',
          hasRemoteVideo: false,
          hasRemoteScreenShare: false,
          remoteVideoTrack: null,
          remoteScreenShareTrack: null,
          remoteAudioTrack: null,
        });
      }
    };

    // ─── Setup Room Event Listeners ─────────────────────────────────
    room.on(RoomEvent.ConnectionStateChanged, (connState) => {
      set({ connectionState: connState });
      if (connState === ConnectionState.Connected) {
        set({ errorMsg: null });
      }
    });

    room.on(RoomEvent.Connected, () => {
      updateParticipants();
    });

    room.on(RoomEvent.Disconnected, () => {
      set({
        isScreenSharing: false,
        hasRemoteVideo: false,
        hasRemoteScreenShare: false,
        localVideoTrack: null,
        remoteVideoTrack: null,
        remoteAudioTrack: null,
        remoteScreenShareTrack: null,
      });
      updateParticipants();
    });

    room.on(RoomEvent.ParticipantConnected, () => {
      updateParticipants();
    });

    room.on(RoomEvent.ParticipantDisconnected, () => {
      updateParticipants();
    });

    room.on(
      RoomEvent.TrackSubscribed,
      (track: Track, _pub: RemoteTrackPublication, _participant: RemoteParticipant) => {
        if (track.kind === Track.Kind.Video) {
          if (track.source === Track.Source.ScreenShare) {
            set({
              hasRemoteScreenShare: true,
              remoteScreenShareTrack: track as RemoteVideoTrack,
            });
          } else {
            set({
              hasRemoteVideo: true,
              remoteVideoTrack: track as RemoteVideoTrack,
            });
          }
        } else if (track.kind === Track.Kind.Audio) {
          set({
            remoteAudioTrack: track as RemoteAudioTrack,
          });
        }
      }
    );

    room.on(RoomEvent.TrackUnsubscribed, (track: Track) => {
      if (track.kind === Track.Kind.Video) {
        if (track.source === Track.Source.ScreenShare) {
          set({
            hasRemoteScreenShare: false,
            remoteScreenShareTrack: null,
          });
        } else {
          set({
            hasRemoteVideo: false,
            remoteVideoTrack: null,
          });
        }
      } else if (track.kind === Track.Kind.Audio) {
        set({
          remoteAudioTrack: null,
        });
      }
    });

    room.on(RoomEvent.LocalTrackPublished, (pub: LocalTrackPublication) => {
      if (pub.track) {
        if (pub.track.source === Track.Source.Camera) {
          set({
            localVideoTrack: pub.track as LocalVideoTrack,
            isCamEnabled: true,
          });
        } else if (pub.track.source === Track.Source.ScreenShare) {
          set({
            isScreenSharing: true,
          });
        }
      }
    });

    room.on(RoomEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
      if (pub.track) {
        if (pub.track.source === Track.Source.Camera) {
          set({
            localVideoTrack: null,
            isCamEnabled: false,
          });
        } else if (pub.track.source === Track.Source.ScreenShare) {
          set({
            isScreenSharing: false,
          });
        }
      }
    });

    room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
      if (participant === room.localParticipant) {
        set((s) => ({
          diagnostics: {
            ...s.diagnostics,
            connectionQuality: quality,
            lastUpdated: Date.now(),
          },
        }));
      }
    });

    // Camera: On mobile, start voice-only by default to conserve battery and bandwidth.
    // On desktop, enable if explicitly requested or if user opted into camera.
    const shouldEnableCam =
      options?.enableCam !== undefined
        ? options.enableCam
        : !isMobile && info.type === 'study';

    try {
      set({ room });

      // If running with a demo token, simulate a connected session with full control support
      if (info.token === 'demo-local-token' || info.token.startsWith('demo-')) {
        set({
          connectionState: ConnectionState.Connected,
          participantCount: 2,
          remoteParticipantName: 'Partner (Demo)',
          errorMsg: null,
          isMicEnabled: true,
          isCamEnabled: shouldEnableCam,
        });
        return;
      }

      // Connect to LiveKit Cloud endpoint with autoSubscribe
      await room.connect(info.serverUrl, info.token, {
        autoSubscribe: true,
      });

      // Enable microphone on join by default with echo cancellation & noise suppression
      try {
        await room.localParticipant.setMicrophoneEnabled(true, {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        });
        set({ isMicEnabled: true });
      } catch (micErr: any) {
        console.warn('[MediaRoomStore] Initial microphone notice:', micErr?.message || micErr);
        set({ isMicEnabled: false });
      }

      if (shouldEnableCam) {
        try {
          await room.localParticipant.setCameraEnabled(true);
          set({ isCamEnabled: true });
        } catch (camErr: any) {
          console.warn('[MediaRoomStore] Initial camera notice:', camErr?.message || camErr);
          set({ isCamEnabled: false });
        }
      } else {
        set({ isCamEnabled: false });
      }

      updateParticipants();
    } catch (err: any) {
      console.error('[MediaRoomStore] Connection failed:', err);
      set({
        connectionState: ConnectionState.Disconnected,
        errorMsg: err.message || 'Failed to connect to media server.',
      });
      throw err;
    }
  },

  leaveRoom: async (explicit = true) => {
    const { room, activeRoomInfo, pipWindow, stopScreenShare } = get();

    // If explicit leave, register in explicitlyLeftRoomIds so auto-join does not re-trigger
    if (explicit && activeRoomInfo?.roomId) {
      set((s) => ({
        explicitlyLeftRoomIds: [...s.explicitlyLeftRoomIds, activeRoomInfo.roomId],
      }));
    }

    // Stop active screen share if present
    await stopScreenShare();

    // Close Document PiP window if open
    if (pipWindow && !pipWindow.closed) {
      try {
        pipWindow.close();
      } catch {}
    }

    // Exit video PiP if active
    if (typeof document !== 'undefined' && document.pictureInPictureElement) {
      try {
        await document.exitPictureInPicture();
      } catch {}
    }

    if (room) {
      try {
        // Stop all local tracks safely
        room.localParticipant.trackPublications.forEach((pub) => {
          if (pub.track) {
            try {
              pub.track.stop();
            } catch {}
          }
        });

        room.removeAllListeners();
        await room.disconnect(true);
      } catch (e) {
        console.warn('[MediaRoomStore] Disconnect notice:', e);
      }
    }

    set({
      room: null,
      activeRoomInfo: null,
      connectionState: ConnectionState.Disconnected,
      isMicEnabled: false,
      isCamEnabled: false,
      isScreenSharing: false,
      hasRemoteVideo: false,
      hasRemoteScreenShare: false,
      localVideoTrack: null,
      remoteVideoTrack: null,
      remoteAudioTrack: null,
      remoteScreenShareTrack: null,
      pipMode: 'none',
      pipWindow: null,
      errorMsg: null,
      screenShareNotice: null,
      diagnostics: null,
    });
  },

  toggleMic: async () => {
    const { room, isMicEnabled, activeRoomInfo } = get();
    if (activeRoomInfo?.token.startsWith('demo')) {
      set({ isMicEnabled: !isMicEnabled });
      return;
    }
    if (!room) return;
    try {
      const next = !isMicEnabled;
      await room.localParticipant.setMicrophoneEnabled(next, {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      set({ isMicEnabled: next });
    } catch (err: any) {
      console.warn('[MediaRoomStore] Toggle mic error:', err);
    }
  },

  toggleCam: async () => {
    const { room, isCamEnabled, activeRoomInfo } = get();
    if (activeRoomInfo?.token.startsWith('demo')) {
      set({ isCamEnabled: !isCamEnabled });
      return;
    }
    if (!room) return;
    try {
      const next = !isCamEnabled;
      await room.localParticipant.setCameraEnabled(next);
      set({ isCamEnabled: next });
    } catch (err: any) {
      console.warn('[MediaRoomStore] Toggle camera error:', err);
    }
  },

  startScreenShare: async (claimSlot, releaseSlot) => {
    const { room, isPipSupported, activeRoomInfo } = get();
    if (!room) return false;

    // Runtime platform detection
    if (!isPipSupported.getDisplayMedia) {
      set({
        errorMsg:
          'Screen sharing is not supported by this mobile browser. To share your screen, open this room on desktop (Chrome, Edge, or Safari). Watching your partner stream is still supported here!',
      });
      return false;
    }

    if (activeRoomInfo?.token.startsWith('demo')) {
      set({ isScreenSharing: true, errorMsg: null });
      return true;
    }

    try {
      // 1. Immediately request browser screen capture directly in the user gesture event loop.
      // Do not await network or Socket.IO work before calling createLocalScreenTracks.
      const screenTracks = await createLocalScreenTracks({
        audio: true,
        resolution: { width: 1920, height: 1080, frameRate: 30 },
        surfaceSwitching: 'include',
        systemAudio: 'include',
      });

      if (!screenTracks || screenTracks.length === 0) {
        set({ errorMsg: 'No screen or window source selected.' });
        return false;
      }

      // 2. Once the user chooses a source, claim the room's single screen-share slot
      const allowed = await claimSlot();
      if (!allowed) {
        // Stop newly captured tracks immediately if slot is occupied
        screenTracks.forEach((t) => {
          try {
            t.stop();
          } catch {}
        });
        set({
          errorMsg:
            'Another partner is currently sharing their screen. Only one screen share can be active at a time.',
        });
        return false;
      }

      activeScreenReleaseCallback = releaseSlot;
      activeScreenTracks = screenTracks;

      // 3. Publish tracks with correct screen-share and screen-share-audio sources
      for (const track of screenTracks) {
        await room.localParticipant.publishTrack(track, {
          source: track.source, // Track.Source.ScreenShare or Track.Source.ScreenShareAudio
        });

        // Listen for browser's native "Stop Sharing" button
        const mediaTrack = track.mediaStreamTrack;
        const onEnded = async () => {
          await get().stopScreenShare();
        };

        if (mediaTrack) {
          mediaTrack.addEventListener('ended', onEnded, { once: true });
        }
      }

      set({ isScreenSharing: true, errorMsg: null });
      return true;
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        set({ errorMsg: 'Screen sharing was cancelled or permission was denied.' });
      } else if (err.name === 'NotFoundError') {
        set({ errorMsg: 'No screen or window was selected.' });
      } else if (err.name === 'NotReadableError') {
        set({ errorMsg: 'Hardware or OS permission prevented screen capture.' });
      } else {
        set({ errorMsg: `Failed to start screen share: ${err.message || err}` });
      }
      return false;
    }
  },

  stopScreenShare: async () => {
    const { room, activeRoomInfo } = get();
    if (activeRoomInfo?.token.startsWith('demo')) {
      set({ isScreenSharing: false });
      return;
    }
    if (!room) return;

    if (activeScreenTracks.length > 0) {
      for (const track of activeScreenTracks) {
        try {
          await room.localParticipant.unpublishTrack(track, true);
          track.stop();
        } catch {}
      }
      activeScreenTracks = [];
    }

    if (activeScreenReleaseCallback) {
      try {
        await activeScreenReleaseCallback();
      } catch {}
      activeScreenReleaseCallback = null;
    }

    set({ isScreenSharing: false });
  },

  setRemoteVolume: (volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));
    set({ remoteVolume: clamped, isRemoteMuted: clamped === 0 });
  },

  toggleRemoteMute: () => {
    const { isRemoteMuted, remoteVolume } = get();
    if (isRemoteMuted) {
      set({ isRemoteMuted: false, remoteVolume: remoteVolume || 0.8 });
    } else {
      set({ isRemoteMuted: true });
    }
  },

  requestVideoPip: async (targetVideoElement: HTMLVideoElement) => {
    if (!targetVideoElement) {
      set({ pipNotice: 'No video stream selected for Picture-in-Picture.' });
      return false;
    }

    const { isPipSupported, pipMode } = get();

    // If currently in Picture-in-Picture, exit and return to normal room layout
    if (pipMode === 'video' || (typeof document !== 'undefined' && document.pictureInPictureElement)) {
      if (typeof document !== 'undefined' && document.pictureInPictureElement) {
        try {
          await document.exitPictureInPicture();
        } catch {}
      }
      set({ pipMode: 'none', pipNotice: null });
      return true;
    }

    // Feature detection
    const canVideoPip =
      isPipSupported.videoPip && typeof targetVideoElement.requestPictureInPicture === 'function';

    if (!canVideoPip) {
      set({
        pipMode: 'in-app',
        pipNotice:
          'Native OS Picture-in-Picture is not supported in this browser. Switched to in-app mini-player.',
      });
      return false;
    }

    try {
      // Direct call synchronously in user gesture
      await targetVideoElement.requestPictureInPicture();
      set({ pipMode: 'video', pipNotice: null });

      const onLeavePip = () => {
        set({ pipMode: 'none' });
        targetVideoElement.removeEventListener('leavepictureinpicture', onLeavePip);
      };
      const onEnterPip = () => {
        set({ pipMode: 'video' });
      };

      targetVideoElement.addEventListener('leavepictureinpicture', onLeavePip, { once: true });
      targetVideoElement.addEventListener('enterpictureinpicture', onEnterPip, { once: true });
      return true;
    } catch (err: any) {
      console.warn('[MediaRoomStore] requestPictureInPicture error:', err);
      if (err.name === 'NotAllowedError') {
        set({
          pipNotice:
            'Picture-in-Picture requires direct user interaction or permission was denied.',
        });
      } else if (err.name === 'InvalidStateError') {
        set({ pipNotice: 'Video stream is not ready for Picture-in-Picture yet.' });
      } else {
        set({
          pipNotice: `Could not open Picture-in-Picture: ${err?.message || err}`,
        });
      }
      return false;
    }
  },

  requestDocumentPip: async () => {
    const { isPipSupported, pipMode, pipWindow } = get();
    if (!isPipSupported.documentPip) {
      set({ pipNotice: 'Floating room panel is not supported on this browser.' });
      return false;
    }

    if (pipMode === 'document') {
      if (pipWindow && !pipWindow.closed) {
        try {
          pipWindow.close();
        } catch {}
      }
      set({ pipMode: 'none', pipWindow: null });
      return true;
    }

    try {
      const dpip = (window as any).documentPictureInPicture;
      const pipWin: Window = await dpip.requestWindow({
        width: 420,
        height: 320,
      });

      // Copy stylesheet rules to PiP window head so CSS styling works
      Array.from(document.styleSheets).forEach((sheet) => {
        try {
          const rules = sheet.cssRules
            ? Array.from(sheet.cssRules).map((r) => r.cssText).join('\n')
            : '';
          const style = pipWin.document.createElement('style');
          style.textContent = rules;
          pipWin.document.head.appendChild(style);
        } catch {
          if (sheet.href) {
            const link = pipWin.document.createElement('link');
            link.rel = 'stylesheet';
            link.href = sheet.href;
            pipWin.document.head.appendChild(link);
          }
        }
      });

      // Set PiP document background
      pipWin.document.body.style.margin = '0';
      pipWin.document.body.style.padding = '0';
      pipWin.document.body.style.backgroundColor = '#0c0a09';
      pipWin.document.body.style.overflow = 'hidden';

      pipWin.addEventListener(
        'pagehide',
        () => {
          set({ pipMode: 'none', pipWindow: null });
        },
        { once: true }
      );

      set({ pipMode: 'document', pipWindow: pipWin, pipNotice: null });
      return true;
    } catch (dpipErr: any) {
      console.warn('[MediaRoomStore] Document PiP error:', dpipErr);
      set({ pipNotice: `Failed to open floating room panel: ${dpipErr?.message || dpipErr}` });
      return false;
    }
  },

  toggleInAppMini: () => {
    const { pipMode } = get();
    set({ pipMode: pipMode === 'in-app' ? 'none' : 'in-app' });
  },

  setPipNotice: (notice: string | null) => {
    set({ pipNotice: notice });
  },

  requestPip: async (targetVideoElement) => {
    if (targetVideoElement) {
      await get().requestVideoPip(targetVideoElement);
    } else {
      get().toggleInAppMini();
    }
  },

  closePip: async () => {
    const { pipWindow, pipMode } = get();

    if (pipMode === 'document' && pipWindow && !pipWindow.closed) {
      try {
        pipWindow.close();
      } catch {}
    }

    if (
      (pipMode === 'video' || (typeof document !== 'undefined' && document.pictureInPictureElement)) &&
      typeof document !== 'undefined' &&
      document.pictureInPictureElement
    ) {
      try {
        await document.exitPictureInPicture();
      } catch {}
    }

    set({ pipMode: 'none', pipWindow: null, pipNotice: null });
  },

  setMinimized: (minimized: boolean) => {
    set({ pipMode: minimized ? 'in-app' : 'none' });
  },

  setErrorMsg: (msg: string | null) => {
    set({ errorMsg: msg });
  },

  clearExplicitlyLeft: (roomId: string) => {
    set((s) => ({
      explicitlyLeftRoomIds: s.explicitlyLeftRoomIds.filter((id) => id !== roomId),
    }));
  },

  updateDiagnostics: async () => {
    const { room } = get();
    if (!room) return;

    try {
      let rtt: number | undefined;
      let jitter: number | undefined;
      let packetsLost: number | undefined;

      // Extract WebRTC stats from LiveKit engine
      const engine = (room as any).engine;
      if (engine?.client?.getStats) {
        const stats = await engine.client.getStats();
        stats.forEach((report: any) => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            rtt = report.currentRoundTripTime ? Math.round(report.currentRoundTripTime * 1000) : undefined;
          }
          if (report.type === 'inbound-rtp' && report.kind === 'audio') {
            jitter = report.jitter ? Math.round(report.jitter * 1000) : undefined;
            packetsLost = report.packetsLost;
          }
        });
      }

      // Check local microphone track settings
      let audioSettings: any = {};
      const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      if (micPub?.track) {
        const mst = (micPub.track as any).mediaStreamTrack;
        if (mst && typeof mst.getSettings === 'function') {
          audioSettings = mst.getSettings();
        }
      }

      set({
        diagnostics: {
          rtt,
          jitter,
          packetsLost,
          audioEchoCancellation: audioSettings.echoCancellation,
          audioNoiseSuppression: audioSettings.noiseSuppression,
          audioAutoGainControl: audioSettings.autoGainControl,
          connectionQuality: (room.localParticipant as any).connectionQuality,
          captureState: micPub?.isMuted ? 'Muted' : 'Capturing Active',
          lastUpdated: Date.now(),
        },
      });
    } catch (e) {
      console.warn('[MediaRoomStore] Error updating diagnostics:', e);
    }
  },
}));
