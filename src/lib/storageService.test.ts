import { describe, it, expect } from 'vitest';
import { isCloudStorageAvailable, setCloudStorageEnabled, blobToDataUrl, dataUrlToBlob } from './storageService';

describe('storageService', () => {
  it('allows checking, enabling and disabling Cloud Storage', () => {
    setCloudStorageEnabled(false);
    expect(isCloudStorageAvailable()).toBe(false);

    setCloudStorageEnabled(true);
    expect(isCloudStorageAvailable()).toBe(true);

    setCloudStorageEnabled(false);
    expect(isCloudStorageAvailable()).toBe(false);
  });

  it('converts a blob to a data URL and back', async () => {
    const originalBlob = new Blob(['hello duo couples'], { type: 'text/plain' });
    const dataUrl = await blobToDataUrl(originalBlob);
    expect(dataUrl.startsWith('data:text/plain;base64,')).toBe(true);

    const recoveredBlob = dataUrlToBlob(dataUrl);
    expect(recoveredBlob).not.toBeNull();
    expect(recoveredBlob?.type).toBe('text/plain');
    expect(recoveredBlob?.size).toBe(originalBlob.size);
  });
});
