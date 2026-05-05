import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIcon } from '../../providers/IconProvider';
import api from '../../api/client';

export default function DemoDashboardPage() {
  const getIcon = useIcon();
  const navigate = useNavigate();
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/demo/manifest')
      .then((data) => { setAgents(data); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2" style={{ color: 'var(--color-muted)' }}>
        {getIcon('loader', { size: 16 })}
        <span className="text-sm">Loading…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <p className="text-sm" style={{ color: 'var(--color-error, #ef4444)' }}>{error}</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>
          AI Capabilities Demo
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-muted)' }}>
          Select an agent below to explore how AI can work for your business.
        </p>
      </div>

      {agents.length === 0 ? (
        <div
          className="rounded-xl p-8 text-center"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            No agents have been assigned to your account yet.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <AgentCard
              key={agent.slug}
              agent={agent}
              onRun={() => navigate(`/demo/run/${agent.slug}`)}
              getIcon={getIcon}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentCard({ agent, onRun, getIcon }) {
  const ready = agent.is_configured;

  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-3"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        opacity: ready ? 1 : 0.65,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className="flex items-center justify-center w-10 h-10 rounded-lg shrink-0"
          style={{ background: 'rgba(var(--color-primary-rgb), 0.1)', color: 'var(--color-primary)' }}
        >
          {getIcon(agent.icon, { size: 20 })}
        </div>

        <span
          className="text-xs rounded-full px-2 py-0.5 font-medium shrink-0"
          style={
            ready
              ? { background: '#dcfce7', color: '#166534' }
              : { background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }
          }
        >
          {ready ? 'Ready' : 'Coming soon'}
        </span>
      </div>

      <div className="flex-1">
        <h2 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>
          {agent.name}
        </h2>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
          {agent.description}
        </p>
      </div>

      <button
        onClick={onRun}
        disabled={!ready}
        className="w-full rounded-lg py-2 text-sm font-medium transition-all"
        style={
          ready
            ? { background: 'var(--color-primary)', color: '#fff', cursor: 'pointer' }
            : { background: 'var(--color-bg)', color: 'var(--color-muted)', cursor: 'not-allowed', border: '1px solid var(--color-border)' }
        }
      >
        {ready ? 'Launch' : 'Not configured'}
      </button>
    </div>
  );
}
