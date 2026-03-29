/**
 * AdminSqlPage — execute raw SQL against the platform database.
 * Restricted to org_admin. SELECT-only by default; toggle to allow writes.
 */
import { useState, useRef } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import InlineBanner from '../../components/ui/InlineBanner';

const PLACEHOLDER = `-- Examples:
-- SELECT * FROM users WHERE org_id = 1 LIMIT 20;
-- SELECT slug, status, run_at FROM agent_runs ORDER BY run_at DESC LIMIT 50;
-- SELECT key, value FROM system_settings WHERE org_id = 1;`;

export default function AdminSqlPage() {
  const [sql, setSql]           = useState('');
  const [results, setResults]   = useState(null); // { columns, rows, rowCount, duration }
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [allowWrite, setAllowWrite] = useState(false);
  const textareaRef = useRef(null);

  async function runQuery() {
    const query = sql.trim();
    if (!query) return;
    setLoading(true);
    setError('');
    setResults(null);
    try {
      const data = await api.post('/admin/sql', { sql: query, allowWrite });
      setResults(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    // Ctrl+Enter / Cmd+Enter to run
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runQuery();
    }
    // Tab → insert spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = textareaRef.current;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = sql.slice(0, start) + '  ' + sql.slice(end);
      setSql(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 2;
      });
    }
  }

  const hasRows = results?.rows?.length > 0;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>SQL Console</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Run queries directly against the PostgreSQL database.
          </p>
        </div>

        {/* Write toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none" title="Allow INSERT / UPDATE / DELETE">
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

      {allowWrite && (
        <InlineBanner
          type="error"
          message="Write mode enabled — INSERT, UPDATE, and DELETE statements will execute against the live database."
        />
      )}

      {/* Editor */}
      <div
        className="rounded-2xl border overflow-hidden"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <textarea
          ref={textareaRef}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={PLACEHOLDER}
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
        <div
          className="flex items-center justify-between px-4 py-2"
          style={{ background: 'var(--color-surface)' }}
        >
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Ctrl+Enter to run
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setSql(''); setResults(null); setError(''); }}
              className="text-xs px-3 py-1.5 rounded-lg"
              style={{ color: 'var(--color-muted)' }}
            >
              Clear
            </button>
            <Button variant="primary" onClick={runQuery} disabled={loading || !sql.trim()}>
              {loading ? 'Running…' : 'Run'}
            </Button>
          </div>
        </div>
      </div>

      {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} />}

      {/* Results */}
      {results && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
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
                    <tr
                      key={i}
                      style={{ borderBottom: '1px solid var(--color-border)' }}
                    >
                      {results.columns.map((col) => {
                        const val = row[col];
                        const display = val === null ? (
                          <span style={{ color: 'var(--color-muted)', fontStyle: 'italic' }}>null</span>
                        ) : typeof val === 'object' ? (
                          <span className="font-mono text-xs">{JSON.stringify(val)}</span>
                        ) : (
                          String(val)
                        );
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
      )}
    </div>
  );
}
