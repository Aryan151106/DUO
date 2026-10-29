import React, { useState } from 'react';
import {
  Download,
  FileText,
  Play,
  ExternalLink,
  Paperclip,
} from 'lucide-react';
import type { FileAttachment } from '../../lib/attachments';
import { formatFileSize } from '../../lib/attachments';
import { soundEffects } from '../../lib/sound';
import { saveMediaToDevice } from '../../lib/saveMedia';
import { MediaViewerModal } from '../../components/MediaViewerModal';

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
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  const viewableMedia = attachments.filter((a) => a.type === 'image' || a.type === 'video');
  const images = attachments.filter((a) => a.type === 'image');
  const videos = attachments.filter((a) => a.type === 'video');
  const docs = attachments.filter((a) => a.type === 'document');

  const openViewerForAttachment = (attachmentId: string) => {
    soundEffects.playPop();
    const idx = viewableMedia.findIndex((m) => m.id === attachmentId);
    setViewerIndex(idx >= 0 ? idx : 0);
  };

  const handleDownload = async (att: FileAttachment) => {
    soundEffects.playPop();
    await saveMediaToDevice(att.url, {
      fileName: att.fileName,
      mimeType: att.mimeType,
    });
  };

  if (attachments.length === 0) return null;

  // Compact chip mode for tasks
  if (compactTaskChip) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        <button
          type="button"
          onClick={() => {
            if (viewableMedia.length > 0) {
              soundEffects.playPop();
              setViewerIndex(0);
            }
          }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 min-h-[36px] rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface)] text-[var(--text)] border-2 border-[var(--border)] text-[11px] font-ui font-semibold shadow-xs cursor-pointer transition-colors"
        >
          <Paperclip className="w-3.5 h-3.5" />
          <span>
            {attachments.length} Attachment{attachments.length > 1 ? 's' : ''}
          </span>
        </button>

        {/* Mini thumbnails for visual preview */}
        {viewableMedia.slice(0, 3).map((media) => (
          <button
            key={media.id}
            type="button"
            onClick={() => openViewerForAttachment(media.id)}
            className="w-7 h-7 rounded-lg overflow-hidden border border-[var(--border)] cursor-pointer hover:scale-105 transition-transform relative bg-black/10 shrink-0"
            aria-label={`Open ${media.fileName}`}
          >
            {media.type === 'video' ? (
              <div className="w-full h-full bg-black/80 flex items-center justify-center text-white">
                <Play className="w-3 h-3 fill-current ml-0.5" />
              </div>
            ) : (
              <img
                src={media.thumbnailUrl || media.url}
                alt={media.fileName}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            )}
          </button>
        ))}

        {/* Full-Screen Media Viewer */}
        <MediaViewerModal
          isOpen={viewerIndex !== null}
          onClose={() => setViewerIndex(null)}
          items={viewableMedia}
          initialIndex={viewerIndex ?? 0}
        />
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
            const isFailed = failedImages[img.id];

            return (
              <div
                key={img.id}
                onClick={() => {
                  if (isFailed) return;
                  openViewerForAttachment(img.id);
                }}
                className="relative aspect-square overflow-hidden bg-[var(--surface-2)] cursor-pointer group rounded-2xl border-2 border-[var(--border)] shadow-xs hover:border-[var(--partner-a)] transition-all min-h-[44px]"
              >
                {isFailed ? (
                  <div className="w-full h-full flex flex-col items-center justify-center p-2 text-center bg-[var(--surface-2)]">
                    <span className="text-base select-none">📷</span>
                    <span className="font-ui text-[10px] text-[var(--text-muted)] mt-1 font-semibold">Failed to load</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFailedImages((prev) => {
                          const next = { ...prev };
                          delete next[img.id];
                          return next;
                        });
                      }}
                      className="mt-1 px-2 py-0.5 rounded-lg bg-[var(--surface)] text-[10px] font-ui font-bold border border-[var(--border)] hover:bg-[var(--accent)] cursor-pointer min-h-[30px]"
                    >
                      Retry
                    </button>
                  </div>
                ) : (
                  <img
                    src={img.thumbnailUrl || img.url}
                    alt={img.fileName}
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    loading="lazy"
                    onError={() => setFailedImages((prev) => ({ ...prev, [img.id]: true }))}
                  />
                )}

                {!isFailed && isFourthAndMore && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white font-chunky text-xl font-bold">
                    +{extraCount}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 2. Videos List - Opens in Full-Screen Media Viewer Shell */}
      {videos.length > 0 && (
        <div className={isGallery ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 w-full' : 'space-y-2'}>
          {videos.map((vid) => (
            <div
              key={vid.id}
              onClick={() => openViewerForAttachment(vid.id)}
              className={`relative rounded-2xl overflow-hidden bg-black border-2 border-[var(--border)] shadow-xs cursor-pointer group transition-transform hover:scale-[1.01] ${
                isGallery ? 'w-full aspect-video' : 'w-full max-w-[320px] aspect-video'
              }`}
            >
              {vid.thumbnailUrl ? (
                <img
                  src={vid.thumbnailUrl}
                  alt={vid.fileName}
                  className="w-full h-full object-cover opacity-80 group-hover:opacity-90 transition-opacity"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full bg-[var(--surface-2)] flex items-center justify-center" />
              )}

              {/* Big Play Button Badge */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-12 h-12 rounded-2xl bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] flex items-center justify-center shadow-[0_3px_0_var(--shadow-color)] group-hover:scale-110 transition-transform">
                  <Play className="w-5 h-5 fill-current ml-0.5" />
                </div>
              </div>

              {/* Video metadata chip */}
              <div className="absolute bottom-2 left-2 px-2.5 py-1 rounded-xl bg-black/75 backdrop-blur-xs text-white font-numeric text-[11px] font-semibold border border-white/20">
                {formatFileSize(vid.size)}
              </div>

              <div className="absolute top-2 right-2 px-2 py-0.5 rounded-lg bg-black/60 text-white/90 text-[10px] font-ui font-bold">
                Tap to play
              </div>
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
                <div className="w-10 h-10 min-w-[40px] rounded-xl bg-[var(--accent)]/30 text-[var(--text)] border border-[var(--border)] flex items-center justify-center shrink-0">
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
                  aria-label={`Download ${doc.fileName}`}
                  className="p-2 min-w-[40px] min-h-[40px] rounded-xl hover:bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] cursor-pointer flex items-center justify-center transition-colors"
                >
                  <Download className="w-4 h-4" />
                </button>
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open file"
                  aria-label={`Open ${doc.fileName}`}
                  className="p-2 min-w-[40px] min-h-[40px] rounded-xl hover:bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] cursor-pointer inline-flex items-center justify-center transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Shared Responsive Media Viewer Modal */}
      <MediaViewerModal
        isOpen={viewerIndex !== null}
        onClose={() => setViewerIndex(null)}
        items={viewableMedia}
        initialIndex={viewerIndex ?? 0}
      />
    </div>
  );
};
