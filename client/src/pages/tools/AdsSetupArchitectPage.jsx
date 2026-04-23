import { useState, useEffect } from 'react';
import api from '../../api/client';
import MarkdownRenderer from '../../components/ui/MarkdownRenderer';
import InlineBanner from '../../components/ui/InlineBanner';
import { fmtDate } from '../../utils/date';
import { exportPdf, exportText } from '../../utils/exportService';

const AGENT_SLUG = 'ads-setup-architect';

export default function AdsSetupArchitectPage() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState([]);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    loadHistory();
  }, []);

  function loadHistory() {
    api.get(`/agents/${AGENT_SLUG}/history`)
      .then((rows) => {
        setHistory(rows ?? []);
        const latest = rows?.find((r) => r.status === 'complete');
        if (latest?.result && !result) setResult(latest.result);
      })
      .catch(() => {});
  }

  async function handleRun() {
    setRunning(true);
    setProgress([]);
    setError('');
    setResult(null);

    try {
      const res = await api.stream(`/agents/${AGENT_SLUG}/run`, {});
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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
            loadHistory();
            return;
          }
          try {
            const msg = JSON.parse(raw);
            if (msg.type === 'progress') {
              setProgress((p) => [...p, msg.text]);
            } else if (msg.type === 'result') {
              setResult(msg.data);
            } else if (msg.type === 'error') {
              setError(msg.error);
            }
          } catch (e) {
            console.error('Failed to parse SSE:', e);
          }
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="p-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Ads Setup Architect</h1>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            Strategic campaign blueprint based on competitor intelligence and Diamond Plate performance data.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="px-4 py-2 rounded-xl text-sm font-medium border"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            {showHistory ? 'View Report' : 'History'}
          </button>
          <button
            onClick={handleRun}
            disabled={running}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--color-primary)' }}
          >
            {running ? 'Architecting...' : 'Generate Blueprint'}
          </button>
        </div>
      </div>

      {error && <InlineBanner type="error" message={error} className="mb-6" />}

      {running && (
        <div className="mb-6 p-4 rounded-2xl border" style={{ borderColor: 'var(--color-primary)', background: 'var(--color-surface)' }}>
          <p className="text-sm font-medium mb-2">Architecting your campaign structure...</p>
          <div className="space-y-1">
            {progress.slice(-3).map((line, i) => (
              <p key={i} className="text-xs text-muted-foreground italic">› {line}</p>
            ))}
          </div>
        </div>
      )}

      {showHistory ? (
        <div className="space-y-4">
          {history.length === 0 ? (
            <p className="text-center py-12 text-muted-foreground">No history found.</p>
          ) : (
            history.map((run) => (
              <div key={run.id} className="p-4 rounded-2xl border flex items-center justify-between" style={{ background: 'var(--color-surface)' }}>
                <div>
                  <p className="font-medium text-sm">{fmtDate(run.run_at)}</p>
                  <p className="text-xs text-muted-foreground capitalize">{run.status}</p>
                </div>
                {run.status === 'complete' && (
                  <button
                    onClick={() => { setResult(run.result); setShowHistory(false); }}
                    className="text-xs font-semibold text-primary hover:underline"
                    style={{ color: 'var(--color-primary)' }}
                  >
                    View Report
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {result ? (
            <div className="p-6 rounded-2xl border" style={{ background: 'var(--color-surface)' }}>
              <div className="flex justify-end gap-2 mb-4">
                <button
                  onClick={() => exportText({ content: result.summary, filename: `ads-setup-${AGENT_SLUG}.txt` })}
                  className="text-xs px-3 py-1.5 rounded-lg border"
                >
                  Export TXT
                </button>
                <button
                  onClick={() => exportPdf({ content: result.summary, title: 'Ads Setup Architect Blueprint', filename: `ads-setup-${AGENT_SLUG}.pdf` })}
                  className="text-xs px-3 py-1.5 rounded-lg border"
                >
                  Export PDF
                </button>
              </div>
              <MarkdownRenderer text={result.summary} />
            </div>
          ) : !running && (
            <div className="text-center py-24 rounded-2xl border border-dashed">
              <p className="text-muted-foreground">Click "Generate Blueprint" to start the strategic setup analysis.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
