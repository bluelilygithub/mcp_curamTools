/**
 * AdminDataPrivacyPage — unified data privacy controls.
 *
 * Two independent sections, one page:
 *
 *   AI Extraction Privacy
 *     Declared field names are stripped from extraction results AFTER the AI
 *     runs but BEFORE the result is saved to the database. The AI still reads
 *     the full document — exclusions prevent sensitive values from being stored
 *     or displayed. Applies to Doc Extractor and any future extraction tool.
 *
 *   CRM Privacy
 *     Declared field names are stripped from CRM data BEFORE it reaches the AI.
 *     Applies to get_enquiries and get_not_interested_reasons tools.
 */
import { useState, useEffect, useRef } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import InlineBanner from '../../components/ui/InlineBanner';

// ── Shared tag-input component ────────────────────────────────────────────────

function TagInput({ fields, onChange, placeholder }) {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef(null);

  function addField() {
    const field = inputValue.trim().toLowerCase();
    if (!field) return;
    if (fields.includes(field)) { setInputValue(''); return; }
    onChange([...fields, field]);
    setInputValue('');
    inputRef.current?.focus();
  }

  function removeField(f) {
    onChange(fields.filter((x) => x !== f));
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); addField(); return; }
    if (e.key === 'Backspace' && !inputValue && fields.length > 0) {
      onChange(fields.slice(0, -1));
    }
  }

  return (
    <div
      className="flex flex-wrap gap-2 rounded-xl px-3 py-2.5 min-h-[44px] cursor-text"
      style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg)' }}
      onClick={() => inputRef.current?.focus()}
    >
      {fields.map((f) => (
        <span
          key={f}
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
          style={{ background: 'var(--color-primary)', color: '#fff', fontFamily: 'var(--font-mono)' }}
        >
          {f}
          <button
            type="button"
            onClick={() => removeField(f)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fff', lineHeight: 1, padding: 0 }}
            aria-label={`Remove ${f}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={fields.length === 0 ? placeholder : ''}
        className="text-sm outline-none flex-1 min-w-[160px]"
        style={{ background: 'transparent', color: 'var(--color-text)', border: 'none' }}
      />
      {inputValue && (
        <button
          type="button"
          onClick={addField}
          className="text-xs px-2 py-0.5 rounded-full"
          style={{ background: 'var(--color-surface)', color: 'var(--color-primary)', border: '1px solid var(--color-primary)', cursor: 'pointer' }}
        >
          Add
        </button>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminDataPrivacyPage() {
  const [extractionFields, setExtractionFields] = useState([]);
  const [crmFields,        setCrmFields]        = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [success,  setSuccess]  = useState('');
  const [error,    setError]    = useState('');

  useEffect(() => {
    api.get('/admin/data-privacy')
      .then((data) => {
        setExtractionFields(data.extraction?.excluded_field_names ?? []);
        setCrmFields(data.crm?.excluded_fields ?? []);
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
      await api.put('/admin/data-privacy', {
        extraction: { excluded_field_names: extractionFields },
        crm:        { excluded_fields: crmFields },
      });
      setSuccess('Data privacy settings saved. Exclusions take effect immediately.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Data Privacy</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
          Control which fields are excluded from AI access and from stored results.
          Exclusions take effect immediately — no restart required.
        </p>
      </div>

      {error   && <InlineBanner type="error"   message={error}   onDismiss={() => setError('')} />}
      {success && <InlineBanner type="neutral" message={success} onDismiss={() => setSuccess('')} />}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>
      ) : (
        <form onSubmit={save} className="space-y-8">

          {/* ── Section 1: AI Extraction Privacy ───────────────────────── */}
          <section
            className="rounded-2xl border p-6 space-y-4"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
                AI Extraction Privacy
              </h2>
              <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
                Field names declared here are stripped from extraction results <strong>after</strong> the AI
                runs but <strong>before</strong> the result is saved to the database.
                The AI reads the full document — these exclusions prevent sensitive values from being
                stored, displayed, or accessed by other users.
              </p>
              <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
                Applies to: <strong>Doc Extractor</strong> and any future extraction tool.
                Use snake_case field names as returned by the AI (e.g. <code className="text-xs px-1 rounded" style={{ background: 'var(--color-bg)', fontFamily: 'var(--font-mono)' }}>tax_file_number</code>).
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>
                Excluded field names
              </label>
              <TagInput
                fields={extractionFields}
                onChange={setExtractionFields}
                placeholder="Type a field name and press Enter — e.g. tax_file_number"
              />
              {extractionFields.length === 0 && (
                <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
                  No fields excluded. All extracted fields are stored and visible.
                </p>
              )}
            </div>

            <div className="text-xs rounded-lg p-3 space-y-1" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>
              <p className="font-semibold" style={{ color: 'var(--color-text)' }}>How it works</p>
              <p>The AI extracts all visible fields from the document. Immediately after, any field whose name matches an entry here is removed from the result before it is written to the database.</p>
              <p>The original document is not stored — only the extraction result. Excluded fields are gone permanently from that run.</p>
              <p><strong>Common exclusions:</strong> <span style={{ fontFamily: 'var(--font-mono)' }}>tax_file_number, bank_account_number, date_of_birth, passport_number, driver_licence, medicare_number, credit_card_number, signature</span></p>
            </div>
          </section>

          {/* ── Section 2: CRM Privacy ──────────────────────────────────── */}
          <section
            className="rounded-2xl border p-6 space-y-4"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
                CRM Privacy
              </h2>
              <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
                Field names declared here are stripped from CRM data <strong>before</strong> it reaches the AI.
                The data remains unchanged in WordPress — only what the AI sees is filtered.
              </p>
              <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
                Applies to: <strong>get_enquiries</strong> and <strong>get_not_interested_reasons</strong> tools
                used by the Google Ads conversation agent.
                Use the ACF <code className="text-xs px-1 rounded" style={{ background: 'var(--color-bg)', fontFamily: 'var(--font-mono)' }}>meta_key</code> name exactly as stored in WordPress.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>
                Excluded CRM fields
              </label>
              <TagInput
                fields={crmFields}
                onChange={setCrmFields}
                placeholder="Type a meta_key name and press Enter — e.g. email"
              />
              {crmFields.length === 0 && (
                <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
                  No fields excluded. All CRM fields are visible to the AI.
                </p>
              )}
            </div>

            <div className="text-xs rounded-lg p-3 space-y-1" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>
              <p className="font-semibold" style={{ color: 'var(--color-text)' }}>How it works</p>
              <p>Exclusions are applied at the tool layer before Claude sees the data. WordPress is not modified.</p>
              <p>Discovery tools (<code style={{ fontFamily: 'var(--font-mono)' }}>enquiry_field_check</code>, <code style={{ fontFamily: 'var(--font-mono)' }}>find_meta_key</code>) bypass exclusions intentionally — admins need full field visibility to manage this list.</p>
              <p><strong>Common exclusions:</strong> <span style={{ fontFamily: 'var(--font-mono)' }}>email, phone, first_name, last_name</span></p>
            </div>
          </section>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save privacy settings'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
