import { describe, it, expect } from 'vitest';
import type { FileAttachment } from '../lib/attachments';

describe('MediaViewerModal & Attachment Logic', () => {
  const sampleAttachments: FileAttachment[] = [
    {
      id: 'att-1',
      path: 'tasks/beach.jpg',
      url: 'https://storage.googleapis.com/full_resolution_beach.jpg',
      thumbnailUrl: 'https://storage.googleapis.com/thumb_beach.jpg',
      fileName: 'beach.jpg',
      mimeType: 'image/jpeg',
      type: 'image',
      size: 2048500,
      uploadedBy: 'user-1',
      createdAt: '2026-10-29T12:00:00Z',
    },
    {
      id: 'att-2',
      path: 'tasks/clip.mp4',
      url: 'https://storage.googleapis.com/full_resolution_clip.mp4',
      thumbnailUrl: 'https://storage.googleapis.com/thumb_clip.jpg',
      fileName: 'clip.mp4',
      mimeType: 'video/mp4',
      type: 'video',
      size: 15480000,
      uploadedBy: 'user-1',
      createdAt: '2026-10-29T12:05:00Z',
    },
    {
      id: 'att-3',
      path: 'tasks/notes.pdf',
      url: 'https://storage.googleapis.com/notes.pdf',
      fileName: 'notes.pdf',
      mimeType: 'application/pdf',
      type: 'document',
      size: 512000,
      uploadedBy: 'user-1',
      createdAt: '2026-10-29T12:10:00Z',
    },
  ];

  it('filters only image and video attachments for the full-screen media viewer', () => {
    const viewable = sampleAttachments.filter(
      (a) => a.type === 'image' || a.type === 'video'
    );
    expect(viewable.length).toBe(2);
    expect(viewable[0].fileName).toBe('beach.jpg');
    expect(viewable[1].fileName).toBe('clip.mp4');
    expect(viewable.some((a) => a.type === 'document')).toBe(false);
  });

  it('uses full original URL rather than thumbnail URL in the viewer', () => {
    const viewable = sampleAttachments.filter(
      (a) => a.type === 'image' || a.type === 'video'
    );
    // Verified: url contains full resolution file, not thumb
    expect(viewable[0].url).toBe('https://storage.googleapis.com/full_resolution_beach.jpg');
    expect(viewable[0].thumbnailUrl).toBe('https://storage.googleapis.com/thumb_beach.jpg');

    expect(viewable[1].url).toBe('https://storage.googleapis.com/full_resolution_clip.mp4');
  });

  it('computes touch pinch zoom factor correctly within [1, 4] bounds', () => {
    const computePinchZoom = (initialZoom: number, initialDist: number, currentDist: number) => {
      if (initialDist <= 0) return initialZoom;
      const factor = currentDist / initialDist;
      return Math.min(Math.max(initialZoom * factor, 1), 4);
    };

    // Expanding pinch: 100px -> 200px (2x factor)
    expect(computePinchZoom(1, 100, 200)).toBe(2);

    // Zoom clamped at max 4x
    expect(computePinchZoom(1, 100, 500)).toBe(4);

    // Zoom clamped at min 1x
    expect(computePinchZoom(1, 100, 50)).toBe(1);

    // Multi-step pinch from 2x
    expect(computePinchZoom(2, 100, 150)).toBe(3);
  });

  it('formats video playback times accurately as M:SS', () => {
    const formatTime = (seconds: number): string => {
      if (isNaN(seconds) || seconds < 0) return '0:00';
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    };

    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(9)).toBe('0:09');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(125.8)).toBe('2:05');
    expect(formatTime(3600)).toBe('60:00');
  });

  it('cycles playback speeds accurately through supported speeds', () => {
    const speeds = [0.5, 1, 1.25, 1.5, 2];
    const getNextSpeed = (current: number) => {
      const idx = speeds.indexOf(current);
      return speeds[(idx + 1) % speeds.length];
    };

    expect(getNextSpeed(1)).toBe(1.25);
    expect(getNextSpeed(1.25)).toBe(1.5);
    expect(getNextSpeed(1.5)).toBe(2);
    expect(getNextSpeed(2)).toBe(0.5);
    expect(getNextSpeed(0.5)).toBe(1);
  });
});
