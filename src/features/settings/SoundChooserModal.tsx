import React, { useState, useRef } from 'react';
import {
  soundEngine,
  BUILTIN_SOUNDS,
  type CustomSoundItem,
} from '../../lib/sounds';
import {
  Play,
  Square,
  UploadCloud,
  Check,
  X,
  Trash2,
  AlertCircle,
  Loader2,
  Music,
} from 'lucide-react';

interface SoundChooserModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  category: 'message' | 'ringtone' | 'alarm';
  selectedSoundId: string;
  onSelectSound: (soundId: string) => void;
  spaceId?: string;
  userId?: string;
}

export const SoundChooserModal: React.FC<SoundChooserModalProps> = ({
  isOpen,
  onClose,
  title,
  category,
  selectedSoundId,
  onSelectSound,
}) => {
  const [playingSoundId, setPlayingSoundId] = useState<string | null>(null);
  const activeStopRef = useRef<(() => void) | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  if (!isOpen) return null;

  const builtins = BUILTIN_SOUNDS.filter((s) => s.category === category);
  const customList = soundEngine
    .getCustomSounds()
    .filter((s) => s.category === category);

  const stopCurrent = () => {
    if (activeStopRef.current) {
      activeStopRef.current();
      activeStopRef.current = null;
    }
    setPlayingSoundId(null);
  };

  const handleTogglePlay = async (soundId: string) => {
    if (playingSoundId === soundId) {
      stopCurrent();
      return;
    }

    stopCurrent();
    setPlayingSoundId(soundId);

    const handle = await soundEngine.play(soundId, {
      category,
      force: true,
      loop: category === 'ringtone',
    });

    activeStopRef.current = handle.stop;

    // Automatically reset playing state after 4s for short sounds
    if (category !== 'ringtone') {
      setTimeout(() => {
        if (playingSoundId === soundId) {
          stopCurrent();
        }
      }, 4000);
    }
  };

  const handleSelect = (soundId: string) => {
    stopCurrent();
    onSelectSound(soundId);
    onClose();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);

    const validation = await soundEngine.validateAudioUpload(file, category);
    if (!validation.valid) {
      setUploadError(validation.error || 'Invalid audio file');
      setUploading(false);
      return;
    }

    try {
      // Create local object URL for instant zero-latency playback
      const localUrl = URL.createObjectURL(file);
      const newCustom: CustomSoundItem = {
        id: `custom-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        name: file.name.replace(/\.[^/.]+$/, '').slice(0, 30),
        category,
        url: localUrl,
        duration: validation.duration,
        size: file.size,
        storagePath: `local/sounds/${file.name}`,
        createdAt: new Date().toISOString(),
      };

      const existing = soundEngine.getCustomSounds();
      soundEngine.setCustomSounds([...existing, newCustom]);
      handleSelect(newCustom.id);
    } catch (err: any) {
      setUploadError('Failed to process custom audio file');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteCustom = (customId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    stopCurrent();
    const existing = soundEngine.getCustomSounds();
    const target = existing.find((c) => c.id === customId);
    if (target?.url && target.url.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(target.url);
      } catch {}
    }
    const updated = existing.filter((c) => c.id !== customId);
    soundEngine.setCustomSounds(updated);
    if (selectedSoundId === customId) {
      const fallback = builtins[0]?.id || 'msg-pop';
      onSelectSound(fallback);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[var(--overlay)] backdrop-blur-xs animate-in fade-in">
      <div className="w-full max-w-lg rounded-3xl bg-[var(--surface)] border-3 border-[var(--border)] shadow-[0_8px_0_var(--shadow-color)] overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b-2 border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[var(--accent)] border-2 border-[var(--border)] flex items-center justify-center text-[var(--text)]">
              <Music className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-chunky font-bold text-base text-[var(--text)]">{title}</h3>
              <p className="font-clean text-xs text-[var(--text-muted)]">
                Choose a melody or upload your own audio clip
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              stopCurrent();
              onClose();
            }}
            className="p-1.5 rounded-full hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable list */}
        <div className="p-4 overflow-y-auto space-y-4 flex-1">
          {/* Built-in Sounds Section */}
          <div>
            <span className="font-chunky text-xs uppercase text-[var(--text-muted)] font-bold mb-2 block">
              Built-in Sounds
            </span>
            <div className="space-y-1.5">
              {builtins.map((sound) => {
                const isSelected = selectedSoundId === sound.id;
                const isPlaying = playingSoundId === sound.id;

                return (
                  <div
                    key={sound.id}
                    onClick={() => handleSelect(sound.id)}
                    className={`flex items-center justify-between p-3 rounded-2xl border-2 transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[var(--accent)]/20 border-[var(--accent)] shadow-xs'
                        : 'bg-[var(--surface-2)] border-[var(--border)] hover:bg-[var(--surface)]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTogglePlay(sound.id);
                        }}
                        className={`w-9 h-9 min-w-[36px] min-h-[36px] rounded-xl border-2 border-[var(--border)] flex items-center justify-center cursor-pointer shadow-xs ${
                          isPlaying ? 'bg-[var(--urgent)] text-white' : 'bg-[var(--surface)] text-[var(--text)]'
                        }`}
                        aria-label={isPlaying ? 'Stop sound' : 'Preview sound'}
                      >
                        {isPlaying ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                      </button>

                      <div className="min-w-0">
                        <div className="font-clean font-bold text-xs text-[var(--text)] flex items-center gap-1.5">
                          <span>{sound.name}</span>
                          {isSelected && <span className="text-[10px] text-[var(--partner-a)] font-bold">Selected</span>}
                        </div>
                        <span className="font-clean text-[11px] text-[var(--text-muted)] block truncate">
                          {sound.description}
                        </span>
                      </div>
                    </div>

                    {isSelected && <Check className="w-4 h-4 text-[var(--accent)] shrink-0" />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* User Custom Sounds */}
          {customList.length > 0 && (
            <div>
              <span className="font-chunky text-xs uppercase text-[var(--text-muted)] font-bold mb-2 block">
                My Uploads
              </span>
              <div className="space-y-1.5">
                {customList.map((sound) => {
                  const isSelected = selectedSoundId === sound.id;
                  const isPlaying = playingSoundId === sound.id;

                  return (
                    <div
                      key={sound.id}
                      onClick={() => handleSelect(sound.id)}
                      className={`flex items-center justify-between p-3 rounded-2xl border-2 transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-[var(--accent)]/20 border-[var(--accent)] shadow-xs'
                          : 'bg-[var(--surface-2)] border-[var(--border)] hover:bg-[var(--surface)]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTogglePlay(sound.id);
                          }}
                          className={`w-9 h-9 min-w-[36px] min-h-[36px] rounded-xl border-2 border-[var(--border)] flex items-center justify-center cursor-pointer shadow-xs ${
                            isPlaying ? 'bg-[var(--urgent)] text-white' : 'bg-[var(--surface)] text-[var(--text)]'
                          }`}
                          aria-label={isPlaying ? 'Stop sound' : 'Preview sound'}
                        >
                          {isPlaying ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                        </button>

                        <div className="min-w-0">
                          <div className="font-clean font-bold text-xs text-[var(--text)] truncate">
                            {sound.name}
                          </div>
                          <span className="font-numeric text-[11px] text-[var(--text-muted)]">
                            {Math.round(sound.duration)}s · {(sound.size / 1024).toFixed(0)} KB
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {isSelected && <Check className="w-4 h-4 text-[var(--accent)]" />}
                        <button
                          type="button"
                          onClick={(e) => handleDeleteCustom(sound.id, e)}
                          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--urgent)] hover:bg-[var(--urgent)]/20 cursor-pointer"
                          title="Delete custom sound"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Upload Custom Audio Button */}
          <div className="pt-2 border-t-2 border-[var(--border)]">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.mp3,.m4a,.wav,.ogg,.webm"
              onChange={handleFileUpload}
              className="hidden"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full py-3 rounded-2xl bg-[var(--surface-2)] hover:bg-[var(--accent)]/30 border-2 border-[var(--border)] font-chunky text-xs font-bold text-[var(--text)] flex items-center justify-center gap-2 shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 cursor-pointer disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Checking duration & size...</span>
                </>
              ) : (
                <>
                  <UploadCloud className="w-4 h-4" />
                  <span>Upload Your Own Audio Clip (MP3, WAV, M4A &lt; 2 MB)</span>
                </>
              )}
            </button>

            {uploadError && (
              <div className="mt-2 p-2 rounded-xl bg-[var(--urgent)]/20 text-[var(--urgent)] text-xs font-ui flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{uploadError}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 bg-[var(--surface-2)] border-t-2 border-[var(--border)] text-center text-[11px] font-ui text-[var(--text-muted)]">
          {category === 'message'
            ? 'Short sound effects (up to 5 seconds)'
            : 'Ringtones and alarms loop up to 30 seconds'}
        </div>
      </div>
    </div>
  );
};
