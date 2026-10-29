import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Download,
  Share2,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize,
  Minimize,
  Play,
  Pause,
  Volume2,
  VolumeX,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import type { FileAttachment } from '../lib/attachments';
import { formatFileSize } from '../lib/attachments';
import { saveMediaToDevice } from '../lib/saveMedia';
import { soundEffects } from '../lib/sound';

export interface MediaViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: FileAttachment[];
  initialIndex?: number;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export const MediaViewerModal: React.FC<MediaViewerModalProps> = ({
  isOpen,
  onClose,
  items,
  initialIndex = 0,
}) => {
  // Filter for valid viewable media (photos and videos)
  const viewableItems = items.filter(
    (item) => item.type === 'image' || item.type === 'video'
  );

  const [currentIndex, setCurrentIndex] = useState<number>(initialIndex);
  const [controlsVisible, setControlsVisible] = useState(true);

  // Photo state
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState<number>(0);
  const [isImageLoading, setIsImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);

  // Video state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isVideoBuffering, setIsVideoBuffering] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const controlsTimeoutRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageContainerRef = useRef<HTMLDivElement | null>(null);

  // Touch gesture tracking for pinch-to-zoom & panning
  const touchStateRef = useRef<{
    initialDist: number;
    initialZoom: number;
    startX: number;
    startY: number;
    initialPanX: number;
    initialPanY: number;
    isPinching: boolean;
    isPanning: boolean;
  }>({
    initialDist: 0,
    initialZoom: 1,
    startX: 0,
    startY: 0,
    initialPanX: 0,
    initialPanY: 0,
    isPinching: false,
    isPanning: false,
  });

  // Mouse dragging state for panning when zoomed
  const mouseDragRef = useRef<{
    isDragging: boolean;
    startX: number;
    startY: number;
    initialPanX: number;
    initialPanY: number;
  }>({
    isDragging: false,
    startX: 0,
    startY: 0,
    initialPanX: 0,
    initialPanY: 0,
  });

  // Clamp current index within range
  const safeIndex = Math.max(0, Math.min(currentIndex, viewableItems.length - 1));
  const currentMedia: FileAttachment | undefined = viewableItems[safeIndex];

  // Reset transforms whenever changing media
  const resetMediaState = useCallback(() => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
    setRotation(0);
    setIsImageLoading(true);
    setImageError(false);

    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setIsVideoBuffering(false);
    setVideoError(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, []);

  // Update index when initialIndex changes or modal opens
  useEffect(() => {
    if (isOpen) {
      const idx = Math.max(0, Math.min(initialIndex, viewableItems.length - 1));
      setCurrentIndex(idx);
      resetMediaState();
    }
  }, [isOpen, initialIndex, viewableItems.length, resetMediaState]);

  // Lock body scroll while modal is open
  useEffect(() => {
    if (!isOpen) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = orig;
    };
  }, [isOpen]);

  // Inactivity timer for fading controls
  const bumpActivity = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      // Keep controls visible if video is paused, or zoomed in
      if (!isPlaying) return;
      setControlsVisible(false);
    }, 3500);
  }, [isPlaying]);

  useEffect(() => {
    bumpActivity();
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [bumpActivity]);

  // Navigate prev/next
  const handlePrev = useCallback(() => {
    if (viewableItems.length <= 1) return;
    soundEffects.playPop();
    resetMediaState();
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : viewableItems.length - 1));
    bumpActivity();
  }, [viewableItems.length, resetMediaState, bumpActivity]);

  const handleNext = useCallback(() => {
    if (viewableItems.length <= 1) return;
    soundEffects.playPop();
    resetMediaState();
    setCurrentIndex((prev) => (prev < viewableItems.length - 1 ? prev + 1 : 0));
    bumpActivity();
  }, [viewableItems.length, resetMediaState, bumpActivity]);

  const handleClose = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
    resetMediaState();
    onClose();
  }, [onClose, resetMediaState]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      } else if (e.key === ' ' && currentMedia?.type === 'video') {
        e.preventDefault();
        togglePlayPause();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose, handlePrev, handleNext, currentMedia?.type]);

  // Video Controls
  const togglePlayPause = () => {
    if (!videoRef.current) return;
    bumpActivity();
    if (videoRef.current.paused) {
      videoRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setVideoError(true));
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setCurrentTime(val);
    if (videoRef.current) {
      videoRef.current.currentTime = val;
    }
    bumpActivity();
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    setIsMuted(val === 0);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
    }
    bumpActivity();
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    videoRef.current.muted = nextMute;
    if (!nextMute && volume === 0) {
      setVolume(0.5);
      videoRef.current.volume = 0.5;
    }
    bumpActivity();
  };

  const cycleSpeed = () => {
    const speeds = [0.5, 1, 1.25, 1.5, 2];
    const nextIdx = (speeds.indexOf(playbackSpeed) + 1) % speeds.length;
    const nextSpeed = speeds[nextIdx];
    setPlaybackSpeed(nextSpeed);
    if (videoRef.current) {
      videoRef.current.playbackRate = nextSpeed;
    }
    bumpActivity();
  };

  const toggleFullscreen = async () => {
    bumpActivity();
    try {
      if (!document.fullscreenElement) {
        if (stageContainerRef.current?.requestFullscreen) {
          await stageContainerRef.current.requestFullscreen();
          setIsFullscreen(true);
        } else if ((videoRef.current as any)?.webkitEnterFullscreen) {
          (videoRef.current as any).webkitEnterFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
          setIsFullscreen(false);
        }
      }
    } catch {
      // Fullscreen not allowed or not supported
    }
  };

  // Photo Zoom & Pan controls
  const handleZoomIn = () => {
    bumpActivity();
    setZoomLevel((z) => Math.min(z + 0.5, 4));
  };

  const handleZoomOut = () => {
    bumpActivity();
    setZoomLevel((z) => {
      const next = Math.max(z - 0.5, 1);
      if (next === 1) setPanOffset({ x: 0, y: 0 });
      return next;
    });
  };

  const handleResetZoom = () => {
    bumpActivity();
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
    setRotation(0);
  };

  const handleRotate = () => {
    bumpActivity();
    setRotation((r) => (r + 90) % 360);
  };

  // Touch Pinch and Pan Handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    bumpActivity();
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStateRef.current = {
        initialDist: dist,
        initialZoom: zoomLevel,
        startX: 0,
        startY: 0,
        initialPanX: panOffset.x,
        initialPanY: panOffset.y,
        isPinching: true,
        isPanning: false,
      };
    } else if (e.touches.length === 1 && zoomLevel > 1) {
      touchStateRef.current = {
        initialDist: 0,
        initialZoom: zoomLevel,
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        initialPanX: panOffset.x,
        initialPanY: panOffset.y,
        isPinching: false,
        isPanning: true,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    bumpActivity();
    if (touchStateRef.current.isPinching && e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (touchStateRef.current.initialDist > 0) {
        const factor = dist / touchStateRef.current.initialDist;
        const newZoom = Math.min(Math.max(touchStateRef.current.initialZoom * factor, 1), 4);
        setZoomLevel(newZoom);
        if (newZoom <= 1) setPanOffset({ x: 0, y: 0 });
      }
    } else if (touchStateRef.current.isPanning && e.touches.length === 1 && zoomLevel > 1) {
      const deltaX = e.touches[0].clientX - touchStateRef.current.startX;
      const deltaY = e.touches[0].clientY - touchStateRef.current.startY;
      setPanOffset({
        x: touchStateRef.current.initialPanX + deltaX,
        y: touchStateRef.current.initialPanY + deltaY,
      });
    }
  };

  const handleTouchEnd = () => {
    touchStateRef.current.isPinching = false;
    touchStateRef.current.isPanning = false;
  };

  // Mouse Drag to Pan Handlers (when zoomed)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoomLevel <= 1) return;
    mouseDragRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      initialPanX: panOffset.x,
      initialPanY: panOffset.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    bumpActivity();
    if (!mouseDragRef.current.isDragging || zoomLevel <= 1) return;
    const deltaX = e.clientX - mouseDragRef.current.startX;
    const deltaY = e.clientY - mouseDragRef.current.startY;
    setPanOffset({
      x: mouseDragRef.current.initialPanX + deltaX,
      y: mouseDragRef.current.initialPanY + deltaY,
    });
  };

  const handleMouseUp = () => {
    mouseDragRef.current.isDragging = false;
  };

  // Save / Share Media
  const handleDownload = async () => {
    if (!currentMedia) return;
    soundEffects.playPop();
    await saveMediaToDevice(currentMedia.url, {
      fileName: currentMedia.fileName,
      mimeType: currentMedia.mimeType,
    });
  };

  const handleShare = async () => {
    if (!currentMedia) return;
    soundEffects.playPop();
    if (navigator.share) {
      try {
        await navigator.share({
          title: currentMedia.fileName,
          url: currentMedia.url,
        });
      } catch {}
    } else {
      await navigator.clipboard.writeText(currentMedia.url);
      alert('Link copied to clipboard!');
    }
  };

  if (!isOpen || !currentMedia) return null;

  const isVideo = currentMedia.type === 'video';
  const totalCount = viewableItems.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Full-screen media viewer"
      ref={stageContainerRef}
      onMouseMove={bumpActivity}
      onClick={bumpActivity}
      className="fixed inset-0 z-[80] bg-black flex flex-col justify-between overflow-hidden select-none animate-in fade-in duration-200"
    >
      {/* ── TOP HEADER BAR ── */}
      <div
        className={`shrink-0 flex items-center justify-between text-white z-30 transition-opacity duration-300 pt-[calc(12px+env(safe-area-inset-top,0px))] px-3 sm:px-6 pb-3 bg-gradient-to-b from-black/80 via-black/40 to-transparent ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0 pr-2">
          {totalCount > 1 && (
            <span className="font-numeric font-bold text-xs bg-white/20 px-2.5 py-1 rounded-full shrink-0">
              {safeIndex + 1} / {totalCount}
            </span>
          )}
          <span className="font-ui text-xs sm:text-sm font-semibold truncate text-white/90">
            {currentMedia.fileName}
          </span>
          <span className="hidden sm:inline font-numeric text-[11px] text-white/60 shrink-0">
            ({formatFileSize(currentMedia.size)})
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {!isVideo && (
            <>
              <button
                type="button"
                onClick={handleZoomOut}
                disabled={zoomLevel <= 1}
                aria-label="Zoom out"
                className="w-10 h-10 min-w-[40px] rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white flex items-center justify-center cursor-pointer transition-colors"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleZoomIn}
                disabled={zoomLevel >= 4}
                aria-label="Zoom in"
                className="w-10 h-10 min-w-[40px] rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white flex items-center justify-center cursor-pointer transition-colors"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleRotate}
                aria-label="Rotate clockwise"
                className="w-10 h-10 min-w-[40px] rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition-colors"
              >
                <RotateCw className="w-4 h-4" />
              </button>
              {(zoomLevel > 1 || rotation !== 0) && (
                <button
                  type="button"
                  onClick={handleResetZoom}
                  aria-label="Reset zoom and rotation"
                  className="px-2.5 h-10 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-ui font-semibold text-white flex items-center justify-center cursor-pointer transition-colors"
                >
                  Reset
                </button>
              )}
            </>
          )}

          <button
            type="button"
            onClick={handleShare}
            aria-label="Share media"
            className="w-10 h-10 min-w-[40px] rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition-colors"
          >
            <Share2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleDownload}
            aria-label="Download media"
            className="w-10 h-10 min-w-[40px] rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition-colors"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close viewer"
            className="w-10 h-10 min-w-[40px] rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center cursor-pointer transition-colors ml-1"
          >
            <X className="w-5 h-5 stroke-[2.5]" />
          </button>
        </div>
      </div>

      {/* ── MAIN MEDIA STAGE ── */}
      <div
        className="relative flex-1 w-full h-full flex items-center justify-center overflow-hidden min-h-0"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Navigation Buttons */}
        {totalCount > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handlePrev();
            }}
            aria-label="Previous attachment"
            className={`absolute left-2 sm:left-4 z-30 w-11 h-11 min-w-[44px] rounded-full bg-black/60 hover:bg-black/80 text-white border border-white/20 flex items-center justify-center transition-all cursor-pointer ${
              controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        {totalCount > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            aria-label="Next attachment"
            className={`absolute right-2 sm:right-4 z-30 w-11 h-11 min-w-[44px] rounded-full bg-black/60 hover:bg-black/80 text-white border border-white/20 flex items-center justify-center transition-all cursor-pointer ${
              controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}

        {/* 1. PHOTO DISPLAY */}
        {!isVideo && (
          <div className="relative w-full h-full flex items-center justify-center p-2">
            {isImageLoading && !imageError && (
              <div className="absolute inset-0 flex items-center justify-center">
                <RefreshCw className="w-8 h-8 text-white/50 animate-spin" />
              </div>
            )}

            {imageError ? (
              <div className="text-center p-6 text-white space-y-3">
                <span className="text-4xl">📷</span>
                <p className="font-ui text-sm font-semibold text-white/80">Failed to load photo</p>
                <button
                  type="button"
                  onClick={() => {
                    setImageError(false);
                    setIsImageLoading(true);
                  }}
                  className="px-4 py-2 rounded-xl bg-white/20 hover:bg-white/30 text-xs font-bold text-white cursor-pointer"
                >
                  Retry
                </button>
              </div>
            ) : (
              <img
                src={currentMedia.url}
                alt={currentMedia.fileName}
                onLoad={() => setIsImageLoading(false)}
                onError={() => {
                  setIsImageLoading(false);
                  setImageError(true);
                }}
                style={{
                  transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel}) rotate(${rotation}deg)`,
                  cursor: zoomLevel > 1 ? 'grab' : 'default',
                }}
                className="max-h-[82vh] max-h-[82dvh] max-w-[96vw] object-contain transition-transform duration-75 select-none"
                draggable={false}
              />
            )}
          </div>
        )}

        {/* 2. VIDEO DISPLAY */}
        {isVideo && (
          <div className="relative w-full h-full flex items-center justify-center p-2">
            {isVideoBuffering && !videoError && (
              <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                <div className="w-12 h-12 rounded-full bg-black/60 flex items-center justify-center">
                  <RefreshCw className="w-6 h-6 text-white animate-spin" />
                </div>
              </div>
            )}

            {videoError ? (
              <div className="text-center p-6 text-white space-y-3 z-10">
                <span className="text-4xl">🎬</span>
                <p className="font-ui text-sm font-semibold text-white/80">
                  Could not play this video.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setVideoError(false);
                    if (videoRef.current) {
                      videoRef.current.load();
                      videoRef.current.play().catch(() => setVideoError(true));
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-white/20 hover:bg-white/30 text-xs font-bold text-white cursor-pointer"
                >
                  Retry Playback
                </button>
              </div>
            ) : (
              <video
                ref={videoRef}
                src={currentMedia.url}
                playsInline
                preload="metadata"
                onClick={togglePlayPause}
                onTimeUpdate={() => {
                  if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
                }}
                onDurationChange={() => {
                  if (videoRef.current) setDuration(videoRef.current.duration);
                }}
                onWaiting={() => setIsVideoBuffering(true)}
                onPlaying={() => setIsVideoBuffering(false)}
                onEnded={() => setIsPlaying(false)}
                onError={() => {
                  setIsVideoBuffering(false);
                  setVideoError(true);
                }}
                className="max-h-[80vh] max-h-[80dvh] max-w-[96vw] object-contain select-none cursor-pointer"
              />
            )}
          </div>
        )}
      </div>

      {/* ── BOTTOM VIDEO CONTROLS & PHOTO FOOTER BAR ── */}
      <div
        className={`shrink-0 z-30 transition-opacity duration-300 pb-[calc(14px+env(safe-area-inset-bottom,0px))] px-3 sm:px-6 pt-3 bg-gradient-to-t from-black/90 via-black/60 to-transparent ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {isVideo ? (
          /* Custom Video Action Bar */
          <div className="w-full max-w-3xl mx-auto space-y-2">
            {/* Seek Bar */}
            <div className="flex items-center gap-2">
              <span className="font-numeric text-[11px] text-white/80 min-w-[36px] text-right">
                {formatTime(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={duration || 100}
                step={0.1}
                value={currentTime}
                onChange={handleSeek}
                aria-label="Seek video position"
                className="flex-1 h-2 bg-white/30 rounded-lg appearance-none cursor-pointer accent-[var(--partner-a)]"
              />
              <span className="font-numeric text-[11px] text-white/80 min-w-[36px]">
                {formatTime(duration)}
              </span>
            </div>

            {/* Playback Controls Row */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 sm:gap-2">
                <button
                  type="button"
                  onClick={togglePlayPause}
                  aria-label={isPlaying ? 'Pause video' : 'Play video'}
                  className="w-11 h-11 min-w-[44px] rounded-2xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center cursor-pointer transition-colors"
                >
                  {isPlaying ? (
                    <Pause className="w-5 h-5 fill-current" />
                  ) : (
                    <Play className="w-5 h-5 fill-current ml-0.5" />
                  )}
                </button>

                {/* Volume / Mute */}
                <div className="flex items-center gap-1.5 ml-1">
                  <button
                    type="button"
                    onClick={toggleMute}
                    aria-label={isMuted ? 'Unmute' : 'Mute'}
                    className="w-10 h-10 min-w-[40px] rounded-xl hover:bg-white/10 text-white flex items-center justify-center cursor-pointer"
                  >
                    {isMuted || volume === 0 ? (
                      <VolumeX className="w-4 h-4 text-red-400" />
                    ) : (
                      <Volume2 className="w-4 h-4" />
                    )}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={isMuted ? 0 : volume}
                    onChange={handleVolumeChange}
                    aria-label="Adjust volume"
                    className="hidden sm:block w-16 sm:w-20 h-1.5 bg-white/30 rounded-lg appearance-none cursor-pointer accent-white"
                  />
                </div>
              </div>

              {/* Speed & Fullscreen */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={cycleSpeed}
                  aria-label={`Playback speed ${playbackSpeed}x`}
                  className="px-2.5 h-9 rounded-xl bg-white/15 hover:bg-white/25 text-white font-numeric text-xs font-bold flex items-center justify-center cursor-pointer transition-colors"
                >
                  {playbackSpeed}x
                </button>

                <button
                  type="button"
                  onClick={toggleFullscreen}
                  aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                  className="w-10 h-10 min-w-[40px] rounded-xl bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer transition-colors"
                >
                  {isFullscreen ? (
                    <Minimize className="w-4 h-4" />
                  ) : (
                    <Maximize className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Photo Footer Hint */
          <div className="text-center text-white/60 font-numeric text-xs">
            {zoomLevel > 1
              ? `Zoom: ${(zoomLevel * 100).toFixed(0)}% • Drag or swipe to pan`
              : 'Pinch with 2 fingers or use zoom buttons to enlarge'}
          </div>
        )}
      </div>
    </div>
  );
};

