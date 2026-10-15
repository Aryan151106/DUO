import React, { lazy, Suspense, useEffect } from 'react';
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
import { useActiveSession } from '../lib/activitySessions';
import { useAnyActiveTogetherRoom } from '../lib/togetherRooms';
import {
  CalendarDays,
  Calendar,
  MessageCircle,
  Paintbrush,
  Zap,
  SlidersHorizontal,
} from 'lucide-react';

const NAV_ITEMS = [
  { id: 'today', label: 'Today', icon: CalendarDays },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
  { id: 'chat', label: 'Chat', icon: MessageCircle },
  { id: 'doodle', label: 'Doodle', icon: Paintbrush },
  { id: 'together', label: 'Together', icon: Zap },
  { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
] as const;

export const Shell: React.FC = () => {
  const { activeTab, setTab, couple, setTogetherSubTab } = useAuthStore();
  const activeSession = useActiveSession(couple?.id || null);
  const activeTogetherRoom = useAnyActiveTogetherRoom(couple?.id || null);
  const effectiveSession = activeTogetherRoom || activeSession;
  const { unreadCount, markAllAsRead } = useNotificationStore();

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

  // Background idle tab preloader for instant navigation
  useEffect(() => {
    const preloadAll = () => {
      loadCalendarView();
      loadChatView();
      loadTogetherSpace();
      loadLiveDoodleCanvas();
      loadSettingsModal();
    };

    if (typeof window !== 'undefined') {
      if ('requestIdleCallback' in window) {
        (window as any).requestIdleCallback(preloadAll);
      } else {
        setTimeout(preloadAll, 1200);
      }
    }
  }, []);

  const preloadTab = (tabId: string) => {
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
    <div className="h-[100dvh] w-full bg-[var(--bg)] text-[var(--text)] select-none overflow-hidden lg:grid lg:grid-cols-[96px_minmax(0,1fr)] lg:grid-rows-[72px_1fr] flex flex-col">
      {/* DESKTOP VERTICAL LEFT SIDEBAR RAIL (>=1024px) */}
      {/* Flush with left edge, full height from top to bottom (row 1 to 2) */}
      <aside className="hidden lg:flex flex-col items-center py-4 px-2 w-[96px] h-full col-start-1 row-start-1 row-span-2 border-r-2 border-[var(--border)] bg-[var(--surface)] overflow-y-auto shrink-0 z-30">
        <nav className="w-full flex flex-col gap-2">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleTabChange(item.id)}
                onMouseEnter={() => preloadTab(item.id)}
                className={`w-full h-[72px] flex flex-col items-center justify-center gap-1 px-1.5 rounded-2xl transition-all cursor-pointer border-2 ${
                  isActive
                    ? 'bg-[var(--partner-a)] text-white border-[var(--border)] shadow-[0_3px_0_var(--shadow-color)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
                }`}
                title={item.label}
              >
                <div className="relative flex items-center justify-center">
                  <Icon className="w-6 h-6 stroke-[2.2] shrink-0" />
                  {item.id === 'chat' && unreadCount > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 bg-rose-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shadow-md animate-pulse">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </div>
                <span className="font-ui font-semibold text-[13px] leading-tight text-center truncate max-w-full">
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* HEADER: Col 2, Row 1 on desktop; top on mobile */}
      <div className="lg:col-start-2 lg:row-start-1 w-full z-20 flex flex-col">
        {activeTab === 'settings' && <Header />}
        <div className="chaos-ticker" aria-label="AV status ticker">
          <span>AV — Aryan & Vidhi. One shared space. ✦ </span>
        </div>
      </div>

      {/* MAIN CONTENT AREA: Col 2, Row 2 on desktop */}
      <main
        className={`lg:col-start-2 lg:row-start-2 w-full h-full min-h-0 ${
          activeTab === 'chat' || activeTab === 'doodle'
            ? 'overflow-hidden flex flex-col pb-[calc(60px+env(safe-area-inset-bottom))] lg:pb-0'
            : 'overflow-y-auto pb-[calc(76px+env(safe-area-inset-bottom))] lg:pb-8'
        }`}
      >
        <div
          className={`w-full mx-auto min-w-0 ${
            activeTab === 'chat'
              ? 'h-full flex flex-col w-full max-w-[1600px] p-2 sm:p-4 flex-1'
              : activeTab === 'doodle'
              ? 'h-full w-full flex flex-col flex-1 p-1 sm:p-2 lg:p-3'
              : 'w-full flex-1 p-3 sm:p-5 lg:p-6 max-w-[1600px]'
          }`}
        >
          {effectiveSession && activeTab !== 'together' && activeTab !== 'chat' && (
            <div className="mb-4">
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
            {activeTab === 'together' && <TogetherSpace />}
            {activeTab === 'settings' && <SettingsModal />}
          </Suspense>
        </div>
      </main>

      {/* MOBILE FULL-WIDTH BOTTOM TAB BAR (<1024px) */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[var(--surface)] border-t-2 border-[var(--border)] shadow-[0_-2px_0_var(--shadow-color)] pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-around px-2 py-1.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleTabChange(item.id)}
                onMouseEnter={() => preloadTab(item.id)}
                className={`flex flex-col items-center gap-0.5 py-1 px-3 rounded-2xl transition-all cursor-pointer min-w-[52px] border-2 ${
                  isActive
                    ? 'bg-[var(--partner-a)] text-white border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                <div className="relative flex items-center justify-center">
                  <Icon className="w-5 h-5 stroke-[2.2]" />
                  {item.id === 'chat' && unreadCount > 0 && (
                    <span className="absolute -top-1.5 -right-2 bg-rose-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-0.5 shadow-md animate-pulse">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </div>
                <span className="font-ui font-semibold text-[11px]">
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* OVERLAYS */}
      <ReminderBanner />
      <TaskReminderBanner />
      <NudgeAlarmOverlay />
      <CallOverlay />
    </div>
  );
};
