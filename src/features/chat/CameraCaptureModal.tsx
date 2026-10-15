import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Camera,
  RefreshCw,
  AlertCircle,
  Check,
  RotateCcw,
  Square,
  Circle,
} from 'lucide-react';
import { useCamera } from '../../lib/media';
import { soundEffects } from '../../lib/sound';
import { saveMediaToDevice, generateCleanMediaFileName } from '../../lib/saveMedia';

interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMediaCaptured: (file: File) => void;
}

export const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  isOpen,
  onClose,
  onMediaCaptured,
}) => {
  const [mode, setMode] = useState<'photo' | 'video'>('photo');
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saveToDevice, setSaveToDevice] = useState<boolean>(true);

  const videoRef = useRef<HTMLVideoElement>(null);

  const {
    stream,
    status,
    errorMessage,
    facingMode,
    isRecordingVideo,
    recordSeconds,
    start,
    stop,
    switchCamera,
    capturePhoto,
    startRecording,
    stopRecording,
  } = useCamera({ audio: true, facingMode: 'user' });

  // When modal opens, initialize camera
  useEffect(() => {
    if (isOpen) {
      setCapturedFile(null);
      setPreviewUrl(null);
      start({ audio: mode === 'video' });
    } else {
      stop();
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      }
      setCapturedFile(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Attach stream to video element
  useEffect(() => {
    if (videoRef.current && stream && !capturedFile) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, capturedFile]);

  // Clean up previewUrl on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Auto-stop recording if max duration reached (60 seconds)
  useEffect(() => {
    if (isRecordingVideo && recordSeconds >= 60) {
      handleStopRecord();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordSeconds, isRecordingVideo]);

  if (!isOpen) return null;

  const handleTakePhoto = async () => {
    soundEffects.playPop();
    const file = await capturePhoto(videoRef.current);
    if (file) {
      setCapturedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      stop();
    }
  };

  const handleStartRecord = () => {
    soundEffects.playPop();
    startRecording();
  };

  const handleStopRecord = async () => {
    soundEffects.playPop();
    const file = await stopRecording();
    if (file) {
      setCapturedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      stop();
    }
  };

  const handleRetake = () => {
    soundEffects.playPop();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setCapturedFile(null);
    start({ audio: mode === 'video' });
  };

  const handleSend = () => {
    if (!capturedFile) return;
    soundEffects.playPop();

    if (saveToDevice) {
      saveMediaToDevice(capturedFile, {
        fileName: generateCleanMediaFileName(capturedFile.name, mode),
        mimeType: capturedFile.type,
      });
    }

    onMediaCaptured(capturedFile);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-3xl bg-[var(--surface)] border-3 border-[var(--border)] overflow-hidden shadow-[0_8px_0_var(--shadow-color)] flex flex-col max-h-[92vh]">
        {/* Header Bar */}
        <div className="p-4 flex items-center justify-between border-b-2 border-[var(--border)] bg-[var(--surface)] z-10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[var(--accent)] text-[var(--text)] border border-[var(--border)] flex items-center justify-center shadow-xs">
              <Camera className="w-4 h-4" />
            </div>
            <h3 className="font-chunky text-base font-bold text-[var(--text)]">
              {capturedFile ? 'Preview Capture' : 'Camera'}
            </h3>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-full bg-[var(--surface-2)] hover:bg-[var(--surface-2)]/80 text-[var(--text)] border border-[var(--border)] flex items-center justify-center cursor-pointer shadow-xs"
            aria-label="Close camera"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Viewport Area */}
        <div className="relative flex-1 bg-black min-h-[360px] sm:min-h-[420px] flex items-center justify-center overflow-hidden">
          {capturedFile && previewUrl ? (
            /* Still / Video Preview */
            mode === 'photo' ? (
              <img
                src={previewUrl}
                alt="Captured"
                className="w-full h-full object-contain max-h-[500px]"
              />
            ) : (
              <video
                src={previewUrl}
                controls
                autoPlay
                playsInline
                className="w-full h-full object-contain max-h-[500px]"
              />
            )
          ) : status === 'ready' ? (
            /* Live Camera Feed */
            <div className="relative w-full h-full flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover max-h-[500px] ${
                  facingMode === 'user' ? 'scale-x-[-1]' : ''
                }`}
              />

              {/* Live recording indicator & timer */}
              {isRecordingVideo && (
                <div className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/75 text-white border border-red-500 shadow-md">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                  <span className="font-numeric text-xs font-bold tabular-nums">
                    0:{recordSeconds.toString().padStart(2, '0')} / 1:00
                  </span>
                </div>
              )}
            </div>
          ) : status === 'requesting' ? (
            /* Loading State */
            <div className="p-8 text-center text-white space-y-3">
              <RefreshCw className="w-8 h-8 mx-auto animate-spin text-[var(--accent)]" />
              <p className="font-ui text-sm">Starting camera preview...</p>
            </div>
          ) : (
            /* Error / Permission Denied State */
            <div className="p-6 text-center text-white max-w-sm space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-red-500/20 border-2 border-red-500 text-red-400 flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h4 className="font-chunky text-base font-bold text-red-300">
                Camera Unavailable
              </h4>
              <p className="font-ui text-xs text-stone-300 leading-relaxed">
                {errorMessage || 'Unable to access camera.'}
              </p>
              <button
                type="button"
                onClick={() => start({ audio: mode === 'video' })}
                className="mt-3 px-4 py-2 rounded-xl bg-[var(--accent)] text-[var(--text)] font-chunky font-bold text-xs border border-[var(--border)] shadow-xs cursor-pointer inline-flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Try Again</span>
              </button>
            </div>
          )}
        </div>

        {/* Bottom Controls Bar */}
        <div className="p-4 bg-[var(--surface)] border-t-2 border-[var(--border)] flex flex-col gap-3">
          {capturedFile ? (
            /* Retake / Send Buttons */
            <>
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleRetake}
                  className="flex-1 py-3 px-4 rounded-2xl bg-[var(--surface-2)] hover:bg-[var(--surface-2)]/80 text-[var(--text)] font-chunky font-bold text-sm border-2 border-[var(--border)] shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Retake</span>
                </button>

                <button
                  type="button"
                  onClick={handleSend}
                  className="flex-1 py-3 px-4 rounded-2xl bg-[var(--partner-a)] hover:opacity-90 text-white font-chunky font-bold text-sm border-2 border-[var(--border)] shadow-[0_3px_0_var(--shadow-color)] flex items-center justify-center gap-2 cursor-pointer active:translate-y-0.5"
                >
                  <Check className="w-4 h-4 stroke-[3]" />
                  <span>Send {mode === 'photo' ? 'Photo' : 'Video'}</span>
                </button>
              </div>

              <label className="flex items-center justify-center gap-2 cursor-pointer pt-1 text-xs font-ui text-[var(--text-muted)]">
                <input
                  type="checkbox"
                  checked={saveToDevice}
                  onChange={(e) => setSaveToDevice(e.target.checked)}
                  className="rounded border-[var(--border)] text-[var(--accent)]"
                />
                <span>Save a copy to my device (Camera Roll / Downloads)</span>
              </label>
            </>
          ) : (
            /* Live Camera Controls */
            <>
              {/* Photo vs Video Mode Switcher */}
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  disabled={isRecordingVideo}
                  onClick={() => {
                    setMode('photo');
                    start({ audio: false });
                  }}
                  className={`px-4 py-1 rounded-full font-ui text-xs font-bold transition-all cursor-pointer ${
                    mode === 'photo'
                      ? 'bg-[var(--accent)] text-[var(--text)] border border-[var(--border)] shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  Photo
                </button>
                <button
                  type="button"
                  disabled={isRecordingVideo}
                  onClick={() => {
                    setMode('video');
                    start({ audio: true });
                  }}
                  className={`px-4 py-1 rounded-full font-ui text-xs font-bold transition-all cursor-pointer ${
                    mode === 'video'
                      ? 'bg-[var(--accent)] text-[var(--text)] border border-[var(--border)] shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  Video
                </button>
              </div>

              {/* Shutter & Switch Buttons Row */}
              <div className="flex items-center justify-around pt-1">
                {/* Switch Camera Button (44px tap target) */}
                <button
                  type="button"
                  disabled={isRecordingVideo || status !== 'ready'}
                  onClick={switchCamera}
                  title="Switch front/back camera"
                  className="w-12 h-12 min-w-[44px] min-h-[44px] rounded-full bg-[var(--surface-2)] text-[var(--text)] border-2 border-[var(--border)] flex items-center justify-center shadow-xs disabled:opacity-30 cursor-pointer active:scale-95"
                  aria-label="Switch camera"
                >
                  <RefreshCw className="w-5 h-5" />
                </button>

                {/* Shutter Button (56px+ tap target) */}
                {mode === 'photo' ? (
                  <button
                    type="button"
                    disabled={status !== 'ready'}
                    onClick={handleTakePhoto}
                    title="Take Photo"
                    className="w-16 h-16 min-w-[56px] min-h-[56px] rounded-full bg-[var(--partner-a)] border-4 border-[var(--border)] text-white flex items-center justify-center shadow-[0_4px_0_var(--shadow-color)] active:translate-y-1 active:shadow-none transition-all disabled:opacity-40 cursor-pointer"
                    aria-label="Take Photo"
                  >
                    <Circle className="w-8 h-8 fill-white" />
                  </button>
                ) : isRecordingVideo ? (
                  <button
                    type="button"
                    onClick={handleStopRecord}
                    title="Stop Recording"
                    className="w-16 h-16 min-w-[56px] min-h-[56px] rounded-full bg-red-600 border-4 border-white text-white flex items-center justify-center shadow-md animate-pulse cursor-pointer"
                    aria-label="Stop Recording"
                  >
                    <Square className="w-6 h-6 fill-white" />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={status !== 'ready'}
                    onClick={handleStartRecord}
                    title="Start Recording"
                    className="w-16 h-16 min-w-[56px] min-h-[56px] rounded-full bg-red-500 border-4 border-[var(--border)] text-white flex items-center justify-center shadow-[0_4px_0_var(--shadow-color)] active:translate-y-1 active:shadow-none transition-all disabled:opacity-40 cursor-pointer"
                    aria-label="Start Recording"
                  >
                    <Circle className="w-8 h-8 fill-white" />
                  </button>
                )}

                {/* Placeholder spacer to balance layout */}
                <div className="w-12 h-12" />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
