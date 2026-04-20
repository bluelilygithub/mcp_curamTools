/**
 * AdminModelsPage — add, edit, delete, and test AI models.
 * Features: rich model cards, inline add/edit form, API key status,
 * per-model test with dismissible result, reset to defaults.
 */
import { useState, useEffect } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import InlineBanner from '../../components/ui/InlineBanner';

const TIERS = ['standard', 'advanced', 'premium'];

const TIER_META = {
  standard: { label: 'Economy',  color: '#059669', bg: 'rgba(5,150,105,0.1)'   },
  advanced: { label: 'Standard', color: '#2563eb', bg: 'rgba(37,99,235,0.1)'   },
  premium:  { label: 'Premium',  color: '#7c3aed', bg: 'rgba(124,58,237,0.1)'  },
};

const EMPTY_FORM = {
  id: '', name: '', tier: 'advanced', provider: 'anthropic',
  emoji: '🤖', label: '', tagline: '', desc: '',
  inputPricePer1M: '', outputPricePer1M: '', contextWindow: 200000,
  enabled: true,
};

// ── Field wrapper ────────────────────────────────────────────────────────────

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>
        {label}
        {hint && <span className="ml-1 font-normal opacity-60">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AdminModelsPage() {
  const [models,        setModels]        = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [apiKeyOk,      setApiKeyOk]      = useState({});
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState('');
  const [success,       setSuccess]       = useState('');
  const [editingId,     setEditingId]     = useState(null); // 'new' | model.id | null
  const [form,          setForm]          = useState(EMPTY_FORM);
  const [defaultModel,  setDefaultModel]  = useState(null);
  const [savingDefault, setSavingDefault] = useState(false);
  // testResults: { [modelId]: { status: 'testing'|'ok'|'error', latencyMs?, error? } }
  const [testResults, setTestResults] = useState({});

  useEffect(() => {
    Promise.all([
      api.get('/admin/models'),
      api.get('/admin/model-status'),
      api.get('/admin/default-model'),
    ]).then(([modelData, statusData, defaultData]) => {
      setModels(modelData);
      setApiKeyOk(statusData);
      setDefaultModel(defaultData.model_id ?? '');
    }).catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function saveDefaultModel() {
    setSavingDefault(true);
    try {
      await api.put('/admin/default-model', { model_id: defaultModel || null });
      setSuccess('Default model saved.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingDefault(false);
    }
  }

  // ── Persist ────────────────────────────────────────────────────────────────

  async function persist(newModels, successMsg = 'Models updated.') {
    setSaving(true);
    try {
      await api.put('/admin/models', { models: newModels });
      setModels(newModels);
      setSuccess(successMsg);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  // ── Add / Edit ─────────────────────────────────────────────────────────────

  function openAdd() {
    setForm({ ...EMPTY_FORM });
    setEditingId('new');
  }

  function openEdit(m) {
    setForm({ ...m });
    setEditingId(m.id);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function handleSave() {
    if (!form.id.trim() || !form.name.trim()) return;
    const model = {
      ...form,
      id:               form.id.trim(),
      inputPricePer1M:  parseFloat(form.inputPricePer1M)  || 0,
      outputPricePer1M: parseFloat(form.outputPricePer1M) || 0,
      contextWindow:    parseInt(form.contextWindow, 10)   || 200000,
    };
    let updated;
    if (editingId === 'new') {
      if (models.some((m) => m.id === model.id)) {
        setError('A model with that ID already exists.');
        return;
      }
      updated = [...models, model];
    } else {
      updated = models.map((m) => (m.id === editingId ? model : m));
    }
    const ok = await persist(updated, editingId === 'new' ? 'Model added.' : 'Model saved.');
    if (ok) cancelEdit();
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async function handleDelete(id) {
    if (!window.confirm('Remove this model?')) return;
    await persist(models.filter((m) => m.id !== id), 'Model removed.');
  }

  // ── Reset ──────────────────────────────────────────────────────────────────

  async function handleReset() {
    if (!window.confirm('Reset to default models? Any custom models will be removed.')) return;
    setSaving(true);
    try {
      const data = await api.post('/admin/models/reset', {});
      setModels(data.models);
      setSuccess('Reset to defaults.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Test ───────────────────────────────────────────────────────────────────

  async function testModel(modelId) {
    setTestResults((r) => ({ ...r, [modelId]: { status: 'testing' } }));
    try {
      const result = await api.post(`/admin/models/${encodeURIComponent(modelId)}/test`);
      setTestResults((r) => ({
        ...r,
        [modelId]: result.ok
          ? { status: 'ok',    latencyMs: result.latencyMs }
          : { status: 'error', error: result.error },
      }));
    } catch (e) {
      setTestResults((r) => ({ ...r, [modelId]: { status: 'error', error: e.message } }));
    }
  }

  function dismissTest(id) {
    setTestResults((r) => { const n = { ...r }; delete n[id]; return n; });
  }

  // ── Field input style ──────────────────────────────────────────────────────

  const fi = {
    width: '100%', padding: '0.5rem 0.75rem', borderRadius: '0.5rem',
    border: '1px solid var(--color-border)', background: 'var(--color-bg)',
    color: 'var(--color-text)', fontSize: '0.75rem', outline: 'none', boxSizing: 'border-box',
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-3xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>AI Models</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Add, edit, or remove models. The model ID must match the exact API identifier for the selected provider.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-4">
          <Button variant="secondary" onClick={handleReset} disabled={saving}>
            Reset defaults
          </Button>
          <Button variant="primary" onClick={openAdd} disabled={saving}>
            + Add model
          </Button>
        </div>
      </div>

      {error   && <InlineBanner type="error"   message={error}   onDismiss={() => setError('')}   className="mb-4" />}
      {success && <InlineBanner type="neutral" message={success} onDismiss={() => setSuccess('')} className="mb-4" />}

      {/* Default model */}
      {!loading && (
        <div
          className="rounded-2xl border p-4 mb-5 flex items-center gap-4 flex-wrap"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Default model</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
              Used by all agents unless overridden individually in Admin &rsaquo; Agents.
            </p>
          </div>
          <select
            value={defaultModel ?? ''}
            onChange={(e) => setDefaultModel(e.target.value)}
            className="px-3 py-2 rounded-xl border text-sm outline-none"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)', minWidth: 220 }}
          >
            <option value="">— No default set —</option>
            {models.filter((m) => m.enabled).map((m) => (
              <option key={m.id} value={m.id}>{m.name} ({m.id})</option>
            ))}
          </select>
          <Button variant="primary" onClick={saveDefaultModel} disabled={savingDefault}>
            {savingDefault ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}

      {/* API key status */}
      {Object.keys(apiKeyOk).length > 0 && (
        <div
          className="flex items-center gap-4 px-4 py-2.5 rounded-xl border mb-5 text-sm flex-wrap"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          {Object.entries(apiKeyOk).map(([key, prov]) => (
            <div key={key} className="flex items-center gap-2">
              <span style={{ color: 'var(--color-muted)' }}>{prov.label} API key:</span>
              {prov.configured ? (
                prov.needsBaseUrl ? (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#b45309' }}>
                    ⚠ Key set — {key.toUpperCase()}_BASE_URL missing
                  </span>
                ) : (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#dcfce7', color: '#16a34a' }}>✓ Configured</span>
                )
              ) : (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#b45309' }}>⚠ Not set</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit form */}
      {editingId && (
        <div
          className="rounded-2xl border p-5 mb-5 space-y-4"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-primary)' }}
        >
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-primary)' }}>
            {editingId === 'new' ? 'Add model' : 'Edit model'}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Model API ID *" hint="exact API identifier, e.g. claude-sonnet-4-6 · gpt-4o · grok-3">
              <input
                style={{ ...fi, fontFamily: 'monospace' }}
                placeholder="e.g. claude-sonnet-4-6, gpt-4o, grok-3, mistral-large-latest"
                value={form.id}
                disabled={editingId !== 'new'}
                onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
              />
            </Field>
            <Field label="Display name *">
              <input style={fi} placeholder="Claude Sonnet 4.6"
                value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </Field>
            <Field label="Tier">
              <select style={fi} value={form.tier}
                onChange={(e) => setForm((f) => ({ ...f, tier: e.target.value }))}>
                {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Provider" hint="pick from list or type a custom key (lowercase)">
              <input
                style={fi}
                list="provider-datalist"
                placeholder="e.g. anthropic, openai, seedance"
                value={form.provider}
                onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value.toLowerCase().trim() }))}
              />
              <datalist id="provider-datalist">
                {Object.entries(apiKeyOk).map(([key, prov]) => (
                  <option key={key} value={key}>{prov.label}</option>
                ))}
              </datalist>
            </Field>
            <Field label="Emoji">
              <input style={fi} placeholder="🤖"
                value={form.emoji} onChange={(e) => setForm((f) => ({ ...f, emoji: e.target.value }))} />
            </Field>
            <Field label="Label">
              <input style={fi} placeholder="e.g. Standard"
                value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
            </Field>
            <Field label="Input price / 1M tokens (USD)">
              <input style={fi} type="number" step="0.01" min="0" placeholder="3.00"
                value={form.inputPricePer1M}
                onChange={(e) => setForm((f) => ({ ...f, inputPricePer1M: e.target.value }))} />
            </Field>
            <Field label="Output price / 1M tokens (USD)">
              <input style={fi} type="number" step="0.01" min="0" placeholder="15.00"
                value={form.outputPricePer1M}
                onChange={(e) => setForm((f) => ({ ...f, outputPricePer1M: e.target.value }))} />
            </Field>
            <Field label="Context window (tokens)">
              <input style={fi} type="number" min="1" placeholder="200000"
                value={form.contextWindow}
                onChange={(e) => setForm((f) => ({ ...f, contextWindow: e.target.value }))} />
            </Field>
            <Field label="Tagline">
              <input style={fi} placeholder="e.g. Smart & balanced"
                value={form.tagline} onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))} />
            </Field>
          </div>

          <Field label="Description">
            <input style={fi} placeholder="e.g. Best for most work — writing, analysis, and tool workloads"
              value={form.desc} onChange={(e) => setForm((f) => ({ ...f, desc: e.target.value }))} />
          </Field>

          <div className="flex gap-2 pt-1">
            <Button variant="primary" onClick={handleSave} disabled={saving || !form.id.trim() || !form.name.trim()}>
              {saving ? 'Saving…' : editingId === 'new' ? 'Add model' : 'Save changes'}
            </Button>
            <Button variant="secondary" onClick={cancelEdit}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Model list */}
      {loading ? (
        <div className="p-8 text-center text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</div>
      ) : (
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          {models.length === 0 ? (
            <div className="p-10 text-center text-sm" style={{ color: 'var(--color-muted)' }}>
              No models configured. Add one above or reset to defaults.
            </div>
          ) : (
            models.map((m, i) => {
              const tier = TIER_META[m.tier] ?? TIER_META.advanced;
              const test = testResults[m.id];
              return (
                <div
                  key={m.id}
                  style={{
                    background:   'var(--color-surface)',
                    borderBottom: i < models.length - 1 ? '1px solid var(--color-border)' : 'none',
                  }}
                >
                  <div className="flex items-center gap-3 px-4 py-3">
                    <span className="text-xl flex-shrink-0">{m.emoji || '🤖'}</span>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{m.name}</span>
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ background: tier.bg, color: tier.color }}
                        >
                          {m.tier}
                        </span>
                        {m.tagline && (
                          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{m.tagline}</span>
                        )}
                      </div>
                      <div className="text-xs font-mono mt-0.5 truncate" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>
                        {m.id}
                      </div>
                      {m.inputPricePer1M != null && m.inputPricePer1M !== '' && (
                        <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                          ${m.inputPricePer1M}/1M in · ${m.outputPricePer1M}/1M out
                          {m.contextWindow ? ` · ${(m.contextWindow / 1000).toFixed(0)}k ctx` : ''}
                        </div>
                      )}
                    </div>

                    {/* Toggle enabled */}
                    <button
                      onClick={async () => {
                        const updated = models.map((x) => x.id === m.id ? { ...x, enabled: !x.enabled } : x);
                        await persist(updated, m.enabled ? 'Model disabled.' : 'Model enabled.');
                      }}
                      className="relative inline-flex h-5 w-9 rounded-full transition-all flex-shrink-0"
                      style={{ background: m.enabled ? 'var(--color-primary)' : 'var(--color-border)' }}
                      title={m.enabled ? 'Disable' : 'Enable'}
                    >
                      <span
                        className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full transition-all"
                        style={{ background: '#fff', transform: m.enabled ? 'translateX(16px)' : 'translateX(0)' }}
                      />
                    </button>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => testModel(m.id)}
                        disabled={test?.status === 'testing'}
                        className="text-xs px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-70 disabled:opacity-40"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'transparent', cursor: 'pointer' }}
                      >
                        {test?.status === 'testing' ? 'Testing…' : 'Test'}
                      </button>
                      <button
                        onClick={() => openEdit(m)}
                        className="text-xs px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-70"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'transparent', cursor: 'pointer' }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(m.id)}
                        disabled={saving}
                        className="text-xs px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-70 disabled:opacity-40"
                        style={{ borderColor: '#fca5a5', color: '#991b1b', background: 'transparent', cursor: 'pointer' }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {/* Test result */}
                  {test && test.status !== 'testing' && (
                    <div
                      className="mx-4 mb-3 px-3 py-2 rounded-xl text-xs flex items-start gap-2"
                      style={{
                        background: test.status === 'ok' ? '#f0fdf4' : '#fff1f2',
                        color:      test.status === 'ok' ? '#16a34a' : '#991b1b',
                      }}
                    >
                      <span className="flex-shrink-0">{test.status === 'ok' ? '✓' : '✗'}</span>
                      <span className="flex-1">
                        {test.status === 'ok'
                          ? `Connected — ${test.latencyMs}ms`
                          : test.error}
                      </span>
                      <button
                        onClick={() => dismissTest(m.id)}
                        className="flex-shrink-0 hover:opacity-100"
                        style={{ opacity: 0.5, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
