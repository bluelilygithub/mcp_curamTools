/**
 * AdminAgentsPage — admin guardrails: kill switch, model, fallback model,
 * max tokens, max iterations, per-agent intelligence profile.
 */
import { useState, useEffect } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import InlineBanner from '../../components/ui/InlineBanner';
import EmptyState from '../../components/ui/EmptyState';

function IntelligenceProfileSection({ slug, profile, onChange }) {
  const base = profile ?? {};

  function update(key, value) {
    onChange({ ...base, [key]: value });
  }

  const Field = ({ label, fieldKey, type = 'text', placeholder }) => (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
        {label}
      </label>
      <input
        type={type}
        value={base[fieldKey] ?? ''}
        onChange={(e) => update(fieldKey, type === 'number' ? parseFloat(e.target.value) : e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
        style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
      />
    </div>
  );

  return (
    <div className="space-y-4 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
      <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Account Intelligence Profile</h3>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
        Declare business targets so the agent analyses data relative to your objectives.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Target ROAS" fieldKey="targetROAS" type="number" placeholder="e.g. 7" />
        <Field label="Target CPA (AUD)" fieldKey="targetCPA" type="number" placeholder="e.g. 25" />
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
          Business Context
        </label>
        <textarea
          value={base.businessContext ?? ''}
          onChange={(e) => update('businessContext', e.target.value)}
          rows={3}
          placeholder="What the business does, key constraints, seasonal factors…"
          className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none resize-none"
          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        />
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
          Analytical Guardrails
        </label>
        <textarea
          value={base.analyticalGuardrails ?? ''}
          onChange={(e) => update('analyticalGuardrails', e.target.value)}
          rows={2}
          placeholder="What the agent should NOT flag as issues…"
          className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none resize-none"
          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        />
      </div>
    </div>
  );
}

const inputCls = "w-full px-3 py-2.5 rounded-xl border text-sm outline-none";
const inputStyle = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };

function AgentCard({ agent, models, onSave }) {
  const [config,         setConfig]         = useState(agent);
  const [profile,        setProfile]        = useState(null);
  const [saving,         setSaving]         = useState(false);
  const [success,        setSuccess]        = useState('');
  const [error,          setError]          = useState('');

  const enabledModels = models.filter((m) => m.enabled !== false);
  const rec           = agent.recommended_model; // { id, name, tier, reason } | null
  const hasMismatch   = rec && config.model && config.model !== rec.id;

  async function save() {
    setSaving(true);
    setSuccess('');
    try {
      await api.put(`/admin/agents/${agent.slug}`, config);
      if (profile !== null) {
        await api.put(`/agent-configs/${agent.slug}`, { intelligence_profile: profile });
      }
      setSuccess('Saved.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="rounded-2xl border p-6 space-y-4"
      style={{
        background:   'var(--color-surface)',
        borderColor:  hasMismatch ? '#f59e0b' : 'var(--color-border)',
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{agent.slug}</h2>
          {hasMismatch && (
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full"
              style={{ background: '#fef3c7', color: '#92400e' }}
              title={`Recommended: ${rec.name} — ${rec.reason}`}
            >
              ⚠ Not on recommended model
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Enabled</span>
          <button
            onClick={() => setConfig((c) => ({ ...c, enabled: !c.enabled }))}
            className="relative inline-flex h-5 w-9 rounded-full transition-all"
            style={{ background: config.enabled ? 'var(--color-primary)' : '#ef4444' }}
          >
            <span
              className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full transition-all"
              style={{ background: '#fff', transform: config.enabled ? 'translateX(16px)' : 'translateX(0)' }}
            />
          </button>
        </div>
      </div>

      {error   && <InlineBanner type="error"   message={error}   onDismiss={() => setError('')} />}
      {success && <InlineBanner type="neutral" message={success} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Primary model */}
        <div className="sm:col-span-2">
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
            Model
          </label>
          <select
            value={config.model ?? ''}
            onChange={(e) => setConfig((c) => ({ ...c, model: e.target.value }))}
            className={inputCls}
            style={inputStyle}
          >
            {enabledModels.length === 0 && (
              <option value="">No enabled models — add models in Admin › Models</option>
            )}
            {enabledModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}{rec?.id === m.id ? ' ★ recommended' : ''}
              </option>
            ))}
            {config.model && !enabledModels.some((m) => m.id === config.model) && (
              <option value={config.model}>{config.model} (disabled)</option>
            )}
          </select>
          {rec && (
            <p className="text-xs mt-1" style={{ color: hasMismatch ? '#b45309' : 'var(--color-muted)' }}>
              {hasMismatch
                ? `★ Recommended: ${rec.name} — ${rec.reason}`
                : `★ ${rec.reason}`}
            </p>
          )}
        </div>

        {/* Fallback model */}
        <div className="sm:col-span-2">
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
            Fallback Model
            <span className="ml-1 font-normal normal-case" style={{ opacity: 0.7 }}>— used if primary fails</span>
          </label>
          <select
            value={config.fallback_model ?? ''}
            onChange={(e) => setConfig((c) => ({ ...c, fallback_model: e.target.value || null }))}
            className={inputCls}
            style={inputStyle}
          >
            <option value="">(none — no fallback)</option>
            {enabledModels
              .filter((m) => m.id !== config.model)
              .map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
          </select>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            If the primary model returns an API error on the first call, the platform retries once with this model and alerts you in the run log.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>Max Tokens</label>
          <input
            type="number" value={config.max_tokens ?? ''}
            onChange={(e) => setConfig((c) => ({ ...c, max_tokens: parseInt(e.target.value) }))}
            className={inputCls} style={inputStyle}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>Max Iterations</label>
          <input
            type="number" value={config.max_iterations ?? ''}
            onChange={(e) => setConfig((c) => ({ ...c, max_iterations: parseInt(e.target.value) }))}
            className={inputCls} style={inputStyle}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
            Max Task Budget (AUD)
          </label>
          <input
            type="number" step="0.25" min="0" value={config.max_task_budget_aud ?? ''}
            onChange={(e) => setConfig((c) => ({ ...c, max_task_budget_aud: e.target.value === '' ? null : parseFloat(e.target.value) }))}
            placeholder="Leave blank for unlimited"
            className={inputCls} style={inputStyle}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <p className="text-xs" style={{ color: 'var(--color-muted)', paddingBottom: '0.6rem' }}>
            Per-run AUD ceiling. Leave blank for unlimited. Applies before the daily org budget.
          </p>
        </div>
      </div>

      <IntelligenceProfileSection slug={agent.slug} profile={profile} onChange={setProfile} />

      <div className="flex justify-end pt-2">
        <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </div>
  );
}

export default function AdminAgentsPage() {
  const [agents,  setAgents]  = useState([]);
  const [models,  setModels]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/admin/agents'),
      api.get('/admin/models'),
    ])
      .then(([agentData, modelData]) => {
        setAgents(agentData);
        setModels(modelData);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Agents</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
          Configure guardrails and intelligence profiles. ★ marks the recommended model for each agent based on task complexity.
        </p>
      </div>
      {error && <InlineBanner type="error" message={error} />}
      {loading ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>
      ) : agents.length === 0 ? (
        <EmptyState icon="bot" message="No agents configured yet." hint="Agents appear here once registered in the platform." />
      ) : (
        agents.map((agent) => (
          <AgentCard key={agent.slug} agent={agent} models={models} onSave={() => {}} />
        ))
      )}
    </div>
  );
}
