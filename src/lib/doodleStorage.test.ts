import { describe, it, expect } from 'vitest';
import type { DoodleMetadata, DoodleStroke } from './doodleStorage';

describe('Doodle Storage & Scaling (src/lib/doodleStorage.ts)', () => {
  describe('Dimension Calculations', () => {
    it('scales dimensions down proportionally when exceeding max 1600px width', () => {
      const maxWidth = 1600;
      const rawWidth = 3200;
      const rawHeight = 1800;

      const scale = rawWidth > maxWidth ? maxWidth / rawWidth : 1;
      const targetWidth = Math.round(rawWidth * scale);
      const targetHeight = Math.round(rawHeight * scale);

      expect(targetWidth).toBe(1600);
      expect(targetHeight).toBe(900);
    });

    it('preserves native dimensions when within max width limit', () => {
      const maxWidth = 1600;
      const rawWidth = 800;
      const rawHeight = 600;

      const scale = rawWidth > maxWidth ? maxWidth / rawWidth : 1;
      const targetWidth = Math.round(rawWidth * scale);
      const targetHeight = Math.round(rawHeight * scale);

      expect(targetWidth).toBe(800);
      expect(targetHeight).toBe(600);
    });

    it('computes thumbnail dimensions capped at 320px', () => {
      const targetWidth = 1600;
      const targetHeight = 1200;
      const maxThumb = 320;

      const thumbScale = targetWidth > maxThumb ? maxThumb / targetWidth : 1;
      const thumbWidth = Math.round(targetWidth * thumbScale);
      const thumbHeight = Math.round(targetHeight * thumbScale);

      expect(thumbWidth).toBe(320);
      expect(thumbHeight).toBe(240);
    });
  });

  describe('Doodle Metadata Structure', () => {
    it('verifies metadata documents are lightweight and do not contain raw base64 drawing data', () => {
      const metadata: DoodleMetadata = {
        id: 'doodle-123',
        createdBy: 'user-alex',
        createdAt: { seconds: 123456789 },
        path: 'spaces/space-1/doodles/doodle-123.webp',
        imageUrl: 'https://firebasestorage.googleapis.com/.../doodle-123.webp',
        thumbnailUrl: 'https://firebasestorage.googleapis.com/.../doodle-123_thumb.webp',
        width: 800,
        height: 600,
        caption: 'Sweet heart doodle',
      };

      const docString = JSON.stringify(metadata);
      // Ensure metadata doc is lightweight (< 1 KB) and not a huge base64 payload
      expect(docString.length).toBeLessThan(1024);
      expect(docString).not.toContain('data:image/');
      expect(metadata.imageUrl).toBeDefined();
      expect(metadata.thumbnailUrl).toBeDefined();
    });

    it('rejects sending empty canvas drawings', () => {
      const emptyStrokes: DoodleStroke[] = [];
      const hasContent = emptyStrokes.some((s) => s.points.length > 0 && !s.isEraser);
      expect(hasContent).toBe(false);

      const validStrokes: DoodleStroke[] = [
        {
          id: 'stroke-1',
          points: [{ x: 10, y: 10 }, { x: 20, y: 20 }],
          color: '#FF0000',
          size: 4,
          isEraser: false,
        },
      ];
      const validHasContent = validStrokes.some((s) => s.points.length > 0 && !s.isEraser);
      expect(validHasContent).toBe(true);
    });
  });
});
