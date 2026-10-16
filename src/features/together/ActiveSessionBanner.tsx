import React from 'react';
import { Film, BookOpen, Sparkles, ArrowRight, X } from 'lucide-react';
import { type ActivitySession, endActivitySession } from '../../lib/activitySessions';
import { type TogetherRoom, endTogetherRoom } from '../../lib/togetherRooms';
import { useAuthStore } from '../../lib/store';
import { soundEffects } from '../../lib/sound';

interface ActiveSessionBannerProps {
  session: ActivitySession | TogetherRoom | null;
  onJoin: (session: any) => void;
  isInsideRoom?: boolean;
}

export const ActiveSessionBanner: React.FC<ActiveSessionBannerProps> = ({
  session,
  onJoin,
  isInsideRoom = false,
}) => {
  const { currentUser, partnerUser } = useAuthStore();
  const sessionId = session ? ('roomId' in session ? session.roomId : session.id) : null;
  const [dismissedSessionId, setDismissedSessionId] = React.useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      if (sessionId && localStorage.getItem(`duo_dismissed_session_${sessionId}`)) {
        return sessionId;
      }
      return sessionStorage.getItem('duo_dismissed_session');
    } catch {
      return null;
    }
  });

  if (!session) {
    return null;
  }

  const status = 'status' in session ? session.status : 'ended';
  const isOpen = status === 'open' || status === 'waiting' || status === 'active';

  if (!isOpen || sessionId === dismissedSessionId) {
    return null;
  }

  const handleDismiss = () => {
    if (sessionId) {
      setDismissedSessionId(sessionId);
      try {
        localStorage.setItem(`duo_dismissed_session_${sessionId}`, 'true');
        sessionStorage.setItem('duo_dismissed_session', sessionId);
      } catch {}
    }
  };

  const hostUid = 'hostUid' in session ? session.hostUid : (session as any).createdBy;
  const isCreator = hostUid === currentUser.id;
  const isStudy = session.type === 'study';

  const title = isStudy ? 'Study Space is Open' : 'Movie Night is Open';
  const partnerName =
    ('hostName' in session ? (session as any).hostName : null) ||
    ('createdByName' in session ? (session as any).createdByName : null) ||
    partnerUser.displayName ||
    'Your partner';
  const description = isCreator
    ? `You opened this room. Waiting for your partner to join!`
    : `${partnerName} started ${isStudy ? 'Study Space' : 'Movie Night'}! Tap to join together.`;

  return (
    <div className="w-full bg-[var(--surface)] border-3 border-[var(--border)] rounded-3xl p-4 sm:p-5 shadow-[0_4px_0_var(--shadow-color)] relative overflow-hidden animate-in slide-in-from-top-4 duration-300">
      {/* Top playful accent line */}
      <div
        className={`absolute top-0 left-0 right-0 h-2 ${
          isStudy ? 'bg-indigo-500' : 'bg-rose-500'
        }`}
      />

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        {/* Left: Icon & Description */}
        <div className="flex items-center gap-3.5 min-w-0">
          <div
            className={`w-12 h-12 rounded-2xl border-2 border-[var(--border)] flex items-center justify-center p-2.5 shrink-0 shadow-[0_2px_0_var(--shadow-color)] ${
              isStudy ? 'bg-indigo-500/20 text-indigo-500' : 'bg-rose-500/20 text-rose-500'
            }`}
          >
            {isStudy ? <BookOpen className="w-6 h-6" /> : <Film className="w-6 h-6" />}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-chunky text-base sm:text-lg font-bold text-[var(--text)] tracking-tight">
                {title}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-ui text-[10px] font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Live</span>
              </span>
            </div>
            <p className="font-ui text-xs text-[var(--text-muted)] mt-0.5 truncate max-w-md">
              {description}
            </p>
          </div>
        </div>

        {/* Right: Join / Status button */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
          {!isInsideRoom ? (
            <button
              type="button"
              onClick={() => {
                soundEffects.playPop();
                onJoin(session);
              }}
              className={`flex-1 sm:flex-none px-5 py-2.5 rounded-2xl border-2 border-[var(--border)] font-chunky font-bold text-xs flex items-center justify-center gap-2 shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none transition-all cursor-pointer ${
                isStudy
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white animate-pulse'
                  : 'bg-rose-600 hover:bg-rose-500 text-white animate-pulse'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 fill-current" />
              <span>Join {isStudy ? 'Study Space' : 'Movie Night'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <span className="px-3.5 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-ui text-xs font-bold border border-emerald-500/30">
              You're in this room
            </span>
          )}

          {/* End/Close Room action */}
          <button
            type="button"
            onClick={async () => {
              handleDismiss();
              soundEffects.playPop();
              try {
                if ('roomId' in session) {
                  await endTogetherRoom(session.roomId);
                } else if ('coupleId' in session && session.coupleId) {
                  await endActivitySession(session.coupleId, session.id);
                }
              } catch (err) {
                console.warn('[ActiveSessionBanner] Error closing room:', err);
              }
            }}
            className="px-3 py-2 rounded-2xl border-2 border-rose-500/30 text-rose-500 hover:bg-rose-500/10 font-ui font-semibold text-xs transition-all cursor-pointer"
            title="End and close this room"
          >
            End Room
          </button>

          <button
            type="button"
            onClick={handleDismiss}
            className="p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
            title="Dismiss notification"
            aria-label="Dismiss banner"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
