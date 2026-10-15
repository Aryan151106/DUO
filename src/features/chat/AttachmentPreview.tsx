import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Download,
  Share2,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  FileText,
  Play,
  ExternalLink,
  Paperclip,
} from 'lucide-react';
import type { FileAttachment } from '../../lib/attachments';
import { formatFileSize } from '../../lib/attachments';
import { soundEffects } from '../../lib/sound';
import { saveMediaToDevice } from '../../lib/saveMedia';

interface AttachmentPreviewProps {
  attachments: FileAttachment[];
  compactTaskChip?: boolean;
  variant?: 'bubble' | 'gallery';
}

export const AttachmentPreview: React.FC<AttachmentPreviewProps> = ({
  attachments,
  compactTaskChip = false,
  variant = 'bubble',
}) => {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null);

  const images = attachments.filter((a) => a.type === 'image');
  const videos = attachments.filter((a) => a.type === 'video');
  const docs = attachments.filter((a) => a.type === 'document');

  // Handle keyboard navigation in Lightbox
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (lightboxIndex === null) return;
      if (e.key === 'Escape') {
        setLightboxIndex(null);
        setZoomLevel(1);
      } else if (e.key === 'ArrowLeft') {
        setLightboxIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : images.length - 1));
        setZoomLevel(1);
      } else if (e.key === 'ArrowRight') {
        setLightboxIndex((prev) => (prev !== null && prev < images.length - 1 ? prev + 1 : 0));
        setZoomLevel(1);
      }
    },
    [lightboxIndex, images.length]
  );

  useEffect(() => {
    if (lightboxIndex !== null) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxIndex, handleKeyDown]);

  const handleDownload = async (att: FileAttachment) => {
    soundEffects.playPop();
    await saveMediaToDevice(att.url, {
      fileName: att.fileName,
      mimeType: att.mimeType,
    });
  };

  const handleShare = async (att: FileAttachment) => {
    soundEffects.playPop();
    if (navigator.share) {
      try {
        await navigator.share({
          title: att.fileName,
          url: att.url,
        });
      } catch {
        // User cancelled or share failed
      }
    } else {
      await navigator.clipboard.writeText(att.url);
      alert('Link copied to clipboard!');
    }
  };

  if (attachments.length === 0) return null;

  // Compact chip mode for tasks
  if (compactTaskChip) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        <button
          type="button"
          onClick={() => {
            soundEffects.playPop();
            if (images.length > 0) setLightboxIndex(0);
          }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface)] text-[var(--text)] border-2 border-[var(--border)] text-[11px] font-ui font-semibold shadow-xs cursor-pointer"
        >
          <Paperclip className="w-3.5 h-3.5" />
          <span>
            {attachments.length} Attachment{attachments.length > 1 ? 's' : ''}
          </span>
        </button>

        {/* Mini thumbnails if images */}
        {images.slice(0, 3).map((img, idx) => (
          <img
            key={img.id}
            src={img.url}
            alt={img.fileName}
            onClick={() => {
              soundEffects.playPop();
              setLightboxIndex(idx);
            }}
            className="w-6 h-6 rounded-lg object-cover border border-[var(--border)] cursor-pointer hover:scale-105 transition-transform"
          />
        ))}

        {/* Render lightbox if clicked */}
        {lightboxIndex !== null && images[lightboxIndex] && (
          <LightboxModal
            image={images[lightboxIndex]}
            currentIndex={lightboxIndex}
            totalCount={images.length}
            zoomLevel={zoomLevel}
            onPrev={() => {
              setLightboxIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : images.length - 1));
              setZoomLevel(1);
            }}
            onNext={() => {
              setLightboxIndex((prev) => (prev !== null && prev < images.length - 1 ? prev + 1 : 0));
              setZoomLevel(1);
            }}
            onClose={() => {
              setLightboxIndex(null);
              setZoomLevel(1);
            }}
            onZoomIn={() => setZoomLevel((z) => Math.min(z + 0.5, 3))}
            onZoomOut={() => setZoomLevel((z) => Math.max(z - 0.5, 0.5))}
            onDownload={() => handleDownload(images[lightboxIndex])}
            onShare={() => handleShare(images[lightboxIndex])}
          />
        )}
      </div>
    );
  }

  const isGallery = variant === 'gallery';

  return (
    <div className={`space-y-4 ${isGallery ? 'w-full' : 'mt-1 max-w-md space-y-2'}`}>
      {/* 1. Images Grid */}
      {images.length > 0 && (
        <div
          className={`overflow-hidden ${
            isGallery
              ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 w-full'
              : `grid gap-1.5 rounded-2xl ${
                  images.length === 1
                    ? 'grid-cols-1 max-w-[280px]'
                    : images.length === 2
                    ? 'grid-cols-2 max-w-[340px]'
                    : 'grid-cols-2 max-w-[340px]'
                }`
          }`}
        >
          {(isGallery ? images : images.slice(0, 4)).map((img, idx) => {
            const isFourthAndMore = !isGallery && idx === 3 && images.length > 4;
            const extraCount = images.length - 4;

            return (
              <div
                key={img.id}
                onClick={() => {
                  soundEffects.playPop();
                  setLightboxIndex(idx);
                }}
                className={`relative aspect-square overflow-hidden bg-[var(--surface-2)] cursor-pointer group rounded-2xl border-2 border-[var(--border)] shadow-xs hover:border-[var(--partner-a)] transition-all`}
              >
                <img
                  src={img.url}
                  alt={img.fileName}
                  className="w-full h-full object-cover transition-transform group-hover:scale-105"
                  loading="lazy"
                />

                {isFourthAndMore && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white font-chunky text-xl font-bold">
                    +{extraCount}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 2. Videos List */}
      {videos.length > 0 && (
        <div className={isGallery ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 w-full' : 'space-y-2'}>
          {videos.map((vid) => (
            <div
              key={vid.id}
              className={`relative rounded-2xl overflow-hidden bg-black border-2 border-[var(--border)] shadow-xs ${
                isGallery ? 'w-full' : 'max-w-[320px]'
              }`}
            >
              {activeVideoUrl === vid.url ? (
                <video
                  src={vid.url}
                  controls
                  autoPlay
                  playsInline
                  className="w-full max-h-[300px] object-contain"
                />
              ) : (
                <div
                  onClick={() => setActiveVideoUrl(vid.url)}
                  className="relative aspect-video bg-[var(--surface-2)] flex items-center justify-center cursor-pointer group"
                >
                  {vid.thumbnailUrl ? (
                    <img
                      src={vid.thumbnailUrl}
                      alt={vid.fileName}
                      className="w-full h-full object-cover opacity-80"
                    />
                  ) : (
                    <div className="w-full h-full bg-[var(--surface-2)] flex items-center justify-center" />
                  )}
                  <div className="absolute w-12 h-12 rounded-full bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] flex items-center justify-center shadow-[0_2px_0_var(--shadow-color)] group-hover:scale-110 transition-transform">
                    <Play className="w-5 h-5 fill-current ml-0.5" />
                  </div>
                  <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-lg bg-black/70 text-white font-numeric text-[10px]">
                    {formatFileSize(vid.size)}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 3. Documents Cards */}
      {docs.length > 0 && (
        <div className={isGallery ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 w-full' : 'space-y-2'}>
          {docs.map((doc) => (
            <div
              key={doc.id}
              className={`flex items-center justify-between gap-3 p-3 rounded-2xl bg-[var(--surface-2)] hover:bg-[var(--surface-2)]/80 text-[var(--text)] border-2 border-[var(--border)] shadow-xs transition-colors ${
                isGallery ? 'w-full' : 'max-w-sm'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-[var(--accent)]/30 text-[var(--text)] border border-[var(--border)] flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 stroke-[2.2]" />
                </div>
                <div className="min-w-0">
                  <h5 className="font-ui font-semibold text-xs truncate">{doc.fileName}</h5>
                  <span className="font-numeric text-[10px] text-[var(--text-muted)]">
                    {formatFileSize(doc.size)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => handleDownload(doc)}
                  title="Download file"
                  className="p-1.5 rounded-xl hover:bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open file"
                  className="p-1.5 rounded-xl hover:bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] cursor-pointer inline-flex items-center"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Full-Screen Lightbox Modal */}
      {lightboxIndex !== null && images[lightboxIndex] && (
        <LightboxModal
          image={images[lightboxIndex]}
          currentIndex={lightboxIndex}
          totalCount={images.length}
          zoomLevel={zoomLevel}
          onPrev={() => {
            setLightboxIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : images.length - 1));
            setZoomLevel(1);
          }}
          onNext={() => {
            setLightboxIndex((prev) => (prev !== null && prev < images.length - 1 ? prev + 1 : 0));
            setZoomLevel(1);
          }}
          onClose={() => {
            setLightboxIndex(null);
            setZoomLevel(1);
          }}
          onZoomIn={() => setZoomLevel((z) => Math.min(z + 0.5, 3))}
          onZoomOut={() => setZoomLevel((z) => Math.max(z - 0.5, 0.5))}
          onDownload={() => handleDownload(images[lightboxIndex])}
          onShare={() => handleShare(images[lightboxIndex])}
        />
      )}
    </div>
  );
};

interface LightboxModalProps {
  image: FileAttachment;
  currentIndex: number;
  totalCount: number;
  zoomLevel: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onDownload: () => void;
  onShare: () => void;
}

const LightboxModal: React.FC<LightboxModalProps> = ({
  image,
  currentIndex,
  totalCount,
  zoomLevel,
  onPrev,
  onNext,
  onClose,
  onZoomIn,
  onZoomOut,
  onDownload,
  onShare,
}) => {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/95 flex flex-col justify-between p-4 animate-in fade-in duration-200 backdrop-blur-md"
    >
      {/* Lightbox Header */}
      <div className="flex items-center justify-between text-white z-10">
        <div className="flex items-center gap-2">
          <span className="font-numeric font-bold text-xs bg-white/20 px-2.5 py-1 rounded-full">
            {currentIndex + 1} / {totalCount}
          </span>
          <span className="font-ui text-xs truncate max-w-[200px] sm:max-w-md text-white/80">
            {image.fileName}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onZoomOut}
            title="Zoom out"
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onZoomIn}
            title="Zoom in"
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onShare}
            title="Share"
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
          >
            <Share2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onDownload}
            title="Download"
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="p-2 rounded-xl bg-white/20 hover:bg-white/30 text-white cursor-pointer ml-2"
          >
            <X className="w-5 h-5 stroke-[2.5]" />
          </button>
        </div>
      </div>

      {/* Main Image Stage */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden my-4">
        {totalCount > 1 && (
          <button
            type="button"
            onClick={onPrev}
            className="absolute left-2 sm:left-6 z-20 p-3 rounded-full bg-white/10 hover:bg-white/30 text-white transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        <img
          src={image.url}
          alt={image.fileName}
          style={{ transform: `scale(${zoomLevel})` }}
          className="max-h-[85vh] max-w-[90vw] object-contain transition-transform duration-150 select-none"
        />

        {totalCount > 1 && (
          <button
            type="button"
            onClick={onNext}
            className="absolute right-2 sm:right-6 z-20 p-3 rounded-full bg-white/10 hover:bg-white/30 text-white transition-colors cursor-pointer"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>

      {/* Bottom Info */}
      <div className="text-center text-white/60 font-numeric text-xs">
        {formatFileSize(image.size)} • Pinch or use zoom buttons
      </div>
    </div>
  );
};
