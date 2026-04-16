/**
 * AdminProvidersPage — full CRUD + test for all AI providers.
 *
 * Built-in providers (Anthropic, Google, OpenAI, etc.) show their API key
 * status and can be edited (label, testModelId) or deleted (hidden from UI).
 *
 * Custom providers are fully configurable: key, label, API key env var, base URL.
 */
import { useState, useEffect } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import InlineBanner from '../../components/ui/InlineBanner';

const BUILTIN_ENV_VARS = {
  anthropic: 'ANTHROPIC_API_KEY',
  google:    'GEMINI_API_KEY',
  openai:    'OPENAI_API_KEY',
  mistral:   'MISTRAL_API_KEY',
  deepseek:  'DEEPSEEK_API_KEY',
  xai:       'XAI_API_KEY',
  groq:      'GROQ_API_KEY',
};

const BUILTIN_TEST_MODELS = {
  anthropic: 'claude-haiku-4-5-20251001',
  google:    'gemini-2.0-flash',
  openai:    'gpt-4o-mini',
  mistral:   'mistral-small-latest',
  deepseek:  'deepseek-chat',
  xai:       'grok-3-mini',
  groq:      'llama-3.1-8b-instant',
};

const EMPTY_FORM = {
  key: '', label: '', apiKeyEnv: '', baseUrl: '', testModelId: '',
  _isBuiltin: false,
};

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
  // allProviders: merged list of built-ins (from model-status) + custom overrides/additions
  const [builtinStatus, setBuiltinStatus] = useState({}); // { key: { label, configured } } — raw from server
  const [saved,         setSaved]         = useState([]); // raw custom_providers from DB
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState('');
  const [success,       setSuccess]       = useState('');
  const [editingKey,    setEditingKey]    = useState(null); // key being edited, or 'new'
  const [form,          setForm]          = useState(EMPTY_FORM);
  const [testResults,   setTestResults]   = useState({});

  const fi = {
    width: '100%', padding: '0.5rem 0.75rem', borderRadius: '0.5rem',
    border: '1px solid var(--color-border)', background: 'var(--color-bg)',
    color: 'var(--color-text)', fontSize: '0.75rem', outline: 'none', boxSizing: 'border-box',
  };
  const fiReadonly = { ...fi, opacity: 0.6, cursor: 'default' };

  async function reload() {
    const [statusData, provData] = await Promise.all([
      api.get('/admin/model-status'),
      api.get('/admin/providers'),
    ]);
    setBuiltinStatus(statusData);
    setSaved(provData);
  }

  useEffect(() => {
    reload().catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  // ── Save ───────────────────────────────────────────────────────────────────

  async function persist(newList) {
    setSaving(true);
    try {
      const result = await api.put('/admin/providers', { providers: newList });
      setSaved(result);
      const s = await api.get('/admin/model-status');
      setBuiltinStatus(s);
      setSuccess('Saved.');
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  // ── Edit ───────────────────────────────────────────────────────────────────

  function openAdd() {
    setForm({ ...EMPTY_FORM, _isBuiltin: false });
    setEditingKey('new');
  }

  function openEditBuiltin(key, statusEntry) {
    const override = saved.find((p) => p.key === key && p.builtin);
    setForm({
      ...EMPTY_FORM,
      key,
      label:       override?.label       || statusEntry.label || key,
      testModelId: override?.testModelId || BUILTIN_TEST_MODELS[key] || '',
      apiKeyEnv:   override?.apiKeyEnv   || BUILTIN_ENV_VARS[key] || '',
      _isBuiltin:  true,
    });
    setEditingKey(key);
  }

  function openEditCustom(p) {
    setForm({ ...EMPTY_FORM, ...p, _isBuiltin: false });
    setEditingKey(p.key);
  }

  function cancelEdit() {
    setEditingKey(null);
    setForm(EMPTY_FORM);
  }

  async function handleSave() {
    if (!form.key) return;
    if (!form._isBuiltin && (!form.apiKeyEnv || !form.baseUrl)) return;

    let newList;

    if (form._isBuiltin) {
      const entry = {
        key:         form.key,
        label:       form.label.trim() || form.key,
        apiKeyEnv:   form.apiKeyEnv.trim() || undefined,
        testModelId: form.testModelId.trim(),
        builtin:     true,
      };
      const existing = saved.findIndex((p) => p.key === form.key && p.builtin);
      newList = existing >= 0
        ? saved.map((p, i) => (i === existing ? entry : p))
        : [...saved, entry];
    } else {
      // Custom provider
      const entry = {
        key:         form.key.toLowerCase().trim(),
        label:       form.label.trim() || form.key,
        apiKeyEnv:   form.apiKeyEnv.trim(),
        baseUrl:     form.baseUrl.trim(),
        testModelId: form.testModelId.trim(),
      };
      if (editingKey === 'new') {
        if (saved.some((p) => p.key === entry.key)) {
          setError('A provider with that key already exists.');
          return;
        }
        newList = [...saved, entry];
      } else {
        newList = saved.map((p) => (p.key === editingKey && !p.builtin ? entry : p));
      }
    }

    const ok = await persist(newList);
    if (ok) cancelEdit();
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async function deleteBuiltin(key) {
    if (!window.confirm(`Hide "${key}" from the providers list?`)) return;
    // Mark as hidden in the saved list
    const existing = saved.findIndex((p) => p.key === key && p.builtin);
    const hiddenEntry = { key, builtin: true, hidden: true };
    const newList = existing >= 0
      ? saved.map((p, i) => (i === existing ? hiddenEntry : p))
      : [...saved, hiddenEntry];
    await persist(newList);
  }

  async function deleteCustom(key) {
    if (!window.confirm('Remove this provider?')) return;
    await persist(saved.filter((p) => !(p.key === key && !p.builtin)));
  }

  // ── Test ───────────────────────────────────────────────────────────────────

  async function testProvider(providerKey, modelId) {
    if (!modelId) {
      const entered = window.prompt(`Enter a model ID to test ${providerKey}:`);
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

  // ── Derived lists ──────────────────────────────────────────────────────────

  // Built-in overrides keyed by provider key
  const builtinOverrides = Object.fromEntries(
    saved.filter((p) => p.builtin).map((p) => [p.key, p])
  );

  // Visible built-ins: from model-status (server already filters hidden ones)
  // Cross-reference with saved overrides for label/testModelId
  const builtins = Object.entries(builtinStatus)
    .filter(([, v]) => !v.custom)  // exclude fully-custom entries from this list
    .map(([key, prov]) => ({
      key,
      label:       builtinOverrides[key]?.label || prov.label || key,
      configured:  prov.configured,
      testModelId: builtinOverrides[key]?.testModelId || BUILTIN_TEST_MODELS[key] || '',
      envVar:      BUILTIN_ENV_VARS[key] || '',
    }));

  // Fully custom providers (no builtin flag)
  const customs = saved.filter((p) => !p.builtin);

  // ── Row sub-component ──────────────────────────────────────────────────────

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

  const btnBase = {
    borderColor: 'var(--color-border)', color: 'var(--color-muted)',
    background: 'transparent', cursor: 'pointer',
  };
  const btnDanger = { borderColor: '#fca5a5', color: '#991b1b', background: 'transparent', cursor: 'pointer' };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-3xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>AI Providers</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Manage built-in and custom provider configurations. Add any OpenAI-compatible API as a custom provider.
          </p>
        </div>
        <Button variant="primary" onClick={openAdd} disabled={saving}>+ Add provider</Button>
      </div>

      {error   && <InlineBanner type="error"   message={error}   onDismiss={() => setError('')}   className="mb-4" />}
      {success && <InlineBanner type="neutral" message={success} onDismiss={() => setSuccess('')} className="mb-4" />}

      {/* ── Add / Edit form ── */}
      {editingKey !== null && (
        <div
          className="rounded-2xl border p-5 mb-5 space-y-4"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-primary)' }}
        >
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-primary)' }}>
            {editingKey === 'new' ? 'Add provider' : `Edit — ${form.label || form.key}`}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider key *" hint={form._isBuiltin ? 'built-in, cannot change' : 'lowercase prefix for model IDs'}>
              <input
                style={{ ...(form._isBuiltin ? fiReadonly : { ...fi, fontFamily: 'monospace' }) }}
                value={form.key}
                disabled={editingKey !== 'new' || form._isBuiltin}
                placeholder="e.g. seedance"
                onChange={(e) => setForm((f) => ({ ...f, key: e.target.value.toLowerCase() }))}
              />
            </Field>
            <Field label="Display name">
              <input style={fi} placeholder={form.key || 'Provider name'}
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
            </Field>

            {form._isBuiltin ? (
              <Field label="API key env var" hint="name of the variable set in Railway">
                <input
                  style={{ ...fi, fontFamily: 'monospace' }}
                  value={form.apiKeyEnv}
                  onChange={(e) => setForm((f) => ({ ...f, apiKeyEnv: e.target.value.toUpperCase() }))}
                />
              </Field>
            ) : (
              <>
                <Field label="API key env var *" hint="name set in Railway">
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
                    placeholder="https://api.example.com/v1/chat/completions"
                    value={form.baseUrl}
                    onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                  />
                </Field>
              </>
            )}

            <Field label="Test model ID" hint="used by the Test button">
              <input
                style={{ ...fi, fontFamily: 'monospace' }}
                placeholder={form.key ? `${form.key}-model-name` : 'e.g. provider-model-v1'}
                value={form.testModelId}
                onChange={(e) => setForm((f) => ({ ...f, testModelId: e.target.value }))}
              />
            </Field>
          </div>

          {!form._isBuiltin && (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Models whose ID starts with <code style={{ fontFamily: 'monospace' }}>{form.key || 'key'}-</code> will route to this provider.
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={saving || !form.key || (!form._isBuiltin && (!form.apiKeyEnv || !form.baseUrl))}
            >
              {saving ? 'Saving…' : editingKey === 'new' ? 'Add provider' : 'Save changes'}
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
                {builtins.map((p, i) => {
                  const test = testResults[p.key];
                  return (
                    <div key={p.key} style={{
                      background:   'var(--color-surface)',
                      borderBottom: i < builtins.length - 1 ? '1px solid var(--color-border)' : 'none',
                    }}>
                      <div className="flex items-center gap-3 px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{p.label}</div>
                          <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>
                            {p.key}{p.envVar ? ` · ${p.envVar}` : ''}
                          </div>
                        </div>
                        {p.configured ? (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: '#dcfce7', color: '#16a34a' }}>✓ API key set</span>
                        ) : (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: '#fef3c7', color: '#b45309' }}>⚠ No API key</span>
                        )}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => testProvider(p.key, p.testModelId || null)}
                            disabled={test?.status === 'testing'}
                            className="text-xs px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-70 disabled:opacity-40"
                            style={btnBase}
                          >
                            {test?.status === 'testing' ? 'Testing…' : 'Test'}
                          </button>
                          <button
                            onClick={() => openEditBuiltin(p.key, { label: p.label })}
                            className="text-xs px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-70"
                            style={btnBase}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteBuiltin(p.key)}
                            disabled={saving}
                            className="text-xs px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-70 disabled:opacity-40"
                            style={btnDanger}
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
            </div>
          )}

          {/* ── Custom providers ── */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>
              Custom providers
            </p>
            {customs.length === 0 ? (
              <div className="rounded-2xl border px-4 py-8 text-center text-sm"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                No custom providers yet. Click &quot;+ Add provider&quot; to add one.
              </div>
            ) : (
              <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                {customs.map((p, i) => {
                  const test = testResults[p.key];
                  return (
                    <div key={p.key} style={{
                      background:   'var(--color-surface)',
                      borderBottom: i < customs.length - 1 ? '1px solid var(--color-border)' : 'none',
                    }}>
                      <div className="flex items-center gap-3 px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{p.label || p.key}</span>
                            {p.configured === true  && <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#dcfce7', color: '#16a34a' }}>✓ API key set</span>}
                            {p.configured === false && <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#b45309' }}>⚠ {p.apiKeyEnv} not set</span>}
                          </div>
                          <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>
                            key: {p.key} · env: {p.apiKeyEnv}
                          </div>
                          <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-muted)', opacity: 0.6 }}>{p.baseUrl}</div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => testProvider(p.key, p.testModelId || null)}
                            disabled={test?.status === 'testing'}
                            className="text-xs px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-70 disabled:opacity-40"
                            style={btnBase}
                          >
                            {test?.status === 'testing' ? 'Testing…' : 'Test'}
                          </button>
                          <button
                            onClick={() => openEditCustom(p)}
                            className="text-xs px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-70"
                            style={btnBase}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteCustom(p.key)}
                            disabled={saving}
                            className="text-xs px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-70 disabled:opacity-40"
                            style={btnDanger}
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
