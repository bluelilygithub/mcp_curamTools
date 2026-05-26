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
  const [credentialScopes, setCredentialScopes] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/admin/security'),
      api.get('/admin/credential-scopes').catch(() => null),
    ])
      .then(([securitySettings, scopeReport]) => {
        setSettings(securitySettings);
        setCredentialScopes(scopeReport);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
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

  const scopeColor = (scope) => ({
    global_shared: '#d97706',
    org_configured: '#2563eb',
    external_account_scoped: '#7c3aed',
    org_secret: '#16a34a',
  }[scope] ?? 'var(--color-muted)');

  const riskColor = (risk) => ({
    high: '#dc2626',
    medium: '#d97706',
    low: '#16a34a',
  }[risk] ?? 'var(--color-muted)');

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
        <div className="mt-4 space-y-6">
          <form onSubmit={save}>
            <div className="rounded-2xl border p-6 space-y-6" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>
                  Login Protection
                </p>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  Brute-force controls for user authentication.
                </p>
              </div>
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

          <section className="rounded-2xl border p-6 space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>
                Credential Scope Registry
              </p>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Shared credentials are allowed here, but each one declares its scope, boundary, and configuration status.
              </p>
            </div>

            {!credentialScopes ? (
              <InlineBanner type="warning" message="Credential scope report is unavailable." />
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Credentials', value: credentialScopes.summary.total },
                    { label: 'Configured', value: credentialScopes.summary.configured },
                    { label: 'Shared', value: credentialScopes.summary.shared },
                    { label: 'Org Configured', value: credentialScopes.summary.orgConfigured },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border p-3" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
                      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>{item.label}</p>
                      <p className="text-lg font-bold mt-1" style={{ color: 'var(--color-text)' }}>{item.value ?? 0}</p>
                    </div>
                  ))}
                </div>

                <div className="grid gap-3">
                  {(credentialScopes.entries ?? []).map((entry) => {
                    const configured = entry.configured === true;
                    return (
                      <div
                        key={entry.key}
                        className="rounded-xl border p-4"
                        style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
                      >
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{entry.label}</h2>
                              <span className="text-xs rounded-full px-2 py-0.5" style={{ color: '#fff', background: configured ? '#16a34a' : '#dc2626' }}>
                                {configured ? 'Configured' : 'Missing env'}
                              </span>
                              <span className="text-xs rounded-full px-2 py-0.5" style={{ color: '#fff', background: scopeColor(entry.scope) }}>
                                {entry.scopeLabel}
                              </span>
                              <span className="text-xs rounded-full px-2 py-0.5" style={{ color: '#fff', background: riskColor(entry.risk) }}>
                                {entry.risk} risk
                              </span>
                            </div>
                            <p className="text-xs mt-2 leading-5" style={{ color: 'var(--color-muted)' }}>{entry.boundary}</p>
                            <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                              Rotation: {entry.rotationNote}
                            </p>
                          </div>
                          <div className="text-xs text-right" style={{ color: 'var(--color-muted)' }}>
                            <div>Owner: {entry.owner}</div>
                            <div>{entry.env?.configuredCount ?? 0}/{entry.env?.requiredCount ?? 0} env vars</div>
                          </div>
                        </div>
                        {entry.env?.vars?.length > 0 && (
                          <div className="flex gap-1.5 flex-wrap mt-3">
                            {entry.env.vars.map((envVar) => (
                              <span
                                key={`${entry.key}-${envVar.name}`}
                                className="text-xs font-mono rounded px-1.5 py-0.5"
                                style={{
                                  color: envVar.configured ? '#166534' : '#991b1b',
                                  background: envVar.configured ? '#dcfce7' : '#fee2e2',
                                }}
                              >
                                {envVar.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
