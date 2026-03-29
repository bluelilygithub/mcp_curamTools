/**
 * AdminEmailTemplatesPage — list and edit email templates.
 */
import { useState, useEffect } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import InlineBanner from '../../components/ui/InlineBanner';
import EmptyState from '../../components/ui/EmptyState';
import Modal from '../../components/ui/Modal';

export default function AdminEmailTemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');

  async function load() {
    try { setTemplates(await api.get('/admin/email-templates')); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function openEdit(slug) {
    try {
      const tpl = await api.get(`/admin/email-templates/${slug}`);
      setEditData(tpl);
      setEditing(slug);
    } catch (e) { setError(e.message); }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.put(`/admin/email-templates/${editing}`, editData);
      setSuccess('Template saved.');
      setEditing(null);
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function handleReset(slug) {
    try {
      await api.post(`/admin/email-templates/${slug}/reset`);
      setSuccess('Template reset to default.');
      load();
    } catch (e) { setError(e.message); }
  }

  const inputStyle = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Email Templates</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>Customise transactional email content. Use {'{{variable}}'} placeholders.</p>
      </div>

      {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} />}
      {success && <InlineBanner type="neutral" message={success} onDismiss={() => setSuccess('')} />}

      <div className="rounded-2xl border overflow-hidden mt-4" style={{ borderColor: 'var(--color-border)' }}>
        {loading ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</div>
        ) : templates.length === 0 ? (
          <EmptyState icon="mail" message="No templates found." />
        ) : (
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                {['Slug', 'Subject', 'Actions'].map((col) => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.slug} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="px-4 py-3 text-sm font-mono" style={{ color: 'var(--color-text)' }}>{t.slug}</td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-muted)' }}>{t.subject}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => openEdit(t.slug)}>Edit</Button>
                      <Button variant="secondary" onClick={() => handleReset(t.slug)}>Reset</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Edit: ${editing}`} maxWidth="max-w-2xl">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>Subject</label>
            <input
              type="text" value={editData.subject ?? ''}
              onChange={(e) => setEditData((d) => ({ ...d, subject: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
              style={inputStyle}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>HTML Body</label>
            <textarea
              value={editData.body_html ?? ''} rows={8}
              onChange={(e) => setEditData((d) => ({ ...d, body_html: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none font-mono resize-y"
              style={inputStyle}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>Plain Text Body</label>
            <textarea
              value={editData.body_text ?? ''} rows={4}
              onChange={(e) => setEditData((d) => ({ ...d, body_text: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none resize-y"
              style={inputStyle}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
