/**
 * WP Theme Extractor — fetch a URL and generate a WordPress theme skeleton.
 *
 * Fetches the page HTML server-side, passes to Claude, and returns a full
 * theme with style.css, functions.php, header/footer, and page templates.
 */
import { useState, useEffect, useRef } from 'react';
import api from '../../api/client';
import InlineBanner from '../../components/ui/InlineBanner';
import { fmtDate } from '../../utils/date';

const AGENT_SLUG = 'wp-theme-extractor';

// ── File metadata ─────────────────────────────────────────────────────────────

function buildFileList(files, pageType) {
  if (!files) return [];
  const main = files.mainTemplate;
  const cpt  = files.singleCptPHP;
  return [
    { key: 'styleCss',      filename: 'style.css',                       content: files.styleCss },
    { key: 'functionsPHP',  filename: 'functions.php',                   content: files.functionsPHP },
    { key: 'headerPHP',     filename: 'header.php',                      content: files.headerPHP },
    { key: 'footerPHP',     filename: 'footer.php',                      content: files.footerPHP },
    { key: 'mainTemplate',  filename: main?.filename ?? (pageType === 'post-page' ? 'single.php' : 'front-page.php'), content: main?.content ?? '' },
    { key: 'pagePHP',       filename: 'page.php',                        content: files.pagePHP },
    { key: 'archivePHP',    filename: 'archive.php',                     content: files.archivePHP },
    { key: 'singleCptPHP',  filename: cpt?.filename ?? 'single-service.php', content: cpt?.content ?? '' },
    { key: 'templateOutline', filename: 'template-outline.html',         content: files.templateOutline },
  ].filter((f) => f.content);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyToClipboard(text) {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

function downloadAllFiles(files, pageType) {
  const list = buildFileList(files, pageType);
  for (const f of list) {
    if (f.content) downloadFile(f.filename, f.content);
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ProgressBar({ lines }) {
  return (
    <div
      className="rounded-xl border p-4 mb-4"
      style={{ borderColor: 'var(--color-primary)', background: 'var(--color-surface)' }}
    >
      <style>{`@keyframes _wp_slide { 0%{left:-45%} 100%{left:110%} }`}</style>
      <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-text)' }}>
        Extracting theme — typically 30–90 seconds.
        <span style={{ color: 'var(--color-muted)' }}> Please don&apos;t navigate away.</span>
      </p>
      <div style={{ position: 'relative', height: 4, borderRadius: 2, overflow: 'hidden', background: 'var(--color-border)' }}>
        <div style={{
          position: 'absolute', top: 0, height: '100%', width: '45%',
          background: 'var(--color-primary)', borderRadius: 2,
          animation: '_wp_slide 1.4s ease-in-out infinite',
        }} />
      </div>
      {lines.length > 0 && (
        <div className="mt-3 space-y-0.5">
          {lines.slice(-4).map((l, i) => (
            <p key={i} className="text-xs" style={{ color: 'var(--color-muted)' }}>
              <span style={{ color: 'var(--color-primary)', marginRight: 6 }}>›</span>{l}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function RunHistory({ onLoad }) {
  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [fetchErr, setFetchErr] = useState('');

  useEffect(() => {
    api.get(`/agents/${AGENT_SLUG}/history`)
      .then(setRows)
      .catch((e) => setFetchErr(e.message || 'Failed to load history'))
      .finally(() => setLoading(false));
  }, []);

  if (loading)  return <p className="text-sm py-4" style={{ color: 'var(--color-muted)' }}>Loading history…</p>;
  if (fetchErr) return <p className="text-sm py-4" style={{ color: '#b91c1c' }}>Error: {fetchErr}</p>;
  if (!rows.length) return <p className="text-sm py-4" style={{ color: 'var(--color-muted)' }}>No runs yet.</p>;

  return (
    <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: 'var(--color-surface)' }}>
          {['Date', 'URL', 'Type', 'Status', ''].map((h) => (
            <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)' }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} style={{ borderTop: '1px solid var(--color-border)' }}>
            <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>{fmtDate(r.run_at)}</td>
            <td className="px-3 py-2 text-xs max-w-xs truncate" style={{ color: 'var(--color-text)' }}>
              {r.result?.data?.url ?? '—'}
            </td>
            <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>
              {r.result?.data?.pageType ?? '—'}
            </td>
            <td className="px-3 py-2">
              <span
                className="text-xs font-semibold rounded px-2 py-0.5"
                style={{
                  background: r.status === 'complete' ? '#dcfce7' : r.status === 'error' ? '#fee2e2' : '#fef9c3',
                  color:      r.status === 'complete' ? '#15803d' : r.status === 'error' ? '#b91c1c' : '#854d0e',
                }}
              >
                {r.status}
              </span>
            </td>
            <td className="px-3 py-2 text-right">
              {(r.status === 'complete' || r.status === 'needs_review') && r.result && (
                <button
                  onClick={() => onLoad(r.result)}
                  className="text-xs rounded px-2.5 py-1 font-medium"
                  style={{ background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-muted)', cursor: 'pointer' }}
                >
                  Load
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── File browser ──────────────────────────────────────────────────────────────

function FileBrowser({ files, pageType }) {
  const fileList    = buildFileList(files, pageType);
  const [active,    setActive]    = useState(fileList[0]?.key ?? '');
  const [copied,    setCopied]    = useState(false);
  const copyTimer   = useRef(null);

  const current = fileList.find((f) => f.key === active);

  function handleCopy() {
    if (!current?.content) return;
    copyToClipboard(current.content).then(() => {
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    });
  }

  if (!fileList.length) return (
    <p className="text-sm py-6 text-center" style={{ color: 'var(--color-muted)' }}>No files generated.</p>
  );

  return (
    <div className="flex gap-0" style={{ minHeight: 400 }}>
      {/* File list sidebar */}
      <div
        style={{
          width: 200, flexShrink: 0,
          borderRight: '1px solid var(--color-border)',
          background: 'var(--color-bg)',
        }}
      >
        {fileList.map((f) => (
          <button
            key={f.key}
            onClick={() => setActive(f.key)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '0.5rem 0.75rem', fontSize: '0.75rem',
              fontFamily: 'monospace', border: 'none', cursor: 'pointer',
              background: active === f.key ? 'var(--color-primary)' : 'transparent',
              color:      active === f.key ? '#fff' : 'var(--color-muted)',
              borderBottom: '1px solid var(--color-border)',
              wordBreak: 'break-all',
            }}
          >
            {f.filename}
          </button>
        ))}

        {/* Download all */}
        <div style={{ padding: '0.75rem' }}>
          <button
            onClick={() => downloadAllFiles(files, pageType)}
            style={{
              display: 'block', width: '100%', padding: '0.4rem 0.5rem',
              fontSize: '0.7rem', fontWeight: 600, fontFamily: 'inherit',
              borderRadius: '0.4rem', cursor: 'pointer',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-muted)',
            }}
          >
            Download All
          </button>
        </div>
      </div>

      {/* Code view */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Toolbar */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.5rem 0.75rem',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--color-muted)' }}>
            {current?.filename}
          </span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={handleCopy}
              style={{
                padding: '0.25rem 0.6rem', fontSize: '0.7rem', fontWeight: 600,
                fontFamily: 'inherit', borderRadius: '0.4rem', cursor: 'pointer', border: 'none',
                background: copied ? '#16a34a' : 'var(--color-primary)',
                color: '#fff',
              }}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button
              onClick={() => current && downloadFile(current.filename, current.content)}
              style={{
                padding: '0.25rem 0.6rem', fontSize: '0.7rem', fontWeight: 500,
                fontFamily: 'inherit', borderRadius: '0.4rem', cursor: 'pointer',
                background: 'transparent',
                border: '1px solid var(--color-border)',
                color: 'var(--color-muted)',
              }}
            >
              Download
            </button>
          </div>
        </div>

        {/* Code */}
        <div style={{ flex: 1, overflow: 'auto', background: 'var(--color-bg)' }}>
          <pre
            style={{
              margin: 0, padding: '1rem',
              fontSize: '0.75rem', lineHeight: 1.6,
              fontFamily: 'monospace',
              color: 'var(--color-text)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}
          >
            {current?.content ?? ''}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const inputStyle = {
  padding: '0.45rem 0.7rem',
  borderRadius: '0.5rem',
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  fontSize: '0.875rem',
  outline: 'none',
  fontFamily: 'inherit',
};

export default function WpThemeExtractorPage() {
  const [url,       setUrl]       = useState('');
  const [pageType,  setPageType]  = useState('homepage');
  const [running,   setRunning]   = useState(false);
  const [progress,  setProgress]  = useState([]);
  const [error,     setError]     = useState('');
  const [runError,  setRunError]  = useState('');
  const [result,    setResult]    = useState(null);
  const [activeTab, setActiveTab] = useState('extract');

  // Warn before leaving mid-run
  useEffect(() => {
    const handler = (e) => { if (running) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [running]);

  // Load most recent successful run on mount
  useEffect(() => {
    api.get(`/agents/${AGENT_SLUG}/history`)
      .then((rows) => {
        const latest = rows?.find((r) => r.status === 'complete' || r.status === 'needs_review');
        if (latest?.result && !result) setResult(latest.result);
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRun() {
    if (!url.trim()) {
      setError('Enter a URL to extract.');
      return;
    }
    setRunning(true);
    setProgress([]);
    setError('');
    setRunError('');

    try {
      const res     = await api.stream(`/agents/${AGENT_SLUG}/run`, { url: url.trim(), pageType });
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let resultReceived = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') {
            setRunning(false);
            if (resultReceived) setActiveTab('files');
            return;
          }
          try {
            const msg = JSON.parse(raw);
            if (msg.type === 'progress') {
              setProgress((p) => [...p, msg.text]);
            } else if (msg.type === 'result') {
              resultReceived = true;
              setResult(msg.data);
              setActiveTab('files');
            } else if (msg.type === 'error') {
              setRunError(msg.error);
            }
          } catch { /* ignore parse errors on individual SSE lines */ }
        }
      }

      if (!resultReceived) {
        setRunError('Stream ended without a result. Check server logs.');
      }
    } catch (err) {
      setError(err.message || 'Request failed');
    } finally {
      setRunning(false);
    }
  }

  const files    = result?.data?.files   ?? null;
  const extractedUrl  = result?.data?.url      ?? '';
  const extractedType = result?.data?.pageType ?? '';

  const tabBtn = (key, label) => (
    <button
      key={key}
      onClick={() => setActiveTab(key)}
      style={{
        padding: '0.35rem 0.85rem', fontSize: '0.8rem', fontWeight: 500,
        fontFamily: 'inherit', borderRadius: '0.5rem', cursor: 'pointer', border: 'none',
        background: activeTab === key ? 'var(--color-primary)' : 'transparent',
        color:      activeTab === key ? '#fff' : 'var(--color-muted)',
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="p-5 max-w-7xl mx-auto" style={{ fontFamily: 'inherit' }}>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="mb-5">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
          WP Theme Extractor
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
          Enter a URL to extract a production-ready WordPress theme skeleton with vanilla CSS.
        </p>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 mb-4">
        {tabBtn('extract', 'Extract')}
        {tabBtn('files',   'Files')}
        {tabBtn('history', 'History')}
      </div>

      {/* ── Extract tab ────────────────────────────────────────────── */}
      {activeTab === 'extract' && (
        <div>
          <div
            className="rounded-2xl border p-5 mb-4"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
          >
            {/* URL input */}
            <div className="mb-4">
              <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                Page URL
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                style={{ ...inputStyle, width: '100%', maxWidth: 520 }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !running) handleRun(); }}
              />
              <p className="text-xs mt-1.5" style={{ color: 'var(--color-muted)' }}>
                Works best with server-rendered pages. For React SPAs, use browser DevTools → Elements → Copy outerHTML instead.
              </p>
            </div>

            {/* Page type toggle */}
            <div className="mb-5">
              <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                Page Type
              </label>
              <div
                className="flex gap-0.5 rounded-lg p-1 inline-flex"
                style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
              >
                {[
                  { value: 'homepage',  label: 'Homepage (front-page.php)' },
                  { value: 'post-page', label: 'Post / Page (single.php)' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setPageType(opt.value)}
                    style={{
                      padding: '0.3rem 0.9rem', fontSize: '0.8rem', borderRadius: '0.4rem',
                      border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                      background: pageType === opt.value ? 'var(--color-primary)' : 'transparent',
                      color:      pageType === opt.value ? '#fff' : 'var(--color-muted)',
                      fontWeight: pageType === opt.value ? 600 : 400,
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Run button */}
            <button
              onClick={handleRun}
              disabled={running}
              style={{
                padding: '0.45rem 1.25rem', fontSize: '0.875rem', fontWeight: 600,
                fontFamily: 'inherit', borderRadius: '0.5rem', border: 'none',
                background: running ? 'var(--color-border)' : 'var(--color-primary)',
                color: '#fff', cursor: running ? 'not-allowed' : 'pointer',
              }}
            >
              {running ? 'Extracting…' : 'Extract Theme'}
            </button>
          </div>

          {error && (
            <InlineBanner type="error" message={error} onDismiss={() => setError('')} className="mb-4" />
          )}

          {running && <ProgressBar lines={progress} />}

          {runError && !running && (
            <div className="rounded-xl p-4" style={{ background: '#fee2e2', border: '1px solid #fca5a5' }}>
              <p className="text-sm font-semibold mb-1" style={{ color: '#b91c1c' }}>Extraction failed</p>
              <p className="text-sm" style={{ color: '#7f1d1d', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {runError}
              </p>
            </div>
          )}

          {/* What this generates */}
          {!running && !result && (
            <div
              className="rounded-2xl border p-5"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            >
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-muted)' }}>
                What gets generated
              </p>
              <ul className="space-y-1">
                {[
                  'style.css — WP theme header + extracted vanilla CSS with :root variables',
                  'functions.php — enqueue, nav menus, theme supports, widget areas',
                  'header.php — wp_head(), body_class(), primary nav',
                  'footer.php — footer nav, wp_footer()',
                  'front-page.php or single.php — based on page type toggle',
                  'page.php — static page template with WP loop',
                  'archive.php — post archive with title and loop',
                  'single-{cpt}.php — sample CPT template (Claude detects the CPT from content)',
                  'template-outline.html — annotated HTML with {{semantic-placeholders}}',
                ].map((item, i) => (
                  <li key={i} className="text-xs flex gap-2" style={{ color: 'var(--color-text)' }}>
                    <span style={{ color: 'var(--color-primary)', flexShrink: 0 }}>›</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Quick jump to files if result exists */}
          {!running && result && (
            <div
              className="rounded-xl p-4 flex items-center justify-between gap-3"
              style={{ background: '#f0fdf4', border: '1px solid #86efac' }}
            >
              <div>
                <p className="text-sm font-medium" style={{ color: '#15803d' }}>Theme extracted</p>
                <p className="text-xs mt-0.5" style={{ color: '#166534' }}>{result.summary}</p>
              </div>
              <button
                onClick={() => setActiveTab('files')}
                style={{
                  padding: '0.35rem 0.9rem', fontSize: '0.8rem', fontWeight: 600,
                  fontFamily: 'inherit', borderRadius: '0.5rem', cursor: 'pointer',
                  background: '#16a34a', color: '#fff', border: 'none', whiteSpace: 'nowrap',
                }}
              >
                View Files
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Files tab ──────────────────────────────────────────────── */}
      {activeTab === 'files' && (
        <div>
          {!files && (
            <div
              className="rounded-2xl border p-8 text-center"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            >
              <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem' }}>
                No theme extracted yet. Go to <strong>Extract</strong> and run the agent.
              </p>
            </div>
          )}

          {files && (
            <div>
              {/* Meta bar */}
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                {extractedUrl && (
                  <span className="text-xs rounded px-2 py-0.5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-muted)', fontFamily: 'monospace' }}>
                    {extractedUrl}
                  </span>
                )}
                {extractedType && (
                  <span className="text-xs rounded px-2 py-0.5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                    {extractedType === 'homepage' ? 'Homepage' : 'Post / Page'}
                  </span>
                )}
                {result?.summary && (
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{result.summary}</span>
                )}
              </div>

              <div
                className="rounded-2xl border overflow-hidden"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <FileBrowser files={files} pageType={extractedType} />
              </div>

              <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>
                Upload all files to a new folder in <code style={{ fontFamily: 'monospace' }}>wp-content/themes/ai-template-bridge/</code>, then activate in Appearance › Themes.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── History tab ────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div
          className="rounded-2xl border p-4"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <RunHistory
            onLoad={(r) => { setResult(r); setActiveTab('files'); }}
          />
        </div>
      )}
    </div>
  );
}
