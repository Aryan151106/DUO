import { create } from 'zustand';

export type DuoTheme =
  | 'hazard'
  | 'concrete'
  | 'acid'
  | 'arcade'
  | 'jungle'
  | 'taxi'
  | 'cozy-cream'
  | 'cozy-dusk'
  | 'paper-ink'
  | 'soft-pop'
  | 'midnight'
  | 'mint-fresh'
  | 'custom';

export interface UserProfile {
  id: string;
  displayName: string;
  avatarUrl: string;
  timezone: string;
  theme: DuoTheme;
  mode?: 'light' | 'dark' | 'auto';
  partnerColor?: string;
  timeFormat?: '12h' | '24h' | 'auto';
  firstDayOfWeek?: 'sunday' | 'monday';
  quietHoursStart: string;
  quietHoursEnd: string;
  moodStatus: string;
  nickname?: string;
  realDisplayName?: string;
  gender?: 'female' | 'male' | 'other';
}

export interface CoupleData {
  id: string;
  inviteCode: string | null;
  locked: boolean;
  createdAt: string;
  nicknames?: Record<string, string>;
}

interface AuthStore {
  currentUser: UserProfile;
  partnerUser: UserProfile;
  couple: CoupleData | null;
  soundsEnabled: boolean;
  isDemoMode: boolean;
  activeTab: 'today' | 'calendar' | 'chat' | 'doodle' | 'together' | 'settings';
  togetherSubTab: 'focus' | 'movie' | 'wishlist' | 'recap' | 'diary' | 'media' | 'games';
  timeFormat: '12h' | '24h' | 'auto';
  firstDayOfWeek: 'sunday' | 'monday';
  setTab: (tab: 'today' | 'calendar' | 'chat' | 'doodle' | 'together' | 'settings') => void;
  setTogetherSubTab: (subTab: 'focus' | 'movie' | 'wishlist' | 'recap' | 'diary' | 'media' | 'games') => void;
  setTimeFormat: (format: '12h' | '24h' | 'auto') => void;
  setFirstDayOfWeek: (day: 'sunday' | 'monday') => void;
  setSoundsEnabled: (enabled: boolean) => void;
  setIsDemoMode: (isDemo: boolean) => void;
  setCurrentUser: (user: Partial<UserProfile>) => void;
  setPartnerUser: (user: Partial<UserProfile>) => void;
  setCouple: (couple: CoupleData | null) => void;
  switchActiveProfile: () => void; // High-utility demo feature to instantly switch between Alex & Sam
}

const defaultTimezone =
  typeof Intl !== 'undefined'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    : 'UTC';

export const DEMO_ALEX: UserProfile = {
  id: 'user-aryan-1',
  displayName: 'Aryan',
  avatarUrl:
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
  timezone: 'Asia/Kolkata',
  theme: 'hazard',
  quietHoursStart: '23:00',
  quietHoursEnd: '07:30',
  moodStatus: 'Thinking of you ❤️',
  gender: 'male',
};

export const DEMO_SAM: UserProfile = {
  id: 'user-vidhi-2',
  displayName: 'Vidhi',
  avatarUrl:
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
  timezone: 'Asia/Kolkata',
  theme: 'hazard',
  quietHoursStart: '23:30',
  quietHoursEnd: '08:00',
  moodStatus: 'Thinking of you ✨',
  gender: 'female',
};

export const INITIAL_USER: UserProfile = {
  id: '',
  displayName: 'Aryan',
  avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=aryan',
  timezone: defaultTimezone,
  theme: 'hazard',
  quietHoursStart: '23:00',
  quietHoursEnd: '07:00',
  moodStatus: 'Online ✨',
  gender: 'male',
};

export const INITIAL_PARTNER: UserProfile = {
  id: '',
  displayName: 'Vidhi',
  avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=vidhi',
  timezone: defaultTimezone,
  theme: 'hazard',
  quietHoursStart: '23:00',
  quietHoursEnd: '07:00',
  moodStatus: 'Online ✨',
  gender: 'female',
};

export const useAuthStore = create<AuthStore>((set, get) => ({
  currentUser: INITIAL_USER,
  partnerUser: INITIAL_PARTNER,
  couple: null,
  soundsEnabled: false,
  isDemoMode: false,
  activeTab: 'today',
  togetherSubTab: 'focus',
  timeFormat: (typeof window !== 'undefined' ? (localStorage.getItem('duo_time_format') as any) : 'auto') || 'auto',
  firstDayOfWeek: (typeof window !== 'undefined' ? (localStorage.getItem('duo_first_day_of_week') as any) : 'sunday') || 'sunday',
  setTab: (tab) => set({ activeTab: tab }),
  setTogetherSubTab: (subTab) => set({ togetherSubTab: subTab }),
  setTimeFormat: (format) => {
    if (typeof window !== 'undefined') localStorage.setItem('duo_time_format', format);
    set({ timeFormat: format });
  },
  setFirstDayOfWeek: (day) => {
    if (typeof window !== 'undefined') localStorage.setItem('duo_first_day_of_week', day);
    set({ firstDayOfWeek: day });
  },
  setSoundsEnabled: (enabled) => set({ soundsEnabled: enabled }),
  setIsDemoMode: (isDemoMode) => set({ isDemoMode }),
  setCurrentUser: (updates) =>
    set((state) => ({ currentUser: { ...state.currentUser, ...updates } })),
  setPartnerUser: (updates) =>
    set((state) => ({ partnerUser: { ...state.partnerUser, ...updates } })),
  setCouple: (couple) => set({ couple }),
  switchActiveProfile: () => {
    const { currentUser, partnerUser } = get();
    set({
      currentUser: partnerUser,
      partnerUser: currentUser,
    });
  },
}));

// Nudge Overlay Store
export interface ActiveNudge {
  id: string;
  taskId: string;
  taskTitle: string;
  senderName: string;
  level: number;
  level4Count: number;
  createdAt: string;
}

interface NudgeStore {
  activeNudge: ActiveNudge | null;
  showOverlay: boolean;
  openNudge: (nudge: ActiveNudge) => void;
  closeNudge: () => void;
  escalateNudge: (level: number) => void;
}

export const useNudgeStore = create<NudgeStore>((set) => ({
  activeNudge: null,
  showOverlay: false,
  openNudge: (nudge) => set({ activeNudge: nudge, showOverlay: true }),
  closeNudge: () => set({ activeNudge: null, showOverlay: false }),
  escalateNudge: (level) =>
    set((state) =>
      state.activeNudge
        ? {
            activeNudge: {
              ...state.activeNudge,
              level,
              level4Count:
                level === 4 ? state.activeNudge.level4Count + 1 : state.activeNudge.level4Count,
            },
            showOverlay: true,
          }
        : state
    ),
}));

// WebRTC Call State Machine
export type CallState =
  | 'idle'
  | 'outgoing'
  | 'incoming'
  | 'active'
  | 'reconnecting'
  | 'declined'
  | 'missed'
  | 'busy'
  | 'failed'
  | 'ended';

interface CallStore {
  callState: CallState;
  callId: string | null;
  callType: 'video' | 'audio';
  isCaller: boolean;
  isMuted: boolean;
  isCameraOff: boolean;
  durationSec: number;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  startCall: (type: 'video' | 'audio', isCaller: boolean, callId?: string) => void;
  answerCall: () => void;
  endCall: (reason?: string) => void;
  setCallState: (state: CallState) => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  setLocalStream: (stream: MediaStream | null) => void;
  setRemoteStream: (stream: MediaStream | null) => void;
  tickDuration: () => void;
  resetCall: () => void;
}

export const useCallStore = create<CallStore>((set, get) => ({
  callState: 'idle',
  callId: null,
  callType: 'video',
  isCaller: false,
  isMuted: false,
  isCameraOff: false,
  durationSec: 0,
  localStream: null,
  remoteStream: null,
  startCall: (type, isCaller, callId = `call-${Date.now()}`) =>
    set({
      callState: isCaller ? 'outgoing' : 'incoming',
      callType: type,
      isCaller,
      callId,
      durationSec: 0,
      isMuted: false,
      isCameraOff: false,
    }),
  answerCall: () => set({ callState: 'active' }),
  endCall: (_reason) => {
    const { localStream, remoteStream } = get();
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
    }
    if (remoteStream) {
      remoteStream.getTracks().forEach((t) => t.stop());
    }
    set({ callState: 'ended', localStream: null, remoteStream: null });
    setTimeout(() => {
      if (get().callState === 'ended') {
        set({ callState: 'idle', callId: null, durationSec: 0 });
      }
    }, 1500);
  },
  setCallState: (callState) => set({ callState }),
  toggleMute: () => {
    const { localStream, isMuted } = get();
    if (localStream) {
      localStream.getAudioTracks().forEach((t) => (t.enabled = isMuted));
    }
    set({ isMuted: !isMuted });
  },
  toggleCamera: () => {
    const { localStream, isCameraOff } = get();
    if (localStream) {
      localStream.getVideoTracks().forEach((t) => (t.enabled = isCameraOff));
    }
    set({ isCameraOff: !isCameraOff });
  },
  setLocalStream: (stream) => set({ localStream: stream }),
  setRemoteStream: (stream) => set({ remoteStream: stream }),
  tickDuration: () => set((s) => ({ durationSec: s.durationSec + 1 })),
  resetCall: () =>
    set({
      callState: 'idle',
      callId: null,
      durationSec: 0,
      localStream: null,
      remoteStream: null,
    }),
}));

// Realtime Presence & Partner Activity Store
interface PresenceStore {
  isPartnerOnline: boolean;
  partnerTyping: boolean;
  partnerLastSeen: number | null;
  partnerHeartbeatAt: number | null;
  partnerRecording: boolean;
  partnerFocusing: string | null;
  lastPartnerActivity: string | null;
  setPartnerOnline: (online: boolean) => void;
  setPartnerTyping: (typing: boolean) => void;
  setPartnerPresence: (online: boolean, lastSeen?: number) => void;
  setPartnerRecording: (recording: boolean) => void;
  setPartnerFocusing: (focus: string | null) => void;
  setLastPartnerActivity: (msg: string) => void;
}

export const usePresenceStore = create<PresenceStore>((set) => ({
  isPartnerOnline: true,
  partnerTyping: false,
  partnerLastSeen: null,
  partnerHeartbeatAt: null,
  partnerRecording: false,
  partnerFocusing: null,
  lastPartnerActivity: null,
  setPartnerOnline: (online) => set({ isPartnerOnline: online }),
  setPartnerTyping: (typing) => set({ partnerTyping: typing }),
  setPartnerPresence: (online, lastSeen = Date.now()) =>
    set({
      isPartnerOnline: online,
      partnerLastSeen: online ? null : lastSeen,
      partnerHeartbeatAt: online ? Date.now() : null,
    }),
  setPartnerRecording: (recording) => set({ partnerRecording: recording }),
  setPartnerFocusing: (focus) => set({ partnerFocusing: focus }),
  setLastPartnerActivity: (msg) => set({ lastPartnerActivity: msg }),
}));
