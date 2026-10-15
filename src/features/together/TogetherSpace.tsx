import React, { useState, Suspense, lazy } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { duoDataStore } from '../../lib/dataStore';
import type { WishlistItem } from '../../lib/dataStore';
import { useAuthStore } from '../../lib/store';
import { soundManager, soundEffects } from '../../lib/sound';
import {
  useWishlist,
  useScores,
  useMessages,
  useTasks,
  addWishlistItem,
  updateWishlistItem,
} from '../../lib/firestore';
import confetti from 'canvas-confetti';
import {
  Star,
  Clock,
  Sparkles,
  Trophy,
  Plus,
  Check,
  Paperclip,
  Image as ImageIcon,
  Video as VideoIcon,
  FileText,
  Film,
  BookOpen,
} from 'lucide-react';
import { AttachmentPreview } from '../chat/AttachmentPreview';
import { format } from 'date-fns';
import type { FileAttachment } from '../../lib/attachments';
import { PersonalDiary } from './PersonalDiary';
import { ActiveSessionBanner } from './ActiveSessionBanner';
import { useActiveSession } from '../../lib/activitySessions';
import { useAnyActiveTogetherRoom } from '../../lib/togetherRooms';

const StudySpaceView = lazy(() =>
  import('./StudySpaceView').then((m) => ({ default: m.StudySpaceView }))
);
const MovieNightView = lazy(() =>
  import('./MovieNightView').then((m) => ({ default: m.MovieNightView }))
);

export const TogetherSpace: React.FC = () => {
  const { currentUser, partnerUser, couple, isDemoMode, togetherSubTab, setTogetherSubTab } = useAuthStore();
  const liveCoupleId = !isDemoMode && couple?.id && !couple.id.startsWith('demo') ? couple.id : null;
  const activeSession = useActiveSession(couple?.id || null);
  const activeTogetherRoom = useAnyActiveTogetherRoom(liveCoupleId);
  const effectiveSession = activeTogetherRoom || activeSession;
  const queryClient = useQueryClient();

  const [mediaFilter, setMediaFilter] = useState<'all' | 'image' | 'video' | 'document'>('all');

  // Wishlist State
  const [newWishTitle, setNewWishTitle] = useState('');
  const [newWishCategory, setNewWishCategory] = useState<'date' | 'travel' | 'food' | 'movie'>('date');
  const [isAddWishOpen, setIsAddWishOpen] = useState(false);

  // Firestore live hooks (bypassed in demo mode)
  const firestoreWishlist = useWishlist(liveCoupleId);
  const firestoreScores = useScores(liveCoupleId);

  // Demo Queries
  const { data: demoWishlist = [] } = useQuery({
    queryKey: ['wishlist'],
    queryFn: () => duoDataStore.getWishlist(),
    enabled: isDemoMode,
  });

  const { data: demoScores = [] } = useQuery({
    queryKey: ['scores'],
    queryFn: () => duoDataStore.getScores(),
    enabled: isDemoMode,
  });

  const wishlist: WishlistItem[] = isDemoMode
    ? demoWishlist
    : firestoreWishlist.map((w) => ({
        id: w.id,
        title: w.title,
        category: w.category,
        notes: w.notes,
        completed: w.completed,
        hearts: w.hearts || [],
        created_by: w.createdBy || '',
      }));

  const scores = isDemoMode
    ? demoScores
    : firestoreScores.map((s) => ({
        id: s.id,
        couple_id: couple?.id || '',
        user_id: s.userId,
        kind: s.kind,
        points: s.points,
        day: s.day,
        created_at: new Date().toISOString(),
      }));

  const handleCreateWish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWishTitle.trim()) return;

    soundEffects.playPop();
    const wishData = {
      title: newWishTitle.trim(),
      category: newWishCategory,
      completed: false,
      hearts: [currentUser.id],
      notes: '',
      created_by: currentUser.id,
    };

    if (isDemoMode) {
      const items = duoDataStore.getWishlist();
      const newItem: WishlistItem = {
        id: `wish-${Date.now()}`,
        ...wishData,
      };
      duoDataStore.saveWishlist([...items, newItem]);
      queryClient.invalidateQueries({ queryKey: ['wishlist'] });
    } else if (couple?.id) {
      await addWishlistItem(couple.id, {
        title: wishData.title,
        category: wishData.category,
        completed: wishData.completed,
        hearts: wishData.hearts,
        notes: wishData.notes,
        createdBy: currentUser.id,
      });
    }

    setNewWishTitle('');
    setIsAddWishOpen(false);
  };

  const handleToggleWishComplete = async (item: WishlistItem) => {
    soundEffects.playSuccess();
    const nextCompleted = !item.completed;

    if (nextCompleted) {
      confetti({ particleCount: 40, spread: 50, origin: { y: 0.7 } });
    }

    if (isDemoMode) {
      const items = duoDataStore.getWishlist();
      const updated = items.map((w) => (w.id === item.id ? { ...w, completed: nextCompleted } : w));
      duoDataStore.saveWishlist(updated);
      queryClient.invalidateQueries({ queryKey: ['wishlist'] });
    } else if (couple?.id) {
      await updateWishlistItem(couple.id, item.id, { completed: nextCompleted });
    }
  };

  const handleToggleWishHeart = async (item: WishlistItem) => {
    soundManager.playPop();
    const hasHearted = item.hearts.includes(currentUser.id);
    const nextHearts = hasHearted
      ? item.hearts.filter((uid) => uid !== currentUser.id)
      : [...item.hearts, currentUser.id];

    if (isDemoMode) {
      const items = duoDataStore.getWishlist();
      const updated = items.map((w) => (w.id === item.id ? { ...w, hearts: nextHearts } : w));
      duoDataStore.saveWishlist(updated);
      queryClient.invalidateQueries({ queryKey: ['wishlist'] });
    } else if (couple?.id) {
      await updateWishlistItem(couple.id, item.id, { hearts: nextHearts });
    }
  };

  const myTotalScore = scores
    .filter((s) => s.user_id === currentUser.id)
    .reduce((sum, s) => sum + s.points, 0);

  const partnerTotalScore = scores
    .filter((s) => s.user_id === partnerUser.id)
    .reduce((sum, s) => sum + s.points, 0);

  const winner =
    myTotalScore > partnerTotalScore
      ? currentUser
      : partnerTotalScore > myTotalScore
      ? partnerUser
      : null;

  // Shared Media Aggregation from Messages and Tasks: only active when user is in Media tab
  const isMediaTab = togetherSubTab === 'media';
  const { messages: firestoreMessages = [] } = useMessages(isMediaTab ? liveCoupleId : null, 1000);
  const { tasks: firestoreTasks = [] } = useTasks(isMediaTab ? liveCoupleId : null);

  const allAttachments: FileAttachment[] = React.useMemo(() => {
    const chatMsgs = isDemoMode ? duoDataStore.getMessages() : firestoreMessages;
    const taskList = isDemoMode ? duoDataStore.getTasks() : firestoreTasks;

    const chatAtts = (chatMsgs as any[]).flatMap((m) => m.attachments || []);
    const taskAtts = (taskList as any[]).flatMap((t) => t.attachments || []);
    const combined = [...chatAtts, ...taskAtts];

    if (mediaFilter !== 'all') {
      return combined.filter((a) => a.type === mediaFilter);
    }
    return combined;
  }, [isDemoMode, firestoreMessages, firestoreTasks, mediaFilter]);

  const groupedMedia = React.useMemo(() => {
    const groups: Record<string, FileAttachment[]> = {};
    for (const att of allAttachments) {
      const monthKey = att.createdAt
        ? format(new Date(att.createdAt), 'MMMM yyyy')
        : 'Recent Memories';
      if (!groups[monthKey]) groups[monthKey] = [];
      groups[monthKey].push(att);
    }
    return groups;
  }, [allAttachments]);

  return (
    <div className="w-full max-w-full lg:max-w-[1600px] mx-auto px-2 sm:px-4 lg:px-6 py-2 sm:py-4 pb-24 lg:pb-8 space-y-4 sm:space-y-6 min-w-0">
      {/* Live Room Invitation / Active Session Banner */}
      {effectiveSession && (
        <ActiveSessionBanner
          session={effectiveSession}
          isInsideRoom={
            (effectiveSession.type === 'study' && togetherSubTab === 'focus') ||
            (effectiveSession.type === 'movie' && togetherSubTab === 'movie')
          }
          onJoin={(s) => {
            setTogetherSubTab(s.type === 'study' ? 'focus' : 'movie');
          }}
        />
      )}

      {/* Sub-Tab Pill Bar - Single Row with Horizontal Scroll */}
      <div className="flex flex-nowrap items-center overflow-x-auto scrollbar-none p-1.5 bg-[var(--surface)] border-2 border-[var(--border)] rounded-2xl sm:rounded-full shadow-[0_2px_0_var(--shadow-color)] gap-1.5 w-full">
        <button
          type="button"
          onClick={() => setTogetherSubTab('focus')}
          className={`shrink-0 py-2 px-3.5 rounded-xl sm:rounded-full text-xs font-chunky font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap ${
            togetherSubTab === 'focus'
              ? 'bg-[var(--partner-a)] text-white shadow-[0_2px_0_var(--shadow-color)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>Study Space 📚</span>
        </button>

        <button
          type="button"
          onClick={() => setTogetherSubTab('movie')}
          className={`shrink-0 py-2 px-3.5 rounded-xl sm:rounded-full text-xs font-chunky font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap ${
            togetherSubTab === 'movie'
              ? 'bg-[var(--partner-a)] text-white shadow-[0_2px_0_var(--shadow-color)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
          }`}
        >
          <Film className="w-3.5 h-3.5" />
          <span>Movie Night 🎬</span>
        </button>

        <button
          type="button"
          onClick={() => setTogetherSubTab('wishlist')}
          className={`shrink-0 py-2 px-3.5 rounded-xl sm:rounded-full text-xs font-chunky font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap ${
            togetherSubTab === 'wishlist'
              ? 'bg-[var(--partner-a)] text-white shadow-[0_2px_0_var(--shadow-color)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
          }`}
        >
          <Star className="w-3.5 h-3.5" />
          <span>Bucket List</span>
        </button>

        <button
          type="button"
          onClick={() => setTogetherSubTab('recap' as any)}
          className={`shrink-0 py-2 px-3.5 rounded-xl sm:rounded-full text-xs font-chunky font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap ${
            togetherSubTab === ('recap' as any)
              ? 'bg-[var(--partner-a)] text-white shadow-[0_2px_0_var(--shadow-color)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
          }`}
        >
          <Trophy className="w-3.5 h-3.5" />
          <span>Recap</span>
        </button>

        <button
          type="button"
          onClick={() => setTogetherSubTab('media')}
          className={`shrink-0 py-2 px-3.5 rounded-xl sm:rounded-full text-xs font-chunky font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap ${
            togetherSubTab === 'media'
              ? 'bg-[var(--partner-a)] text-white shadow-[0_2px_0_var(--shadow-color)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
          }`}
        >
          <Paperclip className="w-3.5 h-3.5" />
          <span>Shared Media</span>
        </button>

        <button
          type="button"
          onClick={() => {
            soundEffects.playPop();
            setTogetherSubTab('diary');
          }}
          className={`shrink-0 py-2 px-3.5 rounded-xl sm:rounded-full text-xs font-chunky font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap ${
            togetherSubTab === 'diary'
              ? 'bg-[var(--partner-a)] text-white shadow-[0_2px_0_var(--shadow-color)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Personal Diary 📖</span>
        </button>
      </div>

      {/* 1. STUDY SPACE */}
      {togetherSubTab === 'focus' && (
        <Suspense
          fallback={
            <div className="p-12 text-center text-[var(--text-muted)] font-ui text-xs">
              Loading Study Space...
            </div>
          }
        >
          <StudySpaceView
            activeSession={activeSession?.type === 'study' ? activeSession : null}
          />
        </Suspense>
      )}

      {/* 2. MOVIE NIGHT */}
      {togetherSubTab === 'movie' && (
        <Suspense
          fallback={
            <div className="p-12 text-center text-[var(--text-muted)] font-ui text-xs">
              Loading Movie Night...
            </div>
          }
        >
          <MovieNightView
            activeSession={activeSession?.type === 'movie' ? activeSession : null}
          />
        </Suspense>
      )}

      {/* 3. OUR BUCKET LIST */}
      {togetherSubTab === 'wishlist' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              {/* Section heading: --font-romantic */}
              <h2 className="text-3xl font-romantic text-[var(--text)]">Our Bucket List</h2>
              <p className="font-ui text-xs font-medium text-[var(--text-muted)]">
                Dreams, dates, and trips to check off together ✨
              </p>
            </div>

            <button
              onClick={() => setIsAddWishOpen(!isAddWishOpen)}
              className="px-4 py-2.5 rounded-2xl bg-[var(--partner-a)] hover:opacity-90 text-white font-chunky font-bold text-xs flex items-center gap-1.5 border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-1 active:shadow-none transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Dream</span>
            </button>
          </div>

          {/* Add Dream Card */}
          {isAddWishOpen && (
            <form
              onSubmit={handleCreateWish}
              className="bg-[var(--surface)] rounded-3xl p-5 border-3 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)] space-y-3 animate-in fade-in duration-200"
            >
              <input
                type="text"
                required
                autoFocus
                value={newWishTitle}
                onChange={(e) => setNewWishTitle(e.target.value)}
                placeholder="e.g. Candlelit dinner on a rooftop in Rome 🍝"
                className="w-full px-4 py-3 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] text-[var(--text)] placeholder-[var(--text-muted)]/50 text-sm font-body focus:outline-none"
              />

              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    { key: 'date', label: 'Date Night 🍷' },
                    { key: 'travel', label: 'Travel ✈️' },
                    { key: 'food', label: 'Food 🍣' },
                    { key: 'movie', label: 'Movie 🎬' },
                  ] as const
                ).map((cat) => (
                  <button
                    type="button"
                    key={cat.key}
                    onClick={() => setNewWishCategory(cat.key)}
                    className={`px-3 py-1.5 rounded-xl font-chunky text-xs font-bold border-2 transition-all cursor-pointer ${
                      newWishCategory === cat.key
                        ? 'bg-[var(--accent)] text-[var(--text)] border-[var(--border)] shadow-[0_1px_0_var(--shadow-color)]'
                        : 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-muted)]'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddWishOpen(false)}
                  className="px-3.5 py-1.5 rounded-xl font-ui text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-[var(--partner-a)] text-white font-chunky font-bold text-xs border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-1 active:shadow-none"
                >
                  Save Dream ✨
                </button>
              </div>
            </form>
          )}

          {/* Wishlist Items List: dynamic responsive grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {wishlist.map((item) => {
              const hasHearted = item.hearts.includes(currentUser.id);

              return (
                <div
                  key={item.id}
                  className={`bg-[var(--surface)] rounded-3xl p-4 border-2 transition-all flex items-center justify-between gap-3 shadow-[0_2px_0_var(--shadow-color)] ${
                    item.completed
                      ? 'border-[var(--border)] opacity-70 bg-[var(--surface-2)]'
                      : 'border-[var(--border)] hover:border-[var(--accent)]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      onClick={() => handleToggleWishComplete(item)}
                      className={`w-7 h-7 rounded-xl flex items-center justify-center border-2 transition-all cursor-pointer ${
                        item.completed
                          ? 'bg-[var(--success)] border-[var(--border)] text-white'
                          : 'border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--partner-a)]'
                      }`}
                    >
                      {item.completed && <Check className="w-4 h-4 stroke-[3]" />}
                    </button>

                    <div className="min-w-0">
                      <div
                        className={`font-chunky text-base font-bold truncate ${
                          item.completed ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text)]'
                        }`}
                      >
                        {item.title}
                      </div>
                      <div className="font-ui text-xs font-medium text-[var(--text-muted)] capitalize">
                        {item.category}
                      </div>
                    </div>
                  </div>

                  {/* Heart reaction button */}
                  <button
                    onClick={() => handleToggleWishHeart(item)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-chunky text-xs font-bold border-2 transition-all active:scale-95 cursor-pointer ${
                      hasHearted
                        ? 'bg-[var(--partner-a)] text-white border-[var(--border)] shadow-[0_1px_0_var(--shadow-color)]'
                        : 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    <Star
                      className={`w-3.5 h-3.5 ${hasHearted ? 'fill-current' : ''}`}
                    />
                    <span>{item.hearts.length}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. WEEKLY RECAP */}
      {togetherSubTab === 'recap' && (
        <div className="space-y-6">
          <div className="bg-[var(--surface)] rounded-3xl p-6 sm:p-8 border-3 border-[var(--border)] text-center relative overflow-hidden shadow-[0_4px_0_var(--shadow-color)]">
            {/* Top Color Strip */}
            <div className="absolute top-0 left-0 right-0 h-2 bg-[var(--accent)]" />

            <div className="w-16 h-16 rounded-3xl bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] flex items-center justify-center mx-auto mb-3 shadow-[0_2px_0_var(--shadow-color)] animate-bounce">
              <Trophy className="w-8 h-8" />
            </div>

            {/* Section heading: --font-romantic */}
            <h2 className="text-3xl font-romantic text-[var(--text)] mb-1">Sunday Weekly Recap</h2>
            <p className="font-ui text-xs font-medium text-[var(--text-muted)] mb-6">
              Fun score recorded together this week 🌟
            </p>

            {/* Score Comparison Cards: --font-numeric for points */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div
                className={`p-4 rounded-3xl border-2 shadow-[0_2px_0_var(--shadow-color)] ${
                  winner?.id === currentUser.id
                    ? 'bg-[var(--surface-2)] border-[var(--border)]'
                    : 'bg-[var(--surface)] border-[var(--border)]'
                }`}
              >
                <img
                  src={currentUser.avatarUrl}
                  alt={currentUser.displayName}
                  className="w-14 h-14 rounded-2xl mx-auto mb-2 object-cover border-2 border-[var(--partner-a)] shadow-xs"
                />
                <div className="font-ui text-xs font-semibold text-[var(--text)]">{currentUser.displayName}</div>
                <div className="text-3xl font-numeric font-bold text-[var(--partner-a)] mt-1 tabular-nums">
                  {myTotalScore} pts
                </div>
              </div>

              <div
                className={`p-4 rounded-3xl border-2 shadow-[0_2px_0_var(--shadow-color)] ${
                  winner?.id === partnerUser.id
                    ? 'bg-[var(--surface-2)] border-[var(--border)]'
                    : 'bg-[var(--surface)] border-[var(--border)]'
                }`}
              >
                <img
                  src={partnerUser.avatarUrl}
                  alt={partnerUser.displayName}
                  className="w-14 h-14 rounded-2xl mx-auto mb-2 object-cover border-2 border-[var(--partner-b)] shadow-xs"
                />
                <div className="font-ui text-xs font-semibold text-[var(--text)]">{partnerUser.displayName}</div>
                <div className="text-3xl font-numeric font-bold text-[var(--partner-b)] mt-1 tabular-nums">
                  {partnerTotalScore} pts
                </div>
              </div>
            </div>

            {/* Winner Announcement & Agreed Forfeit */}
            <div className="p-4 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] text-left shadow-[0_2px_0_var(--shadow-color)]">
              <div className="font-ui text-xs font-semibold uppercase tracking-wider text-[var(--partner-a)] mb-1 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-[var(--accent)]" />
                <span>
                  {winner ? `${winner.displayName} leads the friendly leaderboard! 🏆` : 'Tied week! Perfect balance 💕'}
                </span>
              </div>
              <p className="font-body text-xs text-[var(--text)]">
                Agreed Forfeit:{' '}
                <span className="font-bold underline text-[var(--partner-a)]">
                  "Cooks candlelight dinner together & sweet desert!"
                </span>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 4. SHARED MEDIA VAULT */}
      {togetherSubTab === 'media' && (
        <div className="space-y-6">
          <div className="bg-[var(--surface)] border-3 border-[var(--border)] rounded-3xl p-6 shadow-[0_4px_0_var(--shadow-color)] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b-2 border-[var(--border)]">
              <div>
                <h2 className="font-chunky text-xl font-bold text-[var(--text)]">
                  Shared Media Vault
                </h2>
                <p className="font-ui text-xs text-[var(--text-muted)] mt-0.5">
                  Every photo, video, and document we have exchanged 💕
                </p>
              </div>

              {/* Filter Chips */}
              <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)]">
                {[
                  { id: 'all', label: 'All', icon: Paperclip },
                  { id: 'image', label: 'Photos', icon: ImageIcon },
                  { id: 'video', label: 'Videos', icon: VideoIcon },
                  { id: 'document', label: 'Docs', icon: FileText },
                ].map((f) => {
                  const Icon = f.icon;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setMediaFilter(f.id as any)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-ui font-semibold transition-all cursor-pointer ${
                        mediaFilter === f.id
                          ? 'bg-[var(--accent)] text-[var(--text)] border border-[var(--border)] shadow-xs'
                          : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                      }`}
                    >
                      <Icon className="w-3 h-3" />
                      <span>{f.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {Object.keys(groupedMedia).length === 0 ? (
              <div className="text-center py-12 px-6 rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--surface-2)]/40 my-2">
                <div className="w-14 h-14 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] flex items-center justify-center mx-auto mb-3 text-2xl shadow-xs">
                  📸
                </div>
                <h4 className="font-chunky text-lg font-bold text-[var(--text)] mb-1">
                  No shared media yet
                </h4>
                <p className="font-ui text-xs text-[var(--text-muted)] max-w-sm mx-auto">
                  Send pictures, videos, or documents in chat or attach them to missions!
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(groupedMedia).map(([monthYear, monthAttachments]) => (
                  <div key={monthYear} className="space-y-3">
                    <h3 className="font-chunky text-sm font-bold text-[var(--text)] flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
                      <span>{monthYear}</span>
                      <span className="text-[11px] font-numeric text-[var(--text-muted)]">
                        ({monthAttachments.length})
                      </span>
                    </h3>

                    <div className="p-4 rounded-2xl bg-[var(--surface-2)]/50 border-2 border-[var(--border)]">
                      <AttachmentPreview attachments={monthAttachments} variant="gallery" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 6. PERSONAL DIARY (100% Private per User) */}
      {togetherSubTab === 'diary' && <PersonalDiary />}
    </div>
  );
};
