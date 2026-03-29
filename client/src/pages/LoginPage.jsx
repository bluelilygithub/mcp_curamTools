/**
 * LoginPage — handles three modes:
 *   default  — email/password login
 *   register — accept invitation (/invite/:token)
 *   reset    — set new password (/reset-password/:token)
 */
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import useAuthStore from '../stores/authStore';
import Button from '../components/ui/Button';
import InlineBanner from '../components/ui/InlineBanner';

export default function LoginPage({ mode = 'default' }) {
  const navigate = useNavigate();
  const { token } = useParams();
  const { setAuth, token: authToken } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [resetSent, setResetSent] = useState(false);

  // Redirect if already authenticated
  useEffect(() => {
    if (authToken) navigate('/dashboard', { replace: true });
  }, [authToken, navigate]);

  // Pre-fill email from invitation token
  useEffect(() => {
    if (mode === 'register' && token) {
      fetch(`/api/auth/invite/${token}`)
        .then((r) => r.json())
        .then((d) => { if (d.email) setEmail(d.email); })
        .catch(() => {});
    }
  }, [mode, token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      let endpoint = '/api/auth/login';
      let body = { email, password };

      if (mode === 'register') {
        if (password !== confirmPassword) {
          setError('Passwords do not match.');
          return;
        }
        endpoint = '/api/auth/register';
        body = { token, password };
      } else if (mode === 'reset') {
        if (password !== confirmPassword) {
          setError('Passwords do not match.');
          return;
        }
        endpoint = '/api/auth/reset-password';
        body = { token, password };
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong.');
        return;
      }

      if (mode === 'reset') {
        setSuccess('Password reset successfully. You can now log in.');
        setTimeout(() => navigate('/login'), 2000);
        return;
      }

      // Login or register — set auth and navigate
      setAuth(data.token, data.user);
      navigate('/dashboard', { replace: true });
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    if (!email) { setError('Enter your email address first.'); return; }
    setLoading(true);
    await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    setLoading(false);
    setResetSent(true);
  }

  const title = mode === 'register' ? 'Set your password' : mode === 'reset' ? 'Reset your password' : 'Sign in';
  const buttonLabel = mode === 'register' ? 'Create account' : mode === 'reset' ? 'Reset password' : 'Sign in';

  if (resetSent) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--color-bg)' }}>
        <div className="w-full max-w-sm rounded-2xl border p-8 space-y-4 text-center" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className="text-4xl">✉️</div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Check your email</h2>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            If <strong>{email}</strong> has an account, a password reset link has been sent. Check your inbox and spam folder.
          </p>
          <button
            onClick={() => setResetSent(false)}
            className="text-xs hover:opacity-70 transition-all"
            style={{ color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'var(--color-bg)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border p-8 space-y-6"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            MCP CuramTools
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>{title}</p>
        </div>

        {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} />}
        {success && <InlineBanner type="neutral" message={success} />}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'default' && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                autoComplete="email"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 pr-10 rounded-xl border text-sm outline-none"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                autoComplete={mode === 'default' ? 'current-password' : 'new-password'}
                minLength={mode !== 'default' ? 8 : undefined}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 hover:opacity-70 transition-all"
                style={{ color: 'var(--color-muted)' }}
                tabIndex={-1}
              >
                {showPassword ? '👁' : '👁'}
              </button>
            </div>
          </div>

          {(mode === 'register' || mode === 'reset') && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
                Confirm Password
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                autoComplete="new-password"
                minLength={8}
              />
            </div>
          )}

          <Button type="submit" variant="primary" disabled={loading} className="w-full justify-center">
            {loading ? 'Please wait…' : buttonLabel}
          </Button>

          {mode === 'default' && (
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={loading}
              className="w-full text-xs text-center hover:opacity-70 transition-all mt-1"
              style={{ color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Forgot password?
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
