import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Shell } from './app/Shell';
import { LoginPage } from './features/auth/LoginPage';
import { PairScreen } from './features/auth/PairScreen';
import { WidgetView } from './features/widget/WidgetView';
import {
  useAuthStore,
  DEMO_ALEX,
  DEMO_SAM,
  INITIAL_USER,
  INITIAL_PARTNER,
} from './lib/store';
import { startRealtimeRouter } from './lib/realtime';
import { onAuthChange, getProfile, db, checkRedirectAuth } from './lib/firebase';
import { usePartnerProfile, useMessageDeliverySync, usePartnerTyping, sendMessage, forceFirestoreReconnect } from './lib/firestore';
import { useNotificationStore, clearAndroidAndPwaBadges } from './lib/notifications';
import { initOneSignal } from './lib/oneSignal';
import { soundEngine } from './lib/sounds';
import { doc, getDoc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { ThemeProvider } from './lib/theme';
import { AvLoadingScreen } from './components/AvLoadingScreen';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 5,
      refetchOnWindowFocus: false,
    },
  },
});

function AppInner() {
  const {
    couple,
    currentUser,
    partnerUser,
    setCouple,
    setCurrentUser,
    setPartnerUser,
    isDemoMode,
    setIsDemoMode,
  } = useAuthStore();

  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [coupleInfo, setCoupleInfo] = useState<{ inviteCode: string; locked: boolean; members: string[] } | null>(null);

  // Check if opened as standalone desktop/mobile widget
  const isWidgetMode = typeof window !== 'undefined' && window.location.search.includes('widget=true');

  useEffect(() => {
    // If URL explicitly requests demo mode
    if (window.location.search.includes('demo=true')) {
      setIsDemoMode(true);
      setCurrentUser(DEMO_ALEX);
      setPartnerUser(DEMO_SAM);
      setCouple({
        id: 'couple-duo-main',
        inviteCode: 'DEMO-ONLY',
        locked: true,
        createdAt: new Date().toISOString(),
      });
    }
  }, [setIsDemoMode, setCouple, setCurrentUser, setPartnerUser]);

  useEffect(() => {
    checkRedirectAuth().catch((err) => console.warn('[Auth] Redirect check error:', err));
  }, []);

  // Listen for Firebase auth state changes
  useEffect(() => {
    const unsub = onAuthChange(async (user) => {
      setFirebaseUser(user);
      if (user) {
        setIsDemoMode(false);
        const profile = await getProfile(user.uid);
        if (profile) {
          setUserProfile(profile);
          setCurrentUser({
            id: profile.uid,
            displayName: profile.displayName || user.displayName || 'Aryan',
            realDisplayName: profile.displayName || user.displayName || 'Aryan',
            avatarUrl: profile.avatarUrl || user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`,
            theme: (profile.theme as any) || 'hazard',
            moodStatus: profile.moodStatus || 'Welcome to AV ✨',
          });

          if (profile.coupleId) {
            // Check couple doc in Firestore
            const cSnap = await getDoc(doc(db, 'couples', profile.coupleId));
            if (cSnap.exists()) {
              const cData = cSnap.data();
              const isLocked = Boolean(cData.locked || (cData.members && cData.members.length >= 2));
              setCoupleInfo({
                inviteCode: cData.inviteCode,
                locked: isLocked,
                members: cData.members || [],
              });
              setCouple({
                id: profile.coupleId,
                inviteCode: cData.inviteCode,
                locked: isLocked,
                createdAt: new Date().toISOString(),
                nicknames: cData.nicknames || {},
              });
            } else {
              setCouple(null);
              setCoupleInfo(null);
            }
          } else {
            setCouple(null);
            setCoupleInfo(null);
          }
        } else {
          // Fresh profile
          const initialDisplayName = user.displayName || (user.email ? user.email.split('@')[0] : 'Partner');
          const initialAvatar = user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`;
          setUserProfile({ uid: user.uid, coupleId: null });
          setCurrentUser({
            id: user.uid,
            displayName: initialDisplayName,
            realDisplayName: initialDisplayName,
            avatarUrl: initialAvatar,
            theme: 'hazard',
            moodStatus: 'Welcome to AV ✨',
          });
          setDoc(
            doc(db, 'profiles', user.uid),
            {
              uid: user.uid,
              displayName: initialDisplayName,
              avatarUrl: initialAvatar,
              coupleId: null,
              createdAt: serverTimestamp(),
            },
            { merge: true }
          ).catch((e: any) => console.warn('[Auth] Error writing fresh profile doc:', e));
          setCouple(null);
          setCoupleInfo(null);
        }
      } else {
        import('./lib/oneSignal').then(({ logoutOneSignal }) => logoutOneSignal().catch(() => {}));
        if (!isDemoMode) {
          setCouple(null);
          setCoupleInfo(null);
        }
      }
      setAuthLoading(false);
    });

    return () => unsub();
  }, [setCurrentUser, setCouple, isDemoMode, setIsDemoMode]);

  // If user has coupleId, watch couple doc in real-time
  useEffect(() => {
    if (!userProfile?.coupleId || userProfile.coupleId.startsWith('demo')) return;

    const unsub = onSnapshot(
      doc(db, 'couples', userProfile.coupleId),
      (snap) => {
        if (snap.exists()) {
          const cData = snap.data();
          const isLocked = Boolean(cData.locked || (cData.members && cData.members.length >= 2));
          setCoupleInfo({
            inviteCode: cData.inviteCode,
            locked: isLocked,
            members: cData.members || [],
          });
          setCouple({
            id: userProfile.coupleId,
            inviteCode: cData.inviteCode,
            locked: isLocked,
            createdAt: new Date().toISOString(),
            nicknames: cData.nicknames || {},
          });
        }
      },
      (error) => {
        console.warn('[App] Couple listener error:', error);
      }
    );

    return () => unsub();
  }, [userProfile?.coupleId, setCouple]);

  // Immediate partner UID fallback from couple members
  useEffect(() => {
    if (coupleInfo?.members?.length && currentUser?.id) {
      const pId = coupleInfo.members.find((m) => m !== currentUser.id);
      if (pId && (!partnerUser.id || partnerUser.id !== pId)) {
        setPartnerUser({ id: pId });
      }
    }
  }, [coupleInfo, currentUser?.id, partnerUser.id, setPartnerUser]);

  // Live partner sync from Firestore
  const livePartner = usePartnerProfile(
    !isDemoMode ? couple?.id || null : null,
    currentUser.id
  );

  useEffect(() => {
    if (livePartner) {
      setPartnerUser({
        id: livePartner.uid,
        displayName: couple?.nicknames?.[livePartner.uid] || livePartner.displayName || 'Vidhi',
        nickname: couple?.nicknames?.[livePartner.uid] || '',
        realDisplayName: livePartner.displayName || 'Vidhi',
        avatarUrl:
          livePartner.avatarUrl ||
          `https://api.dicebear.com/7.x/avataaars/svg?seed=${livePartner.uid}`,
        timezone:
          livePartner.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        theme: livePartner.theme || 'midnight',
        moodStatus: livePartner.moodStatus || 'Online ✨',
        quietHoursStart: livePartner.quietHoursStart || '23:00',
        quietHoursEnd: livePartner.quietHoursEnd || '07:00',
      });
    }
  }, [couple?.nicknames, livePartner, setPartnerUser]);

  useEffect(() => {
    const nickname = couple?.nicknames?.[currentUser.id];
    if (nickname !== undefined) {
      setCurrentUser({
        nickname,
        displayName: nickname || currentUser.realDisplayName || currentUser.displayName,
      });
    }
  }, [couple?.nicknames, currentUser.id, currentUser.realDisplayName, currentUser.displayName, setCurrentUser]);

  // Real-time delivery sync: marks messages from partner as delivered when app is open
  useMessageDeliverySync(!isDemoMode ? couple?.id || null : null, currentUser?.id || null);
  // Real-time typing sync: listens to partner's cross-device typing status
  usePartnerTyping(!isDemoMode ? couple?.id || null : null, !isDemoMode ? partnerUser?.id || null : null);

  // Initialize OneSignal background push immediately as soon as user is authenticated
  useEffect(() => {
    if (!currentUser?.id || isDemoMode) return;
    initOneSignal(currentUser.id).catch(() => {});
  }, [currentUser?.id, isDemoMode]);

  // Initialize notifications collection listener once paired with reliable cleanup
  useEffect(() => {
    if (isDemoMode || !couple?.id || !currentUser?.id) {
      useNotificationStore.getState().cleanupNotifications();
      return;
    }
    const unsub = useNotificationStore.getState().initNotifications(currentUser.id, couple.id);
    return () => {
      if (typeof unsub === 'function') {
        unsub();
      }
      useNotificationStore.getState().cleanupNotifications();
    };
  }, [couple?.id, currentUser?.id, isDemoMode]);

  // Clear mobile PWA app badge on foreground wakeup; only reconnect Firestore on network recovery
  useEffect(() => {
    const handleClearBadges = () => {
      clearAndroidAndPwaBadges();
    };

    const handleNetworkOnline = () => {
      clearAndroidAndPwaBadges();
      forceFirestoreReconnect();
    };

    handleClearBadges();
    window.addEventListener('focus', handleClearBadges);
    window.addEventListener('online', handleNetworkOnline);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        handleClearBadges();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('focus', handleClearBadges);
      window.removeEventListener('online', handleNetworkOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  useEffect(() => {
    if (isDemoMode || !couple?.id) return;
    const unsubscribe = startRealtimeRouter(couple.id, queryClient);

    return () => {
      unsubscribe();
    };
  }, [couple?.id, isDemoMode]);

  // Handle WhatsApp-style inline notification replies from notification shade or action banner
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const handleSwMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'FOCUS_REPLY_INPUT') {
        useAuthStore.getState().setTab('chat');
        return;
      }

      if (event.data?.type === 'NOTIFICATION_REPLY_ACTION') {
        const { replyText, coupleId: targetCoupleId } = event.data;
        const activeCid = targetCoupleId || couple?.id;
        if (replyText && activeCid && currentUser?.id) {
          try {
            await sendMessage(activeCid, {
              senderId: currentUser.id,
              content: replyText,
              messageType: 'text',
              status: 'sent',
            });
            soundEngine.play('msg-pop');
          } catch (err) {
            console.warn('[Notification Reply] Error sending reply:', err);
          }
        }
      }
    };

    navigator.serviceWorker.addEventListener('message', handleSwMessage);

    // Also check if app was opened with ?replyText=... from notification click
    if (typeof window !== 'undefined' && window.location.search.includes('replyText=')) {
      const urlParams = new URLSearchParams(window.location.search);
      const replyText = urlParams.get('replyText');
      const activeCid = urlParams.get('coupleId') || couple?.id;
      if (replyText && activeCid && currentUser?.id) {
        sendMessage(activeCid, {
          senderId: currentUser.id,
          content: replyText,
          messageType: 'text',
          status: 'sent',
        }).then(() => {
          soundEngine.play('msg-pop');
          // Clean up the URL
          urlParams.delete('replyText');
          urlParams.delete('coupleId');
          const newUrl = `${window.location.pathname}${urlParams.toString() ? `?${urlParams.toString()}` : ''}`;
          window.history.replaceState({}, '', newUrl);
        }).catch((e) => console.warn('Failed to send startup reply:', e));
      }
    }

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage);
    };
  }, [couple?.id, currentUser?.id]);

  // Standalone desktop/mobile widget
  if (isWidgetMode) {
    return (
      <QueryClientProvider client={queryClient}>
        <WidgetView isPopout={true} />
      </QueryClientProvider>
    );
  }

  // Loading state while checking credentials
  if (authLoading && !isDemoMode) {
    return <AvLoadingScreen />;
  }

  // Not logged in and not in demo mode -> Show Login Screen!
  if (!firebaseUser && !isDemoMode) {
    return (
      <QueryClientProvider client={queryClient}>
        <LoginPage
          onSuccess={() => setIsDemoMode(false)}
          onEnterDemo={() => {
            setIsDemoMode(true);
            setCurrentUser(DEMO_ALEX);
            setPartnerUser(DEMO_SAM);
            setCouple({
              id: 'couple-duo-main',
              inviteCode: 'DEMO-ONLY',
              locked: true,
              createdAt: new Date().toISOString(),
            });
          }}
        />
      </QueryClientProvider>
    );
  }

  // User is logged in, but not yet paired with partner (or still waiting for partner to enter code)
  const isWaitingForPartner = !coupleInfo || !coupleInfo.locked;

  if (firebaseUser && !isDemoMode && isWaitingForPartner) {
    return (
      <QueryClientProvider client={queryClient}>
        <PairScreen
          userId={firebaseUser.uid}
          userName={firebaseUser.displayName || userProfile?.displayName || 'Aryan'}
          initialCode={coupleInfo?.inviteCode || null}
          existingCoupleId={userProfile?.coupleId || null}
          onCodeCreated={(coupleId: string, inviteCode: string) => {
            setUserProfile((prev: any) => ({ ...prev, coupleId }));
            setCoupleInfo({
              inviteCode,
              locked: false,
              members: [firebaseUser.uid],
            });
            setCouple({
              id: coupleId,
              inviteCode,
              locked: false,
              createdAt: new Date().toISOString(),
            });
          }}
          onPaired={(coupleId?: string) => {
            if (coupleId) {
              setUserProfile((prev: any) => ({ ...prev, coupleId }));
            }
          }}
          onSignOut={() => {
            setFirebaseUser(null);
            setUserProfile(null);
            setCouple(null);
            setCoupleInfo(null);
            setCurrentUser(INITIAL_USER);
            setPartnerUser(INITIAL_PARTNER);
            setIsDemoMode(false);
          }}
        />
      </QueryClientProvider>
    );
  }

  // User is logged in & paired with partner, OR user chose Demo Mode
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}

export default App;
