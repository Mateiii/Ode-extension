import React, { useState } from 'react';
import { Crown, LogIn, LogOut, MailCheck, User, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SupabaseUser } from '@/lib/supabase';
import { IS_STRIPE_CONFIGURED } from '@/lib/stripe';

type AuthMode = 'signin' | 'signup';

type Props = {
  user: SupabaseUser | null;
  isPremium: boolean;
  onSignIn: (email: string, password: string) => Promise<{ error: string | null }>;
  onSignUp: (email: string, password: string) => Promise<{ error: string | null }>;
  onSignOut: () => Promise<void>;
  onUpgradeClick: () => void;
  onRefreshStatus: () => Promise<void>;
};

export function AccountPanel({ user, isPremium, onSignIn, onSignUp, onSignOut, onUpgradeClick, onRefreshStatus }: Props) {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [signupDone, setSignupDone] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError('');
    setPassword('');
    setConfirmPassword('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (mode === 'signup' && password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    const result = mode === 'signin'
      ? await onSignIn(email, password)
      : await onSignUp(email, password);
    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else if (mode === 'signup') {
      setSignupDone(true);
    }
  };

  // ── Signed out ────────────────────────────────────────────────
  if (!user) {
    // Post-signup confirmation screen
    if (signupDone) {
      return (
        <section className="account-panel" aria-label="Account">
          <div className="account-intro">
            <MailCheck aria-hidden="true" className="account-intro-icon" size={30} />
            <p className="account-intro-text">
              Almost there! Check your inbox and click the confirmation link to activate your account.
            </p>
          </div>
          <button
            className="auth-mode-link"
            onClick={() => { setSignupDone(false); switchMode('signin'); }}
            type="button"
          >
            Back to sign in
          </button>
        </section>
      );
    }

    return (
      <section className="account-panel" aria-label="Account">
        <div className="account-intro">
          <User aria-hidden="true" className="account-intro-icon" size={30} />
          <p className="account-intro-text">
            {mode === 'signin'
              ? 'Sign in to back up your notes and sync your research across devices.'
              : 'Create an account to keep your research backed up and in sync.'}
          </p>
        </div>

        {/* Mode tabs */}
        <div className="auth-mode-tabs" role="tablist">
          <button
            aria-selected={mode === 'signin'}
            className={`auth-mode-tab${mode === 'signin' ? ' active' : ''}`}
            onClick={() => switchMode('signin')}
            role="tab"
            type="button"
          >
            Sign in
          </button>
          <button
            aria-selected={mode === 'signup'}
            className={`auth-mode-tab${mode === 'signup' ? ' active' : ''}`}
            onClick={() => switchMode('signup')}
            role="tab"
            type="button"
          >
            Sign up
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-label" htmlFor="auth-email">Email</label>
          <input
            autoComplete="email"
            className="auth-input"
            id="auth-email"
            onChange={(e) => setEmail(e.target.value)}
            required
            type="email"
            value={email}
          />

          <label className="auth-label" htmlFor="auth-password">Password</label>
          <input
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            className="auth-input"
            id="auth-password"
            onChange={(e) => setPassword(e.target.value)}
            required
            type="password"
            value={password}
          />

          {mode === 'signup' && (
            <>
              <label className="auth-label" htmlFor="auth-confirm-password">Confirm password</label>
              <input
                autoComplete="new-password"
                className="auth-input"
                id="auth-confirm-password"
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                type="password"
                value={confirmPassword}
              />
            </>
          )}

          {error ? <p className="auth-error" role="alert">{error}</p> : null}

          <Button className="auth-submit" disabled={loading} type="submit">
            {mode === 'signin'
              ? <LogIn aria-hidden="true" size={14} />
              : <UserPlus aria-hidden="true" size={14} />}
            {loading
              ? (mode === 'signin' ? 'Signing in…' : 'Creating account…')
              : (mode === 'signin' ? 'Sign in' : 'Create account')}
          </Button>
        </form>
      </section>
    );
  }

  // ── Signed in ─────────────────────────────────────────────────
  return (
    <section className="account-panel" aria-label="Account">
      <div className="account-user-card">
        <div className="account-user-avatar" aria-hidden="true">
          <User size={16} />
        </div>
        <div className="account-user-info">
          <span className="account-user-email">{user.email}</span>
          {isPremium ? (
            <span className="account-premium-badge">
              <Crown aria-hidden="true" size={10} />
              Øde Pro
            </span>
          ) : (
            <span className="account-free-badge">Free plan</span>
          )}
        </div>
      </div>

      {!isPremium && (
        <div className="settings-upgrade-card">
          <div className="settings-upgrade-header">
            <Crown aria-hidden="true" className="settings-upgrade-icon" size={15} />
            <strong>Unlock Cloud Sync</strong>
          </div>
          <p className="settings-upgrade-desc">
            Upgrade to Øde Pro to sync your notes and sources from any device, automatically.
          </p>
          <button
            className="settings-upgrade-cta"
            disabled={!IS_STRIPE_CONFIGURED}
            onClick={onUpgradeClick}
            title={IS_STRIPE_CONFIGURED ? undefined : 'Add WXT_STRIPE_PAYMENT_LINK to .env and rebuild'}
            type="button"
          >
            {IS_STRIPE_CONFIGURED ? 'Upgrade to Pro →' : 'Payments not configured'}
          </button>
          <button
            className="auth-mode-link"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              await onRefreshStatus();
              setRefreshing(false);
            }}
            style={{ marginTop: '8px', display: 'block', width: '100%', textAlign: 'center' }}
            type="button"
          >
            {refreshing ? 'Checking…' : 'Already paid? Refresh plan status'}
          </button>
        </div>
      )}

      {isPremium && (
        <div className="account-sync-status">
          <span className="account-sync-dot" aria-hidden="true" />
          Cloud sync active
        </div>
      )}

      <button className="auth-signout-btn" onClick={onSignOut} type="button">
        <LogOut aria-hidden="true" size={14} />
        Sign out
      </button>
    </section>
  );
}
