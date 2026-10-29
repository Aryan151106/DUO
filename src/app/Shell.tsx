import React, { lazy, Suspense, useEffect, useRef } from 'react';
import { useAuthStore } from '../lib/store';
import { useNotificationStore } from '../lib/notifications';
import { soundManager } from '../lib/sound';
import { Header } from './Header';

// Tab Loaders
const loadTaskList = () => import('../features/tasks/TaskList').then((m) => ({ default: m.TaskList }));
const loadCalendarView = () => import('../features/calendar/CalendarView').then((m) => ({ default: m.CalendarView }));
const loadChatView = () => import('../features/chat/ChatView').then((m) => ({ default: m.ChatView }));
const loadLiveDoodleCanvas = () => import('../features/doodle/LiveDoodleCanvas').then((m) => ({ default: m.LiveDoodleCanvas }));
const loadTogetherSpace = () => import('../features/together/TogetherSpace').then((m) => ({ default: m.TogetherSpace }));
const loadSettingsModal = () => import('../features/settings/SettingsModal').then((m) => ({ default: m.SettingsModal }));

const TaskList = lazy(loadTaskList);
const CalendarView = lazy(loadCalendarView);
const ChatView = lazy(loadChatView);
const LiveDoodleCanvas = lazy(loadLiveDoodleCanvas);
const TogetherSpace = lazy(loadTogetherSpace);
const SettingsModal = lazy(loadSettingsModal);

import { NudgeAlarmOverlay } from '../features/nudge/NudgeAlarmOverlay';
import { CallOverlay } from '../features/calls/CallOverlay';
import { ReminderBanner } from '../features/calendar/ReminderBanner';
import { TaskReminderBanner } from '../features/tasks/TaskReminderBanner';
import { ActiveSessionBanner } from '../features/together/ActiveSessionBanner';
import { GlobalMediaRoomHost } from '../features/together/GlobalMediaRoomHost';
import { PwaUpdatePrompt } from './PwaUpdatePrompt';
import { useActiveSession } from '../lib/activitySessions';
import { useAnyActiveTogetherRoom } from '../lib/togetherRooms';
import { useMediaRoomStore } from '../lib/mediaRoomStore';

const NAV_ITEMS = [
  { id: 'today', label: 'Today', emoji: '🌞' },
  { id: 'calendar', label: 'Calendar', emoji: '📅' },
  { id: 'chat', label: 'Chat', emoji: '💬' },
  { id: 'doodle', label: 'Doodle', emoji: '🖍️' },
  { id: 'together', label: 'Together', emoji: '⚡' },
  { id: 'settings', label: 'Settings', emoji: '🎛️' },
] as const;

export const Shell: React.FC = () => {
  const { activeTab, setTab, couple, setTogetherSubTab, currentUser, togetherSubTab } = useAuthStore();
  const activeRoomInfo = useMediaRoomStore((s) => s.activeRoomInfo);
  const activeSession = useActiveSession(couple?.id || null);
  const activeTogetherRoom = useAnyActiveTogetherRoom(couple?.id || null);
  const effectiveSession = activeTogetherRoom || activeSession;
  const { unreadCount, markAllAsRead } = useNotificationStore();

  const isTogetherGames = activeTab === 'together' && togetherSubTab === 'games';

  // Play chime and notify when partner starts a room
  const prevRoomIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeTogetherRoom && activeTogetherRoom.status !== 'ended') {
      const isFromPartner = activeTogetherRoom.hostUid !== currentUser.id;
      if (isFromPartner && prevRoomIdRef.current !== activeTogetherRoom.roomId) {
        prevRoomIdRef.current = activeTogetherRoom.roomId;
        try {
          soundManager.playGentleChime();
        } catch {}
      }
    } else {
      prevRoomIdRef.current = null;
    }
  }, [activeTogetherRoom?.roomId, activeTogetherRoom?.status, activeTogetherRoom?.hostUid, currentUser.id]);

  // Handle notification action deep links on initial load (e.g., ?action=chat, ?openReply=true)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      const action = params.get('action');
      const openReply = params.get('openReply') === 'true';

      if (openReply || action === 'chat') {
        setTab('chat');
      } else if (action === 'today' || action === 'tasks') {
        setTab('today');
      } else if (action === 'calendar') {
        setTab('calendar');
      } else if (action === 'doodle') {
        setTab('doodle');
      } else if (action === 'together') {
        setTab('together');
      } else if (action === 'settings') {
        setTab('settings');
      }
    } catch {}
  }, [setTab]);

  // Smart idle preloader for most likely next screen, strictly respecting saveData and slow connections
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Check data-saver and network constraints
    const nav = navigator as any;
    const connection = nav?.connection || nav?.mozConnection || nav?.webkitConnection;
    if (connection?.saveData) return;
    if (connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g') return;

    // Preload only the most likely companion screen (Chat if on Today; Today if on Chat)
    const targetNext = activeTab === 'today' ? loadChatView : activeTab === 'chat' ? loadTaskList : null;
    if (!targetNext) return;

    const runIdlePreload = () => {
      try {
        targetNext();
      } catch {}
    };

    if ('requestIdleCallback' in window) {
      const handle = (window as any).requestIdleCallback(runIdlePreload, { timeout: 3500 });
      return () => (window as any).cancelIdleCallback(handle);
    } else {
      const timer = (globalThis as any).setTimeout(runIdlePreload, 2500);
      return () => (globalThis as any).clearTimeout(timer);
    }
  }, [activeTab]);

  const preloadTab = (tabId: string) => {
    // Also skip hover preload on saveData
    const nav = navigator as any;
    const connection = nav?.connection || nav?.mozConnection || nav?.webkitConnection;
    if (connection?.saveData) return;

    switch (tabId) {
      case 'today':
        loadTaskList();
        break;
      case 'calendar':
        loadCalendarView();
        break;
      case 'chat':
        loadChatView();
        break;
      case 'together':
        loadTogetherSpace();
        break;
      case 'doodle':
        loadLiveDoodleCanvas();
        break;
      case 'settings':
        loadSettingsModal();
        break;
    }
  };

  const handleTabChange = (tab: typeof activeTab) => {
    soundManager.playPing();
    setTab(tab);
    if (tab === 'chat') {
      if (couple?.id && unreadCount > 0) {
        markAllAsRead(couple.id);
      }
      if (typeof navigator !== 'undefined' && 'clearAppBadge' in navigator) {
        try {
          (navigator as any).clearAppBadge();
        } catch {}
      }
    }
  };

  useEffect(() => {
    if (activeTab === 'chat' && couple?.id && unreadCount > 0) {
      markAllAsRead(couple.id);
    }
  }, [activeTab, couple?.id, unreadCount, markAllAsRead]);

  return (
    <div className={`h-screen h-[100dvh] w-full bg-[var(--bg)] text-[var(--text)] select-none overflow-hidden lg:grid lg:grid-cols-[96px_minmax(0,1fr)] ${activeTab === 'settings' ? 'lg:grid-rows-[72px_1fr]' : 'lg:grid-rows-[1fr]'} flex flex-col relative`}>
      {/* Floating Sticker Emojis Background Layer */}
      <div className="stk" aria-hidden="true">
        {['⚡', '⭐', '🔥', '🎲', '✨', '🛹', '🎯', '🍕', '🚀', '💥'].map((emoji, i) => (
          <span
            key={i}
            style={{
              left: `${(i * 37 + 8) % 94}%`,
              top: `${(i * 53 + 12) % 86}%`,
              fontSize: `${28 + (i % 4) * 14}px`,
              animationDelay: `-${i * 0.7}s`,
            }}
          >
            {emoji}
          </span>
        ))}
      </div>

      {/* DESKTOP VERTICAL LEFT SIDEBAR RAIL (>=1024px) */}
      <aside className="hidden lg:flex flex-col items-center desktop-nav-rail col-start-1 row-start-1 row-span-2 border-r-2 border-[var(--border)] bg-[var(--bg)] shrink-0 z-30">
        <nav className="w-full flex flex-col gap-3 py-2 items-center">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleTabChange(item.id)}
                onMouseEnter={() => preloadTab(item.id)}
                className={`nv ${isActive ? 'on' : ''}`}
                title={item.label}
              >
                <div className="relative flex items-center justify-center">
                  <i>{item.emoji}</i>
                  {item.id === 'chat' && unreadCount > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 bg-rose-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shadow-md animate-pulse">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </div>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* HEADER: Col 2, Row 1 on desktop (only on settings) */}
      {activeTab === 'settings' && (
        <div className="lg:col-start-2 lg:row-start-1 w-full z-20 flex flex-col">
          <Header />
        </div>
      )}

      {/* MAIN CONTENT AREA */}
      <main
        className={`lg:col-start-2 ${activeTab === 'settings' ? 'lg:row-start-2' : 'lg:row-start-1'} w-full h-full min-h-0 view ${
          activeTab === 'chat' || activeTab === 'doodle'
            ? 'overflow-hidden flex flex-col pb-[calc(64px+env(safe-area-inset-bottom,0px))] lg:pb-0'
            : 'overflow-y-auto pb-[calc(76px+env(safe-area-inset-bottom,0px))] lg:pb-8'
        }`}
      >
        <div
          className={`w-full mx-auto min-w-0 ${
            activeTab === 'chat'
              ? 'h-full flex flex-col w-full max-w-[1600px] p-2 sm:p-4 flex-1'
              : activeTab === 'doodle'
              ? 'h-full w-full flex flex-col flex-1 p-1 sm:p-2 lg:p-3'
              : isTogetherGames
              ? 'w-full flex-1 px-0 py-2 sm:p-5 lg:p-6 max-w-[1600px]'
              : 'w-full flex-1 p-3 sm:p-5 lg:p-6 max-w-[1600px]'
          }`}
        >
          {effectiveSession && activeTab !== 'together' && (
            <div className="mb-3 shrink-0">
              <ActiveSessionBanner
                session={effectiveSession}
                isInsideRoom={false}
                onJoin={(s) => {
                  setTab('together');
                  setTogetherSubTab(s.type === 'study' ? 'focus' : 'movie');
                }}
              />
            </div>
          )}

          <Suspense
            fallback={
              <div className="flex min-h-40 items-center justify-center text-sm font-ui text-[var(--text-muted)]">
                Loading…
              </div>
            }
          >
            {activeTab === 'today' && <TaskList />}
            {activeTab === 'calendar' && <CalendarView />}
            {activeTab === 'chat' && <ChatView />}
            {activeTab === 'doodle' && <LiveDoodleCanvas />}
            {activeTab === 'settings' && <SettingsModal />}

            {/* Together Space with PiP keep-alive: remains mounted whenever a call is active so video PiP never disconnects */}
            <div
              className={
                activeTab === 'together'
                  ? 'contents'
                  : activeRoomInfo
                  ? 'fixed -top-[9999px] -left-[9999px] w-px h-px opacity-0 pointer-events-none overflow-hidden'
                  : 'hidden'
              }
              aria-hidden={activeTab !== 'together'}
              style={activeTab !== 'together' && activeRoomInfo ? { zIndex: -9999 } : undefined}
            >
              {(activeTab === 'together' || Boolean(activeRoomInfo)) && <TogetherSpace />}
            </div>
          </Suspense>
        </div>
      </main>

      {/* MOBILE FULL-WIDTH BOTTOM TAB BAR (<1024px) */}
      <nav className="flex lg:hidden mobile-bottom-nav z-40">
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => handleTabChange(item.id)}
              onMouseEnter={() => preloadTab(item.id)}
              className={`nv ${isActive ? 'on' : ''}`}
            >
              <div className="relative flex items-center justify-center">
                <i>{item.emoji}</i>
                {item.id === 'chat' && unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 bg-rose-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-0.5 shadow-md animate-pulse">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </div>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* OVERLAYS */}
      <GlobalMediaRoomHost />
      <ReminderBanner />
      <TaskReminderBanner />
      <NudgeAlarmOverlay />
      <CallOverlay />
      <PwaUpdatePrompt />
    </div>
  );
};
