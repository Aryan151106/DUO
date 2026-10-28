import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMediaRoomStore, type ActiveRoomInfo } from './mediaRoomStore';
import { ConnectionState } from 'livekit-client';

// Mock LiveKit Room
vi.mock('livekit-client', async () => {
  const actual = await vi.importActual('livekit-client');

  class MockRoom {
    state = ConnectionState.Disconnected;
    remoteParticipants = new Map();
    localParticipant = {
      setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined),
      setCameraEnabled: vi.fn().mockResolvedValue(undefined),
      publishTrack: vi.fn().mockResolvedValue(undefined),
      unpublishTrack: vi.fn().mockResolvedValue(undefined),
      trackPublications: new Map(),
      getTrackPublication: vi.fn().mockReturnValue(null),
    };
    connect = vi.fn().mockImplementation(async () => {
      this.state = ConnectionState.Connected;
    });
    disconnect = vi.fn().mockResolvedValue(undefined);
    removeAllListeners = vi.fn();
    on = vi.fn();
    off = vi.fn();
  }

  return {
    ...actual,
    Room: MockRoom,
    createLocalScreenTracks: vi.fn().mockResolvedValue([
      {
        source: 'screen_share',
        mediaStreamTrack: {
          addEventListener: vi.fn(),
          stop: vi.fn(),
        },
        stop: vi.fn(),
      },
    ]),
  };
});

describe('mediaRoomStore', () => {
  beforeEach(() => {
    useMediaRoomStore.setState({
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
      remoteVolume: 1.0,
      isRemoteMuted: false,
      screenShareNotice: null,
      errorMsg: null,
      explicitlyLeftRoomIds: [],
      pipMode: 'none',
      pipWindow: null,
      pipNotice: null,
      isPipSupported: {
        getDisplayMedia: true,
        documentPip: true,
        videoPip: true,
      },
    });
  });

  it('manages in-call remote volume and muting correctly without altering system volume', () => {
    const store = useMediaRoomStore.getState();

    store.setRemoteVolume(0.65);
    expect(useMediaRoomStore.getState().remoteVolume).toBe(0.65);
    expect(useMediaRoomStore.getState().isRemoteMuted).toBe(false);

    // Clamps to [0, 1]
    store.setRemoteVolume(1.5);
    expect(useMediaRoomStore.getState().remoteVolume).toBe(1.0);

    store.setRemoteVolume(-0.2);
    expect(useMediaRoomStore.getState().remoteVolume).toBe(0);
    expect(useMediaRoomStore.getState().isRemoteMuted).toBe(true);

    // Toggling mute restores level
    store.setRemoteVolume(0.8);
    store.toggleRemoteMute();
    expect(useMediaRoomStore.getState().isRemoteMuted).toBe(true);

    store.toggleRemoteMute();
    expect(useMediaRoomStore.getState().isRemoteMuted).toBe(false);
    expect(useMediaRoomStore.getState().remoteVolume).toBe(0.8);
  });

  it('records explicitlyLeftRoomIds on explicit leave so auto-rejoin does not re-trigger', async () => {
    const info: ActiveRoomInfo = {
      roomId: 'room-101',
      roomName: 'room-101',
      serverUrl: 'wss://livekit.test',
      token: 'fake-token',
      type: 'study',
      displayName: 'User',
    };

    await useMediaRoomStore.getState().joinRoom(info);
    expect(useMediaRoomStore.getState().activeRoomInfo?.roomId).toBe('room-101');

    await useMediaRoomStore.getState().leaveRoom(true);
    expect(useMediaRoomStore.getState().room).toBeNull();
    expect(useMediaRoomStore.getState().explicitlyLeftRoomIds).toContain('room-101');

    // Clear explicitly left allows user to join again later
    useMediaRoomStore.getState().clearExplicitlyLeft('room-101');
    expect(useMediaRoomStore.getState().explicitlyLeftRoomIds).not.toContain('room-101');
  });

  it('does not create duplicate connection if already connected to same room', async () => {
    const info: ActiveRoomInfo = {
      roomId: 'room-102',
      roomName: 'room-102',
      serverUrl: 'wss://livekit.test',
      token: 'fake-token',
      type: 'movie',
      displayName: 'User',
    };

    await useMediaRoomStore.getState().joinRoom(info);
    const firstRoomInstance = useMediaRoomStore.getState().room;
    expect(firstRoomInstance).not.toBeNull();

    // Call joinRoom again with the same room info
    await useMediaRoomStore.getState().joinRoom(info);
    const secondRoomInstance = useMediaRoomStore.getState().room;

    // Must be the identical room instance, no duplicate connection
    expect(secondRoomInstance).toBe(firstRoomInstance);
  });

  it('handles screen share flow with immediate capture and slot rejection cleanup', async () => {
    const info: ActiveRoomInfo = {
      roomId: 'room-103',
      roomName: 'room-103',
      serverUrl: 'wss://livekit.test',
      token: 'fake-token',
      type: 'movie',
      displayName: 'User',
    };

    await useMediaRoomStore.getState().joinRoom(info);

    // Test rejection: slot is occupied by partner
    const claimOccupiedSlot = vi.fn().mockResolvedValue(false);
    const releaseCallback = vi.fn().mockResolvedValue(undefined);

    const success = await useMediaRoomStore.getState().startScreenShare(claimOccupiedSlot, releaseCallback);
    expect(success).toBe(false);
    expect(useMediaRoomStore.getState().isScreenSharing).toBe(false);
    expect(useMediaRoomStore.getState().errorMsg).toContain('Another partner is currently sharing');

    // Test acceptance: slot claimed successfully
    const claimFreeSlot = vi.fn().mockResolvedValue(true);
    const success2 = await useMediaRoomStore.getState().startScreenShare(claimFreeSlot, releaseCallback);
    expect(success2).toBe(true);
    expect(useMediaRoomStore.getState().isScreenSharing).toBe(true);

    // Stop screen share releases slot
    await useMediaRoomStore.getState().stopScreenShare();
    expect(useMediaRoomStore.getState().isScreenSharing).toBe(false);
    expect(releaseCallback).toHaveBeenCalled();
  });

  it('handles requestVideoPip and exitPictureInPicture flow', async () => {
    const mockVideo = {
      requestPictureInPicture: vi.fn().mockResolvedValue({}),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLVideoElement;

    (globalThis as any).document = {
      pictureInPictureEnabled: true,
      pictureInPictureElement: null,
      exitPictureInPicture: vi.fn().mockImplementation(async () => {
        (globalThis as any).document.pictureInPictureElement = null;
      }),
    };

    const store = useMediaRoomStore.getState();

    // 1. Calling with video element requests native PiP directly
    const opened = await store.requestVideoPip(mockVideo);
    expect(opened).toBe(true);
    expect(mockVideo.requestPictureInPicture).toHaveBeenCalled();
    expect(useMediaRoomStore.getState().pipMode).toBe('video');

    // 2. Calling again while in PiP exits PiP cleanly
    (globalThis as any).document.pictureInPictureElement = mockVideo;
    const closed = await useMediaRoomStore.getState().requestVideoPip(mockVideo);
    expect(closed).toBe(true);
    expect((globalThis as any).document.exitPictureInPicture).toHaveBeenCalled();
    expect(useMediaRoomStore.getState().pipMode).toBe('none');

    // 3. Fallback when videoPip is unsupported
    useMediaRoomStore.setState({
      isPipSupported: {
        documentPip: false,
        videoPip: false,
        getDisplayMedia: false,
      },
    });
    const fallbackResult = await useMediaRoomStore.getState().requestVideoPip(mockVideo);
    expect(fallbackResult).toBe(false);
    expect(useMediaRoomStore.getState().pipMode).toBe('in-app');
    expect(useMediaRoomStore.getState().pipNotice).toContain('not supported');
  });
});
