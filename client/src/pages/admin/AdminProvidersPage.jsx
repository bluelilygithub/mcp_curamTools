/**
 * AdminProvidersPage — manage custom AI provider configurations.
 *
 * Built-in providers (Anthropic, Google, OpenAI, Mistral, DeepSeek, xAI, Groq)
 * are shown as read-only with their API key status.
 *
 * Custom providers are fully editable: add name, API key env var, and base URL.
 * The platform auto-routes any model whose ID starts with the provider key.
 *
 * Example custom provider:
 *   Key:         seedance
 *   Label:       Seedance
 *   API key env: SEEDANCE_API_KEY       ← set this in Railway
 *   Base URL:    https://api.seedance.ai/v1/chat/completions
 */
import { useState, useEffect } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import InlineBanner from '../../components/ui/InlineBanner';

const BUILTIN_LABELS = {
  anthropic: 'Anthropic',
  google:    'Google (Gemini)',
  openai:    'OpenAI',
  mistral:   'Mistral',
  deepseek:  'DeepSeek',
  xai:       'xAI (Grok)',
  groq:      'Groq',
};

const EMPTY_FORM = { key: '', label: '', apiKeyEnv: '', baseUrl: '' };

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
  const [status,      setStatus]      = useState({});   // { key: { label, configured, custom? } }
  const [custom,      setCustom]      = useState([]);   // saved custom providers
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  const [success,     setSuccess]     = useState('');
  const [editingIdx,  setEditingIdx]  = useState(null); // index in custom[], or 'new'
  const [form,        setForm]        = useState(EMPTY_FORM);

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

  async function save(newList) {
    setSaving(true);
    try {
      const saved = await api.put('/admin/providers', { providers: newList });
      setCustom(saved);
      // Refresh status to pick up new provider
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

  function openAdd() {
    setForm({ ...EMPTY_FORM });
    setEditingIdx('new');
  }

  function openEdit(idx) {
    setForm({ ...custom[idx] });
    setEditingIdx(idx);
  }

  function cancelEdit() {
    setEditingIdx(null);
    setForm(EMPTY_FORM);
  }

  async function handleSave() {
    if (!form.key || !form.apiKeyEnv || !form.baseUrl) return;
    const entry = {
      key:       form.key.toLowerCase().trim(),
      label:     form.label || form.key,
      apiKeyEnv: form.apiKeyEnv.trim(),
      baseUrl:   form.baseUrl.trim(),
    };
    let updated;
    if (editingIdx === 'new') {
      if (custom.some((p) => p.key === entry.key) || BUILTIN_LABELS[entry.key]) {
        setError('A provider with that key already exists.');
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

  // Builtin providers from status (exclude ones also in custom list)
  const builtins = Object.entries(status).filter(([k]) => !custom.some((c) => c.key === k));

  return (
    <div className="p-6 max-w-3xl mx-auto">

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
            <Field label="Provider key *" hint="lowercase — used as model ID prefix">
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
            <Field label="API key env var *" hint="name set in Railway">
              <input
                style={{ ...fi, fontFamily: 'monospace' }}
                placeholder="SEEDANCE_API_KEY"
                value={form.apiKeyEnv}
                onChange={(e) => setForm((f) => ({ ...f, apiKeyEnv: e.target.value.toUpperCase() }))}
              />
            </Field>
            <Field label="Base URL *" hint="OpenAI-compatible chat endpoint">
              <input
                style={{ ...fi, fontFamily: 'monospace' }}
                placeholder="https://api.seedance.ai/v1/chat/completions"
                value={form.baseUrl}
                onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} />
            </Field>
          </div>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Models whose ID starts with <code style={{ fontFamily: 'monospace' }}>{form.key || 'key'}-</code> will automatically route to this provider.
          </p>
          <div className="flex gap-2 pt-1">
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={saving || !form.key || !form.apiKeyEnv || !form.baseUrl}
            >
              {saving ? 'Saving...' : editingIdx === 'new' ? 'Add provider' : 'Save changes'}
            </Button>
            <Button variant="secondary" onClick={cancelEdit}>Cancel</Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-sm" style={{ color: 'var(--color-muted)' }}>Loading...</div>
      ) : (
        <div className="space-y-4">

          {/* Built-in providers */}
          {builtins.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>
                Built-in providers
              </p>
              <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                {builtins.map(([key, prov], i) => (
                  <div
                    key={key}
                    className="flex items-center gap-3 px-4 py-3"
                    style={{
                      background:   'var(--color-surface)',
                      borderBottom: i < builtins.length - 1 ? '1px solid var(--color-border)' : 'none',
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                        {prov.label || BUILTIN_LABELS[key] || key}
                      </div>
                      <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>
                        {key}
                      </div>
                    </div>
                    {prov.configured ? (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#dcfce7', color: '#16a34a' }}>
                        API key set
                      </span>
                    ) : (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#b45309' }}>
                        No API key
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Custom providers */}
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
                {custom.map((p, i) => (
                  <div
                    key={p.key}
                    className="flex items-center gap-3 px-4 py-3"
                    style={{
                      background:   'var(--color-surface)',
                      borderBottom: i < custom.length - 1 ? '1px solid var(--color-border)' : 'none',
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                          {p.label || p.key}
                        </span>
                        {p.configured ? (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#dcfce7', color: '#16a34a' }}>
                            API key set
                          </span>
                        ) : (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#b45309' }}>
                            {p.apiKeyEnv} not set
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
                ))}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
