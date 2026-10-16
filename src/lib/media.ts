import { useState, useEffect, useRef, useCallback } from 'react';

export type CameraStatus =
  | 'idle'
  | 'requesting'
  | 'ready'
  | 'denied'
  | 'unavailable'
  | 'error';

export interface CameraOptions {
  audio?: boolean;
  video?: boolean;
  facingMode?: 'user' | 'environment';
  deviceId?: string;
  idealWidth?: number;
  idealHeight?: number;
}

export interface CameraErrorResult {
  code: string;
  message: string;
  originalError: any;
}

/**
 * Maps raw DOMException names to friendly, user-actionable instructions.
 */
export function getFriendlyCameraErrorMessage(err: any): string {
  if (!err) return 'Unknown camera error.';

  const name = err.name || '';
  const msg = err.message || '';

  // Log error details for diagnostics
  console.warn(`[Camera Diagnostics] ${name}: ${msg}`, err);

  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'Camera access requires a secure context (HTTPS or localhost/127.0.0.1). Please open the app securely.';
  }

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Camera permission was denied. Please click the camera/lock icon in your browser address bar to allow camera access, then retry.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was detected on this device. Please connect a webcam or switch devices.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is currently in use by another tab or app. Please close other video calls/apps using the camera and retry.';
    case 'OverconstrainedError':
      return 'The requested camera resolution or mode is not supported by your camera.';
    case 'SecurityError':
      return 'Camera access was blocked by browser security policy. Please ensure the app runs on HTTPS or localhost.';
    case 'AbortError':
      return 'Camera access was aborted. Please try again.';
    default:
      return msg || 'Could not start camera preview. Please check your browser permissions.';
  }
}

/**
 * Safely stops all tracks in a MediaStream.
 */
export function stopMediaStream(stream: MediaStream | null) {
  if (!stream) return;
  try {
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (e) {
        console.warn('Failed to stop media track:', e);
      }
    });
  } catch (e) {
    console.warn('Failed to get tracks from stream:', e);
  }
}

/**
 * Detects mobile or resource-constrained devices using multi-factor signals:
 * 1. Coarse pointer detection (touch screens)
 * 2. Navigator touch points (> 0)
 * 3. Screen viewport dimensions (e.g. min dimension <= 768px)
 * 4. User agent regex as secondary validation
 * 5. Device memory / hardware concurrency if constrained
 */
export function isMobileOrConstrainedDevice(): boolean {
  if (typeof window === 'undefined') return false;

  const isCoarsePointer =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;

  const hasTouch =
    (typeof navigator !== 'undefined' &&
      ((navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
        ((navigator as any).msMaxTouchPoints && (navigator as any).msMaxTouchPoints > 0))) ||
    'ontouchstart' in window;

  const isSmallScreen =
    typeof window.screen !== 'undefined' &&
    Math.min(window.screen.width, window.screen.height) <= 768;

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile/i.test(ua);

  const isConstrainedHardware =
    typeof navigator !== 'undefined' &&
    (((navigator as any).deviceMemory && (navigator as any).deviceMemory <= 4) ||
      (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4));

  if (isMobileUA) return true;
  if (hasTouch && isCoarsePointer && isSmallScreen) return true;
  if (isConstrainedHardware && hasTouch) return true;

  return false;
}

/**
 * Computes appropriate camera constraints:
 * - 480p @ 24fps on phones to prevent thermal throttling, battery drain, and dropped frames.
 * - 720p @ 30fps on desktop for high fidelity.
 */
export function getRecommendedMediaConstraints(options: CameraOptions = {}): {
  idealWidth: number;
  idealHeight: number;
  frameRate: number;
} {
  const isMobile = isMobileOrConstrainedDevice();
  if (isMobile) {
    return {
      idealWidth: options.idealWidth ?? 640,
      idealHeight: options.idealHeight ?? 480,
      frameRate: 24,
    };
  }
  return {
    idealWidth: options.idealWidth ?? 1280,
    idealHeight: options.idealHeight ?? 720,
    frameRate: 30,
  };
}

/**
 * Safe feature detection for screen sharing capability (getDisplayMedia).
 * Returns false on mobile platforms that lack getDisplayMedia support.
 */
export function isScreenShareSupported(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return Boolean(
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function'
  );
}

/**
 * Requests camera with ideal constraints and fallback handling.
 */
export async function requestCamera(
  options: CameraOptions = {}
): Promise<{ stream: MediaStream | null; error: CameraErrorResult | null }> {
  if (typeof window === 'undefined') {
    return {
      stream: null,
      error: { code: 'SSR', message: 'SSR not supported', originalError: null },
    };
  }

  if (!window.isSecureContext) {
    const errorMsg =
      'Camera access requires a secure context (HTTPS or localhost/127.0.0.1).';
    console.error(`[Camera Error] Insecure context: ${location.origin}`);
    return {
      stream: null,
      error: {
        code: 'SecurityError',
        message: errorMsg,
        originalError: new Error(errorMsg),
      },
    };
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const errorMsg = 'Your browser does not support mediaDevices.getUserMedia.';
    console.error(`[Camera Error] mediaDevices missing:`, errorMsg);
    return {
      stream: null,
      error: {
        code: 'NotSupported',
        message: errorMsg,
        originalError: new Error(errorMsg),
      },
    };
  }

  const recommended = getRecommendedMediaConstraints(options);
  const {
    audio = false,
    video = true,
    facingMode = 'user',
    deviceId,
    idealWidth = recommended.idealWidth,
    idealHeight = recommended.idealHeight,
  } = options;

  // Build video constraints using ideal values (never exact) to prevent OverconstrainedError
  const videoConstraints: MediaTrackConstraints | boolean = video
    ? {
        width: { ideal: idealWidth },
        height: { ideal: idealHeight },
        frameRate: { ideal: recommended.frameRate, max: 30 },
      }
    : false;

  if (video && typeof videoConstraints === 'object') {
    if (deviceId) {
      videoConstraints.deviceId = { ideal: deviceId };
    } else if (facingMode) {
      videoConstraints.facingMode = { ideal: facingMode };
    }
  }

  // First attempt: with audio if requested
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
      audio: audio ? { echoCancellation: true, noiseSuppression: true } : false,
    });
    return { stream, error: null };
  } catch (err: any) {
    console.warn(
      `[Camera Attempt 1 Failed] ${err?.name || 'Error'}: ${err?.message || ''}. Retrying...`
    );

    // If audio was requested and caused failure (e.g. no mic), try video-only
    if (audio) {
      try {
        const videoOnlyStream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });
        console.info('[Camera] Video-only fallback succeeded.');
        return { stream: videoOnlyStream, error: null };
      } catch (secondErr: any) {
        console.warn(`[Camera Attempt 2 Failed]`, secondErr);
      }
    }

    // If overconstrained or not readable with dimensions, try minimal video constraint
    if (err?.name === 'OverconstrainedError' || err?.name === 'NotReadableError') {
      try {
        const relaxedStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        console.info('[Camera] Relaxed video constraints succeeded.');
        return { stream: relaxedStream, error: null };
      } catch (relaxedErr: any) {
        console.warn(`[Camera Attempt 3 Failed]`, relaxedErr);
      }
    }

    const friendlyMessage = getFriendlyCameraErrorMessage(err);
    return {
      stream: null,
      error: {
        code: err?.name || 'CameraError',
        message: friendlyMessage,
        originalError: err,
      },
    };
  }
}

/**
 * React hook managing camera lifecycle, tracks cleanup, StrictMode double-mounting,
 * and device switching.
 */
export function useCamera(defaultOptions: CameraOptions = {}) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>(
    defaultOptions.facingMode || 'user'
  );
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(
    defaultOptions.deviceId
  );
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  const activeStreamRef = useRef<MediaStream | null>(null);
  const isMountedRef = useRef(true);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordIntervalRef = useRef<number | null>(null);

  // Synchronize activeStreamRef with state
  useEffect(() => {
    activeStreamRef.current = stream;
  }, [stream]);

  // Clean stop helper
  const stop = useCallback(() => {
    if (recordIntervalRef.current) {
      clearInterval(recordIntervalRef.current);
      recordIntervalRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
    setIsRecordingVideo(false);
    setRecordSeconds(0);

    if (activeStreamRef.current) {
      stopMediaStream(activeStreamRef.current);
      activeStreamRef.current = null;
    }
    if (isMountedRef.current) {
      setStream(null);
      setStatus('idle');
      setErrorMessage(null);
    }
  }, []);

  // Enumerate video devices
  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((d) => d.kind === 'videoinput');
      if (isMountedRef.current) {
        setAvailableDevices(videoDevices);
      }
    } catch (e) {
      console.warn('Failed to enumerate devices:', e);
    }
  }, []);

  // Start camera
  const start = useCallback(
    async (optionsOverride?: Partial<CameraOptions>) => {
      // Clean up previous stream first
      if (activeStreamRef.current) {
        stopMediaStream(activeStreamRef.current);
        activeStreamRef.current = null;
      }

      setStatus('requesting');
      setErrorMessage(null);

      const targetFacingMode = optionsOverride?.facingMode || facingMode;
      const targetDeviceId = optionsOverride?.deviceId || selectedDeviceId;
      const targetAudio = optionsOverride?.audio ?? defaultOptions.audio ?? false;

      const { stream: newStream, error } = await requestCamera({
        ...defaultOptions,
        ...optionsOverride,
        facingMode: targetFacingMode,
        deviceId: targetDeviceId,
        audio: targetAudio,
      });

      if (!isMountedRef.current) {
        stopMediaStream(newStream);
        return;
      }

      if (error || !newStream) {
        setStatus(
          error?.code === 'NotAllowedError'
            ? 'denied'
            : error?.code === 'NotFoundError'
            ? 'unavailable'
            : 'error'
        );
        setErrorMessage(error?.message || 'Failed to open camera.');
        setStream(null);
      } else {
        activeStreamRef.current = newStream;
        setStream(newStream);
        setStatus('ready');
        setErrorMessage(null);
        refreshDevices();
      }
    },
    [defaultOptions, facingMode, selectedDeviceId, refreshDevices]
  );

  // Switch between front & back camera
  const switchCamera = useCallback(async () => {
    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextFacing);

    // If device list has multiple video inputs, cycle deviceId
    if (availableDevices.length > 1) {
      const currentIndex = availableDevices.findIndex(
        (d) => d.deviceId === selectedDeviceId
      );
      const nextDevice =
        availableDevices[(currentIndex + 1) % availableDevices.length];
      setSelectedDeviceId(nextDevice.deviceId);
      await start({ deviceId: nextDevice.deviceId, facingMode: nextFacing });
    } else {
      await start({ facingMode: nextFacing });
    }
  }, [facingMode, availableDevices, selectedDeviceId, start]);

  // Capture still photo to Blob
  const capturePhoto = useCallback(
    async (videoElement: HTMLVideoElement | null): Promise<File | null> => {
      if (!videoElement) return null;
      const videoWidth = videoElement.videoWidth || 640;
      const videoHeight = videoElement.videoHeight || 480;

      const canvas = document.createElement('canvas');
      canvas.width = videoWidth;
      canvas.height = videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      // If front camera, mirror image back to natural orientation
      if (facingMode === 'user') {
        ctx.translate(videoWidth, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(videoElement, 0, 0, videoWidth, videoHeight);

      return new Promise<File | null>((resolve) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(null);
              return;
            }
            const file = new File([blob], `camera-${Date.now()}.jpg`, {
              type: 'image/jpeg',
            });
            resolve(file);
          },
          'image/jpeg',
          0.9
        );
      });
    },
    [facingMode]
  );

  // Record video from camera stream
  const startRecording = useCallback(() => {
    if (!activeStreamRef.current) return;
    recordedChunksRef.current = [];

    try {
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : 'video/mp4';

      const recorder = new MediaRecorder(activeStreamRef.current, { mimeType });
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.start(200); // 200ms slice
      mediaRecorderRef.current = recorder;
      setIsRecordingVideo(true);
      setRecordSeconds(0);

      recordIntervalRef.current = window.setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch (e) {
      console.error('Failed to start MediaRecorder:', e);
    }
  }, []);

  const stopRecording = useCallback((): Promise<File | null> => {
    return new Promise((resolve) => {
      if (recordIntervalRef.current) {
        clearInterval(recordIntervalRef.current);
        recordIntervalRef.current = null;
      }
      setIsRecordingVideo(false);

      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        resolve(null);
        return;
      }

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'video/webm';
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        const file = new File([blob], `video-${Date.now()}.${ext}`, {
          type: mimeType,
        });
        recordedChunksRef.current = [];
        resolve(file);
      };

      try {
        recorder.stop();
      } catch {
        resolve(null);
      }
    });
  }, []);

  // Listen to browser permission change where supported
  useEffect(() => {
    isMountedRef.current = true;

    if (navigator.permissions && (navigator.permissions as any).query) {
      try {
        (navigator.permissions as any)
          .query({ name: 'camera' })
          .then((permissionStatus: any) => {
            if (!isMountedRef.current) return;
            permissionStatus.onchange = () => {
              if (permissionStatus.state === 'denied') {
                setStatus('denied');
                setErrorMessage(
                  'Camera permission was revoked. Please enable camera access in browser settings.'
                );
              }
            };
          })
          .catch(() => {
            // Safari / Firefox do not support permissions.query('camera'), ignore safely
          });
      } catch {}
    }

    return () => {
      isMountedRef.current = false;
      stop();
    };
  }, [stop]);

  return {
    stream,
    status,
    errorMessage,
    facingMode,
    availableDevices,
    selectedDeviceId,
    isRecordingVideo,
    recordSeconds,
    start,
    stop,
    switchCamera,
    capturePhoto,
    startRecording,
    stopRecording,
  };
}
