import { describe, it, expect, vi } from 'vitest';
import { getFriendlyCameraErrorMessage, stopMediaStream } from './media';

describe('media.ts - Camera & Media Layer', () => {
  it('maps NotAllowedError to clear user-friendly permission instructions', () => {
    const error = { name: 'NotAllowedError', message: 'Permission denied' };
    const msg = getFriendlyCameraErrorMessage(error);
    expect(msg).toContain('permission was denied');
    expect(msg).toContain('camera/lock icon');
  });

  it('maps NotFoundError to webcam detection message', () => {
    const error = { name: 'NotFoundError', message: 'Requested device not found' };
    const msg = getFriendlyCameraErrorMessage(error);
    expect(msg).toContain('No camera was detected');
  });

  it('maps NotReadableError to hardware-busy message', () => {
    const error = { name: 'NotReadableError', message: 'Device in use' };
    const msg = getFriendlyCameraErrorMessage(error);
    expect(msg).toContain('in use by another tab or app');
  });

  it('safely stops all tracks in stopMediaStream', () => {
    const stopFn1 = vi.fn();
    const stopFn2 = vi.fn();

    const fakeStream = {
      getTracks: () => [
        { stop: stopFn1 },
        { stop: stopFn2 },
      ],
    } as unknown as MediaStream;

    stopMediaStream(fakeStream);
    expect(stopFn1).toHaveBeenCalled();
    expect(stopFn2).toHaveBeenCalled();
  });

  it('handles null stream in stopMediaStream without throwing', () => {
    expect(() => stopMediaStream(null)).not.toThrow();
  });
});
