/**
 * SettingsPage — two tabs: Profile and Appearance.
 * Profile: name, phone, timezone, change password.
 * Appearance: theme, body font, heading font, mono font.
 */
import { useState, useEffect } from 'react';
import api from '../api/client';
import useSettingsStore from '../stores/settingsStore';
import useAuthStore from '../stores/authStore';
import { THEMES } from '../providers/ThemeProvider';
import Button from '../components/ui/Button';
import InlineBanner from '../components/ui/InlineBanner';

// ── Timezones ──────────────────────────────────────────────────────────────

const TIMEZONES = [
  'UTC',
  'Pacific/Auckland',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Brisbane',
  'Australia/Adelaide',
  'Australia/Perth',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Rome',
  'Europe/Madrid',
  'Europe/Stockholm',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Vancouver',
  'America/Toronto',
  'America/Sao_Paulo',
  'America/Mexico_City',
];

// ── Font lists ─────────────────────────────────────────────────────────────

const BODY_FONTS    = ['Inter', 'DM Sans', 'Open Sans', 'Lato', 'Nunito', 'Poppins', 'Raleway', 'Montserrat', 'Oswald'];
const HEADING_FONTS = ['Playfair Display', 'Lora', 'Merriweather', 'PT Serif', 'Crimson Text'];
const MONO_FONTS    = ['DM Mono', 'JetBrains Mono', 'Fira Code'];

const THEME_LABELS = {
  'warm-sand':     'Warm Sand',
  'dark-slate':    'Dark Slate',
  forest:          'Forest',
  'midnight-blue': 'Midnight Blue',
  'paper-white':   'Paper White',
};

// ── Shared primitives ──────────────────────────────────────────────────────

const FIELD = 'w-full px-3 py-2.5 rounded-xl border text-sm outline-none';
const FIELD_STYLE = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const LABEL = 'block text-xs font-semibold uppercase tracking-wider mb-1.5';
const LABEL_STYLE = { color: 'var(--color-muted)' };

function Section({ title, children }) {
  return (
    <div className="rounded-2xl border p-6 space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h2>
      {children}
    </div>
  );
}

// ── Profile tab ────────────────────────────────────────────────────────────

function ProfileTab() {
  const { user, setAuth, token } = useAuthStore();

  const [form, setForm] = useState({
    firstName: user?.firstName ?? '',
    lastName:  user?.lastName  ?? '',
    phone:     user?.phone     ?? '',
    timezone:  user?.timezone  ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg,    setProfileMsg]    = useState(null); // { type, text }

  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg,    setPwMsg]    = useState(null);

  async function handleProfileSave(e) {
    e.preventDefault();
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      await api.put('/auth/profile', form);
      // Refresh auth store so TopNav shows updated name
      const updated = await api.get('/auth/profile');
      setAuth(token, { ...user, ...updated });
      setProfileMsg({ type: 'success', text: 'Profile updated.' });
    } catch (err) {
      setProfileMsg({ type: 'error', text: err.message });
    } finally {
      setProfileSaving(false);
    }
  }

  async function handlePasswordChange(e) {
    e.preventDefault();
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwMsg({ type: 'error', text: 'New passwords do not match.' });
      return;
    }
    setPwSaving(true);
    setPwMsg(null);
    try {
      await api.post('/auth/change-password', {
        currentPassword: pwForm.currentPassword,
        newPassword:     pwForm.newPassword,
      });
      setPwMsg({ type: 'success', text: 'Password changed.' });
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      setPwMsg({ type: 'error', text: err.message });
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <div className="space-y-6">

      {/* Personal details */}
      <Section title="Personal details">
        {profileMsg && (
          <InlineBanner
            type={profileMsg.type === 'success' ? 'neutral' : 'error'}
            message={profileMsg.text}
            onDismiss={() => setProfileMsg(null)}
          />
        )}
        <form onSubmit={handleProfileSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL} style={LABEL_STYLE}>First name</label>
              <input
                type="text" value={form.firstName}
                onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                className={FIELD} style={FIELD_STYLE}
              />
            </div>
            <div>
              <label className={LABEL} style={LABEL_STYLE}>Last name</label>
              <input
                type="text" value={form.lastName}
                onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                className={FIELD} style={FIELD_STYLE}
              />
            </div>
          </div>
          <div>
            <label className={LABEL} style={LABEL_STYLE}>Email</label>
            <input
              type="email" value={user?.email ?? ''} disabled
              className={FIELD} style={{ ...FIELD_STYLE, opacity: 0.6, cursor: 'not-allowed' }}
            />
          </div>
          <div>
            <label className={LABEL} style={LABEL_STYLE}>Phone</label>
            <input
              type="tel" value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className={FIELD} style={FIELD_STYLE}
            />
          </div>
          <div>
            <label className={LABEL} style={LABEL_STYLE}>Timezone</label>
            <select
              value={form.timezone}
              onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
              className={FIELD} style={FIELD_STYLE}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" type="submit" disabled={profileSaving}>
              {profileSaving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </Section>

      {/* Change password */}
      <Section title="Change password">
        {pwMsg && (
          <InlineBanner
            type={pwMsg.type === 'success' ? 'neutral' : 'error'}
            message={pwMsg.text}
            onDismiss={() => setPwMsg(null)}
          />
        )}
        <form onSubmit={handlePasswordChange} className="space-y-4">
          <div>
            <label className={LABEL} style={LABEL_STYLE}>Current password</label>
            <input
              type="password" required value={pwForm.currentPassword}
              onChange={(e) => setPwForm((f) => ({ ...f, currentPassword: e.target.value }))}
              className={FIELD} style={FIELD_STYLE}
            />
          </div>
          <div>
            <label className={LABEL} style={LABEL_STYLE}>New password</label>
            <input
              type="password" required minLength={8} value={pwForm.newPassword}
              onChange={(e) => setPwForm((f) => ({ ...f, newPassword: e.target.value }))}
              className={FIELD} style={FIELD_STYLE}
            />
          </div>
          <div>
            <label className={LABEL} style={LABEL_STYLE}>Confirm new password</label>
            <input
              type="password" required value={pwForm.confirmPassword}
              onChange={(e) => setPwForm((f) => ({ ...f, confirmPassword: e.target.value }))}
              className={FIELD} style={FIELD_STYLE}
            />
          </div>
          <div className="flex justify-end">
            <Button variant="primary" type="submit" disabled={pwSaving}>
              {pwSaving ? 'Updating…' : 'Update password'}
            </Button>
          </div>
        </form>
      </Section>
    </div>
  );
}

// ── Appearance tab ─────────────────────────────────────────────────────────

function AppearanceTab() {
  const { theme, bodyFont, headingFont, monoFont, setTheme, setBodyFont, setHeadingFont, setMonoFont } = useSettingsStore();

  return (
    <div className="space-y-6">
      <Section title="Theme">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Object.keys(THEMES).map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className="px-3 py-2 rounded-xl border text-sm font-medium transition-all hover:opacity-80"
              style={{
                background:   THEMES[t].bg,
                borderColor:  t === theme ? THEMES[t].primary : THEMES[t].border,
                color:        THEMES[t].text,
                outline:      t === theme ? `2px solid ${THEMES[t].primary}` : 'none',
                outlineOffset: 2,
              }}
            >
              {THEME_LABELS[t]}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <div className="space-y-4">
          <div>
            <label className={LABEL} style={LABEL_STYLE}>Body font</label>
            <select value={bodyFont} onChange={(e) => setBodyFont(e.target.value)} className={FIELD} style={FIELD_STYLE}>
              {BODY_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <p className="text-xs mt-1.5" style={{ color: 'var(--color-muted)', fontFamily: `'${bodyFont}', sans-serif` }}>
              The quick brown fox jumps over the lazy dog.
            </p>
          </div>
          <div>
            <label className={LABEL} style={LABEL_STYLE}>Heading font</label>
            <select value={headingFont} onChange={(e) => setHeadingFont(e.target.value)} className={FIELD} style={FIELD_STYLE}>
              {HEADING_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <p className="text-xs mt-1.5" style={{ color: 'var(--color-muted)', fontFamily: `'${headingFont}', serif` }}>
              The quick brown fox jumps over the lazy dog.
            </p>
          </div>
          <div>
            <label className={LABEL} style={LABEL_STYLE}>Monospace font</label>
            <select value={monoFont} onChange={(e) => setMonoFont(e.target.value)} className={FIELD} style={FIELD_STYLE}>
              {MONO_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <p className="text-xs mt-1.5" style={{ color: 'var(--color-muted)', fontFamily: `'${monoFont}', monospace` }}>
              const answer = 42;
            </p>
          </div>
        </div>
      </Section>
    </div>
  );
}

// ── Page shell ─────────────────────────────────────────────────────────────

const TABS = ['Profile', 'Appearance'];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('Profile');

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Settings</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>Manage your account and workspace appearance.</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b" style={{ borderColor: 'var(--color-border)' }}>
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="px-4 py-2 text-sm font-medium transition-all"
            style={{
              color:       activeTab === tab ? 'var(--color-primary)' : 'var(--color-muted)',
              borderBottom: activeTab === tab ? '2px solid var(--color-primary)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Profile'    && <ProfileTab />}
      {activeTab === 'Appearance' && <AppearanceTab />}
    </div>
  );
}
