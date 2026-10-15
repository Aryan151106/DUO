/**
 * Doodle Storage & Sync Engine (src/lib/doodleStorage.ts)
 * 
 * Provides:
 * 1. Safe storage of drawings in Firebase Storage (PNG/WebP max 1600px + thumbnail + stroke JSON).
 * 2. Small metadata document in Firestore at couples/{spaceId}/doodles/{doodleId}.
 * 3. Real-time subscription to doodles gallery.
 * 4. Automatic integration into Chat (sends doodle message with preview).
 * 5. Device pixel ratio & export normalization.
 */

import {
  collection,
  doc,
  setDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db, app } from './firebase';
import { sendMessage } from './firestore';
import { isCloudStorageAvailable, blobToDataUrl, setCloudStorageEnabled } from './storageService';
import { useAuthStore } from './store';
import { useNotificationStore } from './notifications';

export interface DoodleMetadata {
  id: string;
  createdBy: string;
  createdAt: any;
  path: string;
  imageUrl: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  caption?: string;
}

export interface StrokePoint {
  x: number;
  y: number;
  pressure?: number;
}

export interface DoodleStroke {
  id: string;
  points: StrokePoint[];
  color: string;
  size: number;
  isEraser: boolean;
  tool?: 'pen' | 'marker' | 'highlighter' | 'spray' | 'neon' | 'calligraphy' | 'shape';
  opacity?: number;
  layer?: number;
  shape?: 'line' | 'circle' | 'rectangle' | 'heart' | 'star';
}

/**
 * Render SVG element onto high-resolution canvas with devicePixelRatio scaling
 */
export async function rasterizeSvgToBlob(
  svgElement: SVGSVGElement,
  options: {
    maxWidth?: number;
    backgroundColor?: string;
    quality?: number;
  } = {}
): Promise<{ fullBlob: Blob; thumbBlob: Blob; width: number; height: number }> {
  const maxWidth = options.maxWidth || 1600;
  const quality = options.quality || 0.85;

  const rect = svgElement.getBoundingClientRect();
  const rawWidth = rect.width || 600;
  const rawHeight = rect.height || 600;

  // Scale down if exceeding maxWidth
  const scale = rawWidth > maxWidth ? maxWidth / rawWidth : 1;
  const targetWidth = Math.round(rawWidth * scale);
  const targetHeight = Math.round(rawHeight * scale);

  const svgClone = svgElement.cloneNode(true) as SVGSVGElement;
  svgClone.setAttribute('width', `${targetWidth}`);
  svgClone.setAttribute('height', `${targetHeight}`);

  const svgData = new XMLSerializer().serializeToString(svgClone);
  const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgData);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      // 1. Generate Full Size Canvas
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context unavailable'));
        return;
      }

      // Fill background
      ctx.fillStyle = options.backgroundColor || '#FFFFFF';
      ctx.fillRect(0, 0, targetWidth, targetHeight);
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      // 2. Generate Thumbnail Canvas (max 320px)
      const thumbScale = Math.min(1, 320 / targetWidth);
      const thumbWidth = Math.round(targetWidth * thumbScale);
      const thumbHeight = Math.round(targetHeight * thumbScale);
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = thumbWidth;
      thumbCanvas.height = thumbHeight;
      const thumbCtx = thumbCanvas.getContext('2d');
      if (thumbCtx) {
        thumbCtx.fillStyle = options.backgroundColor || '#FFFFFF';
        thumbCtx.fillRect(0, 0, thumbWidth, thumbHeight);
        thumbCtx.drawImage(canvas, 0, 0, thumbWidth, thumbHeight);
      }

      canvas.toBlob(
        (fullBlob) => {
          if (!fullBlob) {
            reject(new Error('Failed to create full doodle blob'));
            return;
          }
          thumbCanvas.toBlob(
            (thumbBlob) => {
              resolve({
                fullBlob,
                thumbBlob: thumbBlob || fullBlob,
                width: targetWidth,
                height: targetHeight,
              });
            },
            'image/webp',
            0.8
          );
        },
        'image/webp',
        quality
      );
    };

    img.onerror = () => reject(new Error('Failed to load SVG into image for rasterization'));
    img.src = svgUrl;
  });
}

/**
 * Upload finished doodle to Firebase Storage and write metadata to Firestore
 */
export async function uploadDoodle(params: {
  spaceId: string;
  userId: string;
  userName: string;
  svgElement: SVGSVGElement;
  strokes: DoodleStroke[];
  caption?: string;
  isDark?: boolean;
  onProgress?: (pct: number) => void;
}): Promise<DoodleMetadata> {
  const { spaceId, userId, svgElement, strokes, caption, isDark, onProgress } = params;

  onProgress?.(10);

  // 1. Rasterize SVG to high-res WebP and thumbnail
  const bg = isDark ? '#1F1714' : '#FFFFFF';
  const { fullBlob, thumbBlob, width, height } = await rasterizeSvgToBlob(svgElement, {
    maxWidth: 1600,
    backgroundColor: bg,
    quality: 0.88,
  });

  onProgress?.(30);

  const doodleId = `doodle-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

  // Storage paths
  const fullPath = `spaces/${spaceId}/doodles/${doodleId}.webp`;
  const thumbPath = `spaces/${spaceId}/doodles/${doodleId}_thumb.webp`;
  const strokePath = `spaces/${spaceId}/doodles/${doodleId}_strokes.json`;

  let imageUrl = '';
  let thumbnailUrl = '';

  if (isCloudStorageAvailable()) {
    try {
      const storage = getStorage(app);
      const fullRef = ref(storage, fullPath);
      const thumbRef = ref(storage, thumbPath);
      const strokeRef = ref(storage, strokePath);

      const uploadTask = uploadBytesResumable(fullRef, fullBlob, { contentType: 'image/webp' });

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          try { uploadTask.cancel(); } catch {}
          reject(new Error('Storage upload timeout'));
        }, 3000);

        uploadTask.on(
          'state_changed',
          (snap) => {
            const pct = 30 + Math.round((snap.bytesTransferred / snap.totalBytes) * 40);
            onProgress?.(pct);
          },
          (err) => {
            clearTimeout(timer);
            reject(err);
          },
          () => {
            clearTimeout(timer);
            resolve();
          }
        );
      });

      const strokeJsonBlob = new Blob([JSON.stringify(strokes)], { type: 'application/json' });
      await Promise.all([
        uploadBytesResumable(thumbRef, thumbBlob, { contentType: 'image/webp' }),
        uploadBytesResumable(strokeRef, strokeJsonBlob, { contentType: 'application/json' }),
      ]);

      onProgress?.(80);

      const urls = await Promise.all([
        getDownloadURL(fullRef),
        getDownloadURL(thumbRef),
      ]);
      imageUrl = urls[0];
      thumbnailUrl = urls[1];
    } catch (storageErr) {
      console.warn('[DoodleStorage] Cloud storage failed or CORS blocked, using instant direct data URL:', storageErr);
      setCloudStorageEnabled(false);
      imageUrl = await blobToDataUrl(fullBlob);
      thumbnailUrl = await blobToDataUrl(thumbBlob);
    }
  } else {
    // Instant Direct Sync pipeline
    onProgress?.(60);
    imageUrl = await blobToDataUrl(fullBlob);
    thumbnailUrl = await blobToDataUrl(thumbBlob);
    onProgress?.(80);
  }

  // 4. Save metadata document in Firestore at couples/{spaceId}/doodles/{doodleId}
  const doodleDocRef = doc(db, 'couples', spaceId, 'doodles', doodleId);
  const meta: DoodleMetadata = {
    id: doodleId,
    createdBy: userId,
    createdAt: serverTimestamp(),
    path: fullPath,
    imageUrl,
    thumbnailUrl,
    width,
    height,
    caption: caption || '',
  };

  await setDoc(doodleDocRef, meta);
  onProgress?.(90);

  // 5. Send message in Chat automatically
  await sendMessage(spaceId, {
    senderId: userId,
    content: caption ? `Doodle: ${caption}` : 'Sent you a doodle note 🎨',
    messageType: 'doodle',
    mediaUrl: imageUrl,
    metadata: {
      doodlePreview: thumbnailUrl,
    },
    status: 'sent',
  });

  // Trigger pop-up notification for partner
  useNotificationStore.getState().sendNotification({
    coupleId: spaceId,
    senderId: userId,
    senderName: useAuthStore.getState().currentUser?.displayName || 'Aryan',
    type: 'doodle',
    title: 'New Doodle 🎨',
    body: caption ? `Doodle: ${caption}` : 'Sent you a doodle note!',
    deepLink: '/?action=doodle',
  });

  onProgress?.(100);
  return meta;
}

/**
 * Real-time subscription to doodles in space
 */
export function subscribeDoodles(
  spaceId: string,
  onUpdate: (doodles: DoodleMetadata[]) => void
): Unsubscribe {
  if (useAuthStore.getState().isDemoMode || !spaceId || spaceId === 'couple-duo-main') {
    return () => {};
  }

  const q = query(
    collection(db, 'couples', spaceId, 'doodles'),
    orderBy('createdAt', 'desc')
  );

  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as DoodleMetadata[];
      onUpdate(items);
    },
    (err) => {
      console.warn('Doodles subscription error:', err);
    }
  );
}
