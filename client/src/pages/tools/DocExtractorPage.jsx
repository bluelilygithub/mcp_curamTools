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
import { fmtDate } from '../../utils/date';

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

const TRANSFORM_OPTIONS = [
  { value: 'none',           label: 'No transform' },
  { value: 'strip_currency', label: 'Strip currency symbols' },
  { value: 'numeric',        label: 'Numeric only' },
  { value: 'iso_date',       label: 'ISO date (YYYY-MM-DD)' },
  { value: 'uppercase',      label: 'Uppercase' },
  { value: 'lowercase',      label: 'Lowercase' },
];

export default function DocExtractorPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.roles?.find((r) => r.scope_type === 'global')?.name === 'org_admin';

  // ── Available models + resolved default (fetched once on mount) ─────────
  const [availableModels, setAvailableModels] = useState([]);
  const [defaultModelId, setDefaultModelId]   = useState('');
  useEffect(() => {
    Promise.all([
      api.get('/admin/models').catch(() => []),
      api.get('/doc-extractor/config').catch(() => null),
    ]).then(([models, config]) => {
      const enabled = (models ?? []).filter((m) => m.enabled !== false);
      setAvailableModels(enabled);
      if (config?.default_model?.id) setDefaultModelId(config.default_model.id);
    });
  }, []);

  // ── Upload state ──────────────────────────────────────────────────────────
  const [files, setFiles]              = useState([]);   // File[]
  const [label, setLabel]              = useState('');
  const [purpose, setPurpose]          = useState('');
  const [instructions, setInstructions]= useState('');
  const [modelOverride, setModelOverride] = useState('');  // '' → will be set to defaultModelId once loaded
  const [uploading, setUploading]      = useState(false);

  // ── Extraction progress ───────────────────────────────────────────────────
  // { file, index, total, phase: 'uploading'|'processing'|'complete', uploadPct }
  const [extractProgress, setExtractProgress] = useState(null);
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

  // ── Multi-select export ───────────────────────────────────────────────────
  const [selectedRuns, setSelectedRuns]   = useState(new Set());
  const [multiExporting, setMultiExporting] = useState(false);

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

  // Pre-select default model once it's loaded (only if user hasn't already chosen one)
  useEffect(() => {
    if (defaultModelId && modelOverride === '') setModelOverride(defaultModelId);
  }, [defaultModelId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadRuns(page, search, showDeleted); }, [page, search, showDeleted, loadRuns]);

  // Debounce search input → search state
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Clear selections when page/search changes
  useEffect(() => { setSelectedRuns(new Set()); }, [page, search, showDeleted]);

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
        setExtractProgress({ file: files[i].name, index: i + 1, total: files.length, phase: 'uploading', uploadPct: 0 });

        const fd = new FormData();
        fd.append('file', files[i]);
        if (label)         fd.append('label',        label);
        if (purpose)       fd.append('purpose',      purpose);
        if (instructions)  fd.append('instructions', instructions);
        if (modelOverride) fd.append('model',        modelOverride);

        const data = await api.uploadWithProgress('/doc-extractor/extract', fd, (fraction) => {
          if (fraction < 1) {
            setExtractProgress({ file: files[i].name, index: i + 1, total: files.length, phase: 'uploading', uploadPct: Math.round(fraction * 100) });
          } else {
            setExtractProgress({ file: files[i].name, index: i + 1, total: files.length, phase: 'processing', uploadPct: 100 });
          }
        });

        results.push(data);
      }

      // Show the last (or only) result in the panel
      const last = results[results.length - 1];
      if (last?.runId) setViewed({ runId: last.runId, result: last.result, purpose, instructions });

      setFiles([]);
      setLabel('');
      setPurpose('');
      setInstructions('');
      setModelOverride(defaultModelId || '');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setPage(1);
      loadRuns(1, search, showDeleted);
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
      setUploadProgress(null);
      setExtractProgress(null);
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

  function toggleSelect(id) {
    setSelectedRuns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const completedIds = runs.filter((r) => r.status === 'completed' && !r.deleted_at).map((r) => r.id);
    const allSelected  = completedIds.every((id) => selectedRuns.has(id));
    if (allSelected) {
      setSelectedRuns(new Set());
    } else {
      setSelectedRuns(new Set(completedIds));
    }
  }

  async function handleMultiExport() {
    setMultiExporting(true);
    setRunsError(null);
    try {
      const ids     = [...selectedRuns];
      const results = await Promise.all(ids.map((id) => api.get(`/doc-extractor/runs/${id}`)));

      const rows = [['source', 'field', 'value', 'confidence'].map(escapeCell).join(',')];
      for (const run of results) {
        const source = run.label || run.filename;
        for (const f of run.result?.fields ?? []) {
          rows.push(
            [source, f.name, f.value, f.confidence != null ? f.confidence.toFixed(2) : '']
              .map(escapeCell).join(',')
          );
        }
      }

      const bom  = '\uFEFF';
      const blob = new Blob([bom + rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement('a'), {
        href:     url,
        download: `extraction_export_${ids.length}_runs.csv`,
      });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      logExport(ids, 'csv', rows.length - 1);
      setSelectedRuns(new Set());
    } catch (err) {
      setRunsError(`Export failed: ${err.message}`);
    } finally {
      setMultiExporting(false);
    }
  }

  const completedIds   = runs.filter((r) => r.status === 'completed' && !r.deleted_at).map((r) => r.id);
  const allSelected    = completedIds.length > 0 && completedIds.every((id) => selectedRuns.has(id));
  const someSelected   = selectedRuns.size > 0;
  const totalPages     = Math.ceil(total / PAGE_SIZE);

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

        {/* Model override */}
        {availableModels.length > 0 && (
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Model <span className="font-normal normal-case" style={{ opacity: 0.7 }}>— override admin default</span>
            </label>
            <select
              value={modelOverride}
              onChange={(e) => setModelOverride(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg outline-none"
              style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
            >
              <option value="">Use admin default</option>
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name ?? m.id}</option>
              ))}
            </select>
          </div>
        )}

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
            {files.length > 1 ? `Extract ${files.length} files` : 'Extract'}
          </button>
        </div>

        {/* Extraction progress */}
        {extractProgress && (
          <ExtractionProgress
            file={extractProgress.file}
            index={extractProgress.index}
            total={extractProgress.total}
            phase={extractProgress.phase}
            uploadPct={extractProgress.uploadPct}
          />
        )}

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

        {/* Multi-select export bar */}
        {someSelected && (
          <div
            className="flex items-center gap-3 rounded-lg px-4 py-2.5 mb-4 text-sm"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <span style={{ color: 'var(--color-muted)' }}>
              {selectedRuns.size} run{selectedRuns.size !== 1 ? 's' : ''} selected
            </span>
            <button
              onClick={handleMultiExport}
              disabled={multiExporting}
              className="font-semibold text-xs rounded px-3 py-1.5"
              style={{
                background: 'var(--color-primary)',
                color: '#fff',
                border: 'none',
                cursor: multiExporting ? 'not-allowed' : 'pointer',
                opacity: multiExporting ? 0.6 : 1,
              }}
            >
              {multiExporting ? 'Exporting…' : 'Export CSV'}
            </button>
            <button
              onClick={() => setSelectedRuns(new Set())}
              className="text-xs"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)' }}
            >
              Clear
            </button>
          </div>
        )}

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
                <Th style={{ width: 32, paddingRight: 4 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    title="Select all completed runs on this page"
                  />
                </Th>
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
                  <Td style={{ paddingRight: 4, width: 32 }}>
                    {row.status === 'completed' && !row.deleted_at && (
                      <input
                        type="checkbox"
                        checked={selectedRuns.has(row.id)}
                        onChange={() => toggleSelect(row.id)}
                      />
                    )}
                  </Td>
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
                      {fmtDate(row.created_at)}
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

// ── Extraction progress ───────────────────────────────────────────────────────

function ExtractionProgress({ file, index, total, phase, uploadPct }) {
  const [animPct, setAnimPct] = useState(phase === 'uploading' ? (uploadPct ?? 0) : 0);

  // Sync upload percentage in real-time
  useEffect(() => {
    if (phase === 'uploading') setAnimPct(uploadPct ?? 0);
  }, [phase, uploadPct]);

  // Animate progress bar during AI processing phase
  useEffect(() => {
    if (phase !== 'processing') return;
    setAnimPct(0);
    const start = Date.now();
    const id = setInterval(() => {
      const ms = Date.now() - start;
      // Fast ramp to 70% in 5 s, then slow crawl toward 89%
      const target = ms < 5000
        ? (ms / 5000) * 70
        : 70 + ((ms - 5000) / 40000) * 19;
      setAnimPct(Math.min(target, 89));
    }, 150);
    return () => clearInterval(id);
  }, [phase]);

  const phaseLabel =
    phase === 'uploading'  ? `Uploading… ${uploadPct ?? 0}%` :
    phase === 'processing' ? 'AI extracting fields…' : 'Complete';

  const barColor = phase === 'complete' ? '#16a34a' : 'var(--color-primary)';

  return (
    <div
      className="rounded-xl px-5 py-4 mt-2"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
    >
      {total > 1 && (
        <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>
          File {index} of {total}
        </p>
      )}
      <p className="text-sm font-medium mb-3 truncate" style={{ color: 'var(--color-text)' }} title={file}>
        {file}
      </p>

      {/* Progress bar */}
      <div
        className="rounded-full overflow-hidden mb-2"
        style={{ height: 8, background: 'var(--color-border)' }}
      >
        <div
          style={{
            height: '100%',
            width: `${animPct}%`,
            background: barColor,
            transition: phase === 'uploading' ? 'width 200ms linear' : 'width 150ms ease-out',
            borderRadius: 9999,
          }}
        />
      </div>

      {/* Steps */}
      <div className="flex items-center gap-4 mt-2">
        <Step done={phase !== 'uploading'} active={phase === 'uploading'} label="Upload" />
        <StepArrow />
        <Step done={phase === 'complete'} active={phase === 'processing'} label="AI extraction" />
        <StepArrow />
        <Step done={false} active={phase === 'complete'} label="Done" />
      </div>

      <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{phaseLabel}</p>
    </div>
  );
}

function Step({ done, active, label }) {
  const color = done || active ? 'var(--color-primary)' : 'var(--color-muted)';
  return (
    <div className="flex items-center gap-1.5">
      <span
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 18, height: 18, borderRadius: '50%',
          background: done ? 'var(--color-primary)' : active ? 'transparent' : 'transparent',
          border: done ? 'none' : `2px solid ${color}`,
          fontSize: 10, color: done ? '#fff' : color,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {done ? '✓' : ''}
      </span>
      <span className="text-xs" style={{ color, fontWeight: active ? 600 : 400 }}>{label}</span>
    </div>
  );
}

function StepArrow() {
  return <span style={{ color: 'var(--color-border)', fontSize: 12, flexShrink: 0 }}>→</span>;
}

// ── Export helpers ────────────────────────────────────────────────────────────

function humanize(name) {
  return String(name ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function applyTransform(value, transform) {
  if (value == null) return value;
  const str = String(value);
  switch (transform) {
    case 'strip_currency': return str.replace(/[$£€,]/g, '').trim();
    case 'numeric':        return str.replace(/[^0-9.]/g, '');
    case 'iso_date': {
      const d = new Date(str);
      return isNaN(d.getTime()) ? str : d.toISOString().slice(0, 10);
    }
    case 'uppercase': return str.toUpperCase();
    case 'lowercase': return str.toLowerCase();
    default:          return str;
  }
}

function escapeCell(value) {
  const str = value == null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function exportCsv(fields, filename) {
  // UTF-8 BOM so Excel renders accented characters correctly on Windows
  const bom  = '\uFEFF';
  const rows = [
    ['field', 'value', 'confidence'].map(escapeCell).join(','),
    ...fields.map((f) =>
      [f.name, f.value, f.confidence != null ? f.confidence.toFixed(2) : ''].map(escapeCell).join(',')
    ),
  ];
  const blob = new Blob([bom + rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `${filename}.csv` });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportPdf(fields, meta) {
  const rows = fields.map((f) => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-size:12px;color:#6b7280">${escapeHtml(f.name)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:13px">${escapeHtml(f.value ?? '')}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;text-align:right;color:#6b7280">${f.confidence != null ? (f.confidence * 100).toFixed(0) + '%' : '—'}</td>
    </tr>`).join('');

  const win = window.open('', '_blank', 'width=800,height=600');
  win.document.write(`<!DOCTYPE html><html><head>
    <title>${escapeHtml(meta.filename)}</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 32px; color: #111; }
      h1   { font-size: 16px; margin: 0 0 4px; }
      .meta{ font-size: 12px; color: #6b7280; margin-bottom: 20px; }
      table{ width: 100%; border-collapse: collapse; }
      th   { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
             color: #6b7280; padding: 6px 10px; border-bottom: 2px solid #e5e7eb; }
      @media print { body { margin: 16px; } }
    </style>
  </head><body>
    <h1>${escapeHtml(meta.filename)}</h1>
    <p class="meta">Extracted fields — ${escapeHtml(meta.filename)}${meta.documentType ? ' &nbsp;·&nbsp; Type: ' + escapeHtml(meta.documentType) : ''}${meta.purpose ? ' &nbsp;·&nbsp; Purpose: ' + escapeHtml(meta.purpose) : ''} &nbsp;·&nbsp; Fields: ${fields.length}${meta.date ? ' &nbsp;·&nbsp; ' + escapeHtml(meta.date) : ''}</p>
    <table>
      <thead><tr>
        <th style="width:200px">Field</th><th>Value</th><th style="width:90px;text-align:right">Confidence</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function logExport(runIds, format, fieldCount) {
  try {
    await api.post('/export-log', {
      tool_slug:   'doc-extractor',
      run_ids:     runIds,
      format,
      field_count: fieldCount,
    });
  } catch {
    // fire-and-forget — never block the user on log failure
  }
}

// ── Export button ─────────────────────────────────────────────────────────────

function ExportBtn({ onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex items-center justify-center rounded-lg text-xs px-2.5 py-1.5 gap-1.5"
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-muted)',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

// ── Field Customization Modal ─────────────────────────────────────────────────

function FieldCustomizationModal({ fields, baseName, format, runId, onClose }) {
  const [configs, setConfigs] = useState(() =>
    fields.map((f) => ({
      name:        f.name,
      label:       humanize(f.name),
      include:     true,
      transform:   'none',
      _value:      f.value,
      _confidence: f.confidence,
    }))
  );

  function moveUp(i) {
    if (i === 0) return;
    setConfigs((prev) => {
      const next = [...prev];
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      return next;
    });
  }

  function moveDown(i) {
    setConfigs((prev) => {
      if (i === prev.length - 1) return prev;
      const next = [...prev];
      [next[i], next[i + 1]] = [next[i + 1], next[i]];
      return next;
    });
  }

  function update(i, key, val) {
    setConfigs((prev) => prev.map((c, idx) => idx === i ? { ...c, [key]: val } : c));
  }

  function handleExport() {
    const included = configs
      .filter((c) => c.include)
      .map((c) => ({
        name:        c.label,
        value:       applyTransform(c._value, c.transform),
        confidence:  c._confidence,
      }));

    if (format === 'csv') {
      exportCsv(included, baseName);
    } else {
      exportPdf(included, { filename: baseName, date: fmtDate(new Date()) });
    }

    logExport([runId], format, included.length);
    onClose();
  }

  const includedCount = configs.filter((c) => c.include).length;

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: 'var(--color-surface)',
          borderRadius: 12,
          border: '1px solid var(--color-border)',
          width: '100%',
          maxWidth: 760,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <div>
            <h3 className="text-base font-semibold m-0" style={{ color: 'var(--color-text)' }}>
              Configure {format === 'pdf' ? 'PDF' : 'CSV'} export
            </h3>
            <p className="text-xs mt-0.5 m-0" style={{ color: 'var(--color-muted)' }}>
              Reorder, rename, and transform fields before exporting
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', fontSize: '1.25rem', lineHeight: 1 }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Table */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--color-surface)', zIndex: 1 }}>
              <tr>
                <Th style={{ width: 52 }} />
                <Th style={{ width: 160 }}>Field</Th>
                <Th>Export label</Th>
                <Th style={{ width: 180 }}>Transform</Th>
                <Th style={{ width: 60 }}>Include</Th>
              </tr>
            </thead>
            <tbody>
              {configs.map((c, i) => (
                <tr
                  key={c.name + i}
                  style={{
                    borderTop: '1px solid var(--color-border)',
                    opacity: c.include ? 1 : 0.45,
                  }}
                >
                  {/* Reorder arrows */}
                  <Td style={{ paddingRight: 4 }}>
                    <div className="flex flex-col gap-0.5 items-center">
                      <button
                        type="button"
                        onClick={() => moveUp(i)}
                        disabled={i === 0}
                        title="Move up"
                        style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', color: 'var(--color-muted)', opacity: i === 0 ? 0.25 : 1, padding: '1px 4px', fontSize: 11, lineHeight: 1 }}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => moveDown(i)}
                        disabled={i === configs.length - 1}
                        title="Move down"
                        style={{ background: 'none', border: 'none', cursor: i === configs.length - 1 ? 'default' : 'pointer', color: 'var(--color-muted)', opacity: i === configs.length - 1 ? 0.25 : 1, padding: '1px 4px', fontSize: 11, lineHeight: 1 }}
                      >
                        ▼
                      </button>
                    </div>
                  </Td>
                  {/* Original field name */}
                  <Td>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-muted)' }}>
                      {c.name}
                    </span>
                  </Td>
                  {/* Custom label */}
                  <Td>
                    <input
                      type="text"
                      value={c.label}
                      onChange={(e) => update(i, 'label', e.target.value)}
                      className="w-full px-2 py-1 text-xs rounded outline-none"
                      style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                    />
                  </Td>
                  {/* Transform */}
                  <Td>
                    <select
                      value={c.transform}
                      onChange={(e) => update(i, 'transform', e.target.value)}
                      className="w-full px-2 py-1 text-xs rounded outline-none"
                      style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                    >
                      {TRANSFORM_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </Td>
                  {/* Include toggle */}
                  <Td className="text-center">
                    <input
                      type="checkbox"
                      checked={c.include}
                      onChange={(e) => update(i, 'include', e.target.checked)}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {includedCount} of {configs.length} field{configs.length !== 1 ? 's' : ''} included
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-sm rounded-lg px-4 py-2"
              style={{
                background: 'none',
                border: '1px solid var(--color-border)',
                color: 'var(--color-muted)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={includedCount === 0}
              className="font-semibold text-sm rounded-lg px-4 py-2"
              style={{
                background: 'var(--color-primary)',
                color: '#fff',
                border: 'none',
                cursor: includedCount === 0 ? 'not-allowed' : 'pointer',
                opacity: includedCount === 0 ? 0.5 : 1,
              }}
            >
              Export {format === 'pdf' ? 'PDF' : 'CSV'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Result panel ──────────────────────────────────────────────────────────────

function ResultPanel({ runId, result, filename, purpose, instructions, onClose }) {
  const [customizeFor, setCustomizeFor] = useState(null); // 'pdf' | 'csv' | null

  const fields   = result?.fields ?? [];
  const baseName = (filename ?? 'extraction').replace(/\.[^.]+$/, '');

  return (
    <>
      {customizeFor && (
        <FieldCustomizationModal
          fields={fields}
          baseName={baseName}
          format={customizeFor}
          runId={runId}
          onClose={() => setCustomizeFor(null)}
        />
      )}

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
          <div className="flex items-center gap-2">
            {fields.length > 0 && (
              <>
                <ExportBtn title="Export as PDF" onClick={() => setCustomizeFor('pdf')}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                  PDF
                </ExportBtn>
                <ExportBtn title="Export as CSV" onClick={() => setCustomizeFor('csv')}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>
                  CSV
                </ExportBtn>
              </>
            )}
            <button
              onClick={onClose}
              className="text-xl leading-none ml-1"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)' }}
              aria-label="Close"
            >
              ×
            </button>
          </div>
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

        {/* Quality advisory banner */}
        {result?.quality_advisory?.flag && (
          <div
            className="flex gap-3 rounded-lg px-4 py-3 mb-4 text-sm"
            style={{ background: '#fffbeb', border: '1px solid #f59e0b', color: '#92400e' }}
          >
            <span className="shrink-0 text-base leading-snug">⚠</span>
            <div>
              <span className="font-semibold">Results may be limited — a more capable model could help.</span>
              {result.quality_advisory.reason && (
                <ul className="mt-2 mb-1 space-y-1 list-none pl-0">
                  {result.quality_advisory.reason
                    .split(/;\s*/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map((sentence, i) => (
                      <li key={i} className="flex gap-2">
                        <span style={{ opacity: 0.5, flexShrink: 0 }}>·</span>
                        <span>{sentence.replace(/\.$/, '')}.</span>
                      </li>
                    ))}
                </ul>
              )}
              {result.quality_advisory.avg_confidence != null && (
                <span className="block opacity-75 text-xs">
                  Avg confidence: {(result.quality_advisory.avg_confidence * 100).toFixed(0)}%
                </span>
              )}
              <span className="block mt-1 opacity-75 text-xs">
                Select a higher-tier model in the upload form above and re-run for better accuracy.
              </span>
            </div>
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
    </>
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
