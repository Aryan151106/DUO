import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Send,
  Mic,
  CornerUpLeft,
  X,
  UploadCloud,
} from 'lucide-react';
import { AttachmentPicker } from './AttachmentPicker';
import type { FileAttachment } from '../../lib/attachments';
import type { ChatMessage } from '../../lib/dataStore';

interface ChatInputComposerProps {
  partnerName: string;
  spaceId: string;
  currentUserId: string;
  replyTarget: ChatMessage | null;
  onClearReply: () => void;
  onSendMessage: (text: string) => void;
  onSendAttachments: (attachments: FileAttachment[]) => void;
  onBroadcastTyping: (isTyping: boolean) => void;
  isVoiceUploading: boolean;
  isRecording: boolean;
  recordDuration: number;
  micLevel: number;
  onStartRecording: () => void;
  onStopRecording: (send: boolean) => void;
  externalInputRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export const ChatInputComposer: React.FC<ChatInputComposerProps> = React.memo(({
  partnerName,
  spaceId,
  currentUserId,
  replyTarget,
  onClearReply,
  onSendMessage,
  onSendAttachments,
  onBroadcastTyping,
  isVoiceUploading,
  isRecording,
  recordDuration,
  micLevel,
  onStartRecording,
  onStopRecording,
  externalInputRef,
}) => {
  const [inputText, setInputText] = useState('');
  const localInputRef = useRef<HTMLTextAreaElement | null>(null);
  const inputRef = externalInputRef || localInputRef;

  const typingBroadcastTimer = useRef<number>(0);
  const typingStopTimer = useRef<number | null>(null);

  // Auto-resize textarea height smoothly up to max 112px (4 lines)
  const adjustHeight = useCallback(() => {
    const el = inputRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
    }
  }, [inputRef]);

  // If app is opened via notification "Reply" action button, auto-focus textarea
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('openReply=true')) {
      const timer = window.setTimeout(() => {
        inputRef.current?.focus();
        try {
          const params = new URLSearchParams(window.location.search);
          params.delete('openReply');
          const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
          window.history.replaceState({}, '', newUrl);
        } catch {}
      }, 350);
      return () => window.clearTimeout(timer);
    }
  }, [inputRef]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInputText(value);
    adjustHeight();

    const isTyping = value.length > 0;
    const now = Date.now();

    // Throttled typing indicator: only broadcast at most once every 2 seconds
    if (isTyping && now - typingBroadcastTimer.current >= 2000) {
      typingBroadcastTimer.current = now;
      onBroadcastTyping(true);
    }

    if (typingStopTimer.current) window.clearTimeout(typingStopTimer.current);

    if (isTyping) {
      typingStopTimer.current = window.setTimeout(() => {
        onBroadcastTyping(false);
      }, 3000);
    } else {
      onBroadcastTyping(false);
    }
  };

  const handleBlur = () => {
    if (typingStopTimer.current) window.clearTimeout(typingStopTimer.current);
    onBroadcastTyping(false);
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed) return;

    onSendMessage(trimmed);
    setInputText('');
    onBroadcastTyping(false);

    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  };

  useEffect(() => {
    return () => {
      if (typingStopTimer.current) window.clearTimeout(typingStopTimer.current);
    };
  }, []);

  return (
    <>
      {/* Active Quoted Reply Bar */}
      {replyTarget && (
        <div className="flex items-center justify-between p-2.5 mb-2 rounded-2xl bg-[var(--surface)] border-2 border-[var(--border)] shadow-xs animate-in slide-in-from-bottom-2">
          <div className="flex items-center gap-2 min-w-0">
            <CornerUpLeft className="w-4 h-4 text-[var(--accent)] shrink-0" />
            <div className="min-w-0 text-xs font-ui">
              <span className="font-bold text-[var(--text)] block">
                Replying to{' '}
                {replyTarget.sender_id === currentUserId ? 'yourself' : partnerName}
              </span>
              <p className="text-[var(--text-muted)] truncate">
                {replyTarget.content || (replyTarget.message_type === 'media' ? 'Photo or attachment' : 'Shared something')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClearReply}
            className="p-1 rounded-full text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Input Composer: Fixed at bottom like WhatsApp/Instagram */}
      <div className="card p-2 sm:p-2.5 shrink-0 z-10 shadow-xs mt-auto">
        {isVoiceUploading && (
          <div className="flex items-center gap-2 px-3 py-1 mb-1 text-xs font-ui text-[var(--accent)] animate-pulse">
            <UploadCloud className="w-3.5 h-3.5" />
            <span>Uploading voice note...</span>
          </div>
        )}

        {isRecording ? (
          <div className="flex items-center justify-between px-3 py-1.5 text-sm">
            <div className="flex items-center gap-2 font-ui text-[var(--urgent)] font-semibold">
              <div
                className="w-3 h-3 rounded-full bg-[var(--urgent)] transition-transform duration-75"
                style={{ transform: `scale(${1 + micLevel * 1.5})` }}
              />
              <span>Recording Voice Note... ({recordDuration}s)</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onStopRecording(false)}
                className="px-3 py-1.5 rounded-xl font-chunky text-xs text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => onStopRecording(true)}
                className="px-4 py-1.5 rounded-xl bg-[var(--partner-a)] text-white font-chunky font-bold text-xs border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-1 cursor-pointer"
              >
                Send Voice Note ✨
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="flex items-end gap-2"
          >
            {/* Attachment Picker Paperclip Trigger (44px) */}
            <div className="shrink-0 flex items-center justify-center">
              <AttachmentPicker
                spaceId={spaceId}
                folder="chat"
                parentId={`chat-msg-${Date.now()}`}
                uploadedBy={currentUserId}
                onAttachmentsReady={onSendAttachments}
              />
            </div>

            {/* Mic Button (44px tap target) */}
            <button
              type="button"
              onClick={onStartRecording}
              title="Record Voice Note"
              className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-2xl text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] border-2 border-transparent hover:border-[var(--border)] transition-all cursor-pointer flex items-center justify-center shrink-0"
            >
              <Mic className="w-5 h-5" />
            </button>

            {/* Mobile-optimized input: 16px font to prevent iOS/Android zoom, isolated re-renders */}
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              rows={1}
              value={inputText}
              onChange={handleChange}
              onBlur={handleBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={`Message ${partnerName}...`}
              className="flex-1 bg-transparent px-3 py-2.5 text-[16px] font-body text-[var(--text)] placeholder-[var(--text-muted)]/60 focus:outline-none resize-none max-h-28 overflow-y-auto leading-normal"
            />

            {/* Send Button */}
            <button
              type="submit"
              disabled={!inputText.trim()}
              className={`w-11 h-11 min-w-[44px] min-h-[44px] rounded-2xl flex items-center justify-center border-2 transition-all shrink-0 ${
                inputText.trim()
                  ? 'bg-[var(--partner-a)] text-white border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none cursor-pointer'
                  : 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)] cursor-not-allowed shadow-none'
              }`}
              aria-label="Send message"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        )}
      </div>
    </>
  );
});

ChatInputComposer.displayName = 'ChatInputComposer';
