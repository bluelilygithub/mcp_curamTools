/**
 * AdminAppSettingsPage — org-wide defaults: app name, timezone, and company profile.
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

const BUSINESS_TYPES = ['ecommerce', 'lead-gen', 'service', 'saas', 'b2b', 'other'];
const CURRENCIES = ['AUD', 'USD', 'GBP', 'EUR', 'NZD', 'SGD'];

const PROFILE_DEFAULTS = {
  company_name: '', website: '', industry: '', primary_market: '',
  primary_region: '', serviced_regions: '', business_type: '',
  currency: 'AUD', business_description: '',
};

export default function AdminAppSettingsPage() {
  const [settings, setSettings] = useState({ app_name: '', timezone: 'Australia/Sydney', allowed_file_types: [] });
  const [profile, setProfile] = useState(PROFILE_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/admin/settings'),
      api.get('/admin/company-profile'),
    ]).then(([s, p]) => {
      setSettings(s);
      setProfile({ ...PROFILE_DEFAULTS, ...p });
    }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  async function saveSettings(e) {
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

  async function saveProfile(e) {
    e.preventDefault();
    setSavingProfile(true);
    setSuccess('');
    try {
      await api.put('/admin/company-profile', profile);
      setSuccess('Company profile saved.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingProfile(false);
    }
  }

  const Field = ({ label, hint, children }) => (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>{label}</label>
      {children}
      {hint && <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{hint}</p>}
    </div>
  );

  const inputStyle = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
  const inputClass = 'w-full px-3 py-2.5 rounded-xl border text-sm outline-none';

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div className="mb-2">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>App Settings</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>Organisation-wide configuration.</p>
      </div>

      {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} />}
      {success && <InlineBanner type="neutral" message={success} />}

      {loading ? (
        <p className="text-sm mt-4" style={{ color: 'var(--color-muted)' }}>Loading…</p>
      ) : (
        <>
          {/* ── App Settings ─────────────────────────────── */}
          <form onSubmit={saveSettings}>
            <div className="rounded-2xl border p-6 space-y-6" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Platform</h2>
              <Field label="App name">
                <input
                  type="text" value={settings.app_name ?? ''}
                  onChange={(e) => setSettings((s) => ({ ...s, app_name: e.target.value }))}
                  className={inputClass} style={inputStyle}
                />
              </Field>
              <Field label="Default timezone">
                <select
                  value={settings.timezone ?? 'Australia/Sydney'}
                  onChange={(e) => setSettings((s) => ({ ...s, timezone: e.target.value }))}
                  className={inputClass} style={inputStyle}
                >
                  {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </Field>
              <div className="flex justify-end pt-2">
                <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
              </div>
            </div>
          </form>

          {/* ── Company Profile ───────────────────────────── */}
          <form onSubmit={saveProfile}>
            <div className="rounded-2xl border p-6 space-y-6" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
              <div>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Company Profile</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>Used by AI agents to contextualise reports and recommendations.</p>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <Field label="Company name">
                  <input type="text" value={profile.company_name} onChange={(e) => setProfile((p) => ({ ...p, company_name: e.target.value }))} className={inputClass} style={inputStyle} placeholder="Diamondplate" />
                </Field>
                <Field label="Website">
                  <input type="text" value={profile.website} onChange={(e) => setProfile((p) => ({ ...p, website: e.target.value }))} className={inputClass} style={inputStyle} placeholder="diamondplate.com.au" />
                </Field>
                <Field label="Industry">
                  <input type="text" value={profile.industry} onChange={(e) => setProfile((p) => ({ ...p, industry: e.target.value }))} className={inputClass} style={inputStyle} placeholder="Automotive detailing / ceramic coatings" />
                </Field>
                <Field label="Business type">
                  <select value={profile.business_type} onChange={(e) => setProfile((p) => ({ ...p, business_type: e.target.value }))} className={inputClass} style={inputStyle}>
                    <option value="">Select…</option>
                    {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Primary market (country)">
                  <input type="text" value={profile.primary_market} onChange={(e) => setProfile((p) => ({ ...p, primary_market: e.target.value }))} className={inputClass} style={inputStyle} placeholder="Australia" />
                </Field>
                <Field label="Primary region (state / city)">
                  <input type="text" value={profile.primary_region} onChange={(e) => setProfile((p) => ({ ...p, primary_region: e.target.value }))} className={inputClass} style={inputStyle} placeholder="Sydney, NSW" />
                </Field>
                <Field label="Currency">
                  <select value={profile.currency} onChange={(e) => setProfile((p) => ({ ...p, currency: e.target.value }))} className={inputClass} style={inputStyle}>
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Serviced regions" hint="Other states or countries the business serves.">
                  <input type="text" value={profile.serviced_regions} onChange={(e) => setProfile((p) => ({ ...p, serviced_regions: e.target.value }))} className={inputClass} style={inputStyle} placeholder="VIC, QLD, WA" />
                </Field>
              </div>

              <Field label="Business description" hint="2–3 sentences. What the business does, who it serves, and its key differentiator. This is injected into every agent's system prompt.">
                <textarea
                  value={profile.business_description}
                  onChange={(e) => setProfile((p) => ({ ...p, business_description: e.target.value }))}
                  rows={3}
                  className={inputClass} style={inputStyle}
                  placeholder="Diamondplate is an Australian automotive detailing and ceramic coating company based in Sydney, NSW. It serves vehicle owners across Australia with premium paint protection and detailing services."
                />
              </Field>

              <div className="flex justify-end pt-2">
                <Button type="submit" variant="primary" disabled={savingProfile}>{savingProfile ? 'Saving…' : 'Save profile'}</Button>
              </div>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
