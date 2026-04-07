/**
 * AdminStoragePage — S3 file storage settings for the platform.
 *
 * Controls whether Doc Extractor (and future tools) store files in S3,
 * and which bucket/region to use. AWS credentials are env vars on the server
 * and are never surfaced here.
 */
import { useState, useEffect } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import InlineBanner from '../../components/ui/InlineBanner';

const BEHAVIOUR_OPTIONS = [
  {
    value: 'do_not_store',
    label: 'Do not store',
    description: 'Files are processed and discarded. Nothing is uploaded to S3.',
  },
  {
    value: 'store_original',
    label: 'Store original',
    description: 'The original file is uploaded to S3 after extraction. Enables download and re-run.',
  },
  {
    value: 'store_redacted',
    label: 'Store redacted',
    description: 'A redacted copy (sensitive field values blacked out) is stored instead. Not yet implemented — falls back to do not store.',
    disabled: true,
  },
];

export default function AdminStoragePage() {
  const [enabled,     setEnabled]     = useState(false);
  const [behaviour,   setBehaviour]   = useState('do_not_store');
  const [bucket,      setBucket]      = useState('');
  const [region,      setRegion]      = useState('ap-southeast-2');
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [success,     setSuccess]     = useState('');
  const [error,       setError]       = useState('');

  useEffect(() => {
    api.get('/admin/storage-settings')
      .then((data) => {
        setEnabled(data.enabled ?? false);
        setBehaviour(data.default_behaviour ?? 'do_not_store');
        setBucket(data.aws_bucket ?? '');
        setRegion(data.aws_region ?? 'ap-southeast-2');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setSuccess('');
    setError('');
    try {
      await api.put('/admin/storage-settings', {
        enabled,
        default_behaviour: behaviour,
        aws_bucket:        bucket.trim() || null,
        aws_region:        region.trim() || 'ap-southeast-2',
      });
      setSuccess('Storage settings saved. Changes take effect on the next extraction.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>File Storage</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
          Configure S3 storage for extracted documents. When enabled, uploaded files are stored in
          your AWS S3 bucket and can be downloaded or re-processed later.
        </p>
      </div>

      {error   && <InlineBanner type="error"   message={error}   onDismiss={() => setError('')} />}
      {success && <InlineBanner type="neutral" message={success} onDismiss={() => setSuccess('')} />}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>
      ) : (
        <form onSubmit={save} className="space-y-6">

          {/* ── Enable toggle ──────────────────────────────────────────────── */}
          <section
            className="rounded-2xl border p-6"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            <label className="flex items-center justify-between cursor-pointer gap-4">
              <div>
                <p className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Enable file storage</p>
                <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
                  When off, all other settings are ignored and no files are uploaded.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                onClick={() => setEnabled((v) => !v)}
                className="relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200"
                style={{ background: enabled ? 'var(--color-primary)' : 'var(--color-border)', cursor: 'pointer' }}
              >
                <span
                  className="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform duration-200"
                  style={{ transform: enabled ? 'translateX(20px)' : 'translateX(0)' }}
                />
              </button>
            </label>
          </section>

          {/* ── Behaviour + bucket config ─────────────────────────────────── */}
          <section
            className="rounded-2xl border p-6 space-y-6"
            style={{
              background:   'var(--color-surface)',
              borderColor:  'var(--color-border)',
              opacity:       enabled ? 1 : 0.5,
              pointerEvents: enabled ? 'auto' : 'none',
            }}
          >
            {/* Default behaviour */}
            <div className="space-y-3">
              <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                Default behaviour
              </label>
              <div className="space-y-2">
                {BEHAVIOUR_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex items-start gap-3 rounded-xl px-4 py-3 cursor-pointer transition-colors"
                    style={{
                      border:     `1px solid ${behaviour === opt.value ? 'var(--color-primary)' : 'var(--color-border)'}`,
                      background: behaviour === opt.value ? 'var(--color-primary-subtle, var(--color-bg))' : 'var(--color-bg)',
                      opacity:    opt.disabled ? 0.45 : 1,
                      cursor:     opt.disabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="behaviour"
                      value={opt.value}
                      checked={behaviour === opt.value}
                      disabled={opt.disabled}
                      onChange={() => setBehaviour(opt.value)}
                      className="mt-0.5 flex-shrink-0"
                      style={{ accentColor: 'var(--color-primary)' }}
                    />
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                        {opt.label}
                        {opt.disabled && (
                          <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}>
                            Coming soon
                          </span>
                        )}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{opt.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Bucket */}
            <div className="space-y-1">
              <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                S3 bucket name
              </label>
              <input
                type="text"
                value={bucket}
                onChange={(e) => setBucket(e.target.value)}
                placeholder="e.g. curam-tools-docs"
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
              />
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Leave blank to use the <code style={{ fontFamily: 'var(--font-mono)' }}>AWS_S3_BUCKET</code> environment variable.
              </p>
            </div>

            {/* Region */}
            <div className="space-y-1">
              <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                AWS region
              </label>
              <input
                type="text"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="ap-southeast-2"
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
              />
            </div>

            {/* Info box */}
            <div className="text-xs rounded-lg p-3 space-y-1" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>
              <p className="font-semibold" style={{ color: 'var(--color-text)' }}>AWS credentials</p>
              <p>
                <code style={{ fontFamily: 'var(--font-mono)' }}>AWS_ACCESS_KEY_ID</code> and{' '}
                <code style={{ fontFamily: 'var(--font-mono)' }}>AWS_SECRET_ACCESS_KEY</code> are set as
                server environment variables and are never stored here.
                Files are stored under <code style={{ fontFamily: 'var(--font-mono)' }}>org/{'<orgId>'}/'</code> within the bucket.
                Verify connectivity in <a href="/admin/diagnostics" className="underline" style={{ color: 'var(--color-primary)' }}>Admin › Diagnostics</a>.
              </p>
            </div>
          </section>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save storage settings'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
