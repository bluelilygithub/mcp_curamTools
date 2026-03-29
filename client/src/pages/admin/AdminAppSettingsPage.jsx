/**
 * AdminAppSettingsPage — org-wide defaults: app name, timezone, allowed file types.
 */
import { useState, useEffect } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import InlineBanner from '../../components/ui/InlineBanner';

const TIMEZONES = [
  'Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane',
  'Australia/Perth', 'Australia/Adelaide', 'Australia/Darwin',
  'UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London',
];

export default function AdminAppSettingsPage() {
  const [settings, setSettings] = useState({ app_name: '', timezone: 'Australia/Sydney', allowed_file_types: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    api.get('/admin/settings').then(setSettings).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setSuccess('');
    try {
      await api.put('/admin/settings', settings);
      setSuccess('Settings saved.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const Field = ({ label, children }) => (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>{label}</label>
      {children}
    </div>
  );

  const inputStyle = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>App Settings</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>Organisation-wide configuration.</p>
      </div>

      {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} />}
      {success && <InlineBanner type="neutral" message={success} />}

      {loading ? (
        <p className="text-sm mt-4" style={{ color: 'var(--color-muted)' }}>Loading…</p>
      ) : (
        <form onSubmit={save} className="mt-4">
          <div className="rounded-2xl border p-6 space-y-6" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <Field label="App name">
              <input
                type="text" value={settings.app_name ?? ''}
                onChange={(e) => setSettings((s) => ({ ...s, app_name: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={inputStyle}
              />
            </Field>
            <Field label="Default timezone">
              <select
                value={settings.timezone ?? 'Australia/Sydney'}
                onChange={(e) => setSettings((s) => ({ ...s, timezone: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={inputStyle}
              >
                {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </Field>
            <div className="flex justify-end pt-2">
              <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
