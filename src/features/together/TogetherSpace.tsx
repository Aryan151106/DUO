import React, { useState, Suspense, lazy } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { duoDataStore } from '../../lib/dataStore';
import type { WishlistItem } from '../../lib/dataStore';
import { useAuthStore } from '../../lib/store';
import { soundManager, soundEffects } from '../../lib/sound';
import {
  useWishlist,
  useScores,
  addWishlistItem,
  updateWishlistItem,
} from '../../lib/firestore';
import { useSharedMedia, type SharedMediaCategory } from '../../lib/sharedMedia';
import confetti from 'canvas-confetti';
import { GoogleIcon } from '../../components/GoogleIcon';
import { AttachmentPreview } from '../chat/AttachmentPreview';
import { format } from 'date-fns';
import type { FileAttachment } from '../../lib/attachments';
import { PersonalDiary } from './PersonalDiary';
import { ActiveSessionBanner } from './ActiveSessionBanner';
import { useActiveSession } from '../../lib/activitySessions';
import { useAnyActiveTogetherRoom } from '../../lib/togetherRooms';
import { useMediaRoomStore } from '../../lib/mediaRoomStore';

import { WavyText } from '../../components/WavyHeading';

const StudySpaceView = lazy(() =>
  import('./StudySpaceView').then((m) => ({ default: m.StudySpaceView }))
);
const MovieNightView = lazy(() =>
  import('./MovieNightView').then((m) => ({ default: m.MovieNightView }))
);

export const TogetherSpace: React.FC = () => {
  const { currentUser, partnerUser, couple, isDemoMode, togetherSubTab, setTogetherSubTab } = useAuthStore();
  const activeRoomInfo = useMediaRoomStore((s) => s.activeRoomInfo);
  const liveCoupleId = !isDemoMode && couple?.id && !couple.id.startsWith('demo') ? couple.id : null;
  const activeSession = useActiveSession(couple?.id || null);
  const activeTogetherRoom = useAnyActiveTogetherRoom(liveCoupleId);
  const effectiveSession = activeTogetherRoom || activeSession;
  const queryClient = useQueryClient();

  const [mediaFilter, setMediaFilter] = useState<SharedMediaCategory>('all');

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

  // Shared Media Aggregation: Uses specialized paginated index instead of fetching 1000 messages
  const isMediaTab = togetherSubTab === 'media';
  const {
    items: mediaItems,
    loading: mediaLoading,
    hasMore: mediaHasMore,
    loadMore: mediaLoadMore,
  } = useSharedMedia(isMediaTab ? liveCoupleId : null, mediaFilter, 30);

  const allAttachments: FileAttachment[] = React.useMemo(() => {
    return mediaItems.map((item) => ({
      id: item.id,
      type: item.category === 'videos' ? 'video' : 'image',
      path: item.path || '',
      thumbnailPath: item.thumbnailPath,
      url: item.url,
      thumbnailUrl: item.thumbnailUrl || item.url,
      fileName: item.name || (item.category === 'doodles' ? 'Doodle.png' : 'Media'),
      mimeType: item.category === 'videos' ? 'video/mp4' : 'image/jpeg',
      size: item.size || 0,
      width: item.width,
      height: item.height,
      uploadedBy: item.senderId || currentUser.id,
      createdAt: item.createdAt,
    }));
  }, [mediaItems, currentUser.id]);

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
      {/* Live Room Invitation / Active Session Banner (visible when on other sub-tabs) */}
      {effectiveSession && (
        (effectiveSession.type === 'study' && togetherSubTab !== 'focus') ||
        (effectiveSession.type === 'movie' && togetherSubTab !== 'movie')
      ) && (
        <ActiveSessionBanner
          session={effectiveSession}
          isInsideRoom={false}
          onJoin={(s) => {
            setTogetherSubTab(s.type === 'study' ? 'focus' : 'movie');
          }}
        />
      )}

      {/* Header */}
      <div className="hd mb-3">
        <div>
          <h1 className="text-[28px] sm:text-[38px] font-display font-normal text-[var(--text)] tracking-wide">
            <WavyText text="TOGETHER" isDisplay={true} />
          </h1>
          <p className="font-ui font-medium text-xs sm:text-sm text-[var(--text-muted)] mt-0.5">tiny rituals, big love ✨</p>
        </div>
      </div>

      {/* Sub-Tab Pill Bar - Single Row with Horizontal Scroll */}
      <div className="tabs">
        <button
          type="button"
          onClick={() => setTogetherSubTab('focus')}
          className={`chip ${togetherSubTab === 'focus' ? 'on' : ''}`}
        >
          <GoogleIcon name="schedule" size={14} />
          <span>Study Space 📚</span>
        </button>

        <button
          type="button"
          onClick={() => setTogetherSubTab('movie')}
          className={`chip ${togetherSubTab === 'movie' ? 'on' : ''}`}
        >
          <GoogleIcon name="movie" size={14} />
          <span>Movie Night 🎬</span>
        </button>

        <button
          type="button"
          onClick={() => setTogetherSubTab('wishlist')}
          className={`chip ${togetherSubTab === 'wishlist' ? 'on' : ''}`}
        >
          <GoogleIcon name="star" size={14} />
          <span>Bucket List ⭐</span>
        </button>

        <button
          type="button"
          onClick={() => setTogetherSubTab('recap' as any)}
          className={`chip ${togetherSubTab === ('recap' as any) ? 'on' : ''}`}
        >
          <GoogleIcon name="emoji_events" size={14} />
          <span>Recap 🏆</span>
        </button>

        <button
          type="button"
          onClick={() => setTogetherSubTab('media')}
          className={`chip ${togetherSubTab === 'media' ? 'on' : ''}`}
        >
          <GoogleIcon name="attach_file" size={14} />
          <span>Shared Media 📎</span>
        </button>

        <button
          type="button"
          onClick={() => {
            soundEffects.playPop();
            setTogetherSubTab('diary');
          }}
          className={`chip ${togetherSubTab === 'diary' ? 'on' : ''}`}
        >
          <GoogleIcon name="menu_book" size={14} />
          <span>Personal Diary 📖</span>
        </button>
      </div>

      {/* 1. STUDY SPACE (with PiP keepalive if active) */}
      <div
        className={
          togetherSubTab === 'focus'
            ? 'w-full'
            : activeRoomInfo?.type === 'study'
            ? 'fixed -top-[9999px] -left-[9999px] w-px h-px opacity-0 pointer-events-none overflow-hidden'
            : 'hidden'
        }
        aria-hidden={togetherSubTab !== 'focus'}
        style={togetherSubTab !== 'focus' && activeRoomInfo?.type === 'study' ? { zIndex: -9999 } : undefined}
      >
        {(togetherSubTab === 'focus' || activeRoomInfo?.type === 'study') && (
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
      </div>

      {/* 2. MOVIE NIGHT (with PiP keepalive if active) */}
      <div
        className={
          togetherSubTab === 'movie'
            ? 'w-full'
            : activeRoomInfo?.type === 'movie'
            ? 'fixed -top-[9999px] -left-[9999px] w-px h-px opacity-0 pointer-events-none overflow-hidden'
            : 'hidden'
        }
        aria-hidden={togetherSubTab !== 'movie'}
        style={togetherSubTab !== 'movie' && activeRoomInfo?.type === 'movie' ? { zIndex: -9999 } : undefined}
      >
        {(togetherSubTab === 'movie' || activeRoomInfo?.type === 'movie') && (
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
      </div>

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
              <GoogleIcon name="add" size={16} />
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
                  className={`bk ${item.completed ? 'dn' : ''}`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <button
                      onClick={() => handleToggleWishComplete(item)}
                      className={`sw flex items-center justify-center transition-all cursor-pointer ${
                        item.completed
                          ? 'bg-[var(--d)] text-white'
                          : 'bg-[var(--bg)]'
                      }`}
                    >
                      {item.completed && <GoogleIcon name="check" size={16} />}
                    </button>

                    <div className="min-w-0 flex-1">
                      <b className="font-chunky text-base font-bold truncate block">
                        {item.title}
                      </b>
                      <small className="font-ui text-xs text-[var(--text-muted)] capitalize block">
                        {item.category}
                      </small>
                    </div>
                  </div>

                  {/* Heart reaction button */}
                  <button
                    onClick={() => handleToggleWishHeart(item)}
                    className="chip text-xs"
                  >
                    <GoogleIcon
                      name="star"
                      size={14}
                      filled={hasHearted}
                      className={hasHearted ? 'fill-current' : ''}
                    />
                    <span>⭐ {item.hearts.length}</span>
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
          <div className="card text-center relative overflow-hidden">
            {/* Top Color Strip */}
            <div className="absolute top-0 left-0 right-0 h-2 bg-[var(--accent)]" />

            <div className="w-16 h-16 rounded-3xl bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] flex items-center justify-center mx-auto mb-3 shadow-[0_2px_0_var(--shadow-color)] animate-bounce">
              <GoogleIcon name="emoji_events" size={32} />
            </div>

            {/* Section heading */}
            <h2 className="text-3xl font-chunky text-[var(--text)] mb-1">Sunday Weekly Recap</h2>
            <p className="hand text-lg text-[var(--mut)] mb-6">
              fun score recorded this week 🌞
            </p>

            {/* Score Comparison Cards: .clocks with .clk and .pts */}
            <div className="clocks mb-6">
              <div className="clk">
                <div className="av">🧔</div>
                <div className="font-ui text-xs font-semibold">{currentUser.displayName}</div>
                <div className="pts">{myTotalScore}</div>
              </div>

              <div className="clk v">
                <div className="av">👩</div>
                <div className="font-ui text-xs font-semibold">{partnerUser.displayName}</div>
                <div className="pts">{partnerTotalScore}</div>
              </div>
            </div>

            {/* Winner Announcement & Agreed Forfeit */}
            <div className="ev text-left">
              <span className="text-2xl">{winner ? '👑' : '🤝'}</span>
              <div>
                <b>{winner ? `${winner.displayName} leads the leaderboard!` : 'Tied week! Perfect balance'}</b>
                <br />
                <small className="text-[var(--text-muted)]">Agreed forfeit: “Cooks candlelight dinner together & sweet dessert!”</small>
              </div>
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
              <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] overflow-x-auto scrollbar-none">
                {[
                  { id: 'all', label: 'All', iconName: 'attach_file' },
                  { id: 'doodles', label: 'Doodles', iconName: 'palette' },
                  { id: 'photos', label: 'Photos', iconName: 'image' },
                  { id: 'videos', label: 'Videos', iconName: 'videocam' },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setMediaFilter(f.id as SharedMediaCategory)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-ui font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                      mediaFilter === f.id
                        ? 'bg-[var(--accent)] text-[var(--text)] border border-[var(--border)] shadow-xs font-bold'
                        : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    <GoogleIcon name={f.iconName} size={14} />
                    <span>{f.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {mediaLoading && allAttachments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
                <GoogleIcon name="progress_activity" size={24} className="animate-spin text-[var(--partner-a)] mb-2" />
                <span className="font-ui text-xs">Opening shared memories…</span>
              </div>
            ) : Object.keys(groupedMedia).length === 0 ? (
              <div className="text-center py-12 px-6 rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--surface-2)]/40 my-2">
                <div className="w-14 h-14 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] flex items-center justify-center mx-auto mb-3 text-2xl shadow-xs">
                  {mediaFilter === 'doodles' ? '🎨' : mediaFilter === 'videos' ? '🎬' : '📸'}
                </div>
                <h4 className="font-chunky text-lg font-bold text-[var(--text)] mb-1">
                  No {mediaFilter === 'all' ? 'shared media' : mediaFilter} yet
                </h4>
                <p className="font-ui text-xs text-[var(--text-muted)] max-w-sm mx-auto">
                  {mediaFilter === 'doodles'
                    ? 'Draw love doodles together in the Doodle tab to save them here!'
                    : 'Share pictures and videos in chat or missions to keep them forever.'}
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

                {mediaHasMore && (
                  <div className="flex justify-center pt-2">
                    <button
                      type="button"
                      onClick={mediaLoadMore}
                      disabled={mediaLoading}
                      className="px-4 py-2 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--accent)]/30 text-xs font-chunky font-bold text-[var(--text)] border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      {mediaLoading && <GoogleIcon name="progress_activity" size={14} className="animate-spin text-[var(--partner-a)]" />}
                      <span>Load older memories</span>
                    </button>
                  </div>
                )}
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
