/**
 * AdminProvidersPage — manage AI provider configurations.
 *
 * Built-in providers (Anthropic, Google, OpenAI, Mistral, DeepSeek, xAI, Groq)
 * are shown read-only with their API key status and a Test button.
 *
 * Custom providers are fully editable: key, label, API key env var, base URL,
 * and an optional test model ID used by the Test button.
 */
import { useState, useEffect } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import InlineBanner from '../../components/ui/InlineBanner';

// Default test model IDs for built-in providers
const BUILTIN_TEST_MODELS = {
  anthropic: 'claude-haiku-4-5-20251001',
  google:    'gemini-2.0-flash',
  openai:    'gpt-4o-mini',
  mistral:   'mistral-small-latest',
  deepseek:  'deepseek-chat',
  xai:       'grok-3-mini',
  groq:      'llama-3.1-8b-instant',
};

const EMPTY_FORM = { key: '', label: '', apiKeyEnv: '', baseUrl: '', testModelId: '' };

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

export default function AdminProvidersPage() {
  const [status,     setStatus]     = useState({});
  const [custom,     setCustom]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');
  const [success,    setSuccess]    = useState('');
  const [editingIdx, setEditingIdx] = useState(null); // index in custom[] or 'new'
  const [form,       setForm]       = useState(EMPTY_FORM);
  // testResults: { [providerKey]: { status: 'testing'|'ok'|'error', latencyMs?, error? } }
  const [testResults, setTestResults] = useState({});

  const fi = {
    width: '100%', padding: '0.5rem 0.75rem', borderRadius: '0.5rem',
    border: '1px solid var(--color-border)', background: 'var(--color-bg)',
    color: 'var(--color-text)', fontSize: '0.75rem', outline: 'none', boxSizing: 'border-box',
  };

  useEffect(() => {
    Promise.all([
      api.get('/admin/model-status'),
      api.get('/admin/providers'),
    ]).then(([statusData, provData]) => {
      setStatus(statusData);
      setCustom(provData);
    }).catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // ── Save helpers ────────────────────────────────────────────────────────────

  async function save(newList) {
    setSaving(true);
    try {
      const saved = await api.put('/admin/providers', { providers: newList });
      setCustom(saved);
      const s = await api.get('/admin/model-status');
      setStatus(s);
      setSuccess('Providers saved.');
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  // ── Edit / Add ──────────────────────────────────────────────────────────────

  function openAdd() {
    setForm({ ...EMPTY_FORM });
    setEditingIdx('new');
  }

  function openEdit(idx) {
    setForm({ ...EMPTY_FORM, ...custom[idx] });
    setEditingIdx(idx);
  }

  function cancelEdit() {
    setEditingIdx(null);
    setForm(EMPTY_FORM);
  }

  async function handleSave() {
    if (!form.key || !form.apiKeyEnv || !form.baseUrl) return;
    const entry = {
      key:         form.key.toLowerCase().trim(),
      label:       form.label.trim() || form.key,
      apiKeyEnv:   form.apiKeyEnv.trim(),
      baseUrl:     form.baseUrl.trim(),
      testModelId: form.testModelId.trim() || '',
    };
    let updated;
    if (editingIdx === 'new') {
      if (custom.some((p) => p.key === entry.key)) {
        setError('A custom provider with that key already exists.');
        return;
      }
      updated = [...custom, entry];
    } else {
      updated = custom.map((p, i) => (i === editingIdx ? entry : p));
    }
    const ok = await save(updated);
    if (ok) cancelEdit();
  }

  async function handleDelete(idx) {
    if (!window.confirm('Remove this provider?')) return;
    await save(custom.filter((_, i) => i !== idx));
  }

  // ── Test ────────────────────────────────────────────────────────────────────

  async function testProvider(providerKey, modelId) {
    if (!modelId) {
      const entered = window.prompt(
        `Enter a model ID to test ${providerKey} with:\n(e.g. ${providerKey}-model-name)`
      );
      if (!entered) return;
      modelId = entered.trim();
    }
    setTestResults((r) => ({ ...r, [providerKey]: { status: 'testing' } }));
    try {
      const result = await api.post(`/admin/models/${encodeURIComponent(modelId)}/test`);
      setTestResults((r) => ({
        ...r,
        [providerKey]: result.ok
          ? { status: 'ok',    latencyMs: result.latencyMs, modelId }
          : { status: 'error', error: result.error,         modelId },
      }));
    } catch (e) {
      setTestResults((r) => ({ ...r, [providerKey]: { status: 'error', error: e.message } }));
    }
  }

  function dismissTest(key) {
    setTestResults((r) => { const n = { ...r }; delete n[key]; return n; });
  }

  // ── Derived lists ───────────────────────────────────────────────────────────

  // Built-in providers: from model-status, excluding any key that's also a custom provider
  const builtins = Object.entries(status).filter(([k]) => !custom.some((c) => c.key === k));

  // ── Shared sub-components ───────────────────────────────────────────────────

  function TestResult({ provKey }) {
    const t = testResults[provKey];
    if (!t || t.status === 'testing') return null;
    return (
      <div
        className="mx-4 mb-3 px-3 py-2 rounded-xl text-xs flex items-start gap-2"
        style={{
          background: t.status === 'ok' ? '#f0fdf4' : '#fff1f2',
          color:      t.status === 'ok' ? '#16a34a' : '#991b1b',
        }}
      >
        <span className="flex-shrink-0">{t.status === 'ok' ? '✓' : '✗'}</span>
        <span className="flex-1">
          {t.status === 'ok'
            ? `Connected${t.modelId ? ` (${t.modelId})` : ''} — ${t.latencyMs}ms`
            : t.error}
        </span>
        <button
          onClick={() => dismissTest(provKey)}
          style={{ opacity: 0.5, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', flexShrink: 0 }}
        >✕</button>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-3xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>AI Providers</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Built-in providers are pre-configured. Add custom providers for any OpenAI-compatible API.
          </p>
        </div>
        <Button variant="primary" onClick={openAdd} disabled={saving}>+ Add provider</Button>
      </div>

      {error   && <InlineBanner type="error"   message={error}   onDismiss={() => setError('')}   className="mb-4" />}
      {success && <InlineBanner type="neutral" message={success} onDismiss={() => setSuccess('')} className="mb-4" />}

      {/* Add / Edit form */}
      {editingIdx !== null && (
        <div
          className="rounded-2xl border p-5 mb-5 space-y-4"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-primary)' }}
        >
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-primary)' }}>
            {editingIdx === 'new' ? 'Add provider' : 'Edit provider'}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider key *" hint="lowercase — prefix for model IDs">
              <input
                style={{ ...fi, fontFamily: 'monospace' }}
                placeholder="seedance"
                value={form.key}
                disabled={editingIdx !== 'new'}
                onChange={(e) => setForm((f) => ({ ...f, key: e.target.value.toLowerCase() }))}
              />
            </Field>
            <Field label="Display name">
              <input style={fi} placeholder="Seedance"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
            </Field>
            <Field label="API key env var *" hint="as set in Railway">
              <input
                style={{ ...fi, fontFamily: 'monospace' }}
                placeholder="SEEDANCE_API_KEY"
                value={form.apiKeyEnv}
                onChange={(e) => setForm((f) => ({ ...f, apiKeyEnv: e.target.value.toUpperCase() }))}
              />
            </Field>
            <Field label="Base URL *" hint="OpenAI-compatible endpoint">
              <input
                style={{ ...fi, fontFamily: 'monospace' }}
                placeholder="https://api.seedance.ai/v1/chat/completions"
                value={form.baseUrl}
                onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
              />
            </Field>
            <Field label="Test model ID" hint="used by the Test button">
              <input
                style={{ ...fi, fontFamily: 'monospace' }}
                placeholder={`${form.key || 'provider'}-model-name`}
                value={form.testModelId}
                onChange={(e) => setForm((f) => ({ ...f, testModelId: e.target.value }))}
              />
            </Field>
          </div>

          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Models whose ID starts with{' '}
            <code style={{ fontFamily: 'monospace' }}>{form.key || 'key'}-</code>{' '}
            will automatically route to this provider.
          </p>

          <div className="flex gap-2 pt-1">
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={saving || !form.key || !form.apiKeyEnv || !form.baseUrl}
            >
              {saving ? 'Saving…' : editingIdx === 'new' ? 'Add provider' : 'Save changes'}
            </Button>
            <Button variant="secondary" onClick={cancelEdit}>Cancel</Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</div>
      ) : (
        <div className="space-y-5">

          {/* ── Built-in providers ── */}
          {builtins.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>
                Built-in providers
              </p>
              <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                {builtins.map(([key, prov], i) => {
                  const test = testResults[key];
                  return (
                    <div
                      key={key}
                      style={{
                        background:   'var(--color-surface)',
                        borderBottom: i < builtins.length - 1 ? '1px solid var(--color-border)' : 'none',
                      }}
                    >
                      <div className="flex items-center gap-3 px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                            {prov.label || key}
                          </div>
                          <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>
                            {key}
                          </div>
                        </div>
                        {prov.configured ? (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: '#dcfce7', color: '#16a34a' }}>
                            ✓ API key set
                          </span>
                        ) : (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: '#fef3c7', color: '#b45309' }}>
                            ⚠ No API key
                          </span>
                        )}
                        <button
                          onClick={() => testProvider(key, BUILTIN_TEST_MODELS[key] || null)}
                          disabled={test?.status === 'testing' || !prov.configured}
                          className="text-xs px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-70 disabled:opacity-40 flex-shrink-0"
                          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'transparent', cursor: 'pointer' }}
                        >
                          {test?.status === 'testing' ? 'Testing…' : 'Test'}
                        </button>
                      </div>
                      <TestResult provKey={key} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Custom providers ── */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>
              Custom providers
            </p>
            {custom.length === 0 ? (
              <div
                className="rounded-2xl border px-4 py-8 text-center text-sm"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                No custom providers yet. Click &quot;+ Add provider&quot; to add one.
              </div>
            ) : (
              <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                {custom.map((p, i) => {
                  const test = testResults[p.key];
                  return (
                    <div
                      key={p.key}
                      style={{
                        background:   'var(--color-surface)',
                        borderBottom: i < custom.length - 1 ? '1px solid var(--color-border)' : 'none',
                      }}
                    >
                      <div className="flex items-center gap-3 px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                              {p.label || p.key}
                            </span>
                            {p.configured ? (
                              <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#dcfce7', color: '#16a34a' }}>
                                ✓ API key set
                              </span>
                            ) : (
                              <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#b45309' }}>
                                ⚠ {p.apiKeyEnv} not set
                              </span>
                            )}
                          </div>
                          <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>
                            key: {p.key} · env: {p.apiKeyEnv}
                          </div>
                          <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-muted)', opacity: 0.6 }}>
                            {p.baseUrl}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => testProvider(p.key, p.testModelId || null)}
                            disabled={test?.status === 'testing' || !p.configured}
                            className="text-xs px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-70 disabled:opacity-40"
                            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'transparent', cursor: 'pointer' }}
                          >
                            {test?.status === 'testing' ? 'Testing…' : 'Test'}
                          </button>
                          <button
                            onClick={() => openEdit(i)}
                            className="text-xs px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-70"
                            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'transparent', cursor: 'pointer' }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(i)}
                            disabled={saving}
                            className="text-xs px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-70 disabled:opacity-40"
                            style={{ borderColor: '#fca5a5', color: '#991b1b', background: 'transparent', cursor: 'pointer' }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      <TestResult provKey={p.key} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
