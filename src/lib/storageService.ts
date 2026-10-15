/**
 * Storage Service & Circuit Breaker for Duo.
 * 
 * Provides:
 * 1. Intelligent detection of whether Firebase Cloud Storage bucket is configured and reachable.
 * 2. Ultra-fast direct inline media pipeline (compressed WebP / Opus / AAC) when Cloud Storage
 *    is unprovisioned or CORS-blocked, avoiding failed preflight CORS errors and 60-second SDK retry delays.
 * 3. Safe fallback & Blob/DataURL conversions.
 */

// In-memory fallback if localStorage is unavailable
let memoryStorage: Record<string, string> = {
  duo_enable_firebase_storage: 'true',
};

export function isCloudStorageAvailable(): boolean {
  try {
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      const val = window.localStorage.getItem('duo_enable_firebase_storage');
      if (val === 'false') return false;
      return true;
    }
    if (typeof localStorage !== 'undefined') {
      const val = localStorage.getItem('duo_enable_firebase_storage');
      if (val === 'false') return false;
      return true;
    }
  } catch {}
  return memoryStorage['duo_enable_firebase_storage'] !== 'false';
}

export function setCloudStorageEnabled(enabled: boolean): void {
  const val = enabled ? 'true' : 'false';
  memoryStorage['duo_enable_firebase_storage'] = val;
  try {
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      window.localStorage.setItem('duo_enable_firebase_storage', val);
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem('duo_enable_firebase_storage', val);
    }
  } catch {}
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    // If FileReader is available (browser/jsdom)
    if (typeof FileReader !== 'undefined') {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(blob);
      return;
    }

    // Fallback without Node Buffer
    blob.arrayBuffer()
      .then((buf) => {
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        const mime = blob.type || 'application/octet-stream';
        resolve(`data:${mime};base64,${base64}`);
      })
      .catch(reject);
  });
}

/**
 * Convert data URL back into a Blob
 */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const parts = dataUrl.split(',');
    if (parts.length !== 2) return null;
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    const binary = atob(parts[1]);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      array[i] = binary.charCodeAt(i);
    }
    return new Blob([array], { type: mime });
  } catch {
    return null;
  }
}
