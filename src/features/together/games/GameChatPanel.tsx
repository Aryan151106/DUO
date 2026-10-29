import React, { useState, useEffect, useRef } from 'react';
import type { GameMode, GameChatMessage } from '../../../lib/games/types';
import { useActiveGameStore } from '../../../lib/games/gameStore';
import { GoogleIcon } from '../../../components/GoogleIcon';
import { sfx } from '../../../lib/games/arcadeAudio';

interface GameChatPanelProps {
  sessionId: string;
  gameMode: GameMode;
  myUid: string;
  onSendMessage: (text: string) => Promise<void>;
  isConnected?: boolean;
}

function formatChatTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

const EMPTY_MESSAGES: GameChatMessage[] = [];

export const GameChatPanel: React.FC<GameChatPanelProps> = ({
  sessionId,
  gameMode,
  myUid,
  onSendMessage,
  isConnected = true,
}) => {
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const messages = useActiveGameStore(
    (state) => state.chatMessages[sessionId] || EMPTY_MESSAGES
  );
  const isChatOpenMobile = useActiveGameStore((state) => state.isChatOpenMobile);
  const setChatOpenMobile = useActiveGameStore((state) => state.setChatOpenMobile);
  const unreadChatCount = useActiveGameStore((state) => state.unreadChatCount);
  const resetUnreadChatCount = useActiveGameStore((state) => state.resetUnreadChatCount);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Close mobile drawer on Escape key press
  useEffect(() => {
    if (!isChatOpenMobile) return;
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setChatOpenMobile(false);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isChatOpenMobile, setChatOpenMobile]);

  // Reset unread count when opening mobile chat
  const handleOpenMobileChat = () => {
    sfx('boing');
    setChatOpenMobile(true);
    resetUnreadChatCount();
  };

  const handleCloseMobileChat = () => {
    setChatOpenMobile(false);
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed || isSending) return;

    if (trimmed.length > 300) {
      setErrorMessage('Message cannot exceed 300 characters');
      return;
    }

    setErrorMessage(null);
    setIsSending(true);

    try {
      await onSendMessage(trimmed);
      setInputText('');
      sfx('pop');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to send message');
      sfx('buzz');
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const chatContent = (
    <div className="flex flex-col h-full w-full min-w-0 select-text">
      {/* Chat Header */}
      <div className="flex items-center justify-between border-b-2 border-[var(--arcade-ink)] px-3 py-2 bg-[var(--arcade-card)] rounded-t-2xl flex-shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-lg">💬</span>
          <span className="font-black text-sm text-[var(--arcade-ink)] truncate">Game Chat</span>
          <span
            className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-full border border-[var(--arcade-ink)] ${
              gameMode === 'online'
                ? isConnected
                  ? 'bg-[#2bb5d4] text-white'
                  : 'bg-amber-400 text-[#2b2140]'
                : 'bg-[#ff5d8f] text-white'
            }`}
          >
            {gameMode === 'online' ? (isConnected ? 'Live' : 'Reconnecting…') : 'Local Notes'}
          </span>
        </div>

        {/* Close button for mobile sheet */}
        <button
          type="button"
          onClick={handleCloseMobileChat}
          className="lg:hidden p-1 rounded-xl text-[var(--arcade-ink)] hover:bg-[var(--arcade-bg)] transition-colors cursor-pointer"
          aria-label="Close game chat"
        >
          <GoogleIcon name="close" size={18} />
        </button>
      </div>

      {/* Messages Scroll Area */}
      <div
        className="flex-1 overflow-y-auto p-3 space-y-2.5 min-h-0 bg-[var(--arcade-bg)]/30"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Game chat messages"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 text-[var(--arcade-ink)] opacity-70 space-y-1">
            <span className="text-3xl">🎈</span>
            <p className="font-extrabold text-xs">No chatter yet!</p>
            <p className="text-[11px] font-semibold">
              {gameMode === 'online'
                ? 'Send a friendly reaction, tease, or cheer to your partner!'
                : 'Leave playful notes back and forth between turns!'}
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.senderId === myUid;
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-full`}
              >
                <div className="flex items-baseline gap-1.5 px-1 mb-0.5">
                  <span className="text-[10px] font-black text-[var(--arcade-ink)] opacity-80">
                    {isMe ? 'You' : msg.senderName}
                  </span>
                  <span className="text-[9px] font-semibold text-[var(--arcade-ink)] opacity-60">
                    {formatChatTime(msg.createdAt)}
                  </span>
                </div>

                <div
                  className={`px-3 py-1.5 rounded-2xl border-2 border-[var(--arcade-ink)] text-xs font-bold break-words max-w-[85%] shadow-[2px_2px_0_var(--arcade-ink)] ${
                    isMe
                      ? 'bg-[#ff5d8f] text-white rounded-tr-none'
                      : 'bg-[#2bb5d4] text-white rounded-tl-none'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Error Notice */}
      {errorMessage && (
        <div className="bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-300 text-[11px] font-bold px-3 py-1 border-t border-red-300 flex items-center justify-between">
          <span className="truncate">{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-xs font-black ml-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* Message Input & Action Bar */}
      <form
        onSubmit={handleSend}
        className="p-2 border-t-2 border-[var(--arcade-ink)] bg-[var(--arcade-card)] rounded-b-2xl space-y-1.5 flex-shrink-0"
      >
        <div className="flex items-center gap-1.5">
          <textarea
            ref={inputRef}
            rows={1}
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              if (errorMessage) setErrorMessage(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              gameMode === 'online'
                ? isConnected
                  ? 'Message partner…'
                  : 'Reconnecting to game…'
                : 'Write a quick note…'
            }
            disabled={isSending || (gameMode === 'online' && !isConnected)}
            maxLength={300}
            className="flex-1 resize-none bg-[var(--arcade-bg)] text-[var(--arcade-ink)] border-2 border-[var(--arcade-ink)] rounded-xl py-1.5 px-2.5 text-xs font-bold placeholder-[var(--arcade-ink)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--arcade-a)] transition-all min-w-0"
          />

          <button
            type="submit"
            disabled={!inputText.trim() || isSending || (gameMode === 'online' && !isConnected)}
            className="arcade-btn arcade-btn-pink py-1.5 px-3 text-xs flex-shrink-0"
            aria-label="Send message"
          >
            {isSending ? (
              <span className="animate-spin text-xs">⏳</span>
            ) : (
              <GoogleIcon name="send" size={14} />
            )}
          </button>
        </div>

        <div className="flex items-center justify-between text-[10px] font-semibold text-[var(--arcade-ink)] opacity-60 px-1">
          <span>Enter ↵ to send</span>
          <span className={inputText.length > 280 ? 'text-amber-500 font-bold' : ''}>
            {inputText.length}/300
          </span>
        </div>
      </form>
    </div>
  );

  return (
    <>
      {/* ── Desktop Docked Chat (Screens >= 1024px) ── */}
      <div className="hidden lg:flex w-72 xl:w-80 h-[520px] max-h-[72vh] flex-col arcade-card border-3 border-[var(--arcade-ink)] shadow-[4px_4px_0_var(--arcade-ink)] overflow-hidden flex-shrink-0">
        {chatContent}
      </div>

      {/* ── Mobile Floating Trigger Button (Screens < 1024px) ── */}
      <div className="lg:hidden fixed bottom-[calc(76px+env(safe-area-inset-bottom,0px))] right-3.5 sm:right-4 z-40">
        <button
          type="button"
          onClick={handleOpenMobileChat}
          className="arcade-btn arcade-btn-pill arcade-btn-pink py-2 px-3.5 text-xs shadow-[3px_3px_0_var(--arcade-ink)] flex items-center gap-1.5 cursor-pointer relative"
          aria-label={`Open game chat${unreadChatCount > 0 ? `, ${unreadChatCount} unread` : ''}`}
        >
          <span className="text-sm">💬</span>
          <span className="font-black">Game Chat</span>
          {unreadChatCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-[#ffc233] text-[#2b2140] border-2 border-[var(--arcade-ink)] rounded-full text-[10px] font-black w-5 h-5 flex items-center justify-center animate-bounce shadow-xs">
              {unreadChatCount > 9 ? '9+' : unreadChatCount}
            </span>
          )}
        </button>
      </div>

      {/* ── Mobile Bottom Sheet / Modal Drawer (Screens < 1024px) ── */}
      {isChatOpenMobile && (
        <div
          onClick={handleCloseMobileChat}
          className="lg:hidden fixed inset-0 z-[45] flex items-end justify-center bg-black/60 backdrop-blur-xs p-2 sm:p-4 pb-[calc(76px+env(safe-area-inset-bottom,0px))] sm:pb-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md h-[460px] max-h-[75vh] arcade-card border-3 border-[var(--arcade-ink)] shadow-[5px_5px_0_var(--arcade-ink)] overflow-hidden flex flex-col animate-in slide-in-from-bottom-4 duration-200"
            role="dialog"
            aria-modal="true"
            aria-label="In-game chat window"
          >
            {chatContent}
          </div>
        </div>
      )}
    </>
  );
};
