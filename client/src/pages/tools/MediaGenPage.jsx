/**
 * MediaGenPage — Fal.ai image and video generation tool.
 *
 * Submits a multipart form to POST /api/media-gen/generate which returns
 * an SSE stream of progress events. Displays the generated image or video
 * inline and keeps a paginated history of past runs.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import useAuthStore from '../../stores/authStore';

// ── Constants ────────────────────────────────────────────────────────────────

const MODEL_GROUPS = [
  {
    label: 'Text → Video',
    models: [
      { id: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video',  label: 'Kling 2.5 Turbo Pro', requiresImage: false, type: 'video' },
      { id: 'kling-video/v3/text-to-video',                     label: 'Kling 3.0',           requiresImage: false, type: 'video' },
      { id: 'fal-ai/sora-2/text-to-video',                      label: 'Sora 2',              requiresImage: false, type: 'video' },
      { id: 'fal-ai/pixverse/v6/text-to-video',                 label: 'Pixverse V6',         requiresImage: false, type: 'video' },
      { id: 'fal-ai/fast-svd/text-to-video',                    label: 'Fast SVD',            requiresImage: false, type: 'video' },
    ],
  },
  {
    label: 'Image → Video',
    models: [
      { id: 'fal-ai/minimax-video/image-to-video',              label: 'MiniMax (Hailuo AI)', requiresImage: true, type: 'video' },
      { id: 'fal-ai/sora-2/image-to-video',                     label: 'Sora 2',              requiresImage: true, type: 'video' },
      { id: 'fal-ai/wan-2.2/image-to-video',                    label: 'Wan 2.2',             requiresImage: true, type: 'video' },
      { id: 'fal-ai/seedance-2.0/image-to-video',               label: 'Seedance 2.0',        requiresImage: true, type: 'video' },
      { id: 'fal-ai/pika/v2.2/image-to-video',                  label: 'Pika 2.2',            requiresImage: true, type: 'video' },
      { id: 'fal-ai/fast-svd/image-to-video',                   label: 'Fast SVD',            requiresImage: true, type: 'video' },
    ],
  },
  {
    label: 'Image → Image',
    models: [
      { id: 'fal-ai/flux/dev/image-to-image',                   label: 'FLUX Dev',            requiresImage: true, type: 'image' },
      { id: 'fal-ai/flux/pro/image-to-image',                   label: 'FLUX Pro',            requiresImage: true, type: 'image' },
      { id: 'fal-ai/flux-lora/image-to-image',                  label: 'FLUX LoRA',           requiresImage: true, type: 'image' },
      { id: 'fal-ai/glm-image/image-to-image',                  label: 'GLM Image',           requiresImage: true, type: 'image' },
      { id: 'fal-ai/uno',                                        label: 'UNO',                 requiresImage: true, type: 'image' },
    ],
  },
  {
    label: 'Text → Image',
    models: [
      { id: 'fal-ai/flux/schnell',                               label: 'FLUX Schnell',        requiresImage: false, type: 'image' },
      { id: 'fal-ai/black-forest-labs/flux.1schnell',            label: 'FLUX.1 Schnell',      requiresImage: false, type: 'image' },
      { id: 'fal-ai/flux/dev',                                   label: 'FLUX Dev',            requiresImage: false, type: 'image' },
      { id: 'fal-ai/flux/pro',                                   label: 'FLUX Pro',            requiresImage: false, type: 'image' },
      { id: 'fal-ai/flux/kontext',                               label: 'FLUX Kontext',        requiresImage: false, type: 'image' },
      { id: 'fal-ai/ideogram/v2',                                label: 'Ideogram 2.0',        requiresImage: false, type: 'image' },
    ],
  },
];

// Flat list for lookups
const MODELS = MODEL_GROUPS.flatMap((g) => g.models);

/**
 * Infer type/requiresImage for a model ID that isn't in the preset list.
 * Mirrors the server-side modelType() logic.
 */
function inferModelMeta(id) {
  const s = (id || '').toLowerCase();
  const isVideo =
    s.includes('text-to-video') || s.includes('image-to-video') ||
    s.includes('seedance') || s.includes('kling') || s.includes('sora') ||
    s.includes('svd') || s.includes('pixverse') || s.includes('wan') ||
    s.includes('pika') || s.includes('minimax');
  const requiresImage =
    s.includes('image-to-video') || s.includes('image-to-image');
  return { type: isVideo ? 'video' : 'image', requiresImage };
}

const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const DURATIONS     = ['5', '10'];

// ── Small UI helpers ─────────────────────────────────────────────────────────

function Badge({ children, color = 'gray' }) {
  const palette = {
    gray:   { background: 'var(--color-surface)', color: 'var(--color-muted)',   border: '1px solid var(--color-border)' },
    green:  { background: '#d1fae5',              color: '#065f46',              border: '1px solid #6ee7b7' },
    amber:  { background: '#fef3c7',              color: '#92400e',              border: '1px solid #fcd34d' },
    red:    { background: '#fee2e2',              color: '#991b1b',              border: '1px solid #fca5a5' },
    blue:   { background: '#dbeafe',              color: '#1e40af',              border: '1px solid #93c5fd' },
  };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.02em',
        ...palette[color],
      }}
    >
      {children}
    </span>
  );
}

function Spinner({ size = 16 }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      style={{ animation: 'spin 0.8s linear infinite' }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function statusBadge(status) {
  const map = {
    pending:   { label: 'Pending',   color: 'amber' },
    completed: { label: 'Completed', color: 'green' },
    failed:    { label: 'Failed',    color: 'red'   },
  };
  const s = map[status] || { label: status, color: 'gray' };
  return <Badge color={s.color}>{s.label}</Badge>;
}

// ── Main component ───────────────────────────────────────────────────────────

export default function MediaGenPage() {
  const { token } = useAuthStore();

  // Form state
  const [model,        setModel]        = useState(MODELS[0].id);
  const [customInput,  setCustomInput]  = useState('');   // raw text field
  const [prompt,       setPrompt]       = useState('');
  const [aspectRatio,  setAspectRatio]  = useState('16:9');
  const [duration,     setDuration]     = useState('5');
  const [refFile,      setRefFile]      = useState(null);
  const [refPreview,   setRefPreview]   = useState(null);
  const fileInputRef = useRef(null);

  // Generation state
  const [generating,   setGenerating]   = useState(false);
  const [statusMsgs,   setStatusMsgs]   = useState([]);
  const [result,       setResult]       = useState(null); // { type, url, runId }
  const [genError,     setGenError]     = useState(null);

  // History state
  const [runs,         setRuns]         = useState([]);
  const [total,        setTotal]        = useState(0);
  const [page,         setPage]         = useState(1);
  const [loadingRuns,  setLoadingRuns]  = useState(false);
  const [search,       setSearch]       = useState('');
  const [searchInput,  setSearchInput]  = useState('');

  // Effective model: custom input wins if non-empty
  const effectiveModelId = customInput.trim() || model;
  const presetMatch      = MODELS.find((m) => m.id === effectiveModelId);
  const selectedModel    = presetMatch || { id: effectiveModelId, ...inferModelMeta(effectiveModelId) };
  const isVideo          = selectedModel.type === 'video';
  const LIMIT         = 10;

  // Load history
  const loadRuns = useCallback(async (pg = 1, q = search) => {
    setLoadingRuns(true);
    try {
      const params = new URLSearchParams({ page: pg, limit: LIMIT, search: q });
      const res = await fetch(`/api/media-gen/runs?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRuns(data.runs || []);
      setTotal(data.total || 0);
      setPage(pg);
    } catch (err) {
      console.error('[media-gen] load runs:', err.message);
    } finally {
      setLoadingRuns(false);
    }
  }, [token, search]);

  useEffect(() => { loadRuns(1, ''); }, []);

  // Reference image handling
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRefFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setRefPreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  const clearRef = () => {
    setRefFile(null);
    setRefPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Generate
  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setStatusMsgs([]);
    setResult(null);
    setGenError(null);

    const form = new FormData();
    form.append('model',       effectiveModelId);
    form.append('prompt',      prompt.trim());
    form.append('aspectRatio', aspectRatio);
    if (isVideo) form.append('duration', duration);
    if (refFile)  form.append('referenceImage', refFile);

    try {
      const res = await fetch('/api/media-gen/generate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      // Read SSE stream
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete last chunk

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let evt;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }

          switch (evt.type) {
            case 'status':
              setStatusMsgs((prev) => [...prev, evt.message]);
              break;
            case 'submitted':
              setStatusMsgs((prev) => [...prev, `Job submitted (ID: ${evt.requestId.slice(0, 12)}…)`]);
              break;
            case 'progress':
              setStatusMsgs((prev) => {
                const last = prev[prev.length - 1] || '';
                const msg  = `${evt.status}… ${evt.elapsed}s elapsed`;
                if (last.startsWith(evt.status)) return [...prev.slice(0, -1), msg];
                return [...prev, msg];
              });
              break;
            case 'complete': {
              const r = evt.result;
              const url = r?.video?.url || r?.images?.[0]?.url || null;
              setResult({ type: evt.outputType, url, runId: evt.runId, raw: r });
              setStatusMsgs((prev) => [...prev, 'Generation complete.']);
              loadRuns(1, search);
              break;
            }
            case 'error':
              setGenError(evt.message);
              break;
            default:
              break;
          }
        }
      }
    } catch (err) {
      setGenError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this run?')) return;
    await fetch(`/api/media-gen/runs/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
    loadRuns(page, search);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setSearch(searchInput);
    loadRuns(1, searchInput);
  };

  const totalPages = Math.ceil(total / LIMIT);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 20px' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
          Media Generator
        </h1>
        <p style={{ marginTop: 4, fontSize: 14, color: 'var(--color-muted)' }}>
          Text-to-video, image-to-video, image-to-image, and text-to-image — powered by Fal.ai.
        </p>
      </div>

      {/* Form card */}
      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          padding: 24,
          marginBottom: 24,
        }}
      >
        {/* Model selector */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>
            Model
          </label>

          {/* Preset groups — dimmed when a custom ID is typed */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, opacity: customInput.trim() ? 0.4 : 1, transition: 'opacity 150ms' }}>
            {MODEL_GROUPS.map((group) => (
              <div key={group.label}>
                <div style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--color-muted)',
                  marginBottom: 5,
                }}>
                  {group.label}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {group.models.map((m) => {
                    const active = !customInput.trim() && model === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => { setModel(m.id); setCustomInput(''); }}
                        style={{
                          padding: '5px 12px',
                          borderRadius: 5,
                          fontSize: 12,
                          cursor: 'pointer',
                          border: active ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                          background: active ? 'var(--color-primary)' : 'var(--color-bg)',
                          color: active ? '#fff' : 'var(--color-text)',
                          fontWeight: active ? 600 : 400,
                          transition: 'all 120ms',
                        }}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Custom model ID */}
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <input
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder="Or paste any Fal.ai model ID — e.g. fal-ai/seedance-2.0/text-to-video"
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: 6,
                  border: customInput.trim()
                    ? '2px solid var(--color-primary)'
                    : '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  fontSize: 12,
                  fontFamily: 'var(--font-mono, monospace)',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            {customInput.trim() && (
              <button
                onClick={() => setCustomInput('')}
                title="Clear custom ID"
                style={{
                  padding: '6px 10px',
                  borderRadius: 5,
                  border: '1px solid var(--color-border)',
                  background: 'transparent',
                  color: 'var(--color-muted)',
                  fontSize: 12,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                ✕ Clear
              </button>
            )}
          </div>
          {customInput.trim() && (
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-muted)' }}>
              Using custom ID: <code style={{ fontFamily: 'var(--font-mono, monospace)' }}>{customInput.trim()}</code>
              {' · '}detected as <strong>{selectedModel.type}</strong>
              {selectedModel.requiresImage ? ' · image required' : ''}
            </div>
          )}
        </div>

        {/* Prompt */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 6 }}>
            Prompt <span style={{ color: 'var(--color-error)' }}>*</span>
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={isVideo
              ? 'Describe the video you want to generate…'
              : 'Describe the image you want to generate…'}
            rows={4}
            maxLength={2000}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 6,
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              fontSize: 14,
              resize: 'vertical',
              boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
          />
          <div style={{ fontSize: 11, color: 'var(--color-muted)', textAlign: 'right', marginTop: 2 }}>
            {prompt.length} / 2000
          </div>
        </div>

        {/* Options row */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          {/* Aspect ratio */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 6 }}>
              Aspect Ratio
            </label>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
              style={{
                padding: '7px 10px',
                borderRadius: 6,
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                fontSize: 13,
              }}
            >
              {ASPECT_RATIOS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* Duration — video only */}
          {isVideo && (
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 6 }}>
                Duration
              </label>
              <select
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                style={{
                  padding: '7px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  fontSize: 13,
                }}
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>{d} seconds</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Reference image */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 6 }}>
            Reference Image{' '}
            {selectedModel.requiresImage
              ? <span style={{ color: 'var(--color-error)' }}>* required for this model</span>
              : <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(optional)</span>}
          </label>
          {refPreview ? (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <img
                src={refPreview}
                alt="Reference"
                style={{ maxWidth: 180, maxHeight: 120, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--color-border)' }}
              />
              <div>
                <div style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 6 }}>{refFile?.name}</div>
                <button
                  onClick={clearRef}
                  style={{
                    padding: '4px 12px',
                    fontSize: 12,
                    borderRadius: 5,
                    border: '1px solid var(--color-border)',
                    background: 'transparent',
                    color: 'var(--color-error)',
                    cursor: 'pointer',
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                style={{ display: 'none' }}
                id="ref-image-input"
              />
              <label
                htmlFor="ref-image-input"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: '1px dashed var(--color-border)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-muted)',
                  fontSize: 13,
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                Upload reference image
              </label>
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-muted)' }}>
                Used as a style or content guide for generation. Max 20 MB.
              </div>
            </div>
          )}
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={generating || !prompt.trim() || (selectedModel.requiresImage && !refFile)}
          style={{
            padding: '10px 24px',
            borderRadius: 6,
            border: 'none',
            background: generating || !prompt.trim() || (selectedModel.requiresImage && !refFile) ? 'var(--color-border)' : 'var(--color-primary)',
            color: generating || !prompt.trim() || (selectedModel.requiresImage && !refFile) ? 'var(--color-muted)' : '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: generating || !prompt.trim() || (selectedModel.requiresImage && !refFile) ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            transition: 'all 150ms',
          }}
        >
          {generating ? <Spinner size={15} /> : null}
          {generating ? 'Generating…' : `Generate ${isVideo ? 'Video' : 'Image'}`}
        </button>
      </div>

      {/* Progress / status */}
      {(generating || statusMsgs.length > 0) && (
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            padding: 16,
            marginBottom: 24,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>
            {generating ? 'Generation in progress…' : 'Generation log'}
          </div>
          {statusMsgs.map((m, i) => (
            <div key={i} style={{ fontSize: 13, color: 'var(--color-muted)', paddingLeft: 8, lineHeight: '1.8' }}>
              • {m}
            </div>
          ))}
          {generating && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-muted)' }}>
              Video generation typically takes 30–90 seconds.
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {genError && (
        <div
          style={{
            background: '#fee2e2',
            border: '1px solid #fca5a5',
            borderRadius: 8,
            padding: 16,
            marginBottom: 24,
            color: '#991b1b',
            fontSize: 13,
          }}
        >
          <strong>Generation failed:</strong> {genError}
        </div>
      )}

      {/* Result */}
      {result && (
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            padding: 20,
            marginBottom: 24,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>
              Result <Badge color="green">{result.type === 'video' ? 'Video' : 'Image'}</Badge>
            </div>
            {result.url && (
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                download
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: '1px solid var(--color-primary)',
                  background: 'transparent',
                  color: 'var(--color-primary)',
                  fontSize: 12,
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                Download
              </a>
            )}
          </div>

          {result.url && result.type === 'video' && (
            <video
              src={result.url}
              controls
              style={{
                width: '100%',
                maxWidth: 720,
                borderRadius: 6,
                background: '#000',
                display: 'block',
              }}
            />
          )}

          {result.url && result.type === 'image' && (
            <img
              src={result.url}
              alt="Generated"
              style={{
                width: '100%',
                maxWidth: 720,
                borderRadius: 6,
                display: 'block',
              }}
            />
          )}

          {!result.url && (
            <div style={{ color: 'var(--color-muted)', fontSize: 13 }}>
              Result generated but no media URL returned. Check run #{result.runId} for the raw response.
            </div>
          )}
        </div>
      )}

      {/* History */}
      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          padding: '20px 20px 0',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>
            History <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--color-muted)' }}>({total} runs)</span>
          </div>
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8 }}>
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search prompts…"
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                fontSize: 13,
                width: 200,
              }}
            />
            <button
              type="submit"
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Search
            </button>
          </form>
        </div>

        {loadingRuns ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--color-muted)' }}>
            <Spinner size={18} />
          </div>
        ) : runs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--color-muted)', fontSize: 13 }}>
            No runs yet. Generate something above.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {['Model', 'Prompt', 'Type', 'Status', 'Created', 'Result', ''].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        color: 'var(--color-muted)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const mediaUrl = run.video_url || run.image_url;
                  return (
                    <tr
                      key={run.id}
                      style={{ borderBottom: '1px solid var(--color-border)' }}
                    >
                      <td style={{ padding: '10px 10px', color: 'var(--color-muted)', whiteSpace: 'nowrap', maxWidth: 160 }}>
                        <span style={{ fontSize: 11 }}>{run.model.replace('fal-ai/', '')}</span>
                      </td>
                      <td style={{ padding: '10px 10px', maxWidth: 280 }}>
                        <span
                          title={run.prompt}
                          style={{
                            display: 'block',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            color: 'var(--color-text)',
                          }}
                        >
                          {run.prompt}
                        </span>
                      </td>
                      <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>
                        <Badge color={run.output_type === 'video' ? 'blue' : 'gray'}>
                          {run.output_type}
                        </Badge>
                      </td>
                      <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>
                        {statusBadge(run.status)}
                      </td>
                      <td style={{ padding: '10px 10px', whiteSpace: 'nowrap', color: 'var(--color-muted)' }}>
                        {fmtDate(run.created_at)}
                      </td>
                      <td style={{ padding: '10px 10px' }}>
                        {mediaUrl ? (
                          <a
                            href={mediaUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: 'var(--color-primary)', fontSize: 12 }}
                          >
                            {run.output_type === 'video' ? 'View video' : 'View image'}
                          </a>
                        ) : run.error ? (
                          <span
                            title={run.error}
                            style={{ color: 'var(--color-error)', fontSize: 12, cursor: 'help' }}
                          >
                            Error ⓘ
                          </span>
                        ) : (
                          <span style={{ color: 'var(--color-muted)', fontSize: 12 }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 10px' }}>
                        <button
                          onClick={() => handleDelete(run.id)}
                          title="Delete run"
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--color-muted)',
                            padding: '2px 6px',
                            borderRadius: 4,
                          }}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 8,
              padding: '14px 0',
              borderTop: '1px solid var(--color-border)',
              marginTop: 4,
            }}
          >
            <button
              onClick={() => loadRuns(page - 1, search)}
              disabled={page <= 1}
              style={{
                padding: '5px 12px',
                borderRadius: 5,
                border: '1px solid var(--color-border)',
                background: 'transparent',
                color: page <= 1 ? 'var(--color-muted)' : 'var(--color-text)',
                cursor: page <= 1 ? 'not-allowed' : 'pointer',
                fontSize: 12,
              }}
            >
              ← Prev
            </button>
            <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => loadRuns(page + 1, search)}
              disabled={page >= totalPages}
              style={{
                padding: '5px 12px',
                borderRadius: 5,
                border: '1px solid var(--color-border)',
                background: 'transparent',
                color: page >= totalPages ? 'var(--color-muted)' : 'var(--color-text)',
                cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                fontSize: 12,
              }}
            >
              Next →
            </button>
          </div>
        )}

        {!loadingRuns && runs.length > 0 && totalPages <= 1 && (
          <div style={{ height: 16 }} />
        )}
      </div>
    </div>
  );
}
