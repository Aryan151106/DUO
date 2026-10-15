import React, { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { duoDataStore } from '../../lib/dataStore';
import type { ChatMessage } from '../../lib/dataStore';
import { useAuthStore, usePresenceStore, useCallStore } from '../../lib/store';
import { updateCoupleNickname } from '../../lib/firestore';
import { broadcastEvent } from '../../lib/supabase';
import { soundManager, soundEffects } from '../../lib/sound';
import { formatTimeOnly } from '../../lib/format';
import { usePaginatedMessages, sendMessage, updateMessage, markMessagesRead, updateTypingStatus } from '../../lib/firestore';
import {
  groupMessagesByDay,
  mergeAndDeduplicateMessages,
  reconcileOptimisticMessages,
  calculateScrollCompensation,
  normalizeMessageTimestamp,
  type DayGroup,
} from '../../lib/chatHistory';
import {
  Phone,
  Video,
  Smile,
  Check,
  CheckCheck,
  Clock,
  Sparkles,
  PhoneCall,
  MoreVertical,
  CornerUpLeft,
  Copy,
  Trash2,
  X,
  UploadCloud,
  ChevronDown,
  Plus,
  Download,
  Share2,
  Loader2,
  Heart,
} from 'lucide-react';
import { AttachmentPreview } from './AttachmentPreview';
import { VoiceMessage } from './VoiceMessage';
import { ChatInputComposer } from './ChatInputComposer';
import { voiceRecorder, uploadVoiceNote } from '../../lib/voice';
import { saveMediaToDevice, generateCleanMediaFileName } from '../../lib/saveMedia';
import { deleteAttachmentFile, type FileAttachment } from '../../lib/attachments';
import {
  toggleMessageReaction,
  subscribeSpaceReactions,
  QUICK_REACTIONS,
  ALL_EMOJIS,
  type ReactionsMap,
} from '../../lib/reactions';
import { soundEngine } from '../../lib/sounds';
import { useNotificationStore } from '../../lib/notifications';

const EMOJI_LABELS: Record<string, string> = {
  '❤️': 'React with heart',
  '🥰': 'React with smiling face with hearts',
  '🔥': 'React with fire',
  '😂': 'React with laughing',
  '👀': 'React with eyes',
  '🙏': 'React with praying hands',
};

export const ChatView: React.FC = () => {
  const { currentUser, partnerUser, couple, setPartnerUser, isDemoMode: isDemo } = useAuthStore();
  const { isPartnerOnline, partnerTyping, partnerRecording, partnerLastSeen } = usePresenceStore();
  const { startCall } = useCallStore();
  const queryClient = useQueryClient();

  const [selectedReactionMsgId, setSelectedReactionMsgId] = useState<string | null>(null);
  const [showFullEmojiPicker, setShowFullEmojiPicker] = useState<boolean>(false);
  const [spaceReactions, setSpaceReactions] = useState<ReactionsMap>({});
  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);

  // Message Action Context Menu state
  const [contextMenuMsgId, setContextMenuMsgId] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [showChatSettings, setShowChatSettings] = useState(false);
  const [nickname, setNickname] = useState(() =>
    partnerUser.nickname ||
    (typeof window !== 'undefined' ? localStorage.getItem('duo_nickname_partner') || '' : '')
  );
  const [nicknameDraft, setNicknameDraft] = useState(nickname);
  const [showActiveStatus, setShowActiveStatus] = useState(() =>
    typeof window === 'undefined' ? true : localStorage.getItem('duo_show_active_status') !== 'false'
  );
  const [readReceiptsEnabled, setReadReceiptsEnabled] = useState(() =>
    typeof window === 'undefined' ? true : localStorage.getItem('duo_read_receipts') !== 'false'
  );
  const [chatWallpaper, setChatWallpaper] = useState(() =>
    typeof window === 'undefined' ? 'var(--bg)' : localStorage.getItem('duo_chat_wallpaper') || 'var(--bg)'
  );
  const [swipeState, setSwipeState] = useState<{ id: string; x: number; armed: boolean } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const sharedNickname = couple?.nicknames?.[partnerUser.id];
    if (sharedNickname !== undefined) {
      setNickname(sharedNickname);
      setNicknameDraft(sharedNickname);
    }
  }, [couple?.nicknames, partnerUser.id]);

  // Drag and Drop state
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const recordingTimerRef = useRef<number | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const lastTapTimeRef = useRef<{ id: string; time: number } | null>(null);
  const swipePointerRef = useRef<{ id: string; x: number; y: number; pointerId: number } | null>(null);

  // Real-time reactions listener
  useEffect(() => {
    if (!couple?.id || isDemo) return;
    const unsub = subscribeSpaceReactions(couple.id, (grouped) => {
      setSpaceReactions(grouped);
    });
    return () => unsub();
  }, [couple?.id, isDemo]);

  // Outside click & Escape to dismiss reaction picker
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.reaction-bar-container') && !target.closest('.reaction-trigger-btn')) {
        setSelectedReactionMsgId(null);
        setShowFullEmojiPicker(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedReactionMsgId(null);
        setShowFullEmojiPicker(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const {
    messages: paginatedFirestoreMessages,
    isLoadingEarlier,
    hasMoreEarlier,
    loadEarlier,
    isAllCaughtUp,
  } = usePaginatedMessages(isDemo ? null : couple?.id || null, currentUser.timezone);

  const { data: demoMessages = [] } = useQuery({
    queryKey: ['messages', couple?.id || 'couple-duo-main'],
    queryFn: () => duoDataStore.getMessages(),
    enabled: isDemo,
    staleTime: 5000,
    refetchInterval: 5000,
  });

  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>([]);
  const [hasNewIncoming, setHasNewIncoming] = useState(false);
  const lastIncomingMsgIdRef = useRef<string | null>(null);

  // Clear optimistic messages once they appear in the firestore stream
  useEffect(() => {
    if (optimisticMessages.length === 0) return;
    setOptimisticMessages((prev) =>
      reconcileOptimisticMessages(prev, paginatedFirestoreMessages)
    );
  }, [paginatedFirestoreMessages, optimisticMessages.length]);

  const messages: ChatMessage[] = useMemo(() => {
    const rawList = isDemo ? demoMessages : paginatedFirestoreMessages;
    const baseList: (ChatMessage & { clientId?: string; createdAt?: any; clientTimestamp?: number })[] = rawList.map((m: any) => ({
      id: m.id,
      clientId: m.clientId || (m as any).client_id,
      couple_id: couple?.id || '',
      sender_id: m.senderId || m.sender_id,
      senderId: m.senderId || m.sender_id,
      content: m.content,
      message_type: m.messageType || m.message_type || 'text',
      messageType: m.messageType || m.message_type || 'text',
      attachments: m.attachments,
      created_at: new Date(normalizeMessageTimestamp(m)).toISOString(),
      createdAt: m.createdAt,
      clientTimestamp: m.clientTimestamp,
      media_url: m.mediaUrl || m.media_url,
      mediaUrl: m.mediaUrl || m.media_url,
      metadata: m.metadata,
      reactions: m.reactions,
      reply_to: m.replyTo
        ? {
            messageId: m.replyTo.messageId || m.replyTo.id,
            senderId: m.replyTo.senderId || '',
            sender_name: m.replyTo.senderName || 'Unknown',
            type: m.replyTo.type || m.replyTo.messageType || 'text',
            content: m.replyTo.snippet || m.replyTo.content || 'Original message unavailable',
            snippet: m.replyTo.snippet || m.replyTo.content || 'Original message unavailable',
            thumbnailUrl: m.replyTo.thumbnailUrl || m.replyTo.mediaUrl,
          }
        : m.reply_to
        ? {
            messageId: m.reply_to.messageId || m.reply_to.id,
            senderId: m.reply_to.senderId || '',
            sender_name: m.reply_to.sender_name || m.reply_to.senderName || 'Unknown',
            type: m.reply_to.type || m.reply_to.message_type || 'text',
            content: m.reply_to.snippet || m.reply_to.content || 'Original message unavailable',
            snippet: m.reply_to.snippet || m.reply_to.content || 'Original message unavailable',
            thumbnailUrl: m.reply_to.thumbnailUrl || m.reply_to.media_url,
          }
        : undefined,
      replyToMessageId: m.replyToMessageId,
      deleted_for_everyone: m.deletedForEveryone || m.deleted_for_everyone,
      deleted_for_me: m.deletedForMe || m.deleted_for_me,
      status: m.status || 'sent',
    }));

    // Filter out messages deleted for the current user
    const filtered = baseList.filter((m) => !m.deleted_for_me?.includes(currentUser.id));

    if (optimisticMessages.length === 0) {
      return [...filtered].sort((a: any, b: any) => {
        const tA = normalizeMessageTimestamp(a);
        const tB = normalizeMessageTimestamp(b);
        if (tA !== tB) return tA - tB;
        return (a.id || '').localeCompare(b.id || '');
      });
    }

    return mergeAndDeduplicateMessages(filtered, optimisticMessages);
  }, [isDemo, demoMessages, paginatedFirestoreMessages, couple?.id, currentUser.id, optimisticMessages]);

  const dayGroups: DayGroup[] = useMemo(() => {
    return groupMessagesByDay(messages, currentUser.timezone);
  }, [messages, currentUser.timezone]);

  // Scroll compensation anchoring (zero visual jump on top-scroll)
  const prevScrollHeightRef = useRef<number>(0);
  const prevScrollTopRef = useRef<number>(0);
  const isCompensatingRef = useRef<boolean>(false);

  const handleLoadEarlier = useCallback(async () => {
    const container = messagesContainerRef.current;
    if (!container || isLoadingEarlier || !hasMoreEarlier) return;

    prevScrollHeightRef.current = container.scrollHeight;
    prevScrollTopRef.current = container.scrollTop;
    isCompensatingRef.current = true;

    await loadEarlier();
  }, [isLoadingEarlier, hasMoreEarlier, loadEarlier]);

  useLayoutEffect(() => {
    if (isCompensatingRef.current && messagesContainerRef.current) {
      const container = messagesContainerRef.current;
      const newScrollHeight = container.scrollHeight;
      const compensatedTop = calculateScrollCompensation(
        prevScrollHeightRef.current,
        newScrollHeight,
        prevScrollTopRef.current
      );
      container.scrollTop = compensatedTop;
      isCompensatingRef.current = false;
    }
  }, [messages]);

  // Track incoming partner messages when user is scrolled up
  useEffect(() => {
    if (messages.length === 0) return;
    const latest = messages[messages.length - 1];
    if (
      latest &&
      latest.sender_id !== currentUser.id &&
      latest.id !== lastIncomingMsgIdRef.current
    ) {
      lastIncomingMsgIdRef.current = latest.id;
      if (!shouldStickToBottomRef.current) {
        setHasNewIncoming(true);
      }
    }
  }, [messages, currentUser.id]);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Track the most recent unread partner message ID to prevent unnecessary loops
  const latestUnreadPartnerMsgId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.sender_id !== currentUser.id && m.status !== 'read') {
        return m.id;
      }
    }
    return null;
  }, [messages, currentUser.id]);

  // Automatically mark partner's messages as read when viewing chat
  const markingReadRef = useRef<Set<string>>(new Set());

  const markUnreadAsRead = useCallback(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return;
    }

    // Only mark unread notifications as read if unreadCount > 0
    if (couple?.id && useNotificationStore.getState().unreadCount > 0) {
      useNotificationStore.getState().markAllAsRead(couple.id);
    }
    if (typeof navigator !== 'undefined' && 'clearAppBadge' in navigator) {
      try {
        (navigator as any).clearAppBadge();
      } catch {}
    }

    const currentMessages = messagesRef.current;
    currentMessages.forEach((m) => {
      if (m.status === 'read') {
        markingReadRef.current.delete(m.id);
      }
    });

    const unreadPartnerMsgs = currentMessages.filter(
      (m) =>
        m.sender_id !== currentUser.id &&
        m.status !== 'read' &&
        !markingReadRef.current.has(m.id)
    );

    if (unreadPartnerMsgs.length === 0) return;

    const idsToMark = unreadPartnerMsgs.map((m) => m.id);
    idsToMark.forEach((id) => markingReadRef.current.add(id));

    if (!isDemo && couple?.id) {
      markMessagesRead(couple.id, idsToMark).catch(() => {
        idsToMark.forEach((id) => markingReadRef.current.delete(id));
      });
    } else {
      duoDataStore.markMessagesRead(idsToMark);
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    }
  }, [currentUser.id, isDemo, couple?.id, queryClient]);

  // Only trigger when new unread partner message arrives
  useEffect(() => {
    if (latestUnreadPartnerMsgId) {
      markUnreadAsRead();
    }
  }, [latestUnreadPartnerMsgId, markUnreadAsRead]);

  // Mark as read when switching back to this window/tab
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        markUnreadAsRead();
      }
    };
    const handleFocus = () => {
      markUnreadAsRead();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, [markUnreadAsRead]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior,
      });
    }
  }, []);

  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    setShowJumpToBottom(!isNearBottom);
    shouldStickToBottomRef.current = isNearBottom;

    if (isNearBottom) {
      setHasNewIncoming(false);
    }

    // Auto-load earlier messages smoothly when scrolling near top (< 60px)
    if (container.scrollTop < 60 && hasMoreEarlier && !isLoadingEarlier) {
      handleLoadEarlier();
    }
  };

  // Always scroll to bottom on initial message load
  const hasInitiallyScrolledRef = useRef(false);
  useEffect(() => {
    hasInitiallyScrolledRef.current = false;
  }, [couple?.id]);

  useEffect(() => {
    if (messages.length > 0 && !hasInitiallyScrolledRef.current) {
      hasInitiallyScrolledRef.current = true;
      scrollToBottom('auto');
      const t1 = setTimeout(() => scrollToBottom('auto'), 50);
      const t2 = setTimeout(() => scrollToBottom('auto'), 200);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [messages.length, scrollToBottom]);

  // Keep pinned to bottom when new messages arrive or partner types ONLY IF user was already near bottom
  useEffect(() => {
    if (shouldStickToBottomRef.current) {
      scrollToBottom('smooth');
    }
  }, [messages.length, partnerTyping, scrollToBottom]);

  // Mobile virtual keyboard viewport resize handler
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const handleViewportResize = () => {
      if (shouldStickToBottomRef.current) {
        scrollToBottom('auto');
      }
    };
    window.visualViewport.addEventListener('resize', handleViewportResize);
    return () => window.visualViewport?.removeEventListener('resize', handleViewportResize);
  }, [scrollToBottom]);

  const handleBroadcastTyping = useCallback((isTyping: boolean) => {
    broadcastEvent('TYPING_STATUS', { isTyping, isRecording: false }, currentUser.id, couple?.id || '');
    if (!isDemo && couple?.id) {
      updateTypingStatus(couple.id, currentUser.id, isTyping, false);
    }
  }, [currentUser.id, couple?.id, isDemo]);

  useEffect(() => {
    const handleUnload = () => {
      broadcastEvent('TYPING_STATUS', { isTyping: false, isRecording: false }, currentUser.id, couple?.id || '');
      if (!isDemo && couple?.id) {
        updateTypingStatus(couple.id, currentUser.id, false, false);
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      handleUnload();
    };
  }, [currentUser.id, couple?.id, isDemo]);

  useEffect(() => {
    const staleCheck = window.setInterval(() => {
      const presence = usePresenceStore.getState();
      if (presence.isPartnerOnline && presence.partnerHeartbeatAt && Date.now() - presence.partnerHeartbeatAt > 60000) {
        presence.setPartnerPresence(false, presence.partnerHeartbeatAt);
      }
    }, 10000);
    return () => window.clearInterval(staleCheck);
  }, []);

  const handleSendMessage = async (textToSend: string) => {
    if (!textToSend.trim()) return;

    soundManager.playPing();
    const currentReply = replyTarget
      ? {
          messageId: replyTarget.id,
          senderId: replyTarget.sender_id,
          sender_name:
            replyTarget.sender_id === currentUser.id ? 'You' : partnerUser.displayName,
          type: replyTarget.message_type,
          content: replyTarget.content,
          snippet: replyTarget.content || 'Original message unavailable',
          thumbnailUrl: replyTarget.media_url,
        }
      : undefined;

    setReplyTarget(null);
    handleBroadcastTyping(false);

    const tempId = `msg-${Date.now()}`;
    const newMsg: ChatMessage = {
      id: tempId,
      couple_id: couple?.id || 'couple-duo-main',
      sender_id: currentUser.id,
      content: textToSend,
      message_type: 'text',
      reply_to: currentReply,
      status: 'sending',
      created_at: new Date().toISOString(),
    };

    if (!isDemo && couple?.id) {
      setOptimisticMessages((prev) => [...prev, newMsg]);
      shouldStickToBottomRef.current = true;
      setShowJumpToBottom(false);
      setTimeout(() => scrollToBottom('smooth'), 20);
      setTimeout(() => scrollToBottom('smooth'), 120);

      try {
        await sendMessage(couple.id, {
          clientId: tempId,
          senderId: currentUser.id,
          content: textToSend,
          messageType: 'text',
          ...(currentReply
            ? {
                replyTo: {
                  messageId: currentReply.messageId,
                  senderId: currentReply.senderId,
                  senderName: currentReply.sender_name,
                  type: replyTarget?.message_type || 'text',
                  snippet: currentReply.content || 'Original message unavailable',
                  thumbnailUrl: replyTarget?.media_url,
                },
              }
            : {}),
          status: 'sent',
        });

        setOptimisticMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, status: 'sent' as const } : m))
        );
        setTimeout(() => scrollToBottom('smooth'), 40);

        // Trigger real-time pop-up notification for partner
        useNotificationStore.getState().sendNotification({
          coupleId: couple.id,
          senderId: currentUser.id,
          senderName: currentUser.displayName,
          type: 'message',
          title: currentUser.displayName,
          body: textToSend,
          deepLink: '/?action=chat',
        });
      } catch (err) {
        setOptimisticMessages((prev) => prev.filter((m) => m.id !== tempId));
        console.error('Firestore message send failed:', err);
        if (inputRef.current) inputRef.current.value = textToSend;
        window.alert('Message could not be sent. Please check your connection and try again.');
        return;
      }
    } else {
      const currentMessages = duoDataStore.getMessages();
      const updated = [...currentMessages, { ...newMsg, status: 'sent' as const }];
      duoDataStore.saveMessages(updated);
      broadcastEvent('MESSAGE_SENT', newMsg, currentUser.id, couple?.id || '');
    }

    queryClient.invalidateQueries({ queryKey: ['messages'] });
    setTimeout(() => scrollToBottom('smooth'), 50);
  };

  const handleSendAttachments = async (attachments: FileAttachment[], caption?: string) => {
    soundManager.playPing();
    const tempId = `msg-media-${Date.now()}`;
    const currentReply = replyTarget
      ? {
          messageId: replyTarget.id,
          senderId: replyTarget.sender_id,
          sender_name:
            replyTarget.sender_id === currentUser.id ? 'You' : partnerUser.displayName,
          type: replyTarget.message_type,
          content: replyTarget.content,
          snippet: replyTarget.content || 'Original message unavailable',
          thumbnailUrl: replyTarget.media_url,
        }
      : undefined;

    const newMsg: ChatMessage = {
      id: tempId,
      couple_id: couple?.id || 'couple-duo-main',
      sender_id: currentUser.id,
      content: caption || '',
      message_type: 'media',
      attachments,
      reply_to: currentReply,
      status: 'sent',
      created_at: new Date().toISOString(),
    };

    if (!isDemo && couple?.id) {
      setOptimisticMessages((prev) => [...prev, newMsg]);
      setTimeout(() => scrollToBottom('smooth'), 10);
      try {
        await sendMessage(couple.id, {
          clientId: tempId,
          senderId: currentUser.id,
          content: caption || '',
          messageType: 'media',
          attachments,
          ...(currentReply
            ? {
                replyTo: {
                  messageId: currentReply.messageId,
                  senderId: currentReply.senderId,
                  senderName: currentReply.sender_name,
                  type: replyTarget?.message_type || 'text',
                  snippet: currentReply.content || 'Original message unavailable',
                  thumbnailUrl: replyTarget?.media_url,
                },
              }
            : {}),
          status: 'sent',
        });

        // Trigger real-time pop-up notification for partner
        useNotificationStore.getState().sendNotification({
          coupleId: couple.id,
          senderId: currentUser.id,
          senderName: currentUser.displayName,
          type: 'attachment',
          title: currentUser.displayName,
          body: caption || `Shared ${attachments.length} attachment(s)`,
          deepLink: '/?action=chat',
        });
      } catch (err) {
        setOptimisticMessages((prev) => prev.filter((m) => m.id !== tempId));
        console.error('Firestore attachment message send failed:', err);
        window.alert('The file uploaded but could not be sent to chat. Please try again.');
        return;
      }
    } else {
      const currentMessages = duoDataStore.getMessages();
      const updated = [...currentMessages, newMsg];
      duoDataStore.saveMessages(updated);
      broadcastEvent('MESSAGE_SENT', newMsg, currentUser.id, couple?.id || '');
    }

    setReplyTarget(null);
    queryClient.invalidateQueries({ queryKey: ['messages'] });
    setTimeout(() => scrollToBottom('smooth'), 50);
  };

  // Drag & drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDragLeave = () => {
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
  };

  // Voice recording & Uploading
  const [micLevel, setMicLevel] = useState<number>(0.1);
  const [isVoiceUploading, setIsVoiceUploading] = useState<boolean>(false);

  const handleStartRecording = async () => {
    soundEffects.playPop();
    try {
      await voiceRecorder.startRecording((level) => {
        setMicLevel(level);
      });
      setIsRecording(true);
      setRecordDuration(0);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordDuration((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.warn('Microphone access denied:', err);
      alert('Could not access microphone. Please check permissions in settings.');
    }
  };

  const handleStopRecording = async (send: boolean) => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);

    if (!send) {
      await voiceRecorder.cancelRecording();
      setRecordDuration(0);
      return;
    }

    try {
      setIsVoiceUploading(true);
      const recordResult = await voiceRecorder.stopRecording();
      const messageId = `msg-voice-${Date.now()}`;
      const spaceId = couple?.id || 'couple-duo-main';

      // Upload audio blob to storage
      const { downloadUrl, storagePath } = await uploadVoiceNote({
        spaceId,
        messageId,
        blob: recordResult.blob,
        mimeType: recordResult.mimeType,
      });

      const newVoiceMsg: ChatMessage = {
        id: messageId,
        couple_id: spaceId,
        sender_id: currentUser.id,
        content: downloadUrl,
        message_type: 'voice',
        metadata: {
          audioUrl: downloadUrl,
          storagePath,
          mimeType: recordResult.mimeType,
          durationMs: recordResult.durationMs,
          durationSec: Math.round(recordResult.durationMs / 1000),
          waveform: recordResult.waveform,
        },
        status: 'sent',
        created_at: new Date().toISOString(),
      };

      if (!isDemo && couple?.id) {
        setOptimisticMessages((prev) => [...prev, newVoiceMsg]);
        setTimeout(() => scrollToBottom('smooth'), 10);
        await sendMessage(couple.id, {
          clientId: messageId,
          senderId: currentUser.id,
          content: downloadUrl,
          messageType: 'voice',
          mediaUrl: downloadUrl,
          metadata: newVoiceMsg.metadata,
          status: 'sent',
        });

        // Trigger real-time pop-up notification for partner
        useNotificationStore.getState().sendNotification({
          coupleId: couple.id,
          senderId: currentUser.id,
          senderName: currentUser.displayName,
          type: 'voice',
          title: currentUser.displayName,
          body: `🎙️ Sent a voice note (${Math.round(recordResult.durationMs / 1000)}s)`,
          deepLink: '/?action=chat',
        });
      } else {
        const currentMessages = duoDataStore.getMessages();
        const updated = [...currentMessages, newVoiceMsg];
        duoDataStore.saveMessages(updated);
        broadcastEvent('MESSAGE_SENT', newVoiceMsg, currentUser.id, couple?.id || '');
      }

      soundManager.playPing();
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    } catch (err) {
      console.error('Failed to record or upload voice note:', err);
    } finally {
      setIsVoiceUploading(false);
      setRecordDuration(0);
    }
  };

  const handleSaveMessageMedia = async (msg: ChatMessage) => {
    soundEffects.playPop();
    const mediaUrl = msg.attachments?.[0]?.url || msg.metadata?.audioUrl || msg.doodle_url || (msg.content?.startsWith('http') ? msg.content : undefined);
    const mediaName = msg.attachments?.[0]?.fileName || (msg.message_type === 'voice' ? 'Voice_Note.webm' : undefined);
    const mime = msg.attachments?.[0]?.mimeType || msg.metadata?.mimeType;

    if (mediaUrl) {
      await saveMediaToDevice(mediaUrl, {
        fileName: generateCleanMediaFileName(mediaName, msg.message_type === 'voice' ? 'voice' : 'photo'),
        mimeType: mime,
      });
    }
  };

  const handleShareMessageMedia = async (msg: ChatMessage) => {
    soundEffects.playPop();
    const mediaUrl = msg.attachments?.[0]?.url || msg.metadata?.audioUrl || msg.doodle_url || msg.content;
    if (mediaUrl && navigator.share) {
      try {
        await navigator.share({
          title: 'Shared from Duo',
          url: mediaUrl,
        });
      } catch {}
    } else if (mediaUrl) {
      await navigator.clipboard.writeText(mediaUrl);
      alert('Link copied to clipboard!');
    }
  };

  const handleReact = async (msgId: string, emoji: string) => {
    const settings = soundEngine.getSettings();
    soundEngine.play(settings.reactionSoundId || 'msg-bubble', { force: true });

    if (!couple?.id || !currentUser?.id) return;

    // Optimistically update reactions map locally
    setSpaceReactions((prev) => {
      const msgR = { ...(prev[msgId] || {}) };
      const currentUsers = msgR[emoji] || [];
      const hasMe = currentUsers.includes(currentUser.id);
      if (hasMe) {
        msgR[emoji] = currentUsers.filter((u) => u !== currentUser.id);
        if (msgR[emoji].length === 0) delete msgR[emoji];
      } else {
        // Clean user from other emojis on this message
        for (const [em, uList] of Object.entries(msgR)) {
          if (uList.includes(currentUser.id)) {
            msgR[em] = uList.filter((u) => u !== currentUser.id);
            if (msgR[em].length === 0) delete msgR[em];
          }
        }
        msgR[emoji] = [...currentUsers, currentUser.id];
      }
      return { ...prev, [msgId]: msgR };
    });

    try {
      await toggleMessageReaction({
        spaceId: couple.id,
        messageId: msgId,
        userId: currentUser.id,
        userName: currentUser.displayName,
        emoji,
        currentReactions: spaceReactions[msgId] || {},
      });
    } catch (err) {
      console.warn('[ChatView] Reaction update error:', err);
    }

    setSelectedReactionMsgId(null);
    setShowFullEmojiPicker(false);
  };

  const handleBubbleClick = (msgId: string) => {
    const now = Date.now();
    if (
      lastTapTimeRef.current &&
      lastTapTimeRef.current.id === msgId &&
      now - lastTapTimeRef.current.time < 350
    ) {
      // Double tap detected -> instant heart reaction
      handleReact(msgId, '❤️');
      lastTapTimeRef.current = null;
    } else {
      lastTapTimeRef.current = { id: msgId, time: now };
    }
  };

  const handleBubbleTouchStart = (msgId: string, event?: React.TouchEvent) => {
    void event;
    longPressTimerRef.current = window.setTimeout(() => {
      setSelectedReactionMsgId(msgId);
      soundEngine.vibrate(50);
    }, 400);
  };

  const handleBubbleTouchMove = (event?: React.TouchEvent) => {
    void event;
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleBubbleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleSwipeStart = (msgId: string, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || window.getSelection()?.toString()) return;
    swipePointerRef.current = { id: msgId, x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleSwipeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = swipePointerRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = Math.abs(event.clientY - start.y);
    if (dy > Math.abs(dx) + 8) {
      swipePointerRef.current = null;
      setSwipeState(null);
      return;
    }
    const x = dx <= 0 ? 0 : Math.min(80, dx * 0.62);
    const armed = x >= 45;
    if (armed && !swipeState?.armed && navigator.vibrate) navigator.vibrate(10);
    setSwipeState({ id: start.id, x, armed });
  };

  const handleSwipeEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = swipePointerRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const shouldReply = swipeState?.id === start.id && swipeState.armed;
    const target = messages.find((message) => message.id === start.id);
    swipePointerRef.current = null;
    setSwipeState(null);
    if (shouldReply && target) {
      setReplyTarget(target);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const selectReply = (message: ChatMessage) => {
    setReplyTarget(message);
    setContextMenuMsgId(null);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const formatLastSeen = () => {
    if (!partnerLastSeen) return 'Active recently';
    const minutes = Math.max(1, Math.round((Date.now() - partnerLastSeen) / 60000));
    if (minutes < 60) return `Active ${minutes} min ago`;
    return `Active today at ${formatTimeOnly(new Date(partnerLastSeen).toISOString(), currentUser.timezone)}`;
  };

  const handleCopyText = (content: string) => {
    soundEffects.playPop();
    navigator.clipboard.writeText(content);
    setContextMenuMsgId(null);
  };

  const handleDeleteForMe = async (msgId: string) => {
    soundEffects.playPop();
    setContextMenuMsgId(null);

    if (isDemo) {
      const currentMessages = duoDataStore.getMessages();
      const updated = currentMessages.map((m) =>
        m.id === msgId
          ? { ...m, deleted_for_me: [...(m.deleted_for_me || []), currentUser.id] }
          : m
      );
      duoDataStore.saveMessages(updated);
    } else if (couple?.id) {
      const target = messages.find((m) => m.id === msgId);
      const updatedMe = [...(target?.deleted_for_me || []), currentUser.id];
      await updateMessage(couple.id, msgId, { deletedForMe: updatedMe });
    }
    queryClient.invalidateQueries({ queryKey: ['messages'] });
  };

  const handleDeleteForEveryone = async (msg: ChatMessage) => {
    soundEffects.playPop();
    setContextMenuMsgId(null);

    // Delete associated files from storage
    if (msg.attachments && msg.attachments.length > 0) {
      for (const att of msg.attachments) {
        if (att.path) {
          deleteAttachmentFile(att.path).catch(console.warn);
        }
      }
    }

    if (isDemo) {
      const currentMessages = duoDataStore.getMessages();
      const updated = currentMessages.map((m) =>
        m.id === msg.id
          ? {
              ...m,
              content: 'This message was deleted',
              attachments: [],
              deleted_for_everyone: true,
            }
          : m
      );
      duoDataStore.saveMessages(updated);
    } else if (couple?.id) {
      await updateMessage(couple.id, msg.id, {
        content: 'This message was deleted',
        attachments: [],
        deletedForEveryone: true,
      });
    }
    queryClient.invalidateQueries({ queryKey: ['messages'] });
  };

  return (
    <div
      ref={chatContainerRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative w-full h-full flex-1 min-h-0 flex flex-col overflow-hidden"
      style={{ background: chatWallpaper }}
    >
      {/* Drag & Drop Overlay */}
      {isDraggingOver && (
        <div className="absolute inset-0 z-50 bg-[var(--surface)]/90 backdrop-blur-xs border-3 border-dashed border-[var(--accent)] rounded-3xl flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-150">
          <UploadCloud className="w-16 h-16 text-[var(--accent)] mb-3 animate-bounce" />
          <h3 className="font-chunky text-xl font-bold text-[var(--text)]">
            Drop files here to share
          </h3>
          <p className="font-ui text-xs text-[var(--text-muted)] mt-1">
            Photos, videos, and documents will be attached instantly.
          </p>
        </div>
      )}

      {/* Top Chat Partner Bar: Fixed at top like WhatsApp/Instagram */}
      <div className="card p-2.5 sm:p-3.5 flex items-center justify-between mb-2 shrink-0 z-10 shadow-xs">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative shrink-0">
            <img
              src={partnerUser.avatarUrl}
              alt={partnerUser.displayName}
              className="w-11 h-11 rounded-2xl object-cover border-2 border-[var(--partner-b)] shadow-xs"
            />
            {isPartnerOnline && showActiveStatus && (
              <div className="presence-dot absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-[var(--success)] border-2 border-[var(--surface)]" />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-base font-chunky font-bold text-[var(--text)] flex items-center gap-1.5 leading-tight truncate">
              <span>{nickname || partnerUser.displayName}</span>
              <Sparkles className="w-4 h-4 text-[var(--accent)] shrink-0" />
            </div>
            <div className="font-ui text-xs font-medium text-[var(--text-muted)] truncate" aria-live="polite">
              {partnerTyping && showActiveStatus ? (
                <span className="text-[var(--partner-a)] font-semibold animate-pulse">
                  {nickname || partnerUser.displayName} is {partnerRecording ? 'recording audio…' : 'typing…'}
                </span>
              ) : isPartnerOnline && showActiveStatus ? (
                'Online together 🟢'
              ) : (
                showActiveStatus ? formatLastSeen() : 'Active status hidden'
              )}
            </div>
          </div>

          {showChatSettings && (
            <div className="absolute inset-0 z-40 bg-[var(--overlay)]/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-3">
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="chat-settings-title"
                className="w-full max-w-md rounded-3xl bg-[var(--surface)] border-2 border-[var(--border)] shadow-[0_6px_0_var(--shadow-color)] p-5 space-y-5"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h2 id="chat-settings-title" className="font-chunky text-xl font-bold text-[var(--text)]">Chat settings</h2>
                    <p className="font-ui text-xs text-[var(--text-muted)]">Make this little corner yours.</p>
                  </div>
                  <button type="button" onClick={() => setShowChatSettings(false)} aria-label="Close chat settings" className="p-2 rounded-xl hover:bg-[var(--surface-2)]">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div>
                  <label htmlFor="duo-nickname" className="font-ui text-xs font-bold text-[var(--text-muted)]">What do you call {partnerUser.displayName}?</label>
                  <input
                    id="duo-nickname"
                    value={nicknameDraft}
                    onChange={(event) => setNicknameDraft(event.target.value)}
                    maxLength={24}
                    placeholder="A cute nickname"
                    className="mt-1 w-full rounded-xl border-2 border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-[var(--text)] outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                  <div className="flex flex-wrap gap-2 mt-2">
                    {['Babu', 'Cutie', 'Sunshine', 'Pookie', 'Jaan'].map((suggestion) => (
                      <button type="button" key={suggestion} onClick={() => setNicknameDraft(suggestion)} className="px-2.5 py-1 rounded-full bg-[var(--surface-2)] border border-[var(--border)] text-xs font-ui hover:bg-[var(--accent)]/30">
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {['var(--bg)', 'linear-gradient(135deg, var(--partner-a), var(--partner-b))', 'var(--surface-2)', 'radial-gradient(circle at 20% 20%, var(--accent), transparent 35%), var(--bg)'].map((wallpaper) => (
                    <button
                      type="button"
                      key={wallpaper}
                      onClick={() => {
                        setChatWallpaper(wallpaper);
                        localStorage.setItem('duo_chat_wallpaper', wallpaper);
                      }}
                      className="h-12 rounded-xl border-2 border-[var(--border)]"
                      style={{ background: wallpaper }}
                      aria-label="Choose wallpaper"
                    />
                  ))}
                </div>
                <label className="flex items-center justify-between gap-3 font-ui text-sm text-[var(--text)]">
                  <span>Show my active status</span>
                  <input type="checkbox" checked={showActiveStatus} onChange={(event) => {
                    setShowActiveStatus(event.target.checked);
                    localStorage.setItem('duo_show_active_status', String(event.target.checked));
                  }} />
                </label>
                <label className="flex items-center justify-between gap-3 font-ui text-sm text-[var(--text)]">
                  <span>Read receipts</span>
                  <input type="checkbox" checked={readReceiptsEnabled} onChange={(event) => {
                    setReadReceiptsEnabled(event.target.checked);
                    localStorage.setItem('duo_read_receipts', String(event.target.checked));
                  }} />
                </label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => {
                    setNickname('');
                    setNicknameDraft('');
                    setPartnerUser({
                      displayName: partnerUser.realDisplayName || partnerUser.displayName,
                      nickname: '',
                    });
                    localStorage.removeItem('duo_nickname_partner');
                    if (couple?.id && partnerUser.id) {
                      void updateCoupleNickname(couple.id, partnerUser.id, '').catch((error) => {
                        console.error('[Chat] Failed to clear shared nickname:', error);
                      });
                    }
                  }} className="flex-1 rounded-xl border-2 border-[var(--border)] px-3 py-2 font-ui text-sm text-[var(--text)]">Clear nickname</button>
                  <button type="button" onClick={() => {
                    const next = nicknameDraft.trim();
                    setNickname(next);
                    setPartnerUser({
                      displayName: next || partnerUser.realDisplayName || partnerUser.displayName,
                      nickname: next,
                    });
                    if (couple?.id && partnerUser.id) {
                      void updateCoupleNickname(couple.id, partnerUser.id, next).catch((error) => {
                        console.error('[Chat] Failed to save shared nickname:', error);
                      });
                    }
                    if (next) localStorage.setItem('duo_nickname_partner', next);
                    else localStorage.removeItem('duo_nickname_partner');
                    setShowChatSettings(false);
                  }} className="flex-1 rounded-xl bg-[var(--partner-a)] px-3 py-2 font-chunky font-bold text-white">Save</button>
                </div>
              </section>
            </div>
          )}
        </div>

        {/* Quick Call Action Buttons (44px tap targets) */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setNicknameDraft(nickname);
              setShowChatSettings(true);
            }}
            title="Chat settings"
            aria-label="Open chat settings"
            className="w-11 h-11 min-w-[44px] rounded-2xl bg-[var(--surface-2)] hover:bg-[var(--accent)]/30 text-[var(--text)] border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] transition-all cursor-pointer flex items-center justify-center shrink-0"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
          <button
            onClick={() => startCall('audio', true)}
            title="Start Audio Call"
            className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-2xl bg-[var(--surface-2)] hover:bg-[var(--accent)]/30 text-[var(--text)] border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none transition-all cursor-pointer flex items-center justify-center shrink-0"
          >
            <Phone className="w-4 h-4" />
          </button>
          <button
            onClick={() => startCall('video', true)}
            title="Start Video Call"
            className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-2xl bg-[var(--partner-a)] text-white border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none transition-all cursor-pointer flex items-center justify-center shrink-0"
          >
            <Video className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages Scroll Area (A7: flex 1, min-height 0, themed thin scrollbar at edge) */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto chat-messages-scroll p-3 sm:p-4 space-y-1.5"
      >
        {/* Top Loading Spinner */}
        {isLoadingEarlier && (
          <div className="flex items-center justify-center py-4 text-[var(--text-muted)] animate-in fade-in">
            <Loader2 className="w-4 h-4 animate-spin text-[var(--partner-a)]" />
            <span className="font-ui text-xs ml-2 font-medium">Loading earlier day…</span>
          </div>
        )}

        {/* Manual Load Earlier Button fallback */}
        {hasMoreEarlier && !isLoadingEarlier && (
          <div className="flex justify-center pb-2 pt-1">
            <button
              type="button"
              onClick={handleLoadEarlier}
              className="px-3.5 py-1 text-xs font-ui rounded-full bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] border border-[var(--border)] transition-colors shadow-xs cursor-pointer active:scale-95"
            >
              Load earlier messages
            </button>
          </div>
        )}

        {/* All Caught Up Indicator */}
        {isAllCaughtUp && (
          <div className="flex flex-col items-center justify-center py-6 px-4 text-center animate-in fade-in">
            <div className="w-10 h-10 rounded-2xl bg-rose-500/10 text-rose-500 flex items-center justify-center mb-2 border border-rose-500/20 shadow-xs">
              <Heart className="w-5 h-5 fill-rose-500/30 text-rose-500" />
            </div>
            <p className="font-chunky text-sm font-bold text-[var(--text)]">You're all caught up!</p>
            <p className="font-ui text-xs text-[var(--text-muted)] mt-0.5">
              This is the start of your shared love notes.
            </p>
          </div>
        )}

        {dayGroups.map((group) => (
          <div key={group.dateKey} className="space-y-1.5">
            {/* Sticky Day Separator Badge */}
            <div className="flex items-center justify-center my-3 sticky top-1 z-10 pointer-events-none">
              <span className="px-3.5 py-1 rounded-full bg-[var(--surface-2)]/95 backdrop-blur-md text-[var(--text-muted)] text-[11px] font-ui font-bold border border-[var(--border)] shadow-xs pointer-events-auto">
                {group.label}
              </span>
            </div>

            {/* Messages for this Day */}
            {group.messages.map((msg, index) => {
              const isMe = msg.sender_id === currentUser.id;
              const isDeletedEveryone = msg.deleted_for_everyone;
              const prevMsg = index > 0 ? group.messages[index - 1] : null;
              const isConsecutive =
                prevMsg && prevMsg.sender_id === msg.sender_id;

              return (
                <React.Fragment key={msg.id}>

              <div
                id={`message-${msg.id}`}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} ${
                  isConsecutive ? 'mt-1' : 'mt-2.5'
                } group`}
              >
                <div
                  onPointerDown={(event) => handleSwipeStart(msg.id, event)}
                  onPointerMove={handleSwipeMove}
                  onPointerUp={handleSwipeEnd}
                  onPointerCancel={() => {
                    swipePointerRef.current = null;
                    setSwipeState(null);
                  }}
                  style={{
                    transform: swipeState && swipeState.id === msg.id ? `translateX(${swipeState.x}px)` : undefined,
                    touchAction: 'pan-y',
                  }}
                  onClick={() => handleBubbleClick(msg.id)}
                  onTouchStart={(e) => handleBubbleTouchStart(msg.id, e)}
                  onTouchMove={(e) => handleBubbleTouchMove(e)}
                  onTouchEnd={handleBubbleTouchEnd}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenuMsgId(contextMenuMsgId === msg.id ? null : msg.id);
                  }}
                  className={`relative max-w-[min(75%,520px)] rounded-2xl px-4 py-2.5 text-[15px] font-body transition-all border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] ${
                    isDeletedEveryone
                      ? 'bg-[var(--surface-2)] text-[var(--text-muted)] italic'
                      : isMe
                      ? 'bg-[var(--partner-a)] text-white rounded-tr-sm'
                      : 'bg-[var(--surface-2)] text-[var(--text)] rounded-tl-sm'
                  }`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleBubbleClick(msg.id);
                  }}
                >
                  {swipeState?.id === msg.id && (
                    <span
                      aria-hidden="true"
                      className={`absolute -left-11 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-[var(--accent)] text-[var(--text)] flex items-center justify-center transition-transform ${
                        swipeState?.armed ? 'scale-110' : 'scale-90 opacity-60'
                      }`}
                    >
                      <CornerUpLeft className="w-4 h-4" />
                    </span>
                  )}
                  {/* Quoted Reply Banner */}
                  {msg.reply_to && !isDeletedEveryone && (
                    <div
                      className={`mb-2 p-2 rounded-xl border-l-4 text-xs font-ui ${
                        isMe
                          ? 'bg-black/15 border-white text-white/90'
                          : 'bg-[var(--surface)] border-[var(--partner-a)] text-[var(--text)]'
                      }`}
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        const original = document.getElementById(`message-${msg.reply_to?.messageId}`);
                        original?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        original?.classList.add('chat-reply-highlight');
                        window.setTimeout(() => original?.classList.remove('chat-reply-highlight'), 1200);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          const original = document.getElementById(`message-${msg.reply_to?.messageId}`);
                          original?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                      }}
                    >
                      <span className="font-bold block text-[11px] mb-0.5">
                        {msg.reply_to.senderId === currentUser.id ? 'You' : partnerUser.displayName}
                      </span>
                      <span className="line-clamp-1 truncate">                      {msg.reply_to.snippet || msg.reply_to.content || 'Original message unavailable'}</span>
                    </div>
                  )}

                  {/* Message Body Content */}
                  {isDeletedEveryone ? (
                    <p className="text-xs italic">🚫 This message was deleted</p>
                  ) : msg.message_type === 'voice' ? (
                    <VoiceMessage
                      id={msg.id}
                      audioUrl={
                        msg.metadata?.audioUrl ||
                        msg.media_url ||
                        (typeof msg.content === 'string' && (msg.content.startsWith('http') || msg.content.startsWith('data:audio') || msg.content.startsWith('blob:'))
                          ? msg.content
                          : undefined)
                      }
                      durationMs={msg.metadata?.durationMs || (msg.metadata?.durationSec ? msg.metadata.durationSec * 1000 : 5000)}
                      waveform={msg.metadata?.waveform}
                      isMe={isMe}
                    />
                  ) : msg.message_type === 'call_card' ? (
                    /* A7: Call-summary bubble (compact card, icon, 2 lines of text, timestamp right) */
                    <div className="flex items-center justify-between gap-3 p-1 min-w-[220px] max-w-[280px]">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-[var(--surface)] border-2 border-[var(--border)] text-[var(--text)] flex items-center justify-center shrink-0 shadow-xs">
                          <PhoneCall className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 text-left">
                          <div className="font-ui font-bold text-xs truncate">
                            {msg.content || 'Voice Call'}
                          </div>
                          <div className="font-ui text-[11px] opacity-80 truncate">
                            Call lasted {msg.metadata?.callDuration || '18 mins'}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : msg.message_type === 'doodle' ? (
                    <div>
                      <div className="font-hand text-base font-bold mb-1">Shared a live doodle:</div>
                      {msg.media_url && (
                        <img
                          src={msg.media_url}
                          alt="Doodle"
                          className="rounded-2xl max-h-48 bg-[var(--surface)] border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)]"
                        />
                      )}
                    </div>
                  ) : msg.message_type === 'media' && msg.attachments && msg.attachments.length > 0 ? (
                    <div>
                      <AttachmentPreview attachments={msg.attachments} />
                      {msg.content && (
                        <p className="mt-2 whitespace-pre-wrap break-words">{msg.content}</p>
                      )}
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
                  )}

                  {/* Inline Bottom-Right Timestamp & Status Tick */}
                  {!isDeletedEveryone && (
                    <div className="flex items-center justify-end gap-1.5 mt-1 text-[11px] font-ui select-none">
                      <span className={isMe ? 'text-white/80' : 'text-[var(--text-muted)]'}>
                        {formatTimeOnly(msg.created_at, currentUser.timezone, { showSeconds: false })}
                      </span>
                      {isMe && (
                        <span
                          className="inline-flex items-center ml-0.5"
                          title={
                            msg.status === 'sending'
                              ? 'Sending...'
                              : msg.status === 'sent'
                              ? 'Sent to server'
                              : msg.status === 'delivered'
                              ? 'Delivered to partner'
                              : 'Seen by partner'
                          }
                          aria-label={
                            msg.status === 'sending'
                              ? 'Sending'
                              : msg.status === 'sent'
                              ? 'Sent'
                              : msg.status === 'delivered'
                              ? 'Delivered'
                              : 'Seen'
                          }
                        >
                          {msg.status === 'sending' ? (
                            <Clock className="w-3.5 h-3.5 text-white/60 animate-spin" />
                          ) : msg.status === 'sent' ? (
                            <Check className="w-3.5 h-3.5 text-white/75" />
                          ) : msg.status === 'delivered' ? (
                            <CheckCheck className="w-3.5 h-3.5 text-white/80" />
                          ) : (
                            <CheckCheck className="w-3.5 h-3.5 text-[#38bdf8] stroke-[2.5] drop-shadow-sm" />
                          )}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Quick 3-Dots Action Button */}
                  <button
                    type="button"
                    onClick={() => selectReply(msg)}
                    aria-label="Reply to message"
                    title="Reply"
                    className="absolute top-2 -left-9 opacity-0 group-hover:opacity-100 p-1.5 rounded-full bg-[var(--surface)] border-2 border-[var(--border)] text-[var(--text)] cursor-pointer transition-opacity"
                  >
                    <CornerUpLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setContextMenuMsgId(contextMenuMsgId === msg.id ? null : msg.id)
                    }
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded-full bg-black/20 hover:bg-black/40 text-white cursor-pointer transition-opacity"
                  >
                    <MoreVertical className="w-3.5 h-3.5" />
                  </button>

                  {/* Quick Emoji Reaction Trigger Button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedReactionMsgId(
                        selectedReactionMsgId === msg.id ? null : msg.id
                      );
                      setShowFullEmojiPicker(false);
                    }}
                    className="reaction-trigger-btn absolute -bottom-3 right-2 opacity-0 group-hover:opacity-100 p-1.5 rounded-full bg-[var(--surface)] border-2 border-[var(--border)] text-xs text-[var(--text)] shadow-[0_2px_0_var(--shadow-color)] hover:scale-110 transition-all cursor-pointer min-w-[32px] min-h-[32px] flex items-center justify-center z-10"
                    aria-label="React to message"
                    title="Add reaction"
                  >
                    <Smile className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Context Menu Dropdown */}
                {contextMenuMsgId === msg.id && (
                  <div className="z-30 mt-1 p-1.5 bg-[var(--surface)] text-[var(--text)] border-2 border-[var(--border)] rounded-2xl shadow-[0_4px_0_var(--shadow-color)] flex flex-col gap-1 text-xs font-ui min-w-[150px] animate-in fade-in">
                    <button
                      type="button"
                      onClick={() => {
                        setReplyTarget(msg);
                        setContextMenuMsgId(null);
                      }}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-[var(--surface-2)] cursor-pointer text-left"
                    >
                      <CornerUpLeft className="w-3.5 h-3.5" />
                      <span>Reply</span>
                    </button>

                    {msg.content && (
                      <button
                        type="button"
                        onClick={() => handleCopyText(msg.content)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-[var(--surface-2)] cursor-pointer text-left"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </button>
                    )}

                    {(msg.attachments?.length || msg.message_type === 'voice' || msg.metadata?.audioUrl || msg.doodle_url) && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            handleSaveMessageMedia(msg);
                            setContextMenuMsgId(null);
                          }}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-[var(--surface-2)] cursor-pointer text-left text-[var(--accent)] font-bold"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Save to device</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handleShareMessageMedia(msg);
                            setContextMenuMsgId(null);
                          }}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-[var(--surface-2)] cursor-pointer text-left"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                          <span>Share...</span>
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => handleDeleteForMe(msg.id)}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-[var(--surface-2)] cursor-pointer text-left text-[var(--text-muted)]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete for me</span>
                    </button>

                    {isMe && !isDeletedEveryone && (
                      <button
                        type="button"
                        onClick={() => handleDeleteForEveryone(msg)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-[var(--urgent)]/20 text-[var(--urgent)] font-bold cursor-pointer text-left"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete for everyone</span>
                      </button>
                    )}
                  </div>
                )}

                {/* Quick Emoji Reaction Bar (44px min tap targets, stopPropagation) */}
                {selectedReactionMsgId === msg.id && (
                  <div
                    className="reaction-bar-container relative flex items-center gap-1 p-1.5 mt-2 rounded-full bg-[var(--surface)] border-2 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)] z-30 animate-in zoom-in-95"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {QUICK_REACTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReact(msg.id, emoji);
                        }}
                        className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center text-xl hover:scale-125 hover:bg-[var(--surface-2)] transition-all cursor-pointer"
                        aria-label={EMOJI_LABELS[emoji] || `React with ${emoji}`}
                        title={EMOJI_LABELS[emoji] || emoji}
                      >
                        {emoji}
                      </button>
                    ))}

                    {/* "+" button for full emoji picker */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowFullEmojiPicker(!showFullEmojiPicker);
                      }}
                      className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] border-l-2 border-[var(--border)] transition-all cursor-pointer"
                      aria-label="Show all emojis"
                      title="More emojis"
                    >
                      <Plus className="w-4 h-4" />
                    </button>

                    {/* Full Emoji Picker Popover */}
                    {showFullEmojiPicker && (
                      <div
                        className="absolute bottom-full left-0 mb-2 p-3 bg-[var(--surface)] border-3 border-[var(--border)] rounded-3xl shadow-[0_6px_0_var(--shadow-color)] grid grid-cols-6 gap-1 z-40 max-w-[280px] animate-in zoom-in-95"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {ALL_EMOJIS.map((em) => (
                          <button
                            key={em}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleReact(msg.id, em);
                            }}
                            className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center text-lg hover:scale-125 hover:bg-[var(--surface-2)] rounded-xl cursor-pointer"
                            aria-label={`React with ${em}`}
                          >
                            {em}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Reactions Chips under bubble */}
                {(() => {
                  const reactions = spaceReactions[msg.id] || msg.reactions || {};
                  const entries = Object.entries(reactions).filter(([_, u]) => u && u.length > 0);
                  if (entries.length === 0) return null;

                  return (
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5 -mb-1">
                      {entries.map(([emoji, userIds]) => {
                        const hasMyReaction = userIds.includes(currentUser.id);
                        const names = userIds
                          .map((uid) => (uid === currentUser.id ? 'You' : partnerUser.displayName))
                          .join(', ');

                        return (
                          <button
                            key={emoji}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleReact(msg.id, emoji);
                            }}
                            title={`Reacted by: ${names}`}
                            className={`min-h-[28px] px-2.5 py-0.5 rounded-full bg-[var(--surface)] border-2 text-xs flex items-center gap-1 transition-all cursor-pointer ${
                              hasMyReaction
                                ? 'border-[var(--accent)] ring-2 ring-[var(--accent)] shadow-xs'
                                : 'border-[var(--border)] shadow-xs hover:border-[var(--text)]'
                            }`}
                            aria-label={`${names} reacted with ${emoji}. Tap to toggle.`}
                          >
                            <span>{emoji}</span>
                            {userIds.length > 1 && (
                              <span className="text-[11px] font-numeric font-bold text-[var(--text)]">
                                {userIds.length}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </React.Fragment>
          );
        })}
          </div>
        ))}

        {partnerTyping && showActiveStatus && (
          <div className="typing-bubble flex items-center gap-2 p-2 rounded-2xl bg-[var(--surface-2)] text-[var(--text-muted)] font-ui text-xs max-w-fit">
            <div className="w-6 h-6 rounded-full bg-[var(--partner-a)]/20 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-[var(--partner-a)] animate-spin" />
            </div>
            <span className="sr-only">{nickname || partnerUser.displayName} is typing</span>
            <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>
          </div>
        )}
      </div>

      {/* Floating Jump To New Messages Button (A7) */}
      {showJumpToBottom && (
        <button
          type="button"
          onClick={() => {
            scrollToBottom('smooth');
            setShowJumpToBottom(false);
            setHasNewIncoming(false);
          }}
          className={`absolute bottom-24 right-4 px-3.5 py-1.5 rounded-full border-2 text-xs flex items-center gap-1.5 cursor-pointer z-30 transition-all shadow-md active:scale-95 ${
            hasNewIncoming
              ? 'bg-[var(--partner-a)] text-white border-[var(--border)] font-bold shadow-lg animate-bounce'
              : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text)] font-ui font-semibold shadow-[0_3px_0_var(--shadow-color)]'
          }`}
          aria-label="Scroll to bottom"
        >
          <ChevronDown className="w-3.5 h-3.5" />
          <span>{hasNewIncoming ? '↓ New messages' : 'Jump to bottom'}</span>
        </button>
      )}

      {/* Isolated High-Performance Chat Input Composer */}
      <ChatInputComposer
        partnerName={nickname || partnerUser.displayName}
        spaceId={couple?.id || 'couple-duo-main'}
        currentUserId={currentUser.id}
        replyTarget={replyTarget}
        onClearReply={() => setReplyTarget(null)}
        onSendMessage={handleSendMessage}
        onSendAttachments={handleSendAttachments}
        onBroadcastTyping={handleBroadcastTyping}
        isVoiceUploading={isVoiceUploading}
        isRecording={isRecording}
        recordDuration={recordDuration}
        micLevel={micLevel}
        onStartRecording={handleStartRecording}
        onStopRecording={handleStopRecording}
        externalInputRef={inputRef}
      />
    </div>
  );
};
