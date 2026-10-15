import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateCleanMediaFileName, saveMediaToDevice } from './saveMedia';

describe('Save Media Engine (src/lib/saveMedia.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates clean standardized filenames with dates and extensions', () => {
    const photoName = generateCleanMediaFileName(undefined, 'photo');
    expect(photoName).toMatch(/^Duo_\d{4}-\d{2}-\d{2}_\d{4}\.jpg$/);

    const videoName = generateCleanMediaFileName(undefined, 'video');
    expect(videoName).toMatch(/^Duo_\d{4}-\d{2}-\d{2}_\d{4}\.mp4$/);

    const customName = generateCleanMediaFileName('original_vacation_photo.png', 'photo');
    expect(customName).toMatch(/^Duo_\d{4}-\d{2}-\d{2}_\d{4}\.png$/);
  });

  it('triggers anchor download on desktop for Blob instances', async () => {
    const fakeBlob = new Blob(['sample data'], { type: 'image/jpeg' });

    // Mock document and URL on global
    const clickMock = vi.fn();
    const appendChildMock = vi.fn();
    const removeChildMock = vi.fn();

    const originalDoc = (globalThis as any).document;
    (globalThis as any).document = {
      createElement: vi.fn(() => ({
        set href(_val: string) {},
        set download(_val: string) {},
        style: {},
        click: clickMock,
      })),
      body: {
        appendChild: appendChildMock,
        removeChild: removeChildMock,
      },
    };

    const createObjectUrlMock = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    const revokeObjectUrlMock = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const result = await saveMediaToDevice(fakeBlob, { fileName: 'test.jpg' });

    expect(result.success).toBe(true);
    expect(result.method).toBe('download');
    expect(clickMock).toHaveBeenCalled();

    createObjectUrlMock.mockRestore();
    revokeObjectUrlMock.mockRestore();
    (globalThis as any).document = originalDoc;
  });
});
