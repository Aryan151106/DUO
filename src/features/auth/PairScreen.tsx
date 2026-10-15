import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../lib/store';
import { createCoupleWithCode, joinCoupleWithCode, onCoupleChange } from '../../lib/firestore';
import { soundEffects } from '../../lib/sound';
import { signOut } from '../../lib/firebase';
import confetti from 'canvas-confetti';
import {
  Copy,
  Check,
  Share2,
  ArrowRight,
  Heart,
  Sparkles,
  LogOut,
  ShieldCheck,
} from 'lucide-react';

interface PairScreenProps {
  userId?: string;
  userName?: string;
  initialCode?: string | null;
  existingCoupleId?: string | null;
  onCodeCreated?: (coupleId: string, inviteCode: string) => void;
  onPaired?: (coupleId?: string) => void;
  onSignOut?: () => void;
}

export const PairScreen: React.FC<PairScreenProps> = ({
  userId,
  userName: propUserName,
  initialCode,
  existingCoupleId,
  onCodeCreated,
  onPaired,
  onSignOut,
}) => {
  const { currentUser, setCouple, couple } = useAuthStore();
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [createdCode, setCreatedCode] = useState<string | null>(initialCode || null);
  const [inputCode, setInputCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [partnerJoined, setPartnerJoined] = useState(false);

  const userName = propUserName || currentUser?.displayName || 'Partner';

  // Listen for partner joining if we created a space
  useEffect(() => {
    const activeCoupleId = couple?.id || existingCoupleId;
    if (!activeCoupleId) return;
    const unsub = onCoupleChange(activeCoupleId, (data: any) => {
      if (data && (data.partner2Id || (data.members && data.members.length >= 2))) {
        setPartnerJoined(true);
        soundEffects.playSuccess();
        confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
        setTimeout(() => {
          onPaired?.(activeCoupleId);
        }, 1800);
      }
    });
    return () => unsub();
  }, [couple?.id, existingCoupleId, onPaired]);

  const handleCreateSpace = async () => {
    try {
      setLoading(true);
      setError(null);
      soundEffects.playPop();

      const newCouple = await createCoupleWithCode(userId || currentUser.id);
      setCouple(newCouple);
      setCreatedCode(newCouple.inviteCode);
      onCodeCreated?.(newCouple.id, newCouple.inviteCode);
    } catch (err: any) {
      console.error('Failed to create space:', err);
      setError(err?.message || 'Could not create private space. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinSpace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputCode.trim()) return;

    try {
      setLoading(true);
      setError(null);
      soundEffects.playPop();

      const cleanCode = inputCode.trim().toUpperCase();
      const partnerUid = userId || currentUser?.id || '';
      const pairedCouple = await joinCoupleWithCode(cleanCode, partnerUid);

      setCouple(pairedCouple);
      setPartnerJoined(true);
      soundEffects.playSuccess();
      confetti({ particleCount: 100, spread: 80, origin: { y: 0.6 } });

      setTimeout(() => {
        onPaired?.(pairedCouple.id);
      }, 1800);
    } catch (err: any) {
      console.error('Failed to join space:', err);
      setError(err?.message || 'Invalid or expired invite code. Double check with your partner.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = () => {
    if (!createdCode) return;
    navigator.clipboard.writeText(createdCode);
    setCopied(true);
    soundEffects.playPop();
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = () => {
    if (!createdCode) return;
    soundEffects.playPop();
    const shareText = `Join our AV space. Here is the access code: ${createdCode}`;
    if (navigator.share) {
      navigator.share({
        title: 'Connect on AV',
        text: shareText,
        url: window.location.origin,
      }).catch(() => {});
    } else {
      handleCopyCode();
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] flex flex-col justify-center items-center px-4 py-12 relative overflow-hidden">
      <div className="w-full max-w-md relative z-10 space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-[var(--surface)] border-3 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)] mb-3 p-3.5 transform rotate-2">
            <img src="/logo.svg" alt="AV" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-3xl font-display font-bold tracking-tight text-[var(--text)]">
            Connect AV
          </h1>
          <p className="font-body text-sm text-[var(--text-muted)] mt-1.5">
            Hey {userName} 👋 AV is private to Aryan & Vidhi. Connect to start!
          </p>
        </div>

        {/* Chunky Card */}
        <div className="bg-[var(--surface)] border-3 border-[var(--border)] rounded-3xl p-6 sm:p-7 shadow-[0_4px_0_var(--shadow-color)] relative">
          {/* Top Decorative Color Strip */}
          <div className="absolute top-0 left-0 right-0 h-2 bg-[var(--partner-a)]" />

          {partnerJoined ? (
            <div className="text-center py-8 space-y-4 animate-in fade-in zoom-in duration-300">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-[var(--partner-a)]/20 border-3 border-[var(--border)] text-[var(--partner-a)] mb-2 animate-bounce shadow-[0_2px_0_var(--shadow-color)]">
                <Heart className="w-10 h-10 fill-current" />
              </div>
              <h3 className="text-2xl font-display font-bold text-[var(--text)]">Aryan & Vidhi Connected!</h3>
              <p className="font-body text-sm text-[var(--text-muted)]">
                Opening your private shared world right now...
              </p>
            </div>
          ) : (
            <>
              {/* Tab buttons */}
              <div className="grid grid-cols-2 p-1.5 bg-[var(--surface-2)] rounded-2xl border-2 border-[var(--border)] mb-6 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setTab('create');
                    setError(null);
                  }}
                  className={`py-2.5 px-3 font-chunky text-xs font-bold rounded-xl transition-all cursor-pointer ${
                    tab === 'create'
                      ? 'bg-[var(--partner-a)] text-white shadow-[0_2px_0_var(--shadow-color)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  Create New Space
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTab('join');
                    setError(null);
                  }}
                  className={`py-2.5 px-3 font-chunky text-xs font-bold rounded-xl transition-all cursor-pointer ${
                    tab === 'join'
                      ? 'bg-[var(--partner-a)] text-white shadow-[0_2px_0_var(--shadow-color)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  Enter Access Code
                </button>
              </div>

              {tab === 'create' ? (
                <div className="space-y-5">
                  {!createdCode ? (
                    <div className="text-center py-3 space-y-4">
                      <p className="font-body text-xs sm:text-sm text-[var(--text-muted)] leading-relaxed">
                        Generate an access code and share it between Aryan & Vidhi. As soon as it's entered on the other device, you'll be connected!
                      </p>
                      <button
                        type="button"
                        onClick={handleCreateSpace}
                        disabled={loading}
                        className="w-full py-3.5 px-4 bg-[var(--partner-a)] hover:opacity-90 text-white font-chunky font-bold text-base rounded-2xl border-2 border-[var(--border)] shadow-[0_3px_0_var(--shadow-color)] flex items-center justify-center gap-2 transition-all active:translate-y-1 active:shadow-none disabled:opacity-50 cursor-pointer"
                      >
                        <Sparkles className="w-5 h-5 text-[var(--accent)]" />
                        <span>{loading ? 'Creating...' : 'Generate Secret Code 🔑'}</span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4 text-center">
                      <div className="p-5 bg-[var(--surface-2)] border-3 border-dashed border-[var(--border)] rounded-3xl relative">
                        <span className="font-ui text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-1">
                          Your Secret Pair Code
                        </span>
                        <div className="text-4xl font-numeric font-bold tracking-widest text-[var(--text)] py-1 tabular-nums">
                          {createdCode}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={handleCopyCode}
                          className="flex items-center justify-center gap-2 py-3 px-3 bg-[var(--surface)] hover:bg-[var(--surface-2)] border-2 border-[var(--border)] text-[var(--text)] rounded-2xl font-chunky text-xs font-bold shadow-[0_2px_0_var(--shadow-color)] active:translate-y-1 active:shadow-none transition-all cursor-pointer"
                        >
                          {copied ? (
                            <>
                              <Check className="w-4 h-4 text-[var(--success)]" />
                              <span>Copied! 🎉</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-4 h-4" />
                              <span>Copy Code</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={handleShare}
                          className="flex items-center justify-center gap-2 py-3 px-3 bg-[var(--accent)] hover:opacity-90 border-2 border-[var(--border)] text-[var(--text)] rounded-2xl font-chunky text-xs font-bold shadow-[0_2px_0_var(--shadow-color)] active:translate-y-1 active:shadow-none transition-all cursor-pointer"
                        >
                          <Share2 className="w-4 h-4" />
                          <span>Share Code</span>
                        </button>
                      </div>

                      <div className="flex items-center justify-center gap-2 pt-2 text-xs font-ui font-semibold text-[var(--partner-a)] animate-pulse">
                        <div className="w-2.5 h-2.5 rounded-full bg-[var(--partner-a)]" />
                        <span>Waiting for Vidhi / Aryan to enter the code...</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <form onSubmit={handleJoinSpace} className="space-y-4">
                  <div>
                    <label className="block font-ui font-semibold text-xs text-[var(--text)] mb-1.5">
                      6-Digit Invite Code
                    </label>
                    <input
                      type="text"
                      maxLength={8}
                      required
                      value={inputCode}
                      onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                      placeholder="e.g. K7M2QX"
                      className="w-full text-center text-2xl font-numeric font-bold tracking-widest py-3 px-4 bg-[var(--surface-2)] border-2 border-[var(--border)] rounded-2xl text-[var(--text)] placeholder-[var(--text-muted)]/40 focus:outline-none uppercase tabular-nums"
                    />
                  </div>

                  {error && (
                    <div className="p-3 bg-[var(--urgent)]/10 border-2 border-[var(--urgent)]/30 rounded-2xl font-ui text-xs font-medium text-[var(--urgent)]">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading || !inputCode.trim()}
                    className="w-full py-3.5 px-4 bg-[var(--partner-a)] hover:opacity-90 text-white font-chunky font-bold text-base rounded-2xl border-2 border-[var(--border)] shadow-[0_3px_0_var(--shadow-color)] flex items-center justify-center gap-2 transition-all active:translate-y-1 active:shadow-none disabled:opacity-50 cursor-pointer"
                  >
                    <span>{loading ? 'Connecting...' : 'Connect to Space ✨'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>
              )}
            </>
          )}

          {/* Sign Out option */}
          <div className="mt-6 pt-4 border-t-2 border-[var(--border)] text-center">
            <button
              type="button"
              onClick={async () => {
                await signOut();
                onSignOut?.();
              }}
              className="inline-flex items-center gap-1.5 font-ui text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign out or switch account</span>
            </button>
          </div>
        </div>

        {/* Security badge */}
        <div className="flex items-center justify-center gap-2 text-xs font-ui font-semibold text-[var(--text-muted)]">
          <ShieldCheck className="w-4 h-4 text-[var(--success)]" />
          <span>Strictly Aryan & Vidhi. Private, encrypted, cozy.</span>
        </div>
      </div>
    </div>
  );
};
