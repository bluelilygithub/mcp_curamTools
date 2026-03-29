/**
 * AdminSqlPage — SQL Console with NLP mode.
 * SQL mode: direct query execution.
 * NLP mode: natural language → Claude generates SQL → executes it.
 */
import { useState, useRef } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import InlineBanner from '../../components/ui/InlineBanner';
import MicButton from '../../components/ui/MicButton';
import ReadAloudButton from '../../components/ui/ReadAloudButton';

const SQL_PLACEHOLDER = `-- Examples:
-- SELECT * FROM users WHERE org_id = 1 LIMIT 20;
-- SELECT slug, status, run_at FROM agent_runs ORDER BY run_at DESC LIMIT 50;
-- SELECT key, value FROM system_settings WHERE org_id = 1;`;

const NLP_PLACEHOLDER = `Ask anything about the database…
e.g. "Show me the last 10 agent runs with their status and cost"
e.g. "How many users are in each organisation?"
e.g. "Which agents have been run today?"`;

function buildSpeakSummary(results) {
  if (!results?.rows?.length) return `Query complete. ${results.rowCount ?? 0} rows returned.`;
  const cols = results.columns ?? [];
  const preview = results.rows.slice(0, 3).map((row, i) => {
    const parts = cols.slice(0, 4).map((c) => `${c}: ${row[c] ?? 'null'}`).join(', ');
    return `Row ${i + 1}: ${parts}`;
  }).join('. ');
  return `Query returned ${results.rowCount} row${results.rowCount !== 1 ? 's' : ''}. ${preview}${results.rows.length > 3 ? '. And more.' : '.'}`;
}

function ResultsTable({ results, showReadAloud = false }) {
  const hasRows = results?.rows?.length > 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-semibold" style={{ color: 'var(--color-muted)' }}>
          {results.rowCount} row{results.rowCount !== 1 ? 's' : ''}
        </span>
        {results.duration != null && (
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {results.duration}ms
          </span>
        )}
        {results.command && (
          <span
            className="text-xs font-mono px-2 py-0.5 rounded"
            style={{ background: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            {results.command}
          </span>
        )}
        {showReadAloud && (
          <ReadAloudButton text={buildSpeakSummary(results)} size={14} />
        )}
      </div>

      {hasRows ? (
        <div
          className="rounded-2xl border overflow-auto"
          style={{ borderColor: 'var(--color-border)', maxHeight: 480 }}
        >
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse', minWidth: 'max-content' }}>
            <thead>
              <tr style={{ background: 'var(--color-surface)', position: 'sticky', top: 0, zIndex: 1 }}>
                {results.columns.map((col) => (
                  <th
                    key={col}
                    className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
                    style={{ color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)' }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.rows.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {results.columns.map((col) => {
                    const val = row[col];
                    const display = val === null ? (
                      <span style={{ color: 'var(--color-muted)', fontStyle: 'italic' }}>null</span>
                    ) : typeof val === 'object' ? (
                      <span className="font-mono text-xs">{JSON.stringify(val)}</span>
                    ) : String(val);
                    return (
                      <td
                        key={col}
                        className="px-4 py-2 font-mono text-xs whitespace-nowrap"
                        style={{ color: 'var(--color-text)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}
                      >
                        {display}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          className="rounded-2xl border px-4 py-3 text-sm"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
        >
          Query executed — no rows returned.
        </div>
      )}
    </div>
  );
}

export default function AdminSqlPage() {
  const [mode, setMode]             = useState('sql'); // 'sql' | 'nlp'
  const [sql, setSql]               = useState('');
  const [question, setQuestion]     = useState('');
  const [results, setResults]       = useState(null);
  const [generatedSql, setGeneratedSql] = useState('');
  const [nlpMeta, setNlpMeta]       = useState(null); // { modelId, tokensUsed, costAud }
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [allowWrite, setAllowWrite] = useState(false);
  const textareaRef = useRef(null);

  function reset() {
    setResults(null);
    setGeneratedSql('');
    setNlpMeta(null);
    setError('');
  }

  function switchMode(m) {
    setMode(m);
    reset();
  }

  async function runSql() {
    const query = sql.trim();
    if (!query) return;
    setLoading(true);
    reset();
    try {
      const data = await api.post('/admin/sql', { sql: query, allowWrite });
      setResults(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function runNlp() {
    const q = question.trim();
    if (!q) return;
    setLoading(true);
    reset();
    try {
      const data = await api.post('/admin/sql/nlp', { question: q, allowWrite });
      setGeneratedSql(data.generatedSql ?? '');
      if (data.modelId) setNlpMeta({ modelId: data.modelId, tokensUsed: data.tokensUsed, costAud: data.costAud });
      setResults(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function handleSqlKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runSql(); }
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = textareaRef.current;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = sql.slice(0, start) + '  ' + sql.slice(end);
      setSql(next);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2; });
    }
  }

  function handleNlpKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runNlp(); }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>SQL Console</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Query the PostgreSQL database directly or with natural language.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Mode toggle */}
          <div
            className="flex rounded-xl overflow-hidden border text-xs font-semibold"
            style={{ borderColor: 'var(--color-border)' }}
          >
            {['sql', 'nlp'].map((m) => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                className="px-4 py-1.5 transition-all"
                style={{
                  background: mode === m ? 'var(--color-primary)' : 'var(--color-surface)',
                  color: mode === m ? '#fff' : 'var(--color-muted)',
                }}
              >
                {m === 'sql' ? 'SQL' : 'Natural Language'}
              </button>
            ))}
          </div>

          {/* Write toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <span className="text-xs font-medium" style={{ color: allowWrite ? '#dc2626' : 'var(--color-muted)' }}>
              Allow writes
            </span>
            <button
              onClick={() => setAllowWrite((v) => !v)}
              className="relative inline-flex h-5 w-9 rounded-full transition-all"
              style={{ background: allowWrite ? '#dc2626' : 'var(--color-border)' }}
            >
              <span
                className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full transition-all"
                style={{ background: '#fff', transform: allowWrite ? 'translateX(16px)' : 'translateX(0)' }}
              />
            </button>
          </label>
        </div>
      </div>

      {allowWrite && (
        <InlineBanner
          type="error"
          message="Write mode enabled — INSERT, UPDATE, and DELETE statements will execute against the live database."
        />
      )}

      {/* SQL mode editor */}
      {mode === 'sql' && (
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          <textarea
            ref={textareaRef}
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={handleSqlKeyDown}
            placeholder={SQL_PLACEHOLDER}
            spellCheck={false}
            rows={10}
            className="w-full px-4 py-3 text-sm font-mono outline-none resize-y"
            style={{
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              borderBottom: '1px solid var(--color-border)',
              minHeight: 180,
            }}
          />
          <div className="flex items-center justify-between px-4 py-2" style={{ background: 'var(--color-surface)' }}>
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Ctrl+Enter to run</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setSql(''); reset(); }}
                className="text-xs px-3 py-1.5 rounded-lg"
                style={{ color: 'var(--color-muted)' }}
              >
                Clear
              </button>
              <Button variant="primary" onClick={runSql} disabled={loading || !sql.trim()}>
                {loading ? 'Running…' : 'Run'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* NLP mode editor */}
      {mode === 'nlp' && (
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleNlpKeyDown}
            placeholder={NLP_PLACEHOLDER}
            rows={4}
            className="w-full px-4 py-3 text-sm outline-none resize-none"
            style={{
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              borderBottom: '1px solid var(--color-border)',
            }}
          />
          <div className="flex items-center justify-between px-4 py-2" style={{ background: 'var(--color-surface)' }}>
            <div className="flex items-center gap-1">
              <MicButton
                onResult={(t) => setQuestion((q) => q ? q + ' ' + t : t)}
                onPartial={(t) => setQuestion((q) => {
                  // Replace any trailing interim text with new interim
                  const base = q.replace(/\s*\[.*\]$/, '');
                  return base + (base ? ' ' : '') + '[' + t + ']';
                })}
              />
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Claude reads your schema and generates SQL — Ctrl+Enter to run
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setQuestion(''); reset(); }}
                className="text-xs px-3 py-1.5 rounded-lg"
                style={{ color: 'var(--color-muted)' }}
              >
                Clear
              </button>
              <Button variant="primary" onClick={runNlp} disabled={loading || !question.trim()}>
                {loading ? 'Thinking…' : 'Ask'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} />}

      {/* Generated SQL (NLP mode only) */}
      {generatedSql && (
        <div
          className="rounded-2xl border overflow-hidden"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div
            className="flex items-center justify-between px-4 py-2 border-b flex-wrap gap-2"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                Generated SQL
              </span>
              {nlpMeta?.modelId && (
                <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: 'var(--color-border)', color: 'var(--color-text)' }}>
                  {nlpMeta.modelId}
                </span>
              )}
              {nlpMeta?.tokensUsed && (
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  {nlpMeta.tokensUsed.input + nlpMeta.tokensUsed.output} tokens
                </span>
              )}
              {nlpMeta?.costAud != null && (
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  A${nlpMeta.costAud.toFixed(4)}
                </span>
              )}
            </div>
            <button
              onClick={() => { setSql(generatedSql); switchMode('sql'); }}
              className="text-xs px-3 py-1 rounded-lg"
              style={{ color: 'var(--color-primary)', background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
            >
              Edit in SQL mode
            </button>
          </div>
          <pre
            className="px-4 py-3 text-xs font-mono overflow-x-auto"
            style={{ background: 'var(--color-bg)', color: 'var(--color-text)', margin: 0 }}
          >
            {generatedSql}
          </pre>
        </div>
      )}

      {/* Results */}
      {results && <ResultsTable results={results} showReadAloud={mode === 'nlp'} />}

      {/* Empty state */}
      {!results && !loading && !error && (
        <div
          className="rounded-2xl border p-10 text-center text-sm"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
        >
          {mode === 'sql'
            ? <>Press <strong>Run</strong> or Ctrl+Enter to execute your query.</>
            : <>Ask a question about your data and Claude will generate and run the SQL.</>}
        </div>
      )}
    </div>
  );
}
