/**
 * AdminModelsPage — toggle model availability; test each model's API connection.
 */
import { useState, useEffect } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import InlineBanner from '../../components/ui/InlineBanner';
import { useIcon } from '../../providers/IconProvider';

const TIER_LABELS = { standard: 'Standard', advanced: 'Advanced', premium: 'Premium' };

function TestResult({ result }) {
  if (!result) return null;
  if (result.status === 'testing') {
    return <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Testing…</span>;
  }
  if (result.status === 'ok') {
    return (
      <span className="text-xs font-medium" style={{ color: '#16a34a' }}>
        ✓ {result.latencyMs}ms
      </span>
    );
  }
  return (
    <span className="text-xs font-medium" title={result.error} style={{ color: '#dc2626' }}>
      ✗ {result.error?.length > 40 ? result.error.slice(0, 40) + '…' : result.error}
    </span>
  );
}

export default function AdminModelsPage() {
  const getIcon = useIcon();
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  // testResults: { [modelId]: { status: 'testing'|'ok'|'error', latencyMs?, error? } }
  const [testResults, setTestResults] = useState({});

  useEffect(() => {
    api.get('/admin/models')
      .then(setModels)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function toggleModel(id) {
    setModels((m) => m.map((model) => model.id === id ? { ...model, enabled: !model.enabled } : model));
  }

  async function save() {
    setSaving(true);
    setSuccess('');
    try {
      await api.put('/admin/models', { models });
      setSuccess('Models updated.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function testModel(modelId) {
    setTestResults((prev) => ({ ...prev, [modelId]: { status: 'testing' } }));
    try {
      const result = await api.post(`/admin/models/${encodeURIComponent(modelId)}/test`);
      setTestResults((prev) => ({
        ...prev,
        [modelId]: result.ok
          ? { status: 'ok',    latencyMs: result.latencyMs }
          : { status: 'error', error: result.error, latencyMs: result.latencyMs },
      }));
    } catch (e) {
      setTestResults((prev) => ({ ...prev, [modelId]: { status: 'error', error: e.message } }));
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>AI Models</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Control which models are available to your organisation. Use Test to verify API connectivity.
          </p>
        </div>
        <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
      </div>

      {error   && <InlineBanner type="error"   message={error}   onDismiss={() => setError('')}   className="mb-4" />}
      {success && <InlineBanner type="neutral" message={success} onDismiss={() => setSuccess('')} className="mb-4" />}

      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
        {loading ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</div>
        ) : (
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                {['Model', 'Tier', 'Enabled', 'API Test'].map((col) => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {models.map((m) => {
                const result = testResults[m.id];
                const testing = result?.status === 'testing';
                return (
                  <tr key={m.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{m.name}</div>
                      <div className="text-xs font-mono" style={{ color: 'var(--color-muted)' }}>{m.id}</div>
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-muted)' }}>
                      {TIER_LABELS[m.tier] ?? m.tier}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleModel(m.id)}
                        className="relative inline-flex h-5 w-9 rounded-full transition-all"
                        style={{ background: m.enabled ? 'var(--color-primary)' : 'var(--color-border)' }}
                      >
                        <span
                          className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full transition-all"
                          style={{
                            background: '#fff',
                            transform: m.enabled ? 'translateX(16px)' : 'translateX(0)',
                          }}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Button
                          variant="secondary"
                          onClick={() => testModel(m.id)}
                          disabled={testing}
                        >
                          {testing
                            ? getIcon('loading', { size: 13 })
                            : getIcon('zap', { size: 13 })}
                          {' '}{testing ? 'Testing…' : 'Test'}
                        </Button>
                        <TestResult result={result} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
