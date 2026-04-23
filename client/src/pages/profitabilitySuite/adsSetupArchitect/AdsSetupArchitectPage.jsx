import { useState, useEffect } from 'react';
import api from '../../../api/client';
import MarkdownRenderer from '../../../components/ui/MarkdownRenderer';
import InlineBanner from '../../../components/ui/InlineBanner';
import ConversationView from '../../tools/GoogleAdsMonitor/ConversationView';
import { fmtDate } from '../../../utils/date';
import { exportPdf, exportText } from '../../../utils/exportService';

const AGENT_SLUG = 'ads-setup-architect';

/**
 * Model selection guidance based on project intelligence.
 */
const MODEL_GUIDANCE = {
  'claude-sonnet-4-6': {
    pros: ['Fastest reasoning', 'Excellent tool use', 'Cheapest (with prompt caching)', 'Best for routine setups'],
    cons: ['Slightly less creative than Opus', 'May miss extremely subtle competitive nuances']
  },
  'claude-opus-20240229': {
    pros: ['Deepest strategic insight', 'Best for complex "Blue Ocean" strategy', 'Highly creative ad copy'],
    cons: ['Slowest performance', 'Most expensive', 'No prompt caching support']
  },
  'gemini-2.0-flash-exp': {
    pros: ['Instant responses', 'Very low cost', 'Great for high-volume keyword brainstorming'],
    cons: ['May follow complex ad constraints less strictly', 'Lacks the same "senior specialist" tone']
  },
  'gpt-4o': {
    pros: ['Industry standard for creative writing', 'Strong analytical capabilities', 'Good balance of speed'],
    cons: ['Tool execution can be less reliable than Claude for complex setups']
  }
};

export default function AdsSetupArchitectPage() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState([]);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [activeTab, setActiveTab] = useState('report');
  const [conversationSeed, setConversationSeed] = useState('');
  
  // Model management
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [defaultModelId, setDefaultModelId] = useState('');

  useEffect(() => {
    loadHistory();
    loadModels();
  }, []);

  async function loadModels() {
    try {
      const [allModels, defaultData] = await Promise.all([
        api.get('/admin/models'),
        api.get('/admin/default-model')
      ]);
      const active = allModels.filter(m => m.enabled);
      setModels(active);
      const defId = defaultData.model_id ?? '';
      setDefaultModelId(defId);
      // Initially, the tool uses the default model unless user changes it
      setSelectedModel(defId);
    } catch (e) {
      console.error('Failed to load models:', e);
    }
  }

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
      // Pass the selected model to the run endpoint if it differs from the default
      const body = {};
      if (selectedModel && selectedModel !== defaultModelId) {
        body.model = selectedModel;
      }

      const res = await api.stream(`/agents/${AGENT_SLUG}/run`, body);
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
              setActiveTab('report');
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

  const tabBtn = (tab, label) => (
    <button
      key={tab}
      onClick={() => setActiveTab(tab)}
      style={{
        padding: '0.35rem 0.85rem', fontSize: '0.8rem', fontWeight: 500,
        fontFamily: 'inherit', borderRadius: '0.5rem', cursor: 'pointer', border: 'none',
        background: activeTab === tab ? 'var(--color-primary)' : 'transparent',
        color:      activeTab === tab ? '#fff' : 'var(--color-muted)',
      }}
    >
      {label}
    </button>
  );

  const currentGuidance = MODEL_GUIDANCE[selectedModel] || null;

  return (
    <div className="p-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Ads Setup Architect</h1>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            Strategic campaign blueprint based on competitor intelligence and Diamond Plate performance data.
          </p>
        </div>
        <div className="flex gap-2">
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

      <div className="flex items-center gap-1 mb-4">
        {tabBtn('report', 'Report')}
        {tabBtn('conversation', 'Conversation')}
        {tabBtn('history', 'History')}
        {tabBtn('settings', 'Settings')}
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

      {activeTab === 'settings' && (
        <div className="space-y-6">
          <div className="p-6 rounded-2xl border" style={{ background: 'var(--color-surface)' }}>
            <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--color-muted)' }}>Architecture Model</h2>
            
            <div className="max-w-md mb-6">
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>
                Select reasoning model
              </label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none font-mono"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                {models.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name} {m.id === defaultModelId ? '(Org Default)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {currentGuidance && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 p-4 rounded-xl" style={{ background: 'var(--color-bg)' }}>
                <div>
                  <h4 className="text-xs font-bold uppercase mb-2" style={{ color: '#059669' }}>Pros</h4>
                  <ul className="list-disc list-inside space-y-1">
                    {currentGuidance.pros.map((p, i) => (
                      <li key={i} className="text-xs" style={{ color: 'var(--color-text)' }}>{p}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase mb-2" style={{ color: '#b91c1c' }}>Cons</h4>
                  <ul className="list-disc list-inside space-y-1">
                    {currentGuidance.cons.map((c, i) => (
                      <li key={i} className="text-xs" style={{ color: 'var(--color-text)' }}>{c}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            
            <p className="text-xs mt-4" style={{ color: 'var(--color-muted)' }}>
              Note: More powerful models like Claude 3 Opus or GPT-4o provide deeper strategic insights but may increase the "Architecting" time and token cost.
            </p>
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-4">
          {history.length === 0 ? (
            <p className="text-center py-12 text-muted-foreground">No history found.</p>
          ) : (
            history.map((run) => (
              <div key={run.id} className="p-4 rounded-2xl border flex items-center justify-between" style={{ background: 'var(--color-surface)' }}>
                <div>
                  <p className="font-medium text-sm">{fmtDate(run.run_at)}</p>
                  <div className="flex gap-2 items-center mt-1">
                    <span className="text-xs text-muted-foreground capitalize">{run.status}</span>
                    {run.result?.model && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border" style={{ color: 'var(--color-muted)' }}>
                        {run.result.model}
                      </span>
                    )}
                  </div>
                </div>
                {run.status === 'complete' && (
                  <button
                    onClick={() => { setResult(run.result); setActiveTab('report'); }}
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
      )}

      {activeTab === 'report' && (
        <div className="space-y-6">
          {result ? (
            <div className="p-6 rounded-2xl border" style={{ background: 'var(--color-surface)' }}>
              <div className="flex justify-between items-center mb-4">
                <div className="flex gap-2">
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
                <button
                  onClick={() => {
                    setConversationSeed(`Here is the Ads Setup Architect blueprint report:\n\n${result.summary}`);
                    setActiveTab('conversation');
                  }}
                  className="px-4 py-2 rounded-xl text-sm font-medium border hover:opacity-70"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  Discuss this report
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

      {activeTab === 'conversation' && (
        <ConversationView
          seedText={conversationSeed}
          onSeedConsumed={() => setConversationSeed('')}
          reportText={result?.summary || ''}
          reportTitle="Ads Setup Blueprint"
        />
      )}
    </div>
  );
}
