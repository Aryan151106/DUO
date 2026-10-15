/**
 * Secure attachment processing, client-side compression, validation,
 * and Firebase/local storage handling for Duo.
 */
import { getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { app } from './firebase';
import { isCloudStorageAvailable, blobToDataUrl, setCloudStorageEnabled } from './storageService';

export type AttachmentType = 'image' | 'video' | 'document';

export interface FileAttachment {
  id: string;
  type: AttachmentType;
  path: string;
  url: string;
  thumbnailUrl?: string;
  fileName: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  uploadedBy: string;
  createdAt: string;
}

export interface PendingUpload {
  file: File;
  id: string;
  previewUrl: string;
  thumbnailUrl?: string;
  type: AttachmentType;
  fileName: string;
  size: number;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  error?: string;
  originalQuality?: boolean;
}

const BLOCKED_EXTENSIONS = new Set([
  'exe', 'bat', 'sh', 'apk', 'cmd', 'com', 'vbs', 'msi', 'bin', 'ps1', 'jar'
]);

export const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_DOCUMENT_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_IMAGE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Validate a file before processing.
 * Throws or returns an error string if invalid.
 */
export function validateAttachmentFile(file: File): { valid: boolean; error?: string } {
  const parts = file.name.split('.');
  const ext = parts.length > 1 ? parts.pop()!.toLowerCase() : '';

  if (BLOCKED_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `Executables and scripts (.${ext}) are blocked for security.`,
    };
  }

  const type = getAttachmentType(file);

  if (type === 'video' && file.size > MAX_VIDEO_SIZE_BYTES) {
    return {
      valid: false,
      error: `Video exceeds the 100 MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB).`,
    };
  }

  if (type === 'document' && file.size > MAX_DOCUMENT_SIZE_BYTES) {
    return {
      valid: false,
      error: `Document exceeds the 50 MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB).`,
    };
  }

  return { valid: true };
}

export function getAttachmentType(file: File): AttachmentType {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return 'document';
}

/**
 * Sanitize filename to prevent directory traversal or script injection.
 */
export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Compress an image on device to max 1600px dimension and ~0.8 quality.
 */
export async function compressImage(
  file: File,
  quality: number = 0.8,
  maxDimension: number = 1600
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // If it's a GIF or SVG, don't compress
    if (file.type === 'image/gif' || file.type === 'image/svg+xml') {
      resolve(file);
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to load image for compression'));
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(file);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (blob && blob.size < file.size) {
              resolve(blob);
            } else {
              resolve(file); // keep original if compression didn't save space
            }
          },
          'image/jpeg',
          quality
        );
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Capture thumbnail from video file (first frame around 0.5s).
 */
export async function generateVideoThumbnail(file: File): Promise<string> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const fileUrl = URL.createObjectURL(file);
    video.src = fileUrl;

    const cleanup = () => {
      URL.revokeObjectURL(fileUrl);
      video.remove();
    };

    video.onloadeddata = () => {
      video.currentTime = Math.min(0.5, video.duration / 2 || 0.1);
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 240;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          cleanup();
          resolve(dataUrl);
          return;
        }
      } catch (err) {
        // Ignored
      }
      cleanup();
      resolve('');
    };

    video.onerror = () => {
      cleanup();
      resolve('');
    };

    // Timeout safety
    setTimeout(() => {
      cleanup();
      resolve('');
    }, 4000);
  });
}

/**
 * Format bytes to readable string (e.g. "4.2 MB", "850 KB").
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Upload an attachment to Firebase Storage (with demo/offline fallback).
 */
export async function uploadAttachment(
  spaceId: string,
  folder: 'chat' | 'tasks',
  parentId: string,
  file: File,
  uploadedBy: string,
  options?: {
    originalQuality?: boolean;
    onProgress?: (pct: number) => void;
  }
): Promise<FileAttachment> {
  const type = getAttachmentType(file);
  const sanitized = sanitizeFileName(file.name);
  const fileId = `att-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const storagePath = `spaces/${spaceId}/${folder}/${parentId}/${fileId}-${sanitized}`;

  let processedBlob: Blob = file;
  let thumbnailUrl: string | undefined;

  if (type === 'image' && !options?.originalQuality && file.size > 300 * 1024) {
    try {
      processedBlob = await compressImage(file, 0.8, 1600);
    } catch {
      processedBlob = file;
    }
  } else if (type === 'video') {
    try {
      thumbnailUrl = await generateVideoThumbnail(file);
    } catch {
      // Ignored
    }
  }

  if (!isCloudStorageAvailable()) {
    options?.onProgress?.(50);
    const dataUrl = await blobToDataUrl(processedBlob);
    options?.onProgress?.(100);
    return {
      id: fileId,
      type,
      path: storagePath,
      url: dataUrl,
      thumbnailUrl: thumbnailUrl || (type === 'image' ? dataUrl : undefined),
      fileName: sanitized,
      mimeType: file.type || 'application/octet-stream',
      size: processedBlob.size,
      uploadedBy,
      createdAt: new Date().toISOString(),
    };
  }

  // Attempt Firebase Storage upload
  try {
    const storage = getStorage(app);
    const storageRef = ref(storage, storagePath);
    const uploadTask = uploadBytesResumable(storageRef, processedBlob, {
      contentType: file.type || 'application/octet-stream',
      cacheControl: 'public,max-age=31536000,immutable',
    });

    return await new Promise<FileAttachment>((resolve, reject) => {
      // 60-second safety timeout for slow mobile uploads
      const timer = setTimeout(() => {
        try { uploadTask.cancel(); } catch {}
        reject(new Error('Upload timed out after 60 seconds. Please check your connection.'));
      }, 60000);

      uploadTask.on(
        'state_changed',
        (snapshot) => {
          if (snapshot.totalBytes > 0) {
            const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            options?.onProgress?.(progress);
          }
        },
        (error) => {
          clearTimeout(timer);
          console.error('[Attachments] Firebase Storage upload failed:', error);
          reject(new Error(`Storage upload failed: ${error.message || 'Network error'}`));
        },
        async () => {
          clearTimeout(timer);
          try {
            const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
            resolve({
              id: fileId,
              type,
              path: storagePath,
              url: downloadUrl,
              thumbnailUrl,
              fileName: sanitized,
              mimeType: file.type || 'application/octet-stream',
              size: processedBlob.size,
              uploadedBy,
              createdAt: new Date().toISOString(),
            });
          } catch (err: any) {
            console.error('[Attachments] getDownloadURL failed:', err);
            reject(new Error(`Failed to obtain download URL: ${err.message || 'Unknown error'}`));
          }
        }
      );
    });
  } catch (err) {
    setCloudStorageEnabled(false);
    const dataUrl = await blobToDataUrl(processedBlob);
    return {
      id: fileId,
      type,
      path: storagePath,
      url: dataUrl,
      thumbnailUrl: thumbnailUrl || (type === 'image' ? dataUrl : undefined),
      fileName: sanitized,
      mimeType: file.type || 'application/octet-stream',
      size: processedBlob.size,
      uploadedBy,
      createdAt: new Date().toISOString(),
    };
  }
}

/**
 * Delete a stored file from Firebase Storage.
 */
export async function deleteAttachmentFile(storagePath: string): Promise<void> {
  try {
    const storage = getStorage(app);
    const storageRef = ref(storage, storagePath);
    await deleteObject(storageRef);
  } catch (err) {
    console.warn('Could not delete storage object:', err);
  }
}
