import React, { useState, useRef, useEffect } from 'react';
import {
  Paperclip,
  Camera,
  Image as ImageIcon,
  FileText,
  X,
  AlertCircle,
  UploadCloud,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import {
  validateAttachmentFile,
  formatFileSize,
  getAttachmentType,
  uploadAttachment,
  type FileAttachment,
  type PendingUpload,
} from '../../lib/attachments';
import { soundEffects } from '../../lib/sound';
import { CameraCaptureModal } from './CameraCaptureModal';

interface AttachmentPickerProps {
  spaceId: string;
  folder: 'chat' | 'tasks';
  parentId: string;
  uploadedBy: string;
  onAttachmentsReady: (attachments: FileAttachment[], caption?: string) => void;
  maxFiles?: number;
  triggerButtonClassName?: string;
}

export const AttachmentPicker: React.FC<AttachmentPickerProps> = ({
  spaceId,
  folder,
  parentId,
  uploadedBy,
  onAttachmentsReady,
  maxFiles = 10,
  triggerButtonClassName,
}) => {
  const [isOpenMenu, setIsOpenMenu] = useState(false);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [originalQuality, setOriginalQuality] = useState(false);
  const [caption, setCaption] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  // Close menu on click outside
  useEffect(() => {
    const handleDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpenMenu(false);
      }
    };
    if (isOpenMenu) {
      document.addEventListener('mousedown', handleDocClick);
    }
    return () => document.removeEventListener('mousedown', handleDocClick);
  }, [isOpenMenu]);

  // Global paste handler (Ctrl+V) for images
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!e.clipboardData || !e.clipboardData.files || e.clipboardData.files.length === 0) return;
      const files = Array.from(e.clipboardData.files);
      handleFilesAdded(files);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [pendingUploads.length]);

  // Accept files dropped anywhere in the chat view.
  useEffect(() => {
    const handleDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      handleFilesAdded(Array.from(e.dataTransfer.files));
    };

    window.addEventListener('drop', handleDrop);
    return () => window.removeEventListener('drop', handleDrop);
  }, [pendingUploads.length]);

  // Clean up any pending object URLs on unmount to prevent memory leaks
  const pendingUploadsRef = useRef(pendingUploads);
  pendingUploadsRef.current = pendingUploads;
  useEffect(() => {
    return () => {
      pendingUploadsRef.current.forEach((item) => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
    };
  }, []);

  const handleFilesAdded = (files: File[]) => {
    if (!files.length) return;
    setErrorMessage(null);

    const availableSlots = maxFiles - pendingUploads.length;
    if (availableSlots <= 0) {
      setErrorMessage(`Maximum ${maxFiles} files per upload.`);
      return;
    }

    const filesToProcess = files.slice(0, availableSlots);
    const newItems: PendingUpload[] = [];

    for (const file of filesToProcess) {
      const validation = validateAttachmentFile(file);
      if (!validation.valid) {
        setErrorMessage(validation.error || 'File not supported.');
        continue;
      }

      const type = getAttachmentType(file);
      const previewUrl = type === 'image' ? URL.createObjectURL(file) : '';

      newItems.push({
        file,
        id: `pend-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        previewUrl,
        type,
        fileName: file.name,
        size: file.size,
        progress: 0,
        status: 'pending',
        originalQuality,
      });
    }

    if (newItems.length > 0) {
      soundEffects.playPop();
      setPendingUploads((prev) => [...prev, ...newItems]);
      setIsOpenMenu(false);
    }
  };

  const handleRemoveItem = (id: string) => {
    soundEffects.playPop();
    setPendingUploads((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((i) => i.id !== id);
    });
  };

  const handleStartUpload = async () => {
    if (pendingUploads.length === 0 || isUploading) return;
    setIsUploading(true);
    soundEffects.playPop();

    const uploadedResults: FileAttachment[] = [];
    const itemsToUpload = pendingUploads.filter((i) => i.status !== 'completed');

    await Promise.all(
      itemsToUpload.map(async (item) => {
        setPendingUploads((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, status: 'uploading', progress: 10 } : i))
        );

        try {
          const result = await uploadAttachment(
            spaceId,
            folder,
            parentId,
            item.file,
            uploadedBy,
            {
              originalQuality,
              onProgress: (pct) => {
                setPendingUploads((prev) =>
                  prev.map((i) => (i.id === item.id ? { ...i, progress: pct } : i))
                );
              },
            }
          );

          uploadedResults.push(result);

          setPendingUploads((prev) =>
            prev.map((i) => (i.id === item.id ? { ...i, status: 'completed', progress: 100 } : i))
          );
        } catch (err: any) {
          setPendingUploads((prev) =>
            prev.map((i) =>
              i.id === item.id
                ? { ...i, status: 'error', error: err?.message || 'Upload failed' }
                : i
            )
          );
        }
      })
    );

    setIsUploading(false);

    if (uploadedResults.length > 0) {
      soundEffects.playSuccess();
      onAttachmentsReady(uploadedResults, caption.trim() || undefined);
      // Clean up
      pendingUploads.forEach((i) => {
        if (i.previewUrl) URL.revokeObjectURL(i.previewUrl);
      });
      setPendingUploads([]);
      setCaption('');
    }
  };

  return (
    <div className="relative inline-block" ref={menuRef}>
      {/* Hidden File Inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFilesAdded(Array.from(e.target.files));
          e.target.value = '';
        }}
      />
      <input
        ref={mediaInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFilesAdded(Array.from(e.target.files));
          e.target.value = '';
        }}
      />
      <input
        ref={docInputRef}
        type="file"
        accept="*/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFilesAdded(Array.from(e.target.files));
          e.target.value = '';
        }}
      />

      {/* Trigger Paperclip Button */}
      <button
        type="button"
        onClick={() => {
          soundEffects.playPop();
          setIsOpenMenu(!isOpenMenu);
        }}
        aria-label="Attach photos, videos, or documents"
        className={
          triggerButtonClassName ||
          'p-2.5 rounded-2xl bg-[var(--surface-2)] hover:bg-[var(--surface-2)]/80 text-[var(--text)] border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none cursor-pointer flex items-center justify-center transition-transform'
        }
      >
        <Paperclip className="w-5 h-5 stroke-[2.2]" />
      </button>

      {/* Popover Menu */}
      {isOpenMenu && (
        <div className="absolute bottom-full left-0 mb-3 z-50 w-52 p-2 bg-[var(--surface)] border-3 border-[var(--border)] rounded-2xl shadow-[0_6px_0_var(--shadow-color)] flex flex-col gap-1 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <button
            type="button"
            onClick={() => {
              setIsOpenMenu(false);
              setIsCameraModalOpen(true);
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--surface-2)] text-[var(--text)] font-ui font-semibold text-xs transition-colors cursor-pointer"
          >
            <div className="w-8 h-8 rounded-lg bg-[var(--partner-a)]/20 text-[var(--partner-a)] flex items-center justify-center border border-[var(--border)]">
              <Camera className="w-4 h-4" />
            </div>
            <span>Camera</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsOpenMenu(false);
              mediaInputRef.current?.click();
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--surface-2)] text-[var(--text)] font-ui font-semibold text-xs transition-colors cursor-pointer"
          >
            <div className="w-8 h-8 rounded-lg bg-[var(--accent)]/30 text-[var(--text)] flex items-center justify-center border border-[var(--border)]">
              <ImageIcon className="w-4 h-4" />
            </div>
            <span>Photos & Videos</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsOpenMenu(false);
              docInputRef.current?.click();
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--surface-2)] text-[var(--text)] font-ui font-semibold text-xs transition-colors cursor-pointer"
          >
            <div className="w-8 h-8 rounded-lg bg-[var(--success)]/20 text-[var(--success)] flex items-center justify-center border border-[var(--border)]">
              <FileText className="w-4 h-4" />
            </div>
            <span>Document</span>
          </button>
        </div>
      )}

      {/* Floating Pending Files Tray (if files selected) */}
      {pendingUploads.length > 0 && (
        <div className="fixed inset-x-4 bottom-20 sm:bottom-24 max-w-lg mx-auto z-50 p-4 bg-[var(--surface)] text-[var(--text)] border-3 border-[var(--border)] rounded-3xl shadow-[0_8px_0_var(--shadow-color)] animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-center justify-between pb-3 border-b-2 border-[var(--border)] mb-3">
            <div className="flex items-center gap-2">
              <UploadCloud className="w-5 h-5 text-[var(--accent)]" />
              <h4 className="font-chunky text-sm font-bold">
                Ready to Send ({pendingUploads.length}/{maxFiles})
              </h4>
            </div>
            <button
              type="button"
              onClick={() => {
                pendingUploads.forEach((i) => {
                  if (i.previewUrl) URL.revokeObjectURL(i.previewUrl);
                });
                setPendingUploads([]);
              }}
              className="p-1 rounded-full text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Validation Error Alert */}
          {errorMessage && (
            <div className="mb-3 p-2.5 rounded-xl bg-[var(--urgent)]/20 border-2 border-[var(--urgent)] text-xs font-ui flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-[var(--urgent)] shrink-0" />
              <span className="text-[var(--text)]">{errorMessage}</span>
            </div>
          )}

          {/* Thumbnails Row */}
          <div className="flex items-center gap-2.5 overflow-x-auto pb-2 scrollbar-none">
            {pendingUploads.map((item) => (
              <div
                key={item.id}
                className="relative shrink-0 w-20 h-20 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] overflow-hidden flex flex-col items-center justify-center text-center p-1.5"
              >
                {item.type === 'image' && item.previewUrl ? (
                  <img
                    src={item.previewUrl}
                    alt={item.fileName}
                    className="w-full h-full object-cover rounded-xl"
                  />
                ) : item.type === 'video' ? (
                  <div className="flex flex-col items-center">
                    <span className="text-xl">🎬</span>
                    <span className="font-ui text-[10px] truncate max-w-[68px]">
                      {item.fileName}
                    </span>
                    <span className="font-numeric text-[9px] text-[var(--text-muted)]">
                      {formatFileSize(item.file.size)}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <FileText className="w-6 h-6 text-[var(--accent)] mb-0.5" />
                    <span className="font-ui text-[9px] truncate max-w-[68px] font-semibold">
                      {item.fileName}
                    </span>
                    <span className="font-numeric text-[8px] text-[var(--text-muted)]">
                      {formatFileSize(item.file.size)}
                    </span>
                  </div>
                )}

                {/* Remove button */}
                <button
                  type="button"
                  onClick={() => handleRemoveItem(item.id)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] flex items-center justify-center shadow-xs cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>

                {/* Progress Overlay */}
                {item.status === 'uploading' && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white font-numeric text-xs font-bold">
                    {item.progress}%
                  </div>
                )}

                {item.status === 'completed' && (
                  <div className="absolute top-1 left-1">
                    <CheckCircle2 className="w-4 h-4 text-[var(--success)]" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Controls: Caption & Send Original */}
          <div className="mt-2 space-y-2.5">
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Add a caption... (optional)"
              className="w-full px-3 py-2 rounded-xl bg-[var(--surface-2)] border-2 border-[var(--border)] font-body text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
            />

            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-ui text-[var(--text-muted)]">
                <input
                  type="checkbox"
                  checked={originalQuality}
                  onChange={(e) => setOriginalQuality(e.target.checked)}
                  className="rounded border-[var(--border)] text-[var(--accent)]"
                />
                <span>Send original quality (uncompressed)</span>
              </label>

              <button
                type="button"
                disabled={isUploading}
                onClick={handleStartUpload}
                className="px-4 py-2 rounded-xl bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] font-chunky text-xs font-bold shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                {isUploading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Uploading...</span>
                  </>
                ) : (
                  <span>Send {pendingUploads.length} File{pendingUploads.length > 1 ? 's' : ''}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live Camera Capture Modal */}
      <CameraCaptureModal
        isOpen={isCameraModalOpen}
        onClose={() => setIsCameraModalOpen(false)}
        onMediaCaptured={(file) => handleFilesAdded([file])}
      />
    </div>
  );
};
