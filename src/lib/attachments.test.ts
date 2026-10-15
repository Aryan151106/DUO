import { describe, it, expect } from 'vitest';
import {
  validateAttachmentFile,
  sanitizeFileName,
  formatFileSize,
  getAttachmentType,
  MAX_VIDEO_SIZE_BYTES,
  MAX_DOCUMENT_SIZE_BYTES,
} from './attachments';

describe('Attachment Validation and Utilities', () => {
  it('blocks risky executable extensions (.exe, .bat, .sh, .apk, .cmd)', () => {
    const exeFile = new File(['echo virus'], 'malware.exe', { type: 'application/octet-stream' });
    const batFile = new File(['@echo off'], 'script.bat', { type: 'text/plain' });
    const shFile = new File(['#!/bin/bash'], 'run.sh', { type: 'text/plain' });
    const apkFile = new File(['apk content'], 'installer.apk', { type: 'application/octet-stream' });

    expect(validateAttachmentFile(exeFile).valid).toBe(false);
    expect(validateAttachmentFile(exeFile).error).toContain('Executables and scripts (.exe) are blocked');

    expect(validateAttachmentFile(batFile).valid).toBe(false);
    expect(validateAttachmentFile(shFile).valid).toBe(false);
    expect(validateAttachmentFile(apkFile).valid).toBe(false);
  });

  it('allows valid image, video, and document formats', () => {
    const img = new File(['fake image data'], 'photo.jpg', { type: 'image/jpeg' });
    const pdf = new File(['fake pdf data'], 'contract.pdf', { type: 'application/pdf' });
    const vid = new File(['fake vid data'], 'vacation.mp4', { type: 'video/mp4' });
    const docx = new File(['fake doc data'], 'notes.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

    expect(validateAttachmentFile(img).valid).toBe(true);
    expect(validateAttachmentFile(pdf).valid).toBe(true);
    expect(validateAttachmentFile(vid).valid).toBe(true);
    expect(validateAttachmentFile(docx).valid).toBe(true);
  });

  it('enforces maximum size limits on video and documents', () => {
    // Large video > 100MB
    const bigVideo = new File([new Uint8Array(10)], 'huge.mp4', { type: 'video/mp4' });
    Object.defineProperty(bigVideo, 'size', { value: MAX_VIDEO_SIZE_BYTES + 1024 });
    const vidRes = validateAttachmentFile(bigVideo);
    expect(vidRes.valid).toBe(false);
    expect(vidRes.error).toContain('Video exceeds the 100 MB limit');

    // Large document > 50MB
    const bigDoc = new File([new Uint8Array(10)], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(bigDoc, 'size', { value: MAX_DOCUMENT_SIZE_BYTES + 1024 });
    const docRes = validateAttachmentFile(bigDoc);
    expect(docRes.valid).toBe(false);
    expect(docRes.error).toContain('Document exceeds the 50 MB limit');
  });

  it('identifies attachment types correctly', () => {
    expect(getAttachmentType(new File([], 'a.png', { type: 'image/png' }))).toBe('image');
    expect(getAttachmentType(new File([], 'b.mp4', { type: 'video/mp4' }))).toBe('video');
    expect(getAttachmentType(new File([], 'c.pdf', { type: 'application/pdf' }))).toBe('document');
    expect(getAttachmentType(new File([], 'd.zip', { type: 'application/zip' }))).toBe('document');
  });

  it('sanitizes filenames to avoid dangerous characters', () => {
    expect(sanitizeFileName('../../secret/file.txt')).toBe('.._.._secret_file.txt');
    expect(sanitizeFileName('my photo (1) <cool>.jpg')).toBe('my_photo__1___cool_.jpg');
    expect(sanitizeFileName('normal_name-123.pdf')).toBe('normal_name-123.pdf');
  });

  it('formats file sizes into human-readable strings', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1024 * 1024 * 3.5)).toBe('3.5 MB');
  });
});
