/**
 * DocExtractorPage
 *
 * Upload documents → extract fields with Claude Vision → review results.
 * Supports single or multi-file upload. Each file becomes its own run.
 * Typography follows platform conventions: Tailwind classes for sizes/weights,
 * CSS variables for theme-aware colours, var(--font-mono) for monospace.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../api/client';
import useAuthStore from '../../stores/authStore';

const PAGE_SIZE = 20;

const PURPOSE_OPTIONS = [
  { value: '',          label: 'Select purpose (optional)' },
  { value: 'invoice',   label: 'Invoice' },
  { value: 'receipt',   label: 'Receipt' },
  { value: 'contract',  label: 'Contract' },
  { value: 'form',      label: 'Form' },
  { value: 'id',        label: 'ID / Identity document' },
  { value: 'report',    label: 'Report' },
  { value: 'letter',    label: 'Letter / Correspondence' },
  { value: 'other',     label: 'Other' },
];

export default function DocExtractorPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.roles?.find((r) => r.scope_type === 'global')?.name === 'org_admin';

  // ── Upload state ──────────────────────────────────────────────────────────
  const [files, setFiles]              = useState([]);   // File[]
  const [label, setLabel]              = useState('');
  const [purpose, setPurpose]          = useState('');
  const [instructions, setInstructions]= useState('');
  const [uploading, setUploading]      = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null); // "Processing 2 of 3…"
  const [uploadError, setUploadError]  = useState(null);
  const fileInputRef = useRef(null);

  // ── Result panel (upload result OR selected past run) ─────────────────────
  const [viewed, setViewed] = useState(null);

  // ── Runs list state ───────────────────────────────────────────────────────
  const [runs, setRuns]                   = useState([]);
  const [total, setTotal]                 = useState(0);
  const [page, setPage]                   = useState(1);
  const [search, setSearch]               = useState('');
  const [searchInput, setSearchInput]     = useState('');
  const [showDeleted, setShowDeleted]     = useState(false);
  const [runsLoading, setRunsLoading]     = useState(false);
  const [runsError, setRunsError]         = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  // ── Load runs ─────────────────────────────────────────────────────────────
  const loadRuns = useCallback(async (p, q, deleted) => {
    setRunsLoading(true);
    setRunsError(null);
    try {
      const params = new URLSearchParams({ page: p, limit: PAGE_SIZE });
      if (q)       params.set('q', q);
      if (deleted) params.set('include_deleted', 'true');
      const data = await api.get(`/doc-extractor/runs?${params}`);
      setRuns(data.rows);
      setTotal(data.total);
    } catch (err) {
      setRunsError(err.message);
    } finally {
      setRunsLoading(false);
    }
  }, []);

  useEffect(() => { loadRuns(page, search, showDeleted); }, [page, search, showDeleted, loadRuns]);

  // Debounce search input → search state
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ── Upload ────────────────────────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault();
    if (files.length === 0) return;

    setUploading(true);
    setUploadError(null);
    setViewed(null);

    const results = [];

    try {
      for (let i = 0; i < files.length; i++) {
        if (files.length > 1) {
          setUploadProgress(`Processing ${i + 1} of ${files.length}…`);
        }
        const fd = new FormData();
        fd.append('file', files[i]);
        if (label)        fd.append('label',        label);
        if (purpose)      fd.append('purpose',      purpose);
        if (instructions) fd.append('instructions', instructions);

        const data = await api.upload('/doc-extractor/extract', fd);
        results.push(data);
      }

      // Show the last (or only) result in the panel
      const last = results[results.length - 1];
      if (last?.runId) setViewed({ runId: last.runId, result: last.result, purpose, instructions });

      setFiles([]);
      setLabel('');
      setPurpose('');
      setInstructions('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setPage(1);
      loadRuns(1, search, showDeleted);
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }

  function handleFileChange(e) {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length) { setFiles(picked); setUploadError(null); }
  }

  function handleDrop(e) {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files ?? []);
    if (dropped.length) { setFiles(dropped); setUploadError(null); }
  }

  function removeFile(idx) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleView(row) {
    if (viewed?.runId === row.id) { setViewed(null); return; }
    // Fetch full result from dedicated endpoint — list rows carry field_count only
    try {
      const full = await api.get(`/doc-extractor/runs/${row.id}`);
      setViewed({
        runId:        full.id,
        result:       full.result,
        filename:     full.label || full.filename,
        purpose:      full.purpose,
        instructions: full.instructions,
      });
    } catch (err) {
      setRunsError(`Failed to load run: ${err.message}`);
    }
  }

  async function handleDelete(runId) {
    if (confirmDelete !== runId) { setConfirmDelete(runId); return; }
    setConfirmDelete(null);
    try {
      await api.delete(`/doc-extractor/runs/${runId}`);
      if (viewed?.runId === runId) setViewed(null);
      loadRuns(page, search, showDeleted);
    } catch (err) {
      setRunsError(err.message);
    }
  }

  async function handleRestore(runId) {
    try {
      await api.post(`/doc-extractor/runs/${runId}/restore`, {});
      loadRuns(page, search, showDeleted);
    } catch (err) {
      setRunsError(err.message);
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-8" style={{ maxWidth: 960, margin: '0 auto' }}>

      {/* Page header */}
      <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--color-text)' }}>
        Document Extractor
      </h1>
      <p className="text-sm mb-7" style={{ color: 'var(--color-muted)' }}>
        Upload documents — Claude Vision extracts all visible fields and returns structured JSON.
        Supports JPEG, PNG, GIF, WEBP, and PDF. Select multiple files to process as a batch.
      </p>

      {/* ── Upload form ────────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="mb-7 space-y-4">

        {/* Drop zone */}
        <div
          role="button"
          tabIndex={0}
          className="rounded-xl text-center cursor-pointer"
          style={{
            border: '2px dashed var(--color-border)',
            padding: '24px',
            background: 'var(--color-surface)',
          }}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
          {files.length === 0 ? (
            <p className="text-sm m-0" style={{ color: 'var(--color-muted)' }}>
              Click to choose files, or drag and drop here
            </p>
          ) : (
            <div className="space-y-1">
              {files.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-sm px-2">
                  <span style={{ color: 'var(--color-text)' }} className="font-medium truncate max-w-xs">
                    {f.name}
                  </span>
                  <span className="flex items-center gap-3 shrink-0 ml-4">
                    <span style={{ color: 'var(--color-muted)' }}>
                      {(f.size / 1024).toFixed(1)} KB
                    </span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', fontSize: '1rem', lineHeight: 1 }}
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  </span>
                </div>
              ))}
              <p
                className="text-xs mt-2"
                style={{ color: 'var(--color-muted)' }}
                onClick={(e) => e.stopPropagation()}
              >
                Click to add more files
              </p>
            </div>
          )}
        </div>

        {/* Label + Purpose row */}
        <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Label <span className="font-normal normal-case" style={{ opacity: 0.7 }}>— optional</span>
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={files.length === 1 ? files[0].name : 'e.g. Q1 Invoices'}
              className="w-full px-3 py-2 text-sm rounded-lg outline-none"
              style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
            />
            {files.length > 1 && (
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                Applied as a prefix to each filename
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Purpose <span className="font-normal normal-case" style={{ opacity: 0.7 }}>— optional</span>
            </label>
            <select
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg outline-none"
              style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
            >
              {PURPOSE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Instructions */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
            Instructions for the AI <span className="font-normal normal-case" style={{ opacity: 0.7 }}>— optional</span>
          </label>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={3}
            placeholder="e.g. Focus on line items and totals. Ignore the header logo. Extract all dates in ISO format."
            className="w-full px-3 py-2 text-sm rounded-lg outline-none resize-none"
            style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
          />
        </div>

        {/* Submit */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={files.length === 0 || uploading}
            className="font-semibold text-sm rounded-lg px-5 py-2"
            style={{
              background: 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              cursor: files.length > 0 && !uploading ? 'pointer' : 'not-allowed',
              opacity: files.length === 0 || uploading ? 0.6 : 1,
            }}
          >
            {uploading
              ? (uploadProgress ?? 'Extracting…')
              : files.length > 1
                ? `Extract ${files.length} files`
                : 'Extract'}
          </button>
          {uploading && (
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
              This may take a moment for large files
            </span>
          )}
        </div>

        {uploadError && (
          <p className="text-sm" style={{ color: 'var(--color-error, #dc2626)' }}>
            {uploadError}
          </p>
        )}
      </form>

      {/* ── Result panel ───────────────────────────────────────────────────── */}
      {viewed && (
        <ResultPanel
          runId={viewed.runId}
          result={viewed.result}
          filename={viewed.filename}
          purpose={viewed.purpose}
          instructions={viewed.instructions}
          onClose={() => setViewed(null)}
        />
      )}

      {/* ── Runs table ─────────────────────────────────────────────────────── */}
      <div className={viewed ? 'mt-7' : ''}>

        {/* Toolbar */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <h2 className="text-base font-semibold m-0 shrink-0" style={{ color: 'var(--color-text)' }}>
            {isAdmin ? 'All runs' : 'My runs'}
            {total > 0 && (
              <span className="ml-2 font-normal text-sm" style={{ color: 'var(--color-muted)' }}>
                ({total})
              </span>
            )}
          </h2>
          <input
            type="search"
            placeholder="Search by label or filename…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="flex-1 text-sm rounded-lg px-3 py-1.5 outline-none"
            style={{
              minWidth: 180,
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-text)',
            }}
          />
          {isAdmin && (
            <label className="flex items-center gap-2 text-sm cursor-pointer shrink-0" style={{ color: 'var(--color-muted)' }}>
              <input
                type="checkbox"
                checked={showDeleted}
                onChange={(e) => { setShowDeleted(e.target.checked); setPage(1); }}
              />
              Show deleted
            </label>
          )}
        </div>

        {runsError && (
          <p className="text-sm mb-3" style={{ color: 'var(--color-error, #dc2626)' }}>{runsError}</p>
        )}

        {runsLoading && (
          <p className="text-sm py-4" style={{ color: 'var(--color-muted)' }}>Loading…</p>
        )}

        {!runsLoading && runs.length === 0 && (
          <p className="text-sm py-4" style={{ color: 'var(--color-muted)' }}>
            {search ? 'No runs match your search.' : 'No extraction runs yet.'}
          </p>
        )}

        {!runsLoading && runs.length > 0 && (
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-surface)' }}>
                <Th>Label / File</Th>
                <Th>Purpose</Th>
                <Th>Status</Th>
                <Th>Fields</Th>
                <Th>Date</Th>
                <Th style={{ width: 130 }} />
              </tr>
            </thead>
            <tbody>
              {runs.map((row) => (
                <tr
                  key={row.id}
                  style={{
                    borderTop: '1px solid var(--color-border)',
                    background: viewed?.runId === row.id ? 'var(--color-surface)' : undefined,
                    opacity: row.deleted_at ? 0.5 : 1,
                  }}
                >
                  <Td className="max-w-xs">
                    <div className="truncate font-medium" title={row.label || row.filename}>
                      {row.label || row.filename}
                    </div>
                  </Td>
                  <Td>
                    <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      {row.purpose || '—'}
                    </span>
                  </Td>
                  <Td><StatusBadge status={row.status} /></Td>
                  <Td>
                    {row.status === 'completed'
                      ? (row.field_count ?? 0)
                      : (row.status === 'failed' || row.status === 'stale' ? '—' : '…')}
                  </Td>
                  <Td>
                    <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      {new Date(row.created_at).toLocaleDateString()}
                    </span>
                  </Td>
                  <Td className="text-right">
                    <div className="flex gap-1.5 justify-end">
                      {row.status === 'completed' && !row.deleted_at && (
                        <ActionBtn onClick={() => handleView(row)} active={viewed?.runId === row.id}>
                          {viewed?.runId === row.id ? 'Hide' : 'View'}
                        </ActionBtn>
                      )}
                      {row.deleted_at ? (
                        isAdmin && (
                          <ActionBtn onClick={() => handleRestore(row.id)}>Restore</ActionBtn>
                        )
                      ) : (
                        <ActionBtn
                          onClick={() => handleDelete(row.id)}
                          danger
                          active={confirmDelete === row.id}
                        >
                          {confirmDelete === row.id ? 'Confirm?' : 'Delete'}
                        </ActionBtn>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center gap-2 mt-4 justify-end">
            <PageBtn disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</PageBtn>
            <span className="text-sm" style={{ color: 'var(--color-muted)' }}>
              Page {page} of {totalPages}
            </span>
            <PageBtn disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next →</PageBtn>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Result panel ──────────────────────────────────────────────────────────────

function ResultPanel({ runId, result, filename, purpose, instructions, onClose }) {
  return (
    <div
      className="rounded-xl p-6 mb-1"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold m-0" style={{ color: 'var(--color-text)' }}>
            {filename ?? 'Extraction result'}
          </h2>
          <p className="text-xs mt-0.5 m-0" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
            {runId}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-xl leading-none"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)' }}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* Purpose + Instructions metadata */}
      {(purpose || instructions) && (
        <div className="flex flex-col gap-2 mb-4 text-sm">
          {purpose && (
            <div className="flex gap-2">
              <span className="font-semibold shrink-0" style={{ color: 'var(--color-muted)', minWidth: 90 }}>Purpose</span>
              <span style={{ color: 'var(--color-text)' }}>{purpose}</span>
            </div>
          )}
          {instructions && (
            <div className="flex gap-2">
              <span className="font-semibold shrink-0" style={{ color: 'var(--color-muted)', minWidth: 90 }}>Instructions</span>
              <span style={{ color: 'var(--color-text)', whiteSpace: 'pre-wrap' }}>{instructions}</span>
            </div>
          )}
        </div>
      )}

      {/* Summary cards */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <StatCard label="Document type"    value={result?.document_type ?? '—'} />
        <StatCard label="Fields extracted" value={result?.fields?.length ?? 0} />
        {result?.page_count > 1 && (
          <StatCard label="Pages" value={result.page_count} />
        )}
        <StatCard label="Model" value={result?.model ?? '—'} />
        <StatCard
          label="Tokens"
          value={result?.tokensUsed
            ? (result.tokensUsed.input_tokens ?? 0) + (result.tokensUsed.output_tokens ?? 0)
            : '—'}
        />
      </div>

      {/* Fields table */}
      {result?.fields?.length > 0 && (
        <table className="w-full text-sm mb-4" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--color-bg)' }}>
              <Th style={{ width: 200 }}>Field</Th>
              <Th>Value</Th>
              <Th className="text-right" style={{ width: 90 }}>Confidence</Th>
            </tr>
          </thead>
          <tbody>
            {result.fields.map((f, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--color-border)' }}>
                <Td>
                  <span className="text-xs" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                    {f.name}
                  </span>
                </Td>
                <Td className="font-medium">{f.value}</Td>
                <Td className="text-right"><ConfidenceBadge value={f.confidence} /></Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Raw JSON */}
      <details>
        <summary className="text-xs cursor-pointer select-none" style={{ color: 'var(--color-muted)' }}>
          Raw JSON
        </summary>
        <pre
          className="text-xs rounded-lg p-3 mt-2 overflow-x-auto"
          style={{
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </div>
  );
}

// ── Shared table primitives ───────────────────────────────────────────────────

function Th({ children, className = '', style = {} }) {
  return (
    <th
      className={`px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider ${className}`}
      style={{ color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)', ...style }}
    >
      {children}
    </th>
  );
}

function Td({ children, className = '', style = {}, colSpan }) {
  return (
    <td
      className={`px-3 py-2 ${className}`}
      style={{ color: 'var(--color-text)', ...style }}
      colSpan={colSpan}
    >
      {children}
    </td>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value }) {
  return (
    <div
      className="rounded-lg px-4 py-2"
      style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', minWidth: 110 }}
    >
      <p className="text-xs uppercase tracking-wider m-0" style={{ color: 'var(--color-muted)' }}>
        {label}
      </p>
      <p className="text-sm font-semibold mt-1 m-0" style={{ color: 'var(--color-text)' }}>
        {String(value)}
      </p>
    </div>
  );
}

// ── Badges ────────────────────────────────────────────────────────────────────

function ConfidenceBadge({ value }) {
  const pct   = Math.round((value ?? 0) * 100);
  const color = pct >= 85 ? '#16a34a' : pct >= 60 ? '#d97706' : '#dc2626';
  return (
    <span className="text-xs font-semibold" style={{ color, fontFamily: 'var(--font-mono)' }}>
      {pct}%
    </span>
  );
}

function StatusBadge({ status }) {
  const map = {
    completed: { bg: '#dcfce7', color: '#15803d' },
    failed:    { bg: '#fee2e2', color: '#b91c1c' },
    pending:   { bg: '#fef9c3', color: '#854d0e' },
    stale:     { bg: '#f1f5f9', color: '#64748b' },
  };
  const s = map[status] ?? { bg: '#f1f5f9', color: '#64748b' };
  return (
    <span className="text-xs font-semibold rounded px-2 py-0.5" style={{ background: s.bg, color: s.color }}>
      {status}
    </span>
  );
}

// ── Buttons ───────────────────────────────────────────────────────────────────

function ActionBtn({ children, onClick, danger = false, active = false }) {
  return (
    <button
      onClick={onClick}
      className="text-xs rounded px-2.5 py-1 font-medium"
      style={{
        background: active && danger ? '#fef2f2' : active ? 'var(--color-surface)' : 'none',
        border: `1px solid ${danger && active ? '#fca5a5' : 'var(--color-border)'}`,
        color: danger && active ? '#b91c1c' : 'var(--color-muted)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

function PageBtn({ children, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-sm rounded-lg px-3 py-1.5"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        color: disabled ? 'var(--color-muted)' : 'var(--color-text)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}
