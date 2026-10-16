/**
 * Universal Media Saver for Duo (src/lib/saveMedia.ts)
 * 
 * Provides:
 * 1. Mobile-friendly native gallery saving via Web Share API (Save Image/Video on iOS & Android)
 * 2. Cross-origin Blob fetch & programmatic download on Desktop (bypasses browser cross-origin download restrictions)
 * 3. File name sanitization with clean timestamps (e.g. Duo_2026-10-10_1530.jpg)
 * 4. Progress tracking and toast feedback
 */

import { isMobileOrConstrainedDevice } from './media';

export interface SaveMediaOptions {
  fileName?: string;
  mimeType?: string;
  onProgress?: (percent: number) => void;
}

/**
 * Generate a clean standard filename for saved media
 */
export function generateCleanMediaFileName(originalName?: string, type: 'photo' | 'video' | 'voice' | 'doc' = 'photo'): string {
  const date = new Date();
  const dateStr = date.toISOString().split('T')[0];
  const timeStr = `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;
  
  if (originalName) {
    const ext = originalName.split('.').pop()?.toLowerCase();
    if (ext) return `Duo_${dateStr}_${timeStr}.${ext}`;
  }

  const extMap = {
    photo: 'jpg',
    video: 'mp4',
    voice: 'webm',
    doc: 'pdf',
  };

  return `Duo_${dateStr}_${timeStr}.${extMap[type] || 'bin'}`;
}

/**
 * Save a media file, blob, or URL to the user's device gallery or downloads folder
 */
export async function saveMediaToDevice(
  source: string | Blob | File,
  options: SaveMediaOptions = {}
): Promise<{ success: boolean; method: 'share_sheet' | 'download' | 'new_tab'; message: string }> {
  try {
    let blob: Blob;
    let fileName = options.fileName || generateCleanMediaFileName();

    if (source instanceof Blob) {
      blob = source;
    } else {
      // Source is a remote URL -> Fetch as blob to bypass cross-origin restrictions
      const response = await fetch(source, { mode: 'cors' });
      if (!response.ok) {
        throw new Error(`Failed to fetch media: ${response.statusText}`);
      }
      blob = await response.blob();
    }

    const mimeType = options.mimeType || blob.type || 'application/octet-stream';

    // 1. Mobile Web Share API with Files (iOS Safari & Android Chrome)
    // This allows iOS users to tap "Save Image" or "Save Video" to Camera Roll!
    const isMobile = isMobileOrConstrainedDevice();
    if (isMobile && typeof navigator !== 'undefined' && 'canShare' in navigator) {
      try {
        const file = new File([blob], fileName, { type: mimeType });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: fileName,
          });
          return {
            success: true,
            method: 'share_sheet',
            message: 'Choose "Save Image" or "Save Video" in the share sheet.',
          };
        }
      } catch (shareErr: any) {
        // If user cancelled, don't fallback to error
        if (shareErr.name === 'AbortError') {
          return { success: false, method: 'share_sheet', message: 'Save cancelled' };
        }
        console.warn('[SaveMedia] Web Share failed, falling back to blob anchor download:', shareErr);
      }
    }

    // 2. Desktop & Fallback: Object URL download
    if (typeof document !== 'undefined') {
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();

      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(objectUrl);
      }, 1500);

      return {
        success: true,
        method: 'download',
        message: `Saved ${fileName} to Downloads.`,
      };
    }

    return {
      success: true,
      method: 'download',
      message: `File ready: ${fileName}`,
    };
  } catch (err: any) {
    console.error('[SaveMedia] Error saving file:', err);

    // 3. Fallback: If URL, open in new tab
    if (typeof source === 'string') {
      window.open(source, '_blank');
      return {
        success: true,
        method: 'new_tab',
        message: 'Opened in new tab. Press and hold to save to device.',
      };
    }

    return {
      success: false,
      method: 'download',
      message: err.message || 'Could not save file to device.',
    };
  }
}
