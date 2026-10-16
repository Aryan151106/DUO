import React, { useState } from 'react';
import {
  X,
  Star,
  CornerUpLeft,
  Search,
  FileText,
  Play,
  Paintbrush,
  Mic,
  Clock,
} from 'lucide-react';
import type { StarredMessage } from '../../lib/starredMessages';
import { format } from 'date-fns';
import { soundEffects } from '../../lib/sound';

interface StarredMessagesModalProps {
  isOpen: boolean;
  onClose: () => void;
  starredList: StarredMessage[];
  onUnstar: (messageId: string) => void;
  onJumpToMessage: (messageId: string) => void;
  currentUserId: string;
}

export const StarredMessagesModal: React.FC<StarredMessagesModalProps> = ({
  isOpen,
  onClose,
  starredList,
  onUnstar,
  onJumpToMessage,
  currentUserId,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen) return null;

  const filtered = starredList.filter((item) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.content?.toLowerCase().includes(q) ||
      item.senderName?.toLowerCase().includes(q) ||
      item.attachments?.some((a) => a.fileName.toLowerCase().includes(q))
    );
  });

  const handleJump = (messageId: string) => {
    soundEffects.playPop();
    onClose();
    onJumpToMessage(messageId);
  };

  const handleUnstar = (e: React.MouseEvent, messageId: string) => {
    e.stopPropagation();
    soundEffects.playPop();
    onUnstar(messageId);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="starred-modal-title"
      className="fixed inset-0 z-50 bg-[var(--overlay)]/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-2 sm:p-4 animate-in fade-in duration-150"
    >
      <div className="w-full max-w-lg max-h-[85vh] bg-[var(--surface)] text-[var(--text)] border-3 border-[var(--border)] rounded-3xl shadow-[0_6px_0_var(--shadow-color)] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b-2 border-[var(--border)] flex items-center justify-between gap-3 shrink-0 bg-[var(--surface-2)]/50">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-amber-400/20 border-2 border-amber-400/40 text-amber-500 flex items-center justify-center shrink-0 shadow-xs">
              <Star className="w-5 h-5 fill-amber-400 text-amber-500" />
            </div>
            <div className="min-w-0">
              <h2 id="starred-modal-title" className="font-chunky text-lg font-bold text-[var(--text)] flex items-center gap-2 leading-tight">
                <span>Starred Messages</span>
                <span className="font-numeric text-xs bg-[var(--surface-2)] px-2 py-0.5 rounded-full border border-[var(--border)] text-[var(--text-muted)]">
                  {starredList.length}
                </span>
              </h2>
              <p className="font-ui text-xs text-[var(--text-muted)] truncate">
                Private to you • Tap to jump to original message
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close starred messages"
            className="w-9 h-9 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] flex items-center justify-center cursor-pointer transition-all active:scale-95 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search Bar */}
        {starredList.length > 3 && (
          <div className="p-3 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search starred messages…"
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-[var(--surface-2)] border-2 border-[var(--border)] font-ui text-xs text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
            </div>
          </div>
        )}

        {/* List Content */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 min-h-0 chat-messages-scroll">
          {filtered.length === 0 ? (
            <div className="text-center py-12 px-6">
              <div className="w-14 h-14 rounded-2xl bg-[var(--surface-2)] border-2 border-dashed border-[var(--border)] flex items-center justify-center mx-auto mb-3 text-2xl">
                ⭐
              </div>
              <h4 className="font-chunky text-base font-bold text-[var(--text)]">
                {searchQuery ? 'No matching starred messages' : 'No starred messages yet'}
              </h4>
              <p className="font-ui text-xs text-[var(--text-muted)] max-w-xs mx-auto mt-1">
                {searchQuery
                  ? 'Try searching for different keywords.'
                  : 'Star important notes, cute memories, or sweet moments in chat so you can find them anytime!'}
              </p>
            </div>
          ) : (
            filtered.map((item) => {
              const isMe = item.senderId === currentUserId;
              const dateStr = item.createdAt
                ? format(new Date(item.createdAt), 'MMM d, yyyy • h:mm a')
                : '';

              return (
                <div
                  key={item.id}
                  onClick={() => handleJump(item.messageId)}
                  className="p-3.5 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] hover:border-[var(--partner-a)] shadow-[0_2px_0_var(--shadow-color)] transition-all cursor-pointer group space-y-2 relative"
                >
                  {/* Item Header */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-ui text-xs font-bold text-[var(--text)] truncate">
                        {isMe ? 'You' : item.senderName}
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)]">•</span>
                      <span className="font-ui text-[11px] text-[var(--text-muted)] truncate flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>{dateStr}</span>
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => handleUnstar(e, item.messageId)}
                        title="Unstar message"
                        className="p-1.5 rounded-lg text-amber-500 hover:bg-amber-400/20 transition-all cursor-pointer"
                      >
                        <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-500" />
                      </button>
                    </div>
                  </div>

                  {/* Body Content */}
                  {item.content && (
                    <p className="font-body text-xs sm:text-[13px] text-[var(--text)] line-clamp-3 break-words whitespace-pre-wrap">
                      {item.content}
                    </p>
                  )}

                  {/* Attachment Previews */}
                  {item.attachments && item.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {item.attachments.map((att) => (
                        <div
                          key={att.id}
                          className="flex items-center gap-2 p-1.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-xs font-ui max-w-full truncate"
                        >
                          {att.type === 'image' ? (
                            <img
                              src={att.thumbnailUrl || att.url}
                              alt={att.fileName}
                              className="w-10 h-10 rounded-lg object-cover border border-[var(--border)] shrink-0"
                            />
                          ) : att.type === 'video' ? (
                            <div className="w-10 h-10 rounded-lg bg-black/80 text-white flex items-center justify-center shrink-0">
                              <Play className="w-4 h-4 fill-current ml-0.5" />
                            </div>
                          ) : (
                            <FileText className="w-4 h-4 text-[var(--accent)] shrink-0" />
                          )}
                          <span className="truncate max-w-[160px] text-[11px] font-medium">
                            {att.fileName}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Doodle indicator */}
                  {item.messageType === 'doodle' && (
                    <div className="flex items-center gap-1.5 text-xs font-ui text-[var(--partner-a)] font-semibold pt-1">
                      <Paintbrush className="w-3.5 h-3.5" />
                      <span>Shared Doodle 🎨</span>
                    </div>
                  )}

                  {/* Voice indicator */}
                  {item.messageType === 'voice' && (
                    <div className="flex items-center gap-1.5 text-xs font-ui text-emerald-600 dark:text-emerald-400 font-semibold pt-1">
                      <Mic className="w-3.5 h-3.5" />
                      <span>Voice Note 🎙️</span>
                    </div>
                  )}

                  {/* Jump button */}
                  <div className="flex justify-end pt-1">
                    <span className="inline-flex items-center gap-1 text-[11px] font-ui font-semibold text-[var(--partner-a)] group-hover:underline">
                      <span>Jump to message</span>
                      <CornerUpLeft className="w-3 h-3 rotate-180" />
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
