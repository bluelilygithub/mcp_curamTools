import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import InlineBanner from '../../components/ui/InlineBanner';
import MarkdownRenderer from '../../components/ui/MarkdownRenderer';
import MicButton from '../../components/ui/MicButton';
import { useToast } from '../../components/ui/Toast';
import { useIcon } from '../../providers/IconProvider';
import { fmtDate, fmtDateTime } from '../../utils/date';

const ALL = 'ALL';
const STATUSES = ['active', 'disabled', 'under-review'];
const PAGE_SIZE = 25;
const LESSON_COVERAGE_SECTIONS = [
  {
    title: 'Automatic route-factory coverage',
    note: 'All agents registered through createAgentRoute can submit under-review lesson proposals when their output contains an explicit reusable lesson/pattern. New createAgentRoute agents are presumed covered automatically; add their slug here when registering them.',
    items: [
      'ads-attribution-summary',
      'ads-bounce-analysis',
      'anomaly-investigator',
      'ads-copy-diagnostic',
      'ads-copy-gate',
      'ads-copy-playbook',
      'ads-setup-architect',
      'ai-visibility-monitor',
      'auction-insights',
      'competitor-keyword-intel',
      'cost-per-booked-job',
      'daypart-intelligence',
      'demo-document-analyzer',
      'demo-spec-validator',
      'demo-tender-response',
      'diamondplate-data',
      'geo-heatmap',
      'google-ads-change-audit',
      'google-ads-change-impact',
      'google-ads-freeform',
      'google-ads-monitor',
      'google-ads-strategic-review',
      'high-intent-advisor',
      'keyword-opportunity',
      'lead-velocity',
      'not-interested-report',
      'search-term-intelligence',
      'spec-validator',
      'wp-theme-extractor',
    ],
  },
  {
    title: 'Scheduled coverage',
    note: 'AgentScheduler can submit lesson proposals for successful scheduled runs when a reusable lesson/pattern is present. Future scheduled agents inherit this when registered through AgentScheduler.',
    items: ['ai-visibility-monitor', 'google-ads-monitor'],
  },
  {
    title: 'Custom routine hooks',
    note: 'These routines bypass createAgentRoute, so each has an explicit local proposeLessonFromRun hook.',
    items: [
      'doc-extractor',
      'google-ads-conversation',
      'media-gen',
      'sql-console-nlp',
      'demo-document-analyzer resubmit review',
      'demo-document-analyzer follow-up Q&A',
      'spec-validator follow-up Q&A',
      'demo-spec-validator follow-up Q&A',
    ],
  },
];

const inputCls = 'w-full px-3 py-2.5 rounded-xl border text-sm outline-none';
const inputStyle = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };

function today() {
  return new Date().toISOString().slice(0, 10);
}

function labelForAgent(agents, slug) {
  return agents.find((a) => a.slug === slug)?.label ?? slug;
}

function labelForOrg(orgs, id) {
  if (id === ALL || id == null) return 'All Organisations';
  return orgs.find((o) => String(o.id) === String(id))?.name ?? id;
}

function StatusPill({ status }) {
  const style = {
    active: { background: 'rgba(var(--color-primary-rgb), 0.12)', color: 'var(--color-primary)' },
    disabled: { background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' },
    'under-review': { background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' },
  }[status] ?? {};
  return <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={style}>{status}</span>;
}

function Field({ label, children, hint }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
        {label}
      </label>
      {children}
      {hint && <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{hint}</p>}
    </div>
  );
}

function LessonForm({ initial, meta, onClose, onSaved }) {
  const isEdit = Boolean(initial?.id);
  const [form, setForm] = useState(() => ({
    agent_id: initial?.agent_id ?? ALL,
    organisation_id: initial?.organisation_id ?? (meta.canUseGlobalOrganisation ? ALL : meta.organisations?.[0]?.id),
    category: initial?.category ?? '',
    title: initial?.title ?? '',
    content: initial?.content ?? '',
    status: initial?.status ?? 'active',
    applied_from: initial?.applied_from?.slice(0, 10) ?? today(),
    applied_to: initial?.applied_to?.slice(0, 10) ?? '',
    reason: '',
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save(e) {
    e.preventDefault();
    setError('');
    if (!form.title.trim()) return setError('Title is required.');
    if (form.title.trim().length > 120) return setError('Title must be 120 characters or fewer.');
    if (!form.content.trim()) return setError('Content is required.');
    if (form.applied_to && form.applied_to < form.applied_from) return setError('Applied To must be on or after Applied From.');

    setSaving(true);
    try {
      const payload = {
        agent_id: form.agent_id,
        organisation_id: form.organisation_id,
        category: form.category.trim(),
        title: form.title.trim(),
        content: form.content.trim(),
        status: form.status,
        applied_from: form.applied_from,
        applied_to: form.applied_to || null,
        reason: form.reason.trim() || undefined,
      };
      const result = isEdit
        ? await api.patch(`/lessons/${initial.id}`, payload)
        : await api.post('/lessons', payload);
      onSaved(result.lesson ?? result);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} />}
      {form.content.length > 2000 && (
        <InlineBanner type="warning" message="Content is over 2000 characters. It will still save, but long lessons add prompt cost to every matching run." />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Agent">
          <select value={form.agent_id} onChange={(e) => update('agent_id', e.target.value)} required className={inputCls} style={inputStyle}>
            {meta.agents.map((a) => <option key={a.slug} value={a.slug}>{a.label}</option>)}
          </select>
        </Field>
        <Field label="Organisation">
          <select value={form.organisation_id} onChange={(e) => update('organisation_id', e.target.value)} required className={inputCls} style={inputStyle}>
            {meta.organisations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Category" hint="Type a new category name to add one inline.">
          <input
            list="lesson-category-options"
            value={form.category}
            onChange={(e) => update('category', e.target.value)}
            required
            className={inputCls}
            style={inputStyle}
            placeholder="error-handling"
          />
          <datalist id="lesson-category-options">
            {meta.categories.map((c) => <option key={c} value={c} />)}
          </datalist>
        </Field>
        <Field label="Status">
          <select value={form.status} onChange={(e) => update('status', e.target.value)} className={inputCls} style={inputStyle}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Title">
        <input
          value={form.title}
          onChange={(e) => update('title', e.target.value)}
          maxLength={120}
          required
          className={inputCls}
          style={inputStyle}
          placeholder="Short behavioural rule"
        />
      </Field>

      <Field label="Content" hint="Markdown is supported. This exact text is injected into matching agent system prompts.">
        <textarea
          value={form.content}
          onChange={(e) => update('content', e.target.value)}
          rows={8}
          required
          className={`${inputCls} resize-y`}
          style={inputStyle}
          placeholder="Write the lesson or rule agents should follow..."
        />
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Applied From">
          <input type="date" value={form.applied_from} onChange={(e) => update('applied_from', e.target.value)} className={inputCls} style={inputStyle} />
        </Field>
        <Field label="Applied To">
          <input type="date" value={form.applied_to} min={form.applied_from} onChange={(e) => update('applied_to', e.target.value)} className={inputCls} style={inputStyle} />
        </Field>
      </div>

      {isEdit && (
        <Field label="Reason for audit log">
          <input value={form.reason} onChange={(e) => update('reason', e.target.value)} className={inputCls} style={inputStyle} placeholder="Optional note for this edit" />
        </Field>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Lesson'}</Button>
      </div>
    </form>
  );
}

function AuditEntry({ entry }) {
  const isCreated = entry.field_changed === 'created';
  const isAgent = String(entry.edited_by ?? '').includes('-') && entry.reason === 'agent reflection';
  const contentDiff = entry.field_changed === 'content';
  const isComment = entry.field_changed === 'comment';
  return (
    <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
          <strong style={{ color: 'var(--color-text)' }}>{entry.field_changed}</strong> by {entry.edited_by} on {fmtDateTime(entry.edited_at)}
        </div>
        <span className="px-2 py-0.5 rounded-full text-xs" style={isAgent ? { background: '#fffbeb', color: '#92400e' } : { background: 'var(--color-surface)', color: 'var(--color-muted)' }}>
          {isCreated ? 'created' : isAgent ? 'agent-proposed' : isComment ? 'review comment' : 'admin edit'}
        </span>
      </div>
      {isComment ? (
        <div className="rounded-lg border p-2 text-sm" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <MarkdownRenderer text={entry.new_value || ''} />
        </div>
      ) : contentDiff ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border p-2" style={{ borderColor: '#fca5a5', color: '#991b1b', whiteSpace: 'pre-wrap' }}>
            <p className="font-semibold mb-1">Previous</p>
            {entry.previous_value || '—'}
          </div>
          <div className="rounded-lg border p-2" style={{ borderColor: '#86efac', color: '#166534', whiteSpace: 'pre-wrap' }}>
            <p className="font-semibold mb-1">New</p>
            {entry.new_value || '—'}
          </div>
        </div>
      ) : (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {JSON.stringify(entry.previous_value) ?? '—'} → {JSON.stringify(entry.new_value) ?? '—'}
        </p>
      )}
      {entry.reason && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Reason: {entry.reason}</p>}
    </div>
  );
}

function LessonCommentForm({ lessonId, onSaved }) {
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    const value = comment.trim();
    if (!value) return setError('Comment is required.');
    if (value.length > 2000) return setError('Comment must be 2000 characters or fewer.');
    setSaving(true);
    try {
      const lesson = await api.post(`/lessons/${lessonId}/comments`, { comment: value });
      setComment('');
      onSaved(lesson);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      <div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Review Comment</h3>
        <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
          Add admin review context without changing the agent observation. Comments are sanitised and appended to audit history.
        </p>
      </div>
      {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} />}
      <div className="relative">
        <textarea
          value={comment}
          onChange={(e) => { setComment(e.target.value); setError(''); }}
          rows={4}
          maxLength={2000}
          className={`${inputCls} resize-y pr-12`}
          style={inputStyle}
          placeholder="Add review notes, decision context, or follow-up instructions..."
        />
        <div className="absolute top-2 right-2">
          <MicButton
            onResult={(text) => setComment((prev) => `${prev}${prev ? ' ' : ''}${text}`.slice(0, 2000))}
            size={16}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{comment.length}/2000</span>
        <Button type="submit" disabled={saving || !comment.trim()}>{saving ? 'Adding...' : 'Add Comment'}</Button>
      </div>
    </form>
  );
}

function LessonRevisionChat({ lessonId, lessonContent, onCommentSaved, onRevisionApplied }) {
  const [mode, setMode] = useState('comment');
  const [prompt, setPrompt] = useState('');
  const [revisedContent, setRevisedContent] = useState(null);
  const [revising, setRevising] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  async function handleRevise(e) {
    e?.preventDefault();
    setError('');
    const value = prompt.trim();
    if (!value) return setError('Revision prompt is required.');
    setRevising(true);
    try {
      const result = await api.post(`/lessons/${lessonId}/revise`, { prompt: value });
      setRevisedContent(result.content ?? result.revised_content ?? result.revision ?? '');
    } catch (err) {
      setError(err.message);
    } finally {
      setRevising(false);
    }
  }

  async function handleApply() {
    setError('');
    setApplying(true);
    try {
      const result = await api.patch(`/lessons/${lessonId}`, { content: revisedContent, reason: 'AI revision applied' });
      setRevisedContent(null);
      setPrompt('');
      onRevisionApplied?.(result.lesson ?? result);
    } catch (err) {
      setError(err.message);
    } finally {
      setApplying(false);
    }
  }

  function handleDiscard() {
    setRevisedContent(null);
    setPrompt('');
    setError('');
  }

  const isReviseMode = mode === 'revise';
  const showRevisePreview = isReviseMode && revisedContent != null;

  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-xl border p-1" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', display: 'inline-flex' }}>
        <button
          type="button"
          onClick={() => { setMode('comment'); setRevisedContent(null); setError(''); }}
          className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
          style={{
            background: !isReviseMode ? 'var(--color-bg)' : 'transparent',
            color: !isReviseMode ? 'var(--color-text)' : 'var(--color-muted)',
            border: !isReviseMode ? '1px solid var(--color-border)' : '1px solid transparent',
          }}
        >
          Add Comment
        </button>
        <button
          type="button"
          onClick={() => { setMode('revise'); setError(''); }}
          className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
          style={{
            background: isReviseMode ? 'var(--color-bg)' : 'transparent',
            color: isReviseMode ? 'var(--color-text)' : 'var(--color-muted)',
            border: isReviseMode ? '1px solid var(--color-border)' : '1px solid transparent',
          }}
        >
          Revise with AI
        </button>
      </div>

      {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} />}

      {!isReviseMode && (
        <LessonCommentForm lessonId={lessonId} onSaved={onCommentSaved} />
      )}

      {isReviseMode && (
        <div className="rounded-xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          {!showRevisePreview && (
            <>
              <div>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Revise with AI</h3>
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                  Describe the revision you want to make. The AI will generate an updated version of the lesson content.
                </p>
              </div>
              <div className="relative">
                <textarea
                  value={prompt}
                  onChange={(e) => { setPrompt(e.target.value); setError(''); }}
                  rows={4}
                  className={`${inputCls} resize-y pr-12`}
                  style={inputStyle}
                  placeholder="e.g. Add a note about handling empty responses, or Rewrite this to be more concise..."
                />
                <div className="absolute top-2 right-2">
                  <MicButton
                    onResult={(text) => setPrompt((prev) => `${prev}${prev ? ' ' : ''}${text}`)}
                    size={16}
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-3">
                <Button onClick={handleRevise} disabled={revising || !prompt.trim()}>
                  {revising ? 'Revising...' : 'Revise'}
                </Button>
              </div>
            </>
          )}

          {showRevisePreview && (
            <>
              <div>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Revision Preview</h3>
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                  Review the AI-generated revision below. Apply it to persist the change, or start over with a new prompt.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-muted)' }}>Original Content</p>
                  <div className="prose prose-sm max-w-none" style={{ color: 'var(--color-text)' }}>
                    <MarkdownRenderer text={lessonContent} />
                  </div>
                </div>
                <div className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--color-primary)', background: 'var(--color-surface)' }}>
                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-primary)' }}>Revised Content</p>
                  <div className="prose prose-sm max-w-none" style={{ color: 'var(--color-text)' }}>
                    <MarkdownRenderer text={revisedContent} />
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <Button variant="secondary" onClick={handleDiscard} disabled={applying}>
                  Discard Revision
                </Button>
                <Button onClick={handleApply} disabled={applying}>
                  {applying ? 'Applying...' : 'Apply Revision'}
                </Button>
              </div>
              <div className="border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
                <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-muted)' }}>Refine further</p>
                <div className="relative">
                  <textarea
                    value={prompt}
                    onChange={(e) => { setPrompt(e.target.value); setError(''); }}
                    rows={3}
                    className={`${inputCls} resize-y pr-12`}
                    style={inputStyle}
                    placeholder="e.g. Make it even more concise, or Add an example..."
                  />
                  <div className="absolute top-2 right-2">
                    <MicButton
                      onResult={(text) => setPrompt((prev) => `${prev}${prev ? ' ' : ''}${text}`)}
                      size={16}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-end gap-3 mt-2">
                  <Button onClick={handleRevise} disabled={revising || !prompt.trim()}>
                    {revising ? 'Revising...' : 'Revise Again'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DetailView({ lesson, meta, onCommentSaved, onRevisionApplied }) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <StatusPill status={lesson.status} />
        {lesson.is_agent_proposed && (
          <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: '#fffbeb', color: '#92400e' }}>
            Agent proposed
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><span style={{ color: 'var(--color-muted)' }}>Agent:</span> {labelForAgent(meta.agents, lesson.agent_id)}</div>
        <div><span style={{ color: 'var(--color-muted)' }}>Organisation:</span> {labelForOrg(meta.organisations, lesson.organisation_id)}</div>
        <div><span style={{ color: 'var(--color-muted)' }}>Category:</span> {lesson.category}</div>
        <div><span style={{ color: 'var(--color-muted)' }}>Applies:</span> {fmtDate(lesson.applied_from)} - {lesson.applied_to ? fmtDate(lesson.applied_to) : 'ongoing'}</div>
      </div>

      <section className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>{lesson.title}</h3>
        <MarkdownRenderer text={lesson.content} />
      </section>

      <LessonRevisionChat
        lessonId={lesson.id}
        lessonContent={lesson.content}
        onCommentSaved={onCommentSaved}
        onRevisionApplied={onRevisionApplied}
      />

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Audit History</h3>
        {(lesson.audit_log ?? []).map((entry, i) => <AuditEntry key={i} entry={entry} />)}
      </section>
    </div>
  );
}

function CoverageView() {
  return (
    <div className="space-y-5">
      <InlineBanner
        type="info"
        message="Coverage rule: every new model-backed agent or AI routine must be covered. Standard createAgentRoute and AgentScheduler paths are wired automatically; custom direct-provider routes need an explicit proposeLessonFromRun hook. Plain run logs are ignored."
      />
      {LESSON_COVERAGE_SECTIONS.map((section) => (
        <section key={section.title} className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{section.title}</h3>
          <p className="text-xs mt-1 mb-3" style={{ color: 'var(--color-muted)' }}>{section.note}</p>
          <div className="flex flex-wrap gap-2">
            {section.items.map((item) => (
              <span key={item} className="px-2 py-1 rounded-lg text-xs font-mono" style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                {item}
              </span>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function AdminLessonsPage() {
  const [meta, setMeta] = useState({ agents: [], organisations: [], categories: [], canUseGlobalOrganisation: false });
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });
  const [filters, setFilters] = useState({
    q: '', agent: '', org: '', status: 'all', categories: [], from: '', to: '',
  });
  const { showToast } = useToast();
  const getIcon = useIcon();

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  async function loadMeta() {
    const data = await api.get('/lessons/meta');
    setMeta(data);
  }

  async function loadRows(nextOffset = offset) {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams();
      if (filters.q) qs.set('q', filters.q);
      if (filters.agent) qs.set('agent', filters.agent);
      if (filters.org) qs.set('org', filters.org);
      if (filters.status) qs.set('status', filters.status);
      if (filters.categories.length) qs.set('categories', filters.categories.join(','));
      if (filters.from) qs.set('from', filters.from);
      if (filters.to) qs.set('to', filters.to);
      qs.set('sort', sort.key);
      qs.set('dir', sort.dir);
      qs.set('limit', PAGE_SIZE);
      qs.set('offset', nextOffset);
      const data = await api.get(`/lessons?${qs.toString()}`);
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
      setOffset(nextOffset);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    Promise.all([loadMeta(), loadRows(0)]).catch((err) => {
      setError(err.message);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    loadRows(0);
  }, [filters, sort]);

  const categoryOptions = useMemo(
    () => [...new Set([...(meta.categories ?? []), ...rows.map((r) => r.category)])].sort(),
    [meta.categories, rows]
  );

  function toggleSort(key) {
    setSort((s) => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  }

  async function toggleStatus(row) {
    const next = row.status === 'active' ? 'disabled' : 'active';
    try {
      await api.patch(`/lessons/${row.id}`, { status: next, reason: `Status toggled to ${next}` });
      showToast(`Lesson ${next}.`, 'success');
      loadRows(offset);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function softDelete(id) {
    try {
      await api.delete(`/lessons/${id}`);
      showToast('Lesson deleted.', 'success');
      setDeleteId(null);
      loadRows(offset);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function openView(row) {
    try {
      const lesson = await api.get(`/lessons/${row.id}`);
      setModal({ type: 'view', lesson });
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function onSaved() {
    showToast('Lesson saved.', 'success');
    loadMeta();
    loadRows(offset);
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Lessons Repository</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Persistent, auditable behavioural rules injected into matching agent runs.
            {' '}
            <button type="button" className="underline hover:opacity-70" style={{ color: 'var(--color-primary)' }} onClick={() => setModal({ type: 'coverage' })}>
              View covered agents/routines
            </button>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setModal({ type: 'coverage' })}>
            Covered Agents/Routines
          </Button>
          <Button onClick={() => setModal({ type: 'new' })}>{getIcon('plus', { size: 14 })} New Lesson</Button>
        </div>
      </div>

      {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} />}

      <section className="rounded-2xl border p-4 space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label="Search">
            <input value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} className={inputCls} style={inputStyle} placeholder="title, content, category" />
          </Field>
          <Field label="Agent">
            <select value={filters.agent} onChange={(e) => setFilters((f) => ({ ...f, agent: e.target.value }))} className={inputCls} style={inputStyle}>
              <option value="">All Agents</option>
              {meta.agents.filter((a) => a.slug !== ALL).map((a) => <option key={a.slug} value={a.slug}>{a.label}</option>)}
            </select>
          </Field>
          <Field label="Organisation">
            <select value={filters.org} onChange={(e) => setFilters((f) => ({ ...f, org: e.target.value }))} className={inputCls} style={inputStyle}>
              <option value="">All Organisations</option>
              {meta.organisations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className={inputCls} style={inputStyle}>
              <option value="all">All</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label="Applied From">
            <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className={inputCls} style={inputStyle} />
          </Field>
          <Field label="Applied To">
            <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className={inputCls} style={inputStyle} />
          </Field>
          <Field label="Categories">
            <select
              multiple
              value={filters.categories}
              onChange={(e) => setFilters((f) => ({ ...f, categories: Array.from(e.target.selectedOptions).map((o) => o.value) }))}
              className={inputCls}
              style={{ ...inputStyle, minHeight: 44 }}
            >
              {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <div className="flex items-end">
            <Button variant="secondary" onClick={() => setFilters({ q: '', agent: '', org: '', status: 'all', categories: [], from: '', to: '' })}>Clear Filters</Button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border overflow-hidden" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                {[
                  ['agent', 'Agent'],
                  ['organisation', 'Organisation'],
                  ['category', 'Category'],
                  [null, 'Title'],
                  [null, 'Status'],
                  [null, 'Created'],
                  ['date', 'Applied From'],
                  [null, 'Last Modified'],
                  [null, 'Actions'],
                ].map(([key, label]) => (
                  <th key={label} className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wider">
                    {key ? <button onClick={() => toggleSort(key)} className="hover:opacity-70" style={{ color: 'inherit' }}>{label}</button> : label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-3 py-8 text-center" style={{ color: 'var(--color-muted)' }}>Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-8 text-center" style={{ color: 'var(--color-muted)' }}>No lessons found.</td></tr>
              ) : rows.map((row) => (
                <tr key={row.id} style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                  <td className="px-3 py-3 font-mono text-xs">{row.agent_id}</td>
                  <td className="px-3 py-3">{labelForOrg(meta.organisations, row.organisation_id)}</td>
                  <td className="px-3 py-3">{row.category}</td>
                  <td className="px-3 py-3 min-w-[220px]">
                    <button onClick={() => openView(row)} className="text-left font-medium hover:opacity-70" style={{ color: 'var(--color-text)' }}>
                      {row.title}
                    </button>
                    {row.is_agent_proposed && <div className="text-xs mt-1" style={{ color: '#92400e' }}>Agent-proposed, awaiting review</div>}
                  </td>
                  <td className="px-3 py-3"><StatusPill status={row.status} /></td>
                  <td className="px-3 py-3 text-xs" style={{ color: 'var(--color-muted)' }}>{fmtDate(row.created_at)}</td>
                  <td className="px-3 py-3 text-xs">{fmtDate(row.applied_from)}</td>
                  <td className="px-3 py-3 text-xs" style={{ color: 'var(--color-muted)' }}>{fmtDateTime(row.updated_at)}</td>
                  <td className="px-3 py-3">
                    {deleteId === row.id ? (
                      <div className="flex items-center gap-1">
                        <button className="text-xs" style={{ color: '#ef4444' }} onClick={() => softDelete(row.id)}>Yes</button>
                        <button className="text-xs" style={{ color: 'var(--color-muted)' }} onClick={() => setDeleteId(null)}>No</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <Button variant="icon" title="View" onClick={() => openView(row)}>{getIcon('eye', { size: 14 })}</Button>
                        <Button variant="icon" title={row.status === 'active' ? 'Disable' : 'Enable'} onClick={() => toggleStatus(row)}>{getIcon(row.status === 'active' ? 'eye-off' : 'check', { size: 14 })}</Button>
                        <Button variant="icon" title="Delete" onClick={() => setDeleteId(row.id)}>{getIcon('trash', { size: 14 })}</Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 text-sm" style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
          <span>{total} lessons · page {currentPage} of {pages}</span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={offset === 0} onClick={() => loadRows(Math.max(0, offset - PAGE_SIZE))}>Previous</Button>
            <Button variant="secondary" disabled={offset + PAGE_SIZE >= total} onClick={() => loadRows(offset + PAGE_SIZE)}>Next</Button>
          </div>
        </div>
      </section>

      <Modal
        open={Boolean(modal)}
        onClose={() => setModal(null)}
        title={modal?.type === 'new' ? 'New Lesson' : modal?.type === 'edit' ? 'Edit Lesson' : modal?.type === 'coverage' ? 'Lesson Coverage' : 'Lesson Detail'}
        maxWidth="max-w-4xl"
      >
        {modal?.type === 'coverage' && <CoverageView />}
        {modal?.type === 'view' && (
          <DetailView
            lesson={modal.lesson}
            meta={meta}
            onCommentSaved={(lesson) => {
              setModal({ type: 'view', lesson });
              showToast('Comment added.', 'success');
              loadRows(offset);
            }}
            onRevisionApplied={(lesson) => {
              setModal({ type: 'view', lesson });
              showToast('Revision applied.', 'success');
              loadRows(offset);
              loadMeta();
            }}
          />
        )}
        {(modal?.type === 'new' || modal?.type === 'edit') && (
          <LessonForm
            initial={modal.type === 'edit' ? modal.lesson : null}
            meta={meta}
            onClose={() => setModal(null)}
            onSaved={onSaved}
          />
        )}
      </Modal>
    </div>
  );
}
