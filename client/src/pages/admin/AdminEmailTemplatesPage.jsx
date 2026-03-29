/**
 * AdminEmailTemplatesPage — list and edit email templates.
 * Features: grouped list, description, variable chips, HTML/Preview/Text tabs,
 * live iframe preview, click-to-insert variables at cursor, auto-generate plain text.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import InlineBanner from '../../components/ui/InlineBanner';
import EmptyState from '../../components/ui/EmptyState';
import Modal from '../../components/ui/Modal';

// ── Edit Modal ──────────────────────────────────────────────────────────────

function EditModal({ template, onClose, onSaved, onError }) {
  const [subject,   setSubject]   = useState(template.subject   || '');
  const [bodyHtml,  setBodyHtml]  = useState(template.body_html || '');
  const [bodyText,  setBodyText]  = useState(template.body_text || '');
  const [tab,       setTab]       = useState('html');
  const [saving,    setSaving]    = useState(false);
  const [resetting, setResetting] = useState(false);

  // Cursor tracking for variable insertion
  const lastFocus   = useRef({ field: 'bodyHtml', start: 0, end: 0 });
  const subjectRef  = useRef(null);
  const textareaRef = useRef(null);

  const recordCursor = (field, el) => {
    lastFocus.current = { field, start: el.selectionStart, end: el.selectionEnd };
  };

  const insertVariable = (varName) => {
    const token = `{{${varName}}}`;
    const { field, start, end } = lastFocus.current;

    if (field === 'subject') {
      const next = subject.slice(0, start) + token + subject.slice(end);
      setSubject(next);
      requestAnimationFrame(() => {
        if (subjectRef.current) {
          subjectRef.current.focus();
          subjectRef.current.setSelectionRange(start + token.length, start + token.length);
        }
      });
    } else if (field === 'bodyHtml') {
      const next = bodyHtml.slice(0, start) + token + bodyHtml.slice(end);
      setBodyHtml(next);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(start + token.length, start + token.length);
        }
      });
    } else {
      const next = bodyText.slice(0, start) + token + bodyText.slice(end);
      setBodyText(next);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(start + token.length, start + token.length);
        }
      });
    }
    lastFocus.current = {
      ...lastFocus.current,
      start: start + token.length,
      end:   start + token.length,
    };
  };

  const autoGenerateText = () => {
    const stripped = bodyHtml
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    setBodyText(stripped);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/admin/email-templates/${template.slug}`, {
        subject, body_html: bodyHtml, body_text: bodyText,
      });
      onSaved();
    } catch (e) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Reset this template to its default content? Your customisations will be lost.')) return;
    setResetting(true);
    try {
      await api.post(`/admin/email-templates/${template.slug}/reset`, {});
      onSaved();
    } catch (e) {
      onError(e.message);
    } finally {
      setResetting(false);
    }
  };

  const inputStyle = {
    background: 'var(--color-bg)',
    borderColor: 'var(--color-border)',
    color: 'var(--color-text)',
  };

  const TABS = [
    { id: 'html',    label: 'HTML Source',  hint: 'Edit raw HTML — this is what email clients display' },
    { id: 'preview', label: 'Preview',      hint: 'Rendered preview — {{variables}} shown unsubstituted' },
    { id: 'text',    label: 'Plain Text',   hint: 'Fallback for clients that cannot render HTML (rare)' },
  ];

  return (
    <Modal open onClose={onClose} title={`Edit: ${template.slug}`} maxWidth="max-w-3xl">
      <div className="space-y-4">

        {/* Variable chips */}
        {template.variables?.length > 0 && (
          <div
            className="rounded-lg p-3"
            style={{
              background: 'rgba(var(--color-primary-rgb, 99,102,241),0.05)',
              border: '1px solid rgba(var(--color-primary-rgb, 99,102,241),0.15)',
            }}
          >
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
              Click a variable to insert it at the cursor
            </p>
            <div className="flex flex-wrap gap-1">
              {template.variables.map((v) => (
                <button
                  key={v}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); insertVariable(v); }}
                  className="text-xs font-mono px-2 py-0.5 rounded-md border cursor-pointer hover:opacity-70 transition-opacity"
                  style={{
                    background: 'rgba(var(--color-primary-rgb, 99,102,241),0.08)',
                    borderColor: 'rgba(var(--color-primary-rgb, 99,102,241),0.2)',
                    color: 'var(--color-primary)',
                  }}
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Subject */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
            Subject
          </label>
          <input
            ref={subjectRef}
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onSelect={(e) => recordCursor('subject', e.target)}
            onFocus={(e) => recordCursor('subject', e.target)}
            className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
            style={inputStyle}
          />
        </div>

        {/* Body tabs */}
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className="px-3 py-1.5 rounded-lg border text-xs font-semibold uppercase tracking-wide transition-all"
                style={{
                  background:   tab === t.id ? 'var(--color-primary)' : 'var(--color-bg)',
                  borderColor:  'var(--color-border)',
                  color:        tab === t.id ? '#fff' : 'var(--color-muted)',
                  cursor: 'pointer',
                }}
              >
                {t.label}
              </button>
            ))}
            {tab === 'text' && (
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); autoGenerateText(); }}
                className="px-3 py-1.5 rounded-lg border text-xs transition-all hover:opacity-70"
                style={{ background: 'transparent', borderColor: 'var(--color-border)', color: 'var(--color-muted)', cursor: 'pointer' }}
              >
                Auto-generate from HTML
              </button>
            )}
            <span className="text-xs ml-1" style={{ color: 'var(--color-muted)' }}>
              {TABS.find((t) => t.id === tab)?.hint}
            </span>
          </div>

          {tab === 'preview' ? (
            <iframe
              srcDoc={bodyHtml}
              sandbox="allow-same-origin"
              title="Email preview"
              style={{
                width: '100%',
                height: 420,
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                background: '#fff',
              }}
            />
          ) : (
            <textarea
              ref={textareaRef}
              value={tab === 'text' ? bodyText : bodyHtml}
              onChange={(e) => tab === 'text' ? setBodyText(e.target.value) : setBodyHtml(e.target.value)}
              onSelect={(e) => recordCursor(tab === 'text' ? 'bodyText' : 'bodyHtml', e.target)}
              onFocus={(e) => recordCursor(tab === 'text' ? 'bodyText' : 'bodyHtml', e.target)}
              rows={14}
              spellCheck={false}
              className="w-full px-3 py-2.5 rounded-xl border text-xs outline-none font-mono resize-y"
              style={{ ...inputStyle, lineHeight: 1.6 }}
            />
          )}
        </div>

        {/* Footer actions */}
        <div className="flex justify-between items-center pt-1">
          <Button variant="secondary" onClick={handleReset} disabled={resetting}>
            {resetting ? 'Resetting…' : 'Reset to default'}
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function AdminEmailTemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');
  const [editing,   setEditing]   = useState(null);

  const load = useCallback(async () => {
    try {
      setTemplates(await api.get('/admin/email-templates'));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openEdit = async (slug) => {
    try {
      const tpl = await api.get(`/admin/email-templates/${slug}`);
      setEditing(tpl);
    } catch (e) {
      setError(e.message);
    }
  };

  const onSaved = () => {
    setEditing(null);
    setSuccess('Template saved.');
    load();
  };

  // Group by tool_slug (null / undefined = platform)
  const groups = templates.reduce((acc, t) => {
    const key = t.tool_slug || '__platform__';
    if (!acc[key]) acc[key] = [];
    acc[key].push(t);
    return acc;
  }, {});
  const groupOrder = ['__platform__', ...Object.keys(groups).filter((k) => k !== '__platform__')];

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Email Templates</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
          Customise transactional email content. Use{' '}
          <code className="font-mono text-xs">{'{{variable}}'}</code>{' '}
          placeholders where applicable.
        </p>
      </div>

      {error   && <InlineBanner type="error"   message={error}   onDismiss={() => setError('')}   className="mb-4" />}
      {success && <InlineBanner type="neutral" message={success} onDismiss={() => setSuccess('')} className="mb-4" />}

      {loading ? (
        <div className="p-8 text-center text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</div>
      ) : templates.length === 0 ? (
        <EmptyState icon="mail" message="No templates found." />
      ) : (
        groupOrder.filter((g) => groups[g]).map((group) => (
          <div key={group} className="mb-8">
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--color-muted)' }}>
              {group === '__platform__' ? 'Platform' : group}
            </p>

            <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
              {groups[group].map((t, i) => (
                <div
                  key={t.slug}
                  className="flex items-center justify-between px-4 py-4 gap-4"
                  style={{
                    background:  'var(--color-surface)',
                    borderTop:   i > 0 ? '1px solid var(--color-border)' : 'none',
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{t.subject}</p>
                    {t.description && (
                      <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{t.description}</p>
                    )}
                    {t.variables?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {t.variables.map((v) => (
                          <span
                            key={v}
                            className="text-xs font-mono px-2 py-0.5 rounded-md"
                            style={{
                              background: 'rgba(var(--color-primary-rgb, 99,102,241),0.08)',
                              color: 'var(--color-primary)',
                            }}
                          >
                            {`{{${v}}}`}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button variant="secondary" onClick={() => openEdit(t.slug)}>
                    Edit
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {editing && (
        <EditModal
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
          onError={(msg) => setError(msg)}
        />
      )}
    </div>
  );
}
