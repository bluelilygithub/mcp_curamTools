/**
 * AdminSecurityPage — login rate limit, account lockout thresholds.
 */
import { useState, useEffect } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import InlineBanner from '../../components/ui/InlineBanner';

export default function AdminSecurityPage() {
  const [settings, setSettings] = useState({
    security_login_rate_limit: 5,
    security_login_max_attempts: 5,
    security_lockout_minutes: 15,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    api.get('/admin/security').then(setSettings).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setSuccess('');
    try {
      await api.put('/admin/security', settings);
      setSuccess('Security settings saved. Changes take effect immediately.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const NumberField = ({ label, description, fieldKey, min, max }) => (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>{label}</label>
      {description && <p className="text-xs mb-1.5" style={{ color: 'var(--color-muted)' }}>{description}</p>}
      <input
        type="number" min={min} max={max}
        value={settings[fieldKey] ?? 0}
        onChange={(e) => setSettings((s) => ({ ...s, [fieldKey]: parseInt(e.target.value) }))}
        className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
        style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
      />
    </div>
  );

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Security</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>Configure brute-force protection thresholds.</p>
      </div>

      {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} />}
      {success && <InlineBanner type="neutral" message={success} onDismiss={() => setSuccess('')} />}

      {loading ? (
        <p className="text-sm mt-4" style={{ color: 'var(--color-muted)' }}>Loading…</p>
      ) : (
        <form onSubmit={save} className="mt-4">
          <div className="rounded-2xl border p-6 space-y-6" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <NumberField
              label="IP rate limit (attempts per 15 min)"
              description="Maximum login attempts from a single IP before being rate-limited."
              fieldKey="security_login_rate_limit" min={1} max={20}
            />
            <NumberField
              label="Account lockout threshold (consecutive failures)"
              description="Lock the account after this many consecutive failed login attempts."
              fieldKey="security_login_max_attempts" min={1} max={20}
            />
            <NumberField
              label="Lockout duration (minutes)"
              description="How long an account remains locked after exceeding the failure threshold."
              fieldKey="security_lockout_minutes" min={1} max={1440}
            />
            <div className="flex justify-end">
              <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
