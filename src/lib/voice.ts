/**
 * Real Voice Note Engine (src/lib/voice.ts)
 * 
 * Provides:
 * 1. Cross-platform MediaRecorder format selection (webm/opus, mp4, ogg, wav)
 * 2. Accurate clock duration measurement & live audio analyzer waveform
 * 3. 5-minute recording ceiling with auto-stop
 * 4. High-efficiency upload to Firebase Storage with explicit contentType
 * 5. Single-active shared audio playback coordinator with speed control (1x, 1.5x, 2x)
 */

import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { app } from './firebase';
import { isCloudStorageAvailable } from './storageService';

export interface VoiceRecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  waveform: number[]; // 32 normalized levels 0.05 to 1.0
}

export interface VoicePlaybackState {
  currentMsgId: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number; // 1, 1.5, 2
  isBuffering: boolean;
  error: string | null;
}

/**
 * Detect best supported audio MIME type across Chrome, Edge, Firefox, and Safari (iOS/macOS).
 */
export function getSupportedAudioMimeType(): { mimeType: string; extension: string } {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
    return { mimeType: 'audio/webm', extension: 'webm' };
  }

  const candidates: Array<{ mimeType: string; extension: string }> = [
    { mimeType: 'audio/webm;codecs=opus', extension: 'webm' },
    { mimeType: 'audio/mp4', extension: 'mp4' },
    { mimeType: 'audio/aac', extension: 'aac' },
    { mimeType: 'audio/ogg;codecs=opus', extension: 'ogg' },
    { mimeType: 'audio/webm', extension: 'webm' },
  ];

  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate.mimeType)) {
      return candidate;
    }
  }

  return { mimeType: '', extension: 'webm' };
}

export class VoiceRecorderManager {
  private mediaRecorder: MediaRecorder | null = null;
  private audioStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private recordedChunks: Blob[] = [];
  private startTime: number = 0;
  private mimeType: string = 'audio/webm';
  private extension: string = 'webm';
  private waveformSamples: number[] = [];
  private meterInterval: number | null = null;
  private maxDurationTimer: number | null = null;

  public isRecording(): boolean {
    return this.mediaRecorder !== null && this.mediaRecorder.state === 'recording';
  }

  public getExtension(): string {
    return this.extension;
  }

  /**
   * Request microphone and begin recording.
   * onLevel: callback receiving live volume (0..1) for the UI meter.
   */
  public async startRecording(onLevel?: (level: number) => void): Promise<void> {
    if (this.isRecording()) {
      await this.cancelRecording();
    }

    const { mimeType, extension } = getSupportedAudioMimeType();
    this.mimeType = mimeType;
    this.extension = extension;
    this.recordedChunks = [];
    this.waveformSamples = [];

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.audioStream = stream;

    // Set up Web Audio Analyser for live level meter and waveform capture
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.audioContext = new AudioCtx();
        const source = this.audioContext.createMediaStreamSource(stream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        source.connect(this.analyser);

        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.meterInterval = window.setInterval(() => {
          if (!this.analyser) return;
          this.analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          const normalized = Math.min(1, Math.max(0.08, avg / 128));

          this.waveformSamples.push(normalized);
          if (onLevel) onLevel(normalized);
        }, 100);
      }
    } catch (e) {
      console.warn('[VoiceRecorder] Audio analyzer unavailable, continuing basic recording:', e);
    }

    const options: MediaRecorderOptions = {};
    if (this.mimeType) {
      options.mimeType = this.mimeType;
    }

    this.mediaRecorder = new MediaRecorder(stream, options);

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.recordedChunks.push(event.data);
      }
    };

    this.startTime = Date.now();
    // Record in 250ms chunks to ensure all data is flushed smoothly
    this.mediaRecorder.start(250);

    // 5-minute maximum recording limit (300,000 ms)
    this.maxDurationTimer = window.setTimeout(() => {
      if (this.isRecording()) {
        this.stopRecording().catch(console.error);
      }
    }, 5 * 60 * 1000);
  }

  /**
   * Stop recording and return the assembled Blob, duration, and processed waveform.
   */
  public async stopRecording(): Promise<VoiceRecordingResult> {
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
    if (this.meterInterval) {
      clearInterval(this.meterInterval);
      this.meterInterval = null;
    }

    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        this.cleanup();
        reject(new Error('No active recording'));
        return;
      }

      const durationMs = Math.max(500, Date.now() - this.startTime);

      this.mediaRecorder.onstop = () => {
        try {
          const finalMime = this.mimeType || this.mediaRecorder?.mimeType || 'audio/webm';
          const blob = new Blob(this.recordedChunks, { type: finalMime });

          // Resample waveform into exactly 36 clean bars for the UI bubble
          const processedWaveform = this.compressWaveform(this.waveformSamples, 36);

          this.cleanup();
          resolve({
            blob,
            mimeType: finalMime,
            durationMs,
            waveform: processedWaveform,
          });
        } catch (err) {
          this.cleanup();
          reject(err);
        }
      };

      try {
        this.mediaRecorder.stop();
      } catch (e) {
        this.cleanup();
        reject(e);
      }
    });
  }

  /**
   * Cancel and discard recording.
   */
  public async cancelRecording(): Promise<void> {
    if (this.maxDurationTimer) clearTimeout(this.maxDurationTimer);
    if (this.meterInterval) clearInterval(this.meterInterval);

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.onstop = null;
        this.mediaRecorder.stop();
      } catch {}
    }
    this.cleanup();
  }

  private cleanup(): void {
    if (this.audioStream) {
      this.audioStream.getTracks().forEach((track) => track.stop());
      this.audioStream = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }
    this.analyser = null;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.waveformSamples = [];
  }

  private compressWaveform(samples: number[], targetBars: number): number[] {
    if (!samples.length) {
      return Array.from({ length: targetBars }, () => 0.2);
    }
    if (samples.length <= targetBars) {
      const padded = [...samples];
      while (padded.length < targetBars) padded.push(0.15);
      return padded;
    }

    const blockSize = samples.length / targetBars;
    const result: number[] = [];
    for (let i = 0; i < targetBars; i++) {
      const start = Math.floor(i * blockSize);
      const end = Math.floor((i + 1) * blockSize);
      let sum = 0;
      let count = 0;
      for (let j = start; j < end && j < samples.length; j++) {
        sum += samples[j];
        count++;
      }
      const avg = count ? sum / count : 0.2;
      result.push(Number(Math.max(0.08, Math.min(1.0, avg)).toFixed(2)));
    }
    return result;
  }
}

export const voiceRecorder = new VoiceRecorderManager();

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read audio blob'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Upload Voice Note Blob to Firebase Storage with inline data fallback
 */
export async function uploadVoiceNote(params: {
  spaceId: string;
  messageId: string;
  blob: Blob;
  mimeType: string;
  onProgress?: (percent: number) => void;
}): Promise<{ downloadUrl: string; storagePath: string }> {
  const { spaceId, messageId, blob, mimeType, onProgress } = params;
  const { extension } = getSupportedAudioMimeType();
  const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : extension;
  const storagePath = `spaces/${spaceId}/chat/${messageId}/voice.${ext}`;

  if (!isCloudStorageAvailable()) {
    console.warn('[VoiceUpload] Cloud storage unavailable, using inline audio');
    const dataUrl = await blobToDataUrl(blob);
    onProgress?.(100);
    return { downloadUrl: dataUrl, storagePath: `inline/${messageId}` };
  }

  try {
    const storage = getStorage(app);
    const storageRef = ref(storage, storagePath);

    const uploadTask = uploadBytesResumable(storageRef, blob, {
      contentType: mimeType || 'audio/webm',
      cacheControl: 'public,max-age=31536000,immutable',
    });

    return await new Promise((resolve, reject) => {
      // 6-second safety timeout before falling back to inline data URL
      const timer = setTimeout(async () => {
        try { uploadTask.cancel(); } catch {}
        try {
          console.warn('[VoiceUpload] Storage timed out, falling back to inline audio');
          const dataUrl = await blobToDataUrl(blob);
          onProgress?.(100);
          resolve({ downloadUrl: dataUrl, storagePath: `inline/${messageId}` });
        } catch (fallbackErr) {
          reject(fallbackErr);
        }
      }, 6000);

      uploadTask.on(
        'state_changed',
        (snapshot) => {
          if (onProgress && snapshot.totalBytes > 0) {
            const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            onProgress(pct);
          }
        },
        async (error) => {
          clearTimeout(timer);
          console.warn('[VoiceUpload] Storage upload failed, falling back to inline audio:', error);
          try {
            const dataUrl = await blobToDataUrl(blob);
            onProgress?.(100);
            resolve({ downloadUrl: dataUrl, storagePath: `inline/${messageId}` });
          } catch (fallbackErr) {
            reject(fallbackErr);
          }
        },
        async () => {
          clearTimeout(timer);
          try {
            const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
            resolve({ downloadUrl, storagePath });
          } catch (err: any) {
            console.warn('[VoiceUpload] getDownloadURL failed, falling back to inline audio:', err);
            try {
              const dataUrl = await blobToDataUrl(blob);
              onProgress?.(100);
              resolve({ downloadUrl: dataUrl, storagePath: `inline/${messageId}` });
            } catch (fallbackErr) {
              reject(fallbackErr);
            }
          }
        }
      );
    });
  } catch (err: any) {
    console.warn('[VoiceUpload] Cloud Storage init failed, falling back to inline audio:', err);
    const dataUrl = await blobToDataUrl(blob);
    onProgress?.(100);
    return { downloadUrl: dataUrl, storagePath: `inline/${messageId}` };
  }
}

/**
 * Single-instance shared Voice Player Coordinator
 */
type Listener = (state: VoicePlaybackState) => void;

class VoicePlayerCoordinator {
  private audio: HTMLAudioElement | null = null;
  private currentMsgId: string | null = null;
  private playbackRate: number = 1.0;
  private listeners: Set<Listener> = new Set();
  private isBuffering: boolean = false;
  private error: string | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.audio = new Audio();
      this.audio.preload = 'metadata';

      this.audio.addEventListener('timeupdate', () => this.notify());
      this.audio.addEventListener('playing', () => {
        this.isBuffering = false;
        this.error = null;
        this.notify();
      });
      this.audio.addEventListener('waiting', () => {
        this.isBuffering = true;
        this.notify();
      });
      this.audio.addEventListener('ended', () => {
        this.currentMsgId = null;
        this.notify();
      });
      this.audio.addEventListener('error', () => {
        this.isBuffering = false;
        this.error = 'Playback failed. Tap to retry or download.';
        this.notify();
      });
    }
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  public getState(): VoicePlaybackState {
    return {
      currentMsgId: this.currentMsgId,
      isPlaying: this.audio ? !this.audio.paused && !this.audio.ended : false,
      currentTime: this.audio?.currentTime || 0,
      duration: this.audio?.duration && !isNaN(this.audio.duration) ? this.audio.duration : 0,
      playbackRate: this.playbackRate,
      isBuffering: this.isBuffering,
      error: this.error,
    };
  }

  private notify(): void {
    const state = this.getState();
    this.listeners.forEach((l) => l(state));
  }

  private currentObjectUrl: string | null = null;

  public async play(msgId: string, url: string): Promise<void> {
    if (!this.audio) return;

    if (this.currentMsgId === msgId && !this.audio.paused) {
      this.audio.pause();
      this.notify();
      return;
    }

    let targetSrc = url;
    if (url.startsWith('data:audio')) {
      try {
        const parts = url.split(',');
        if (parts.length === 2) {
          const mime = parts[0].match(/:(.*?);/)?.[1] || 'audio/webm';
          const bstr = atob(parts[1]);
          const u8arr = new Uint8Array(bstr.length);
          for (let i = 0; i < bstr.length; i++) {
            u8arr[i] = bstr.charCodeAt(i);
          }
          const blob = new Blob([u8arr], { type: mime });
          targetSrc = URL.createObjectURL(blob);
          if (this.currentObjectUrl) {
            URL.revokeObjectURL(this.currentObjectUrl);
          }
          this.currentObjectUrl = targetSrc;
        }
      } catch (err) {
        console.warn('[VoicePlayer] Could not convert dataUrl to Blob, playing directly:', err);
      }
    }

    if (this.currentMsgId !== msgId || this.audio.src !== targetSrc) {
      this.currentMsgId = msgId;
      this.audio.src = targetSrc;
      try {
        this.audio.load();
      } catch {}
      this.audio.playbackRate = this.playbackRate;
      this.error = null;
      this.isBuffering = true;
      this.notify();
    }

    try {
      await this.audio.play();
    } catch (e: any) {
      console.warn('[VoicePlayer] Playback error:', e);
      this.error = 'Tap to play audio';
      this.notify();
    }
  }

  public pause(): void {
    if (this.audio && !this.audio.paused) {
      this.audio.pause();
      this.notify();
    }
  }

  public seek(seconds: number): void {
    if (this.audio) {
      this.audio.currentTime = seconds;
      this.notify();
    }
  }

  public setSpeed(rate: number): void {
    this.playbackRate = rate;
    if (this.audio) {
      this.audio.playbackRate = rate;
    }
    this.notify();
  }

  public stop(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.currentMsgId = null;
      this.notify();
    }
  }
}

export const voicePlayer = new VoicePlayerCoordinator();
