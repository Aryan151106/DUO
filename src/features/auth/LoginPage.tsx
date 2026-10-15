import React, { useState } from 'react';
import { Sparkles, Mail, Lock, User, ArrowRight, ShieldCheck, UsersRound } from 'lucide-react';
import { signInWithGoogle, signInWithEmail, signUpWithEmail } from '../../lib/firebase';
import { soundEffects } from '../../lib/sound';

interface LoginPageProps {
  onSuccess?: () => void;
  onEnterDemo?: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onSuccess, onEnterDemo }) => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      setError(null);
      soundEffects.playPop();
      await signInWithGoogle();
      onSuccess?.();
    } catch (err: any) {
      console.error('Google Sign-in failed:', err);
      if (err?.code === 'auth/configuration-not-found' || err?.code === 'auth/operation-not-allowed') {
        setError('Google Sign-In needs to be enabled in Firebase Console. Go to Authentication → Sign-in method → Enable Google.');
      } else if (err?.code === 'auth/api-key-not-valid' || err?.message?.includes('api-key')) {
        setError('Firebase project is being configured. You can use Demo Mode below while setup completes!');
      } else if (err?.code === 'auth/popup-closed-by-user') {
        setError('Sign-in popup was closed before completing. Please try again.');
      } else {
        setError(err?.message || 'Google sign-in could not be completed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please fill in both email and password.');
      return;
    }
    if (isSignUp && !name.trim()) {
      setError('Please provide your name.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      soundEffects.playPop();
      if (isSignUp) {
        await signUpWithEmail(email, password, name.trim());
      } else {
        await signInWithEmail(email, password);
      }
      onSuccess?.();
    } catch (err: any) {
      console.error('Email auth failed:', err);
      if (err?.code === 'auth/api-key-not-valid' || err?.message?.includes('api-key')) {
        setError('Firebase project is being configured. You can use Demo Mode below while setup completes!');
      } else if (err?.code === 'auth/wrong-password' || err?.code === 'auth/user-not-found' || err?.code === 'auth/invalid-credential') {
        setError('Invalid email or password. Please verify your credentials.');
      } else if (err?.code === 'auth/email-already-in-use') {
        setError('An account with this email already exists. Try logging in instead.');
      } else {
        setError(err?.message || 'Authentication failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] flex flex-col justify-center items-center px-4 py-12 relative overflow-hidden">
      {/* Decorative Stamp */}
      <div className="absolute top-6 right-8 rotate-3 hidden sm:block">
        <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[var(--surface)] border-2 border-[var(--border)] text-[var(--text)] font-chunky text-xs rounded-full shadow-[0_2px_0_var(--shadow-color)]">
          <img src="/logo.svg" alt="AV" className="w-4 h-4 object-contain inline-block" />
          Aryan & Vidhi 🎈
        </span>
      </div>

      <div className="w-full max-w-xl relative z-10 space-y-8">
        {/* Playful Brand Header */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-[var(--surface)] border-3 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)] mb-4 p-3.5 transform -rotate-2 hover:rotate-0 transition-transform">
            <img src="/logo.svg" alt="AV" className="w-full h-full object-contain" />
          </div>

          <h1 className="text-5xl font-logo tracking-tight text-[var(--text)]">
            AV
          </h1>
          <p className="font-romantic text-xl text-[var(--text-muted)] mt-2">
            Aryan & Vidhi's private shared space
          </p>
        </div>

        {/* Authentication card */}
        <div className="bg-[var(--surface)] border-3 border-[var(--border)] rounded-3xl p-6 sm:p-8 shadow-[0_4px_0_var(--shadow-color)] relative overflow-hidden">
          {/* Top Decorative Color Strip */}
          <div className="absolute top-0 left-0 right-0 h-2.5 bg-[var(--partner-a)]" />

          {/* Google Sign In Button */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 py-3.5 px-4 bg-[var(--surface-2)] hover:bg-[var(--accent)]/20 text-[var(--text)] border-2 border-[var(--border)] rounded-2xl shadow-[0_3px_0_var(--shadow-color)] font-chunky font-bold text-base transition-all active:translate-y-1 active:shadow-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>Continue with Google</span>
          </button>

          {/* Playful Divider */}
          <div className="flex items-center my-6">
            <div className="flex-1 border-t-2 border-[var(--border)]" />
            <span className="px-3 text-xs uppercase tracking-wider font-chunky text-[var(--text-muted)] font-bold">
              or with email ✨
            </span>
            <div className="flex-1 border-t-2 border-[var(--border)]" />
          </div>

          {/* Form */}
          <form onSubmit={handleEmailAuth} className="space-y-4">
            {isSignUp && (
              <div>
                <label className="block font-ui font-semibold text-xs text-[var(--text)] mb-1.5">
                  Your Nickname
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Honey Bunny, Alex, Sam..."
                    className="w-full pl-10 pr-4 py-3 bg-[var(--surface-2)] border-2 border-[var(--border)] rounded-2xl text-base font-body text-[var(--text)] placeholder-[var(--text-muted)]/60 focus:outline-none focus:border-[var(--accent)] focus:ring-0 transition-all"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block font-ui font-semibold text-xs text-[var(--text)] mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full pl-10 pr-4 py-3 bg-[var(--surface-2)] border-2 border-[var(--border)] rounded-2xl text-base font-body text-[var(--text)] placeholder-[var(--text-muted)]/60 focus:outline-none focus:border-[var(--accent)] focus:ring-0 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block font-ui font-semibold text-xs text-[var(--text)] mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-4 py-3 bg-[var(--surface-2)] border-2 border-[var(--border)] rounded-2xl text-base font-body text-[var(--text)] placeholder-[var(--text-muted)]/60 focus:outline-none focus:border-[var(--accent)] focus:ring-0 transition-all"
                />
              </div>
            </div>

            {error && (
              <div className="p-3 bg-[var(--urgent)]/10 border-2 border-[var(--urgent)]/30 rounded-2xl text-xs font-ui font-medium text-[var(--urgent)] flex items-start gap-2">
                <span className="shrink-0 text-base">⚠️</span>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 bg-[var(--partner-a)] hover:opacity-90 text-white font-chunky font-bold text-base rounded-2xl border-2 border-[var(--border)] shadow-[0_3px_0_var(--shadow-color)] flex items-center justify-center gap-2 transition-all active:translate-y-1 active:shadow-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <span>{loading ? 'Opening AV...' : isSignUp ? 'Create Space 🚀' : 'Step Inside'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Toggle Sign Up / Sign In */}
          <div className="mt-5 text-center">
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError(null);
              }}
              className="font-ui font-semibold text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
            >
              {isSignUp ? (
                <>
                  Already registered? <span className="text-[var(--partner-a)] underline">Sign in</span>
                </>
              ) : (
                <>
                  New here? <span className="text-[var(--partner-a)] underline">Create an account</span>
                </>
              )}
            </button>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] p-3 text-left">
              <div className="flex items-center gap-2 text-[var(--text)] font-chunky text-sm font-bold">
                <UsersRound className="w-4 h-4 text-[var(--partner-a)]" />
                <span>Exclusively AV</span>
              </div>
              <p className="mt-1 text-xs font-body text-[var(--text-muted)]">
                A private shared sanctuary designed specifically for Aryan & Vidhi.
              </p>
            </div>
            <div className="rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] p-3 text-left">
              <div className="flex items-center gap-2 text-[var(--text)] font-chunky text-sm font-bold">
                <ShieldCheck className="w-4 h-4 text-[var(--success)]" />
                <span>Private by design</span>
              </div>
              <p className="mt-1 text-xs font-body text-[var(--text-muted)]">
                Pairing codes are shared only between Aryan & Vidhi.
              </p>
            </div>
          </div>

          {/* Demo fallback */}
          {onEnterDemo && (
            <div className="mt-6 pt-5 border-t-2 border-[var(--border)] text-center">
              <button
                type="button"
                onClick={onEnterDemo}
                className="inline-flex items-center gap-2 font-chunky text-xs font-bold text-[var(--text)] hover:bg-[var(--accent)]/30 transition-all px-4 py-2 rounded-full bg-[var(--surface-2)] border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-1 active:shadow-none cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-[var(--accent)]" />
                <span>Explore the safe demo preview</span>
              </button>
              <p className="mt-2 text-[11px] font-ui text-[var(--text-muted)]">
                Uses temporary sample data. It cannot access or change real AV space.
              </p>
            </div>
          )}
        </div>

        {/* Playful Security badge */}
        <div className="flex items-center justify-center gap-2 text-xs font-ui font-semibold text-[var(--text-muted)]">
          <ShieldCheck className="w-4 h-4 text-[var(--success)]" />
          <span>Exclusively Aryan & Vidhi. Private, encrypted, cozy.</span>
        </div>
      </div>
    </div>
  );
};
