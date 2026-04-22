import { useState, useEffect } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import InlineBanner from '../../components/ui/InlineBanner';

const MAX_COMPETITORS = 10;

const inputStyle = {
  border:      '1px solid var(--color-border)',
  background:  'var(--color-bg)',
  color:       'var(--color-text)',
  borderRadius: 8,
  padding:     '6px 10px',
  fontSize:    13,
  outline:     'none',
  width:       '100%',
};

function emptyRow() {
  return { name: '', url: '', notes: '' };
}

export default function AdminCompetitorsPage() {
  const [competitors, setCompetitors] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [success,     setSuccess]     = useState('');
  const [error,       setError]       = useState('');

  useEffect(() => {
    api.get('/admin/competitors')
      .then((data) => {
        const rows = Array.isArray(data.competitors) && data.competitors.length > 0
          ? data.competitors.map((c) => ({ name: c.name ?? '', url: c.url ?? '', notes: c.notes ?? '' }))
          : [emptyRow()];
        setCompetitors(rows);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function updateRow(index, field, value) {
    setCompetitors((prev) => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  }

  function addRow() {
    if (competitors.length >= MAX_COMPETITORS) return;
    setCompetitors((prev) => [...prev, emptyRow()]);
  }

  function removeRow(index) {
    setCompetitors((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length === 0 ? [emptyRow()] : next;
    });
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setSuccess('');
    setError('');
    try {
      const payload = competitors
        .map((c) => ({ name: c.name.trim(), url: c.url.trim(), notes: c.notes.trim() || undefined }))
        .filter((c) => c.name && c.url);
      await api.put('/admin/competitors', { competitors: payload });
      setSuccess('Competitor list saved. All reports using this list will pick up the changes on their next run.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const filledCount = competitors.filter((c) => c.name.trim() && c.url.trim()).length;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Competitors</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
          Shared competitor list used by Competitor Keyword Intel, AI Visibility Monitor, and the
          Keyword Opportunity report. Up to {MAX_COMPETITORS} competitors. Name and URL are required.
        </p>
      </div>

      {error   && <InlineBanner type="error"   message={error}   onDismiss={() => setError('')} />}
      {success && <InlineBanner type="neutral" message={success} onDismiss={() => setSuccess('')} />}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>
      ) : (
        <form onSubmit={save} className="space-y-6">

          <section
            className="rounded-2xl border p-6 space-y-4"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            {/* Header row */}
            <div
              className="grid gap-3 text-xs font-semibold uppercase tracking-wider pb-1"
              style={{ gridTemplateColumns: '1fr 1fr 1fr auto', color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)' }}
            >
              <span>Name</span>
              <span>Website URL</span>
              <span>Notes (optional)</span>
              <span />
            </div>

            {competitors.map((row, i) => (
              <div key={i} className="grid gap-3 items-center" style={{ gridTemplateColumns: '1fr 1fr 1fr auto' }}>
                <input
                  type="text"
                  placeholder="e.g. Ceramic Pro"
                  value={row.name}
                  onChange={(e) => updateRow(i, 'name', e.target.value)}
                  maxLength={100}
                  style={inputStyle}
                />
                <input
                  type="url"
                  placeholder="https://ceramicpro.com.au"
                  value={row.url}
                  onChange={(e) => updateRow(i, 'url', e.target.value)}
                  maxLength={300}
                  style={inputStyle}
                />
                <input
                  type="text"
                  placeholder="e.g. main AU rival"
                  value={row.notes}
                  onChange={(e) => updateRow(i, 'notes', e.target.value)}
                  maxLength={200}
                  style={inputStyle}
                />
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  title="Remove"
                  style={{ color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 4px' }}
                >
                  ×
                </button>
              </div>
            ))}

            {competitors.length < MAX_COMPETITORS && (
              <button
                type="button"
                onClick={addRow}
                className="text-sm"
                style={{ color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                + Add competitor
              </button>
            )}

            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              {filledCount} of {MAX_COMPETITORS} slots filled.
            </p>
          </section>

          <div
            className="rounded-xl p-4 text-xs space-y-1"
            style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
          >
            <p className="font-semibold" style={{ color: 'var(--color-text)' }}>Used by</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Competitor Keyword Intel — passes competitor URLs to Google Ads Keyword Planner</li>
              <li>AI Visibility Monitor — detects competitor mentions in AI search responses</li>
              <li>Keyword Opportunity report (Report 4) — researches competitor keyword targets</li>
            </ul>
            <p className="pt-1">Rows without both a name and URL are ignored on save.</p>
          </div>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save competitor list'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
