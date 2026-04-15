/**
 * AiVisibilityTab — AI Search Visibility Monitor tab.
 *
 * Renders inside GoogleAdsMonitorPage as the "AI Visibility" tab.
 * Manages its own state: run controls, history navigation, per-prompt
 * accordion, and monitoring prompt CRUD.
 */
import { useState, useEffect, useCallback } from 'react';
import api from '../../../api/client';
import Button from '../../../components/ui/Button';
import MarkdownRenderer from '../../../components/ui/MarkdownRenderer';
import { exportPdf } from '../../../utils/exportService';

// ── Shared style helpers ──────────────────────────────────────────────────────

const inputStyle = {
  padding: '0.4rem 0.6rem', borderRadius: '0.5rem',
  border: '1px solid var(--color-border)', background: 'var(--color-bg)',
  color: 'var(--color-text)', fontSize: '0.875rem', outline: 'none',
  fontFamily: 'inherit',
};

const CATEGORY_LABELS = {
  brand:         'Brand',
  competitor:    'Competitor',
  category:      'Category',
  differentiator:'Differentiator',
  sources:       'Sources',
  general:       'General',
};

const CATEGORY_COLORS = {
  brand:         { bg: '#3b82f620', text: '#3b82f6' },
  competitor:    { bg: '#f5920820', text: '#d97706' },
  category:      { bg: '#8b5cf620', text: '#8b5cf6' },
  differentiator:{ bg: '#10b98120', text: '#059669' },
  sources:       { bg: '#ec489920', text: '#db2777' },
  general:       { bg: '#64748b20', text: '#64748b' },
};

function CategoryBadge({ category }) {
  const cat = (category || 'general').toLowerCase();
  const colors = CATEGORY_COLORS[cat] || CATEGORY_COLORS.general;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99,
      background: colors.bg, color: colors.text,
      textTransform: 'uppercase', letterSpacing: '0.04em', fontFamily: 'inherit',
      whiteSpace: 'nowrap',
    }}>
      {CATEGORY_LABELS[cat] || category}
    </span>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ lines }) {
  return (
    <div className="rounded-xl border p-4 mb-4"
      style={{ borderColor: 'var(--color-primary)', background: 'var(--color-surface)' }}>
      <style>{`@keyframes _aiv_slide{0%{left:-45%}100%{left:110%}}`}</style>
      <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-text)' }}>
        Searching the web — this takes 2–4 minutes for a full prompt set.
        <span style={{ color: 'var(--color-muted)' }}> Please don't navigate away.</span>
      </p>
      <div style={{ position: 'relative', height: 4, borderRadius: 2, overflow: 'hidden', background: 'var(--color-border)' }}>
        <div style={{
          position: 'absolute', top: 0, height: '100%', width: '45%',
          background: 'var(--color-primary)', borderRadius: 2,
          animation: '_aiv_slide 1.4s ease-in-out infinite',
        }} />
      </div>
      {lines.length > 0 && (
        <div className="mt-3 space-y-0.5">
          {lines.slice(-5).map((l, i) => (
            <p key={i} className="text-xs" style={{ color: 'var(--color-muted)', fontFamily: 'inherit' }}>
              <span style={{ color: 'var(--color-primary)', marginRight: 6 }}>›</span>{l}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{
      flex: '1 1 140px', minWidth: 120,
      borderRadius: 12, border: '1px solid var(--color-border)',
      background: 'var(--color-surface)', padding: '12px 14px',
      fontFamily: 'inherit',
    }}>
      <p style={{ fontSize: 11, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 700, color: accent || 'var(--color-text)', lineHeight: 1, marginBottom: 2 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: 'var(--color-muted)' }}>{sub}</p>}
    </div>
  );
}

// ── Per-prompt result accordion ───────────────────────────────────────────────

function PromptResultsAccordion({ promptResults }) {
  const [openId, setOpenId] = useState(null);

  if (!promptResults || promptResults.length === 0) return null;

  // Group by category
  const grouped = {};
  for (const pr of promptResults) {
    const cat = pr.category || 'general';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(pr);
  }

  const categoryOrder = ['brand', 'competitor', 'category', 'differentiator', 'sources', 'general'];
  const sortedCategories = Object.keys(grouped).sort((a, b) => {
    const ai = categoryOrder.indexOf(a); const bi = categoryOrder.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {sortedCategories.map((cat) => (
        <div key={cat}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <CategoryBadge category={cat} />
            <span style={{ fontSize: 11, color: 'var(--color-muted)', fontFamily: 'inherit' }}>
              {grouped[cat].filter((p) => p.brandMentioned).length}/{grouped[cat].length} brand mentions
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {grouped[cat].map((pr) => {
              const isOpen = openId === pr.promptId;
              return (
                <div key={pr.promptId} style={{
                  borderRadius: 10, border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)', overflow: 'hidden', fontFamily: 'inherit',
                }}>
                  {/* Row header */}
                  <button
                    onClick={() => setOpenId(isOpen ? null : pr.promptId)}
                    style={{
                      width: '100%', textAlign: 'left', background: 'none', border: 'none',
                      cursor: 'pointer', padding: '10px 14px',
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}
                  >
                    <span style={{ fontSize: 11, color: 'var(--color-muted)', width: 12, flexShrink: 0 }}>
                      {isOpen ? '▼' : '▶'}
                    </span>
                    <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text)', textAlign: 'left' }}>
                      {pr.label || pr.promptText}
                    </span>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                      {pr.error ? (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: '#ef444420', color: '#ef4444', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Error</span>
                      ) : pr.brandMentioned ? (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: '#16a34a20', color: '#16a34a', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Brand</span>
                      ) : (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: '#64748b20', color: '#64748b', letterSpacing: '0.04em', textTransform: 'uppercase' }}>No mention</span>
                      )}
                      {pr.competitorsMentioned && pr.competitorsMentioned.length > 0 && (
                        <span style={{ fontSize: 10, color: 'var(--color-muted)', fontFamily: 'inherit' }}>
                          {pr.competitorsMentioned.slice(0, 2).join(', ')}{pr.competitorsMentioned.length > 2 ? ' +' + (pr.competitorsMentioned.length - 2) : ''}
                        </span>
                      )}
                      {pr.citedUrls && pr.citedUrls.length > 0 && (
                        <span style={{ fontSize: 10, color: 'var(--color-muted)', fontFamily: 'inherit' }}>
                          {pr.citedUrls.length} URL{pr.citedUrls.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Expanded body */}
                  {isOpen && (
                    <div style={{ borderTop: '1px solid var(--color-border)', padding: '14px 14px 14px 36px' }}>
                      {pr.error ? (
                        <p style={{ fontSize: 12, color: '#ef4444', fontFamily: 'inherit' }}>Error: {pr.error}</p>
                      ) : (
                        <>
                          <p style={{ fontSize: 11, color: 'var(--color-muted)', marginBottom: 8, fontFamily: 'inherit' }}>
                            Query: <em>{pr.promptText}</em>
                          </p>
                          {pr.responseText && (
                            <div style={{ fontSize: 13, color: 'var(--color-text)', lineHeight: 1.6, marginBottom: 10, fontFamily: 'inherit', whiteSpace: 'pre-wrap' }}>
                              {pr.responseText}
                            </div>
                          )}
                          {pr.citedUrls && pr.citedUrls.length > 0 && (
                            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 10, marginTop: 4 }}>
                              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, fontFamily: 'inherit' }}>
                                Cited sources
                              </p>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                {pr.citedUrls.map((url, i) => (
                                  <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                                    style={{ fontSize: 12, color: 'var(--color-primary)', fontFamily: 'inherit', wordBreak: 'break-all' }}>
                                    {url}
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}
                          {pr.competitorsMentioned && pr.competitorsMentioned.length > 0 && (
                            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--color-border)' }}>
                              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, fontFamily: 'inherit' }}>
                                Competitors mentioned
                              </p>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {pr.competitorsMentioned.map((c) => (
                                  <span key={c} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: '#f5920820', color: '#d97706', fontFamily: 'inherit' }}>{c}</span>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Prompt management table ───────────────────────────────────────────────────

const CATEGORY_OPTIONS = ['brand', 'competitor', 'category', 'differentiator', 'sources', 'general'];

// Mirrors DEFAULT_PROMPTS in server/agents/aiVisibilityMonitor/index.js
const DEFAULT_PROMPTS_PREVIEW = [
  { label: 'Best paint protection in Australia',       category: 'brand',         prompt_text: 'best car paint protection coating in Australia' },
  { label: 'Best protection for new car',             category: 'brand',         prompt_text: 'what is the best paint protection for a new car Australia' },
  { label: 'Ceramic coating installer near me',       category: 'brand',         prompt_text: 'recommended ceramic coating installer near me Australia' },
  { label: 'Ceramic Pro vs Gtechniq comparison',      category: 'competitor',    prompt_text: 'Ceramic Pro vs Gtechniq paint protection comparison' },
  { label: 'Best professional ceramic coating brand', category: 'competitor',    prompt_text: 'best professional ceramic coating brand Australia' },
  { label: 'Gyeon vs IGL Coatings',                   category: 'competitor',    prompt_text: 'Gyeon vs IGL Coatings which is better' },
  { label: 'How long does ceramic coating last',      category: 'category',      prompt_text: 'how long does ceramic coating last on a car' },
  { label: 'Is paint protection film worth it',       category: 'category',      prompt_text: 'is paint protection film worth the cost' },
  { label: 'Ceramic coating vs PPF difference',       category: 'category',      prompt_text: 'difference between ceramic coating and paint protection film' },
  { label: 'Self-healing paint protection review',    category: 'differentiator', prompt_text: 'self-healing paint protection coating review' },
  { label: 'Long-life hydrophobic ceramic coating',   category: 'differentiator', prompt_text: 'hydrophobic ceramic coating that lasts 5 years' },
  { label: 'Ceramic coating reviews Australia',       category: 'sources',       prompt_text: 'ceramic coating reviews Australia' },
  { label: 'Paint protection pros and cons',          category: 'sources',       prompt_text: 'paint protection coating pros and cons' },
];

// ── Competitor manager ────────────────────────────────────────────────────────

function CompetitorManager() {
  const [competitors, setCompetitors] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  const [success,     setSuccess]     = useState('');
  const [newName,     setNewName]     = useState('');
  const [newUrl,      setNewUrl]      = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await api.get('/agent-configs/ai-visibility-monitor');
      setCompetitors(Array.isArray(cfg.competitors) ? cfg.competitors : []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save(updated) {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api.put('/agent-configs/ai-visibility-monitor', { competitors: updated });
      setCompetitors(updated);
      setSuccess('Saved.');
      setTimeout(() => setSuccess(''), 2500);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  function handleAdd() {
    if (!newName.trim()) return;
    save([...competitors, { name: newName.trim(), url: newUrl.trim() }]);
    setNewName('');
    setNewUrl('');
  }

  function handleRemove(i) {
    save(competitors.filter((_, idx) => idx !== i));
  }

  function handleChange(i, field, value) {
    const updated = competitors.map((c, idx) => idx === i ? { ...c, [field]: value } : c);
    setCompetitors(updated); // optimistic local update; save on blur
  }

  async function handleBlurSave() {
    await save(competitors);
  }

  const fieldStyle = { ...inputStyle, flex: 1, minWidth: 0 };

  if (loading) return <p style={{ fontSize: 12, color: 'var(--color-muted)', fontFamily: 'inherit' }}>Loading…</p>;

  return (
    <div style={{ fontFamily: 'inherit' }}>
      {error   && <p style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>{error}</p>}
      {success && <p style={{ fontSize: 12, color: '#16a34a', marginBottom: 8 }}>{success}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        {competitors.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--color-muted)', textAlign: 'center', padding: '8px 0' }}>
            No competitors configured — defaults (Ceramic Pro, Gtechniq, IGL Coatings, Gyeon, Autobond) will be used.
          </p>
        )}
        {competitors.map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              style={fieldStyle} value={c.name} placeholder="Company name"
              onChange={(e) => handleChange(i, 'name', e.target.value)}
              onBlur={handleBlurSave}
            />
            <input
              style={{ ...fieldStyle, color: 'var(--color-muted)' }} value={c.url} placeholder="Website (optional)"
              onChange={(e) => handleChange(i, 'url', e.target.value)}
              onBlur={handleBlurSave}
            />
            <button onClick={() => handleRemove(i)} style={{
              fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #fca5a5',
              background: 'transparent', color: '#ef4444', cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit',
            }}>Remove</button>
          </div>
        ))}
      </div>

      {/* Add row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          style={fieldStyle} value={newName} placeholder="Company name"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <input
          style={{ ...fieldStyle, color: 'var(--color-muted)' }} value={newUrl} placeholder="Website (optional)"
          onChange={(e) => setNewUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <Button variant="primary" onClick={handleAdd} disabled={saving || !newName.trim()}
          style={{ fontSize: 11, padding: '4px 12px', flexShrink: 0 }}>
          {saving ? 'Saving…' : 'Add'}
        </Button>
      </div>
      <p style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 8, fontFamily: 'inherit' }}>
        Company names are used for mention detection in AI responses. Edits auto-save on blur.
      </p>
    </div>
  );
}

function DefaultPromptsPreview() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderRadius: 10, border: '1px solid var(--color-border)', overflow: 'hidden', fontFamily: 'inherit' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', textAlign: 'left', background: 'none', border: 'none',
          cursor: 'pointer', padding: '10px 14px',
          display: 'flex', alignItems: 'center', gap: 8,
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>{open ? '▼' : '▶'}</span>
        <span style={{ fontSize: 13, color: 'var(--color-text)', flex: 1 }}>
          13 default prompts will be seeded on first run
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-primary)', fontFamily: 'inherit' }}>
          {open ? 'Hide' : 'Preview'}
        </span>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--color-border)' }}>
          {DEFAULT_PROMPTS_PREVIEW.map((p, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '8px 14px',
              borderBottom: i < DEFAULT_PROMPTS_PREVIEW.length - 1 ? '1px solid var(--color-border)' : 'none',
              background: 'var(--color-bg)',
            }}>
              <CategoryBadge category={p.category} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text)', marginBottom: 2, fontFamily: 'inherit' }}>
                  {p.label}
                </p>
                <p style={{ fontSize: 11, color: 'var(--color-muted)', fontFamily: 'inherit' }}>
                  "{p.prompt_text}"
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PromptManager() {
  const [prompts,   setPrompts]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [editId,    setEditId]    = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [adding,    setAdding]    = useState(false);
  const [newPrompt, setNewPrompt] = useState({ prompt_text: '', category: 'general', label: '' });
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');

  const loadPrompts = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.get('/agents/ai-visibility-monitor/prompts');
      setPrompts(rows ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPrompts(); }, [loadPrompts]);

  async function handleToggle(p) {
    try {
      const updated = await api.put(`/agents/ai-visibility-monitor/prompts/${p.id}`, { is_active: !p.is_active });
      setPrompts((prev) => prev.map((r) => r.id === p.id ? updated : r));
    } catch (e) { setError(e.message); }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this monitoring prompt?')) return;
    try {
      await api.delete(`/agents/ai-visibility-monitor/prompts/${id}`);
      setPrompts((prev) => prev.filter((r) => r.id !== id));
    } catch (e) { setError(e.message); }
  }

  function startEdit(p) {
    setEditId(p.id);
    setEditDraft({ prompt_text: p.prompt_text, category: p.category, label: p.label || '' });
  }

  async function saveEdit(id) {
    setSaving(true);
    try {
      const updated = await api.put(`/agents/ai-visibility-monitor/prompts/${id}`, {
        prompt_text: editDraft.prompt_text,
        category:    editDraft.category,
        label:       editDraft.label || null,
      });
      setPrompts((prev) => prev.map((r) => r.id === id ? updated : r));
      setEditId(null);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function handleAdd() {
    if (!newPrompt.prompt_text.trim()) return;
    setSaving(true);
    try {
      const created = await api.post('/agents/ai-visibility-monitor/prompts', {
        prompt_text: newPrompt.prompt_text.trim(),
        category:    newPrompt.category,
        label:       newPrompt.label.trim() || null,
      });
      setPrompts((prev) => [...prev, created]);
      setNewPrompt({ prompt_text: '', category: 'general', label: '' });
      setAdding(false);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  const fieldStyle = { ...inputStyle, width: '100%', boxSizing: 'border-box' };
  const activeCount = prompts.filter((p) => p.is_active).length;

  return (
    <div style={{ fontFamily: 'inherit' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <p style={{ fontSize: 11, color: 'var(--color-muted)' }}>
          {activeCount} of {prompts.length} prompts active
        </p>
        <Button variant="primary" onClick={() => setAdding(!adding)}
          style={{ fontSize: 11, padding: '4px 12px' }}>
          {adding ? 'Cancel' : '+ Add prompt'}
        </Button>
      </div>

      {error && (
        <p style={{ fontSize: 12, color: '#ef4444', marginBottom: 8, fontFamily: 'inherit' }}>{error}</p>
      )}

      {/* Add form */}
      {adding && (
        <div style={{
          borderRadius: 10, border: '1px solid var(--color-primary)',
          padding: 14, marginBottom: 12, background: 'var(--color-surface)',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--color-muted)', marginBottom: 4 }}>Prompt text *</label>
              <input style={fieldStyle} value={newPrompt.prompt_text}
                placeholder="e.g. best paint protection coating Australia"
                onChange={(e) => setNewPrompt((p) => ({ ...p, prompt_text: e.target.value }))} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--color-muted)', marginBottom: 4 }}>Label (optional)</label>
              <input style={fieldStyle} value={newPrompt.label}
                placeholder="Short display name"
                onChange={(e) => setNewPrompt((p) => ({ ...p, label: e.target.value }))} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--color-muted)', marginBottom: 4 }}>Category</label>
              <select style={fieldStyle} value={newPrompt.category}
                onChange={(e) => setNewPrompt((p) => ({ ...p, category: e.target.value }))}>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </div>
          </div>
          <Button variant="primary" onClick={handleAdd} disabled={saving || !newPrompt.prompt_text.trim()}
            style={{ fontSize: 11, padding: '4px 14px' }}>
            {saving ? 'Saving…' : 'Add prompt'}
          </Button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <p style={{ fontSize: 12, color: 'var(--color-muted)', textAlign: 'center', padding: '16px 0' }}>Loading prompts…</p>
      ) : prompts.length === 0 ? (
        <DefaultPromptsPreview />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {prompts.map((p) => {
            const isEditing = editId === p.id;
            return (
              <div key={p.id} style={{
                borderRadius: 8, border: '1px solid var(--color-border)',
                background: p.is_active ? 'var(--color-bg)' : 'transparent',
                overflow: 'hidden',
              }}>
                {isEditing ? (
                  <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <input style={fieldStyle} value={editDraft.prompt_text}
                      placeholder="Prompt text"
                      onChange={(e) => setEditDraft((d) => ({ ...d, prompt_text: e.target.value }))} />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <input style={fieldStyle} value={editDraft.label}
                        placeholder="Label (optional)"
                        onChange={(e) => setEditDraft((d) => ({ ...d, label: e.target.value }))} />
                      <select style={fieldStyle} value={editDraft.category}
                        onChange={(e) => setEditDraft((d) => ({ ...d, category: e.target.value }))}>
                        {CATEGORY_OPTIONS.map((c) => (
                          <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button variant="primary" onClick={() => saveEdit(p.id)} disabled={saving}
                        style={{ fontSize: 11, padding: '3px 12px' }}>
                        {saving ? 'Saving…' : 'Save'}
                      </Button>
                      <Button variant="secondary" onClick={() => setEditId(null)}
                        style={{ fontSize: 11, padding: '3px 10px' }}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px' }}>
                    {/* Toggle */}
                    <button
                      onClick={() => handleToggle(p)}
                      title={p.is_active ? 'Disable' : 'Enable'}
                      style={{
                        width: 28, height: 16, borderRadius: 99, border: 'none', cursor: 'pointer', flexShrink: 0,
                        background: p.is_active ? 'var(--color-primary)' : 'var(--color-border)',
                        position: 'relative', transition: 'background 0.15s',
                      }}
                    >
                      <span style={{
                        position: 'absolute', top: 2, width: 12, height: 12, borderRadius: '50%',
                        background: '#fff', transition: 'left 0.15s',
                        left: p.is_active ? 14 : 2,
                      }} />
                    </button>

                    <CategoryBadge category={p.category} />

                    <span style={{
                      flex: 1, fontSize: 13, color: p.is_active ? 'var(--color-text)' : 'var(--color-muted)',
                      fontFamily: 'inherit', minWidth: 0,
                    }}>
                      {p.label && <span style={{ fontWeight: 500 }}>{p.label}: </span>}
                      <span style={{ color: 'var(--color-muted)' }}>{p.prompt_text}</span>
                    </span>

                    {/* Edit / Delete */}
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button onClick={() => startEdit(p)} style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 6,
                        border: '1px solid var(--color-border)', background: 'transparent',
                        color: 'var(--color-muted)', cursor: 'pointer', fontFamily: 'inherit',
                      }}>Edit</button>
                      <button onClick={() => handleDelete(p.id)} style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 6,
                        border: '1px solid #fca5a5', background: 'transparent',
                        color: '#ef4444', cursor: 'pointer', fontFamily: 'inherit',
                      }}>Delete</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main tab component ────────────────────────────────────────────────────────

export default function AiVisibilityTab() {
  const [runs,      setRuns]      = useState([]);
  const [runIndex,  setRunIndex]  = useState(0);   // 0 = most recent
  const [running,   setRunning]   = useState(false);
  const [progress,  setProgress]  = useState([]);
  const [error,     setError]     = useState('');
  const [activeSection, setActiveSection] = useState('results'); // 'results' | 'prompts' | 'settings'
  const [exporting,     setExporting]     = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const rows = await api.get('/agents/ai-visibility-monitor/history');
      const complete = (rows ?? []).filter((r) => r.status === 'complete');
      setRuns(complete);
      setRunIndex(0);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Current run data
  const currentRun = runs[runIndex] ?? null;
  const result     = currentRun?.result ?? null;
  const summary    = result?.summary ?? '';
  const stats      = result?.data?.summaryStats ?? null;
  const promptResults = result?.data?.promptResults ?? [];

  const fmtDate = (s) => {
    if (!s) return '—';
    return new Date(s).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  // ── Run handler ─────────────────────────────────────────────────────────────

  async function handleRun() {
    setRunning(true);
    setProgress([]);
    setError('');

    try {
      const res = await api.stream('/agents/ai-visibility-monitor/run', {});
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop();

        for (const line of parts) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') {
            setRunning(false);
            await loadHistory();
            return;
          }
          try {
            const msg = JSON.parse(raw);
            if (msg.type === 'progress') setProgress((l) => [...l, msg.text]);
            else if (msg.type === 'error') setError(msg.error);
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }

  // ── PDF export ──────────────────────────────────────────────────────────────

  async function handleExport() {
    if (!summary) return;
    setExporting(true);
    try {
      const runDate = currentRun?.run_at ? new Date(currentRun.run_at).toLocaleDateString('en-AU') : '';
      const statsBlock = stats ? [
        '',
        '## Summary Statistics',
        '',
        `- **Brand mention rate:** ${stats.brandMentionRate ?? 0}%  (${stats.brandMentionCount ?? 0} of ${stats.totalPrompts ?? 0} prompts)`,
        stats.topCompetitor ? `- **Top competitor:** ${stats.topCompetitor}` : '',
        stats.topDomains?.[0] ? `- **Top cited domain:** ${stats.topDomains[0].domain}` : '',
      ].filter(Boolean).join('\n') : '';

      await exportPdf({
        content:  statsBlock + '\n\n' + summary,
        title:    'AI Visibility Monitor Report' + (runDate ? ' — ' + runDate : ''),
        filename: 'ai-visibility-report' + (runDate ? '-' + runDate.replace(/\//g, '-') : '') + '.pdf',
      });
    } catch (e) {
      setError('PDF export failed: ' + e.message);
    } finally {
      setExporting(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const sectionTabBtn = (key, label) => (
    <button key={key} onClick={() => setActiveSection(key)} style={{
      padding: '0.3rem 0.75rem', fontSize: '0.75rem', fontWeight: 500, fontFamily: 'inherit',
      borderRadius: '0.4rem', cursor: 'pointer', border: 'none',
      background: activeSection === key ? 'var(--color-primary)' : 'transparent',
      color: activeSection === key ? '#fff' : 'var(--color-muted)',
    }}>{label}</button>
  );

  return (
    <div style={{ fontFamily: 'inherit' }}>

      {/* ── Top bar: run controls + section tabs ───────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button variant="primary" onClick={handleRun} disabled={running}
            style={{ fontSize: 12, padding: '5px 14px' }}>
            {running ? 'Running…' : 'Run now'}
          </Button>
          {runs.length > 0 && !running && (
            <span style={{ fontSize: 11, color: 'var(--color-muted)', fontFamily: 'inherit' }}>
              Last run: {fmtDate(runs[0]?.run_at)}
            </span>
          )}
          {runs.length === 0 && !running && (
            <span style={{ fontSize: 11, color: 'var(--color-muted)', fontFamily: 'inherit' }}>
              Scheduled: Mondays 7am AEST
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {summary && (
            <button onClick={handleExport} disabled={exporting} style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 6, fontFamily: 'inherit',
              border: '1px solid var(--color-border)', background: 'transparent',
              color: 'var(--color-muted)', cursor: exporting ? 'not-allowed' : 'pointer',
            }}>
              {exporting ? 'Exporting…' : 'Export PDF'}
            </button>
          )}
          <div style={{ display: 'flex', gap: 4, borderRadius: 8, padding: 3, background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {sectionTabBtn('results',  'Results')}
            {sectionTabBtn('prompts',  'Prompts')}
            {sectionTabBtn('settings', 'Settings')}
          </div>
        </div>
      </div>

      {error && (
        <div style={{ borderRadius: 8, border: '1px solid #fca5a5', background: '#fef2f2', padding: '8px 12px', marginBottom: 12 }}>
          <p style={{ fontSize: 12, color: '#ef4444', fontFamily: 'inherit' }}>{error}</p>
        </div>
      )}

      {running && <ProgressBar lines={progress} />}

      {/* ── Results section ─────────────────────────────────────────────── */}
      {activeSection === 'results' && (
        <>
          {runs.length === 0 && !running ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--color-muted)', fontFamily: 'inherit' }}>
              <p style={{ fontSize: 13 }}>No runs yet. Click "Run now" to generate the first AI visibility report.</p>
              <p style={{ fontSize: 11, marginTop: 6 }}>This will run {'{N}'} monitoring prompts against live web search — takes 2–4 minutes.</p>
            </div>
          ) : (
            <>
              {/* History navigation */}
              {runs.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <button onClick={() => setRunIndex((i) => Math.min(i + 1, runs.length - 1))}
                    disabled={runIndex >= runs.length - 1}
                    style={{ fontSize: 14, padding: '2px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'transparent', cursor: runIndex >= runs.length - 1 ? 'not-allowed' : 'pointer', color: 'var(--color-muted)' }}>
                    ‹
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--color-muted)', fontFamily: 'inherit' }}>
                    {runIndex + 1} / {runs.length} — {fmtDate(currentRun?.run_at)}
                  </span>
                  <button onClick={() => setRunIndex((i) => Math.max(i - 1, 0))}
                    disabled={runIndex <= 0}
                    style={{ fontSize: 14, padding: '2px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'transparent', cursor: runIndex <= 0 ? 'not-allowed' : 'pointer', color: 'var(--color-muted)' }}>
                    ›
                  </button>
                  {runIndex > 0 && (
                    <button onClick={() => setRunIndex(0)} style={{ fontSize: 11, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                      Latest
                    </button>
                  )}
                </div>
              )}

              {/* Summary stats */}
              {stats && (
                <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                  <StatCard
                    label="Brand Mention Rate"
                    value={`${stats.brandMentionRate ?? 0}%`}
                    sub={stats.priorBrandMentionRate != null
                      ? (stats.brandMentionRate > stats.priorBrandMentionRate ? `+${stats.brandMentionRate - stats.priorBrandMentionRate}pp vs prev` : stats.brandMentionRate < stats.priorBrandMentionRate ? `-${stats.priorBrandMentionRate - stats.brandMentionRate}pp vs prev` : 'flat vs prev')
                      : `${stats.brandMentionCount ?? 0} of ${stats.totalPrompts ?? 0} prompts`}
                    accent={stats.brandMentionRate >= 50 ? '#16a34a' : stats.brandMentionRate >= 25 ? '#d97706' : '#ef4444'}
                  />
                  <StatCard
                    label="Top Competitor"
                    value={stats.topCompetitor ?? '—'}
                    sub={stats.topCompetitor && stats.competitorRanking
                      ? `${stats.competitorRanking[0]?.rate ?? 0}% of prompts`
                      : 'No competitors detected'}
                  />
                  <StatCard
                    label="Prompts Run"
                    value={stats.totalPrompts ?? 0}
                    sub={`${stats.brandMentionCount ?? 0} brand mentions`}
                  />
                  {stats.topDomains && stats.topDomains.length > 0 && (
                    <StatCard
                      label="Top Cited Domain"
                      value={stats.topDomains[0].domain}
                      sub={`${stats.topDomains[0].count} citation${stats.topDomains[0].count !== 1 ? 's' : ''}`}
                    />
                  )}
                </div>
              )}

              {/* Competitor breakdown */}
              {stats && stats.competitorRanking && stats.competitorRanking.length > 0 && (
                <div style={{
                  borderRadius: 12, border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)', padding: '12px 14px', marginBottom: 14,
                }}>
                  <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted)', marginBottom: 10, fontFamily: 'inherit' }}>
                    Competitor Mention Rates
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {stats.competitorRanking.map(({ name, rate }) => (
                      <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 12, color: 'var(--color-text)', width: 120, flexShrink: 0, fontFamily: 'inherit' }}>{name}</span>
                        <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--color-border)', overflow: 'hidden' }}>
                          <div style={{ width: `${rate}%`, height: '100%', background: '#f59208', borderRadius: 3, transition: 'width 0.4s' }} />
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--color-muted)', width: 38, textAlign: 'right', fontFamily: 'inherit' }}>{rate}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Narrative analysis */}
              {summary && (
                <div style={{
                  borderRadius: 14, border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)', padding: '16px', marginBottom: 14,
                }}>
                  <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted)', marginBottom: 12, fontFamily: 'inherit' }}>
                    AI Analysis
                  </p>
                  <MarkdownRenderer text={summary} />
                </div>
              )}

              {/* Per-prompt results */}
              {promptResults.length > 0 && (
                <div style={{
                  borderRadius: 14, border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)', overflow: 'hidden', marginBottom: 14,
                }}>
                  <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--color-border)' }}>
                    <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted)', fontFamily: 'inherit' }}>
                      Per-Prompt Results
                    </p>
                  </div>
                  <div style={{ padding: 14 }}>
                    <PromptResultsAccordion promptResults={promptResults} />
                  </div>
                </div>
              )}

              {/* Top cited domains */}
              {stats && stats.topDomains && stats.topDomains.length > 1 && (
                <div style={{
                  borderRadius: 12, border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)', padding: '12px 14px',
                }}>
                  <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted)', marginBottom: 10, fontFamily: 'inherit' }}>
                    Most Cited Domains
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {stats.topDomains.map(({ domain, count }, i) => (
                      <div key={domain} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 11, color: 'var(--color-muted)', width: 16, textAlign: 'right', fontFamily: 'inherit' }}>{i + 1}</span>
                        <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text)', fontFamily: 'inherit' }}>{domain}</span>
                        <span style={{ fontSize: 12, color: 'var(--color-muted)', fontFamily: 'inherit' }}>{count}×</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Prompts section ─────────────────────────────────────────────── */}
      {activeSection === 'prompts' && (
        <div style={{
          borderRadius: 14, border: '1px solid var(--color-border)',
          background: 'var(--color-surface)', padding: '14px 16px',
        }}>
          <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted)', marginBottom: 12, fontFamily: 'inherit' }}>
            Monitoring Prompts
          </p>
          <p style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 12, fontFamily: 'inherit' }}>
            These prompts are run against live AI web search each Monday at 7am AEST.
            Toggle prompts on/off, edit, or add new ones. Changes take effect on the next run.
          </p>
          <PromptManager />
        </div>
      )}

      {/* ── Settings section ────────────────────────────────────────────── */}
      {activeSection === 'settings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{
            borderRadius: 14, border: '1px solid var(--color-border)',
            background: 'var(--color-surface)', padding: '14px 16px',
          }}>
            <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted)', marginBottom: 4, fontFamily: 'inherit' }}>
              Competitors
            </p>
            <p style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 14, fontFamily: 'inherit' }}>
              Company names are matched against AI response text for mention detection.
              Website URLs are stored for reference and future analysis.
            </p>
            <CompetitorManager />
          </div>

          <div style={{
            borderRadius: 14, border: '1px solid var(--color-border)',
            background: 'var(--color-surface)', padding: '14px 16px',
          }}>
            <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted)', marginBottom: 4, fontFamily: 'inherit' }}>
              Geographic Targeting
            </p>
            <p style={{ fontSize: 12, color: 'var(--color-muted)', fontFamily: 'inherit' }}>
              Web search is geo-targeted to <strong style={{ color: 'var(--color-text)' }}>Australia (country-level)</strong> — no city or state bias.
              All AI responses reflect the Australian market broadly.
            </p>
          </div>

          <div style={{
            borderRadius: 14, border: '1px solid var(--color-border)',
            background: 'var(--color-surface)', padding: '14px 16px',
          }}>
            <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted)', marginBottom: 4, fontFamily: 'inherit' }}>
              Schedule & Kill Switch
            </p>
            <p style={{ fontSize: 12, color: 'var(--color-muted)', fontFamily: 'inherit' }}>
              This agent runs automatically every <strong style={{ color: 'var(--color-text)' }}>Monday at 7am AEST</strong>.
              To pause it, go to <strong style={{ color: 'var(--color-text)' }}>Admin → Agents → AI Visibility Monitor</strong> and toggle the enabled switch.
              Model and token settings are also managed there.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
