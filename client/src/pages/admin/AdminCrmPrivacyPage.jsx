/**
 * AdminCrmPrivacyPage — declare ACF field names to exclude from LLM access.
 *
 * Excluded fields are stripped from get_enquiries and get_not_interested_reasons
 * results before they reach Claude. Discovery tools (enquiry_field_check,
 * find_meta_key) bypass this so the admin can still inspect the full field set.
 */
import { useState, useEffect, useRef } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import InlineBanner from '../../components/ui/InlineBanner';

export default function AdminCrmPrivacyPage() {
  const [excludedFields, setExcludedFields] = useState([]);
  const [inputValue, setInputValue]         = useState('');
  const [loading, setLoading]               = useState(true);
  const [saving, setSaving]                 = useState(false);
  const [error, setError]                   = useState('');
  const [success, setSuccess]               = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    api.get('/admin/crm-privacy')
      .then((data) => setExcludedFields(data.excluded_fields ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function addField() {
    const field = inputValue.trim().toLowerCase();
    if (!field) return;
    if (excludedFields.includes(field)) {
      setInputValue('');
      return;
    }
    setExcludedFields((prev) => [...prev, field]);
    setInputValue('');
    inputRef.current?.focus();
  }

  function removeField(field) {
    setExcludedFields((prev) => prev.filter((f) => f !== field));
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); addField(); }
    if (e.key === 'Backspace' && inputValue === '' && excludedFields.length > 0) {
      setExcludedFields((prev) => prev.slice(0, -1));
    }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setSuccess('');
    setError('');
    try {
      await api.put('/admin/crm-privacy', { excluded_fields: excludedFields });
      setSuccess('CRM privacy settings saved. Exclusions take effect immediately.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const chipStyle = {
    display:        'inline-flex',
    alignItems:     'center',
    gap:            '6px',
    padding:        '3px 10px',
    borderRadius:   '999px',
    fontSize:       '0.8rem',
    fontFamily:     'monospace',
    background:     'var(--color-primary-subtle, rgba(99,102,241,0.12))',
    color:          'var(--color-primary, #6366f1)',
    border:         '1px solid var(--color-primary-border, rgba(99,102,241,0.3))',
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>CRM Privacy</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
          Declare ACF field names that should never be sent to the AI. Applies to all CRM
          data returned by the conversation agent and report agents.
        </p>
      </div>

      {error   && <InlineBanner type="error"   message={error}   onDismiss={() => setError('')}   />}
      {success && <InlineBanner type="neutral" message={success} onDismiss={() => setSuccess('')} />}

      {loading ? (
        <p className="text-sm mt-4" style={{ color: 'var(--color-muted)' }}>Loading…</p>
      ) : (
        <form onSubmit={save} className="mt-4 space-y-6">

          {/* Excluded fields */}
          <div className="rounded-2xl border p-6" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>
              Excluded fields
            </label>
            <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
              Enter the exact ACF <code>meta_key</code> name (e.g. <code>email</code>, <code>phone</code>,{' '}
              <code>first_name</code>). Use the conversation agent's{' '}
              <strong>enquiry_field_check</strong> tool to discover all field names in your CRM.
            </p>

            {/* Tag input area */}
            <div
              className="min-h-[48px] flex flex-wrap gap-2 p-2 rounded-xl border cursor-text"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
              onClick={() => inputRef.current?.focus()}
            >
              {excludedFields.map((field) => (
                <span key={field} style={chipStyle}>
                  {field}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeField(field); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', lineHeight: 1, opacity: 0.7 }}
                    aria-label={`Remove ${field}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={excludedFields.length === 0 ? 'Type a field name and press Enter…' : ''}
                className="flex-1 min-w-[180px] text-sm outline-none"
                style={{ background: 'transparent', color: 'var(--color-text)', border: 'none' }}
              />
            </div>

            {/* Add button */}
            {inputValue.trim() && (
              <div className="mt-2">
                <Button type="button" variant="secondary" size="sm" onClick={addField}>
                  Add "{inputValue.trim()}"
                </Button>
              </div>
            )}

            {excludedFields.length === 0 && (
              <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>
                No fields excluded. All CRM fields are visible to the AI.
              </p>
            )}
          </div>

          {/* How it works */}
          <div className="rounded-2xl border p-5" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>How it works</p>
            <ul className="text-sm space-y-1.5" style={{ color: 'var(--color-muted)' }}>
              <li>Exclusions are applied in the tool layer — the field is removed before Claude ever sees the data.</li>
              <li>The WordPress CRM database is not changed. Your sales team still has full access.</li>
              <li><strong>enquiry_field_check</strong> and <strong>find_meta_key</strong> bypass exclusions — they are discovery tools used by the admin, not analytical tools.</li>
              <li>Typical exclusions: <code>email</code>, <code>phone</code>, <code>first_name</code>, <code>last_name</code>.</li>
            </ul>
          </div>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
