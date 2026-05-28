/**
 * ModelsTab — Settings tab for managing AI models, default, and fallback.
 * Only visible to org_admin users.
 *
 * Features:
 *   - Model table with add/edit/delete
 *   - Default model dropdown
 *   - Fallback model dropdown
 *   - Per-model test (ping) with result display
 *   - API key status bar
 *   - Reset to defaults
 */
import { useState, useEffect } from 'react';
import api from '../../api/client';
import useAuthStore from '../../stores/authStore';
import Button from '../ui/Button';
import InlineBanner from '../ui/InlineBanner';

const TIERS = ['standard', 'advanced', 'premium'];
const CAPABILITIES = [
  { key: 'tool_use', label: 'Tool use' },
  { key: 'vision', label: 'Vision' },
  { key: 'long_context', label: 'Long context' },
  { key: 'json_reliable', label: 'Reliable JSON' },
];

const TIER_META = {
  standard: { label: 'Economy',  color: '#059669', bg: 'rgba(5,150,105,0.1)'   },
  advanced: { label: 'Standard', color: '#2563eb', bg: 'rgba(37,99,235,0.1)'   },
  premium:  { label: 'Premium',  color: '#7c3aed', bg: 'rgba(124,58,237,0.1)'  },
};

const EMPTY_FORM = {
  id: '', name: '', tier: 'advanced', provider: 'anthropic',
  emoji: '🤖', label: '', tagline: '', desc: '',
  inputPricePer1M: '', outputPricePer1M: '', contextWindow: 200000,
  capabilities: { tool_use: true, vision: false, long_context: true, json_reliable: true },
  enabled: true,
};

const FIELD = 'w-full px-3 py-2.5 rounded-xl border text-sm outline-none';
const FIELD_STYLE = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const LABEL = 'block text-xs font-semibold uppercase tracking-wider mb-1.5';
const LABEL_STYLE = { color: 'var(--color-muted)' };

function Field({ label, hint, children }) {
  return (
    <div>
      <label className={LABEL} style={LABEL_STYLE}>
        {label}
        {hint && <span className="ml-1 font-normal opacity-60">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function normaliseCapabilities(capabilities) {
  return CAPABILITIES.reduce((next, capability) => {
    next[capability.key] = capabilities?.[capability.key] === true;
    return next;
  }, {});
}

function Section({ title, children }) {
  return (
    <div className="rounded-2xl border p-6 space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h2>
      {children}
    </div>
  );
}

export default function ModelsTab() {
  const { user } = useAuthStore();
  const isAdmin = user?.roles?.some((r) => r.name === 'org_admin');

  const [models,              setModels]              = useState([]);
  const [loading,             setLoading]             = useState(true);
  const [apiKeyOk,            setApiKeyOk]            = useState({});
  const [saving,              setSaving]              = useState(false);
  const [error,               setError]               = useState('');
  const [success,             setSuccess]             = useState('');
  const [editingId,           setEditingId]           = useState(null);
  const [form,                setForm]                = useState(EMPTY_FORM);
  const [defaultModel,        setDefaultModel]        = useState(null);
  const [fallbackModel,       setFallbackModel]       = useState(null);
  const [pdfExtractionModel,  setPdfExtractionModel]  = useState(null);
  const [lessonModel,         setLessonModel]         = useState(null);
  const [tieredValidation,    setTieredValidation]    = useState({ confidence_threshold: 0.85, escalation_model: null });
  const [savingDefaults,      setSavingDefaults]      = useState(false);
  const [testResults,         setTestResults]         = useState({});

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return; }
    Promise.all([
      api.get('/settings/models'),
      api.get('/settings/model-status'),
      api.get('/settings/default-model'),
      api.get('/settings/fallback-model'),
      api.get('/settings/lesson-model'),
      api.get('/settings/tiered-validation'),
      api.get('/admin/agents/spec-validator').catch(() => null),
    ]).then(([modelData, statusData, defaultData, fallbackData, lessonData, validationData, svConfig]) => {
      setModels(modelData);
      setApiKeyOk(statusData);
      setDefaultModel(defaultData.model_id ?? null);
      setFallbackModel(fallbackData.model_id ?? null);
      setLessonModel(lessonData.model_id ?? null);
      setTieredValidation({
        confidence_threshold: validationData.confidence_threshold ?? 0.85,
        escalation_model: validationData.escalation_model ?? null,
      });
      setPdfExtractionModel(svConfig?.model ?? null);
    }).catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  async function saveDefaults() {
    setSavingDefaults(true);
    try {
      await Promise.all([
        api.put('/settings/default-model', { model_id: defaultModel || null }),
        api.put('/settings/fallback-model', { model_id: fallbackModel || null }),
        api.put('/admin/agents/spec-validator',         { model: pdfExtractionModel || null }),
        api.put('/admin/agents/demo-spec-validator',    { model: pdfExtractionModel || null }),
        api.put('/admin/agents/demo-document-analyzer', { model: pdfExtractionModel || null }),
        api.put('/admin/agents/demo-tender-response',   { model: pdfExtractionModel || null }),
        api.put('/settings/lesson-model', { model_id: lessonModel || null }),
        api.put('/settings/tiered-validation', tieredValidation),
      ]);
      setSuccess('Models saved.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingDefaults(false);
    }
  }

  async function persist(newModels, successMsg = 'Models updated.') {
    setSaving(true);
    try {
      await api.put('/settings/models', { models: newModels });
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

  function openAdd() {
    setForm({ ...EMPTY_FORM });
    setEditingId('new');
  }

  function openEdit(m) {
    setForm({ ...m, capabilities: normaliseCapabilities(m.capabilities) });
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
      capabilities:     normaliseCapabilities(form.capabilities),
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

  async function handleDelete(id) {
    if (!window.confirm('Remove this model?')) return;
    await persist(models.filter((m) => m.id !== id), 'Model removed.');
  }

  async function handleReset() {
    if (!window.confirm('Reset to default models? Any custom models will be removed.')) return;
    setSaving(true);
    try {
      const data = await api.post('/settings/models/reset', {});
      setModels(data.models);
      setSuccess('Reset to defaults.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function testModel(modelId) {
    setTestResults((r) => ({ ...r, [modelId]: { status: 'testing' } }));
    try {
      const result = await api.post(`/settings/models/${encodeURIComponent(modelId)}/test`);
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

  // ── Not admin? Show nothing ──────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <div className="p-8 text-center text-sm" style={{ color: 'var(--color-muted)' }}>
        You don't have permission to manage models.
      </div>
    );
  }

  // ── Derived ──────────────────────────────────────────────────────────────

  const activeModels = models.filter((m) => m.enabled);
  const defaultIsInactive = defaultModel && !activeModels.some((m) => m.id === defaultModel);
  const fallbackIsInactive = fallbackModel && !activeModels.some((m) => m.id === fallbackModel);
  const pdfExtractionIsInactive = pdfExtractionModel && !activeModels.some((m) => m.id === pdfExtractionModel);
  const lessonIsInactive = lessonModel && !activeModels.some((m) => m.id === lessonModel);
  const defaultModelObj = models.find((m) => m.id === defaultModel);
  const fallbackModelObj = models.find((m) => m.id === fallbackModel);
  const pdfExtractionModelObj = models.find((m) => m.id === pdfExtractionModel);
  const lessonModelObj = models.find((m) => m.id === lessonModel);
  const validationModelObj = models.find((m) => m.id === tieredValidation.escalation_model);
  const validationModelIsInactive = tieredValidation.escalation_model && !activeModels.some((m) => m.id === tieredValidation.escalation_model);

  const fi = {
    width: '100%', padding: '0.5rem 0.75rem', borderRadius: '0.5rem',
    border: '1px solid var(--color-border)', background: 'var(--color-bg)',
    color: 'var(--color-text)', fontSize: '0.75rem', outline: 'none', boxSizing: 'border-box',
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {error   && <InlineBanner type="error"   message={error}   onDismiss={() => setError('')} />}
      {success && <InlineBanner type="neutral" message={success} onDismiss={() => setSuccess('')} />}

      {/* Default & Fallback */}
      {!loading && (
        <Section title="Default & Fallback Models">
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            The default model is used by all agents unless overridden per-agent.
            If the default fails, the fallback model is used automatically.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className={LABEL} style={LABEL_STYLE}>Default model</label>
              <select
                value={defaultModel ?? ''}
                onChange={(e) => setDefaultModel(e.target.value)}
                className={FIELD}
                style={{
                  ...FIELD_STYLE,
                  borderColor: defaultIsInactive ? '#fca5a5' : 'var(--color-border)',
                }}
              >
                <option value="">— No default —</option>
                {defaultIsInactive && defaultModelObj && (
                  <option value={defaultModelObj.id} disabled style={{ color: '#991b1b' }}>
                    ⚠ {defaultModelObj.name} (inactive)
                  </option>
                )}
                {activeModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} — {m.id}</option>
                ))}
              </select>
              {defaultIsInactive && (
                <p className="text-xs mt-1" style={{ color: '#991b1b' }}>⚠ Default is inactive</p>
              )}
            </div>

            <div>
              <label className={LABEL} style={LABEL_STYLE}>Fallback model</label>
              <select
                value={fallbackModel ?? ''}
                onChange={(e) => setFallbackModel(e.target.value)}
                className={FIELD}
                style={{
                  ...FIELD_STYLE,
                  borderColor: fallbackIsInactive ? '#fca5a5' : 'var(--color-border)',
                }}
              >
                <option value="">— No fallback —</option>
                {fallbackIsInactive && fallbackModelObj && (
                  <option value={fallbackModelObj.id} disabled style={{ color: '#991b1b' }}>
                    ⚠ {fallbackModelObj.name} (inactive)
                  </option>
                )}
                {activeModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} — {m.id}</option>
                ))}
              </select>
              {fallbackIsInactive && (
                <p className="text-xs mt-1" style={{ color: '#991b1b' }}>⚠ Fallback is inactive</p>
              )}
            </div>

            <div>
              <label className={LABEL} style={LABEL_STYLE}>PDF extraction model</label>
              <select
                value={pdfExtractionModel ?? ''}
                onChange={(e) => setPdfExtractionModel(e.target.value)}
                className={FIELD}
                style={{
                  ...FIELD_STYLE,
                  borderColor: pdfExtractionIsInactive ? '#fca5a5' : 'var(--color-border)',
                }}
              >
                <option value="">— Use default —</option>
                {pdfExtractionIsInactive && pdfExtractionModelObj && (
                  <option value={pdfExtractionModelObj.id} disabled style={{ color: '#991b1b' }}>
                    ⚠ {pdfExtractionModelObj.name} (inactive)
                  </option>
                )}
                {activeModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} — {m.id}</option>
                ))}
              </select>
              {pdfExtractionIsInactive && (
                <p className="text-xs mt-1" style={{ color: '#991b1b' }}>⚠ PDF extraction model is inactive</p>
              )}
            </div>
            <div>
              <label className={LABEL} style={LABEL_STYLE}>Lesson AI model</label>
              <select
                value={lessonModel ?? ''}
                onChange={(e) => setLessonModel(e.target.value)}
                className={FIELD}
                style={{
                  ...FIELD_STYLE,
                  borderColor: lessonIsInactive ? '#fca5a5' : 'var(--color-border)',
                }}
              >
                <option value="">— No lesson AI —</option>
                {lessonIsInactive && lessonModelObj && (
                  <option value={lessonModelObj.id} disabled style={{ color: '#991b1b' }}>
                    ⚠ {lessonModelObj.name} (inactive)
                  </option>
                )}
                {activeModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} — {m.id}</option>
                ))}
              </select>
              {lessonIsInactive && (
                <p className="text-xs mt-1" style={{ color: '#991b1b' }}>⚠ Lesson AI model is inactive</p>
              )}
            </div>

          </div>

          <div className="flex justify-end">
            <Button variant="primary" onClick={saveDefaults} disabled={savingDefaults}>
              {savingDefaults ? 'Saving…' : 'Save defaults'}
            </Button>
          </div>
        </Section>
      )}

      {!loading && (
        <Section title="Tiered Extraction Validation">
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            File-capable agents can validate cheap extraction output automatically. Agents opt in individually; this global model and threshold define the shared escalation baseline.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL} style={LABEL_STYLE}>Escalation model</label>
              <select
                value={tieredValidation.escalation_model ?? ''}
                onChange={(e) => setTieredValidation((c) => ({ ...c, escalation_model: e.target.value || null }))}
                className={FIELD}
                style={{
                  ...FIELD_STYLE,
                  borderColor: validationModelIsInactive ? '#fca5a5' : 'var(--color-border)',
                }}
              >
                <option value="">— No escalation model —</option>
                {validationModelIsInactive && validationModelObj && (
                  <option value={validationModelObj.id} disabled style={{ color: '#991b1b' }}>
                    ⚠ {validationModelObj.name} (inactive)
                  </option>
                )}
                {activeModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} — {m.id}</option>
                ))}
              </select>
              {validationModelIsInactive && (
                <p className="text-xs mt-1" style={{ color: '#991b1b' }}>⚠ Escalation model is inactive</p>
              )}
            </div>
            <div>
              <label className={LABEL} style={LABEL_STYLE}>Default confidence threshold</label>
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={tieredValidation.confidence_threshold}
                onChange={(e) => setTieredValidation((c) => ({ ...c, confidence_threshold: parseFloat(e.target.value) || 0 }))}
                className={FIELD}
                style={FIELD_STYLE}
              />
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                Agents inherit this unless they set an override in Admin › Agents.
              </p>
            </div>
          </div>
        </Section>
      )}

      {/* API key status */}
      {Object.keys(apiKeyOk).length > 0 && (
        <div
          className="flex items-center gap-4 px-4 py-2.5 rounded-xl border text-sm flex-wrap"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          {Object.entries(apiKeyOk).map(([key, prov]) => (
            <div key={key} className="flex items-center gap-2">
              <span style={{ color: 'var(--color-muted)' }}>{prov.label} API key:</span>
              {prov.configured ? (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#dcfce7', color: '#16a34a' }}>✓ Configured</span>
              ) : (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#b45309' }}>⚠ Not set</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Model list */}
      <Section title="Models">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Add, edit, or remove models. The model ID must match the exact API identifier.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={handleReset} disabled={saving}>
              Reset defaults
            </Button>
            <Button variant="primary" onClick={openAdd} disabled={saving}>
              + Add model
            </Button>
          </div>
        </div>

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
              <Field label="Model API ID *" hint="exact API identifier, e.g. claude-sonnet-4-6">
                <input
                  style={{ ...fi, fontFamily: 'monospace' }}
                  placeholder="e.g. claude-sonnet-4-6, gpt-4o"
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
              <Field label="Provider">
                <input
                  style={fi}
                  placeholder="e.g. anthropic, openai"
                  value={form.provider}
                  onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value.toLowerCase().trim() }))}
                />
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

            <Field label="Capabilities" hint="used to validate model choices before an agent run">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {CAPABILITIES.map((capability) => (
                  <label
                    key={capability.key}
                    className="flex items-center gap-2 text-xs rounded-xl border px-3 py-2"
                    style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    <input
                      type="checkbox"
                      checked={form.capabilities?.[capability.key] === true}
                      onChange={(e) => setForm((f) => ({
                        ...f,
                        capabilities: { ...normaliseCapabilities(f.capabilities), [capability.key]: e.target.checked },
                      }))}
                    />
                    {capability.label}
                  </label>
                ))}
              </div>
            </Field>

            <div className="flex gap-2 pt-1">
              <Button variant="primary" onClick={handleSave} disabled={saving || !form.id.trim() || !form.name.trim()}>
                {saving ? 'Saving…' : editingId === 'new' ? 'Add model' : 'Save changes'}
              </Button>
              <Button variant="secondary" onClick={cancelEdit}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</div>
        ) : models.length === 0 ? (
          <div className="p-10 text-center text-sm" style={{ color: 'var(--color-muted)' }}>
            No models configured. Add one above or reset to defaults.
          </div>
        ) : (
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
            {models.map((m, i) => {
              const tier = TIER_META[m.tier] ?? TIER_META.advanced;
              const test = testResults[m.id];
              const isCurrentDefault = m.id === defaultModel;
              const isCurrentFallback = m.id === fallbackModel;
              const isSpecValidator = m.id === pdfExtractionModel;
              const isLessonModel = m.id === lessonModel;
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
                        {isCurrentDefault && (
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{ background: 'rgba(37,99,235,0.1)', color: '#2563eb' }}
                          >
                            default
                          </span>
                        )}
                        {isCurrentFallback && (
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}
                          >
                            fallback
                          </span>
                        )}
                        {isSpecValidator && (
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{ background: 'rgba(5,150,105,0.1)', color: '#059669' }}
                          >
                            spec-validator
                          </span>
                        )}
                        {isLessonModel && (
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{ background: 'rgba(147,51,234,0.1)', color: '#9333ea' }}
                          >
                            lesson
                          </span>
                        )}
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
                      {m.capabilities && (
                        <div className="flex gap-1 flex-wrap mt-1">
                          {CAPABILITIES.filter((capability) => m.capabilities?.[capability.key]).map((capability) => (
                            <span
                              key={capability.key}
                              className="text-xs px-1.5 py-0.5 rounded"
                              style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}
                            >
                              {capability.label}
                            </span>
                          ))}
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
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
