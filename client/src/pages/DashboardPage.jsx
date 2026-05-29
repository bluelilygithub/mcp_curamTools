import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import useAuthStore from '../stores/authStore';
import useToolStore from '../stores/toolStore';
import { getPermittedTools } from '../config/tools';
import { useIcon } from '../providers/IconProvider';
import api from '../api/client';
import LineChart from '../components/charts/LineChart';

// ── Animation CSS (injected once) ────────────────────────────────────────────

const DASH_CSS = `
@keyframes duFadeUp {
  from { opacity: 0; transform: translateY(18px); }
  to   { opacity: 1; transform: translateY(0);    }
}
@keyframes duSkeleton {
  0%   { opacity: 0.5; }
  50%  { opacity: 1;   }
  100% { opacity: 0.5; }
}
@keyframes duDotPulse {
  0%, 100% { transform: scale(1);   opacity: 1;   }
  50%       { transform: scale(1.4); opacity: 0.5; }
}
.du-fade-up { animation: duFadeUp 0.42s cubic-bezier(0.16,1,0.3,1) both; }
.du-skeleton { animation: duSkeleton 1.4s ease infinite; background: var(--color-bg); border-radius: 6px; }
.du-card-hover { transition: transform 0.17s ease, box-shadow 0.17s ease; }
.du-card-hover:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 28px rgba(0,0,0,0.16);
}
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS = {
  complete:     { color: '#10b981', label: 'Complete' },
  needs_review: { color: '#f59e0b', label: 'Needs review' },
  error:        { color: '#ef4444', label: 'Error' },
  running:      { color: '#6366f1', label: 'Running', pulse: true },
};

function slugToDisplayName(slug, tools) {
  const t = tools.find(t => t.id === slug);
  if (t) return t.name;
  return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'just now';
}

function useCountUp(target, duration = 750) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!target) { setVal(0); return; }
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(eased * target));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration]);
  return val;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, suffix, icon, delay, loading, format }) {
  const getIcon = useIcon();
  const animated = useCountUp(loading ? 0 : (typeof value === 'number' ? Math.round(Math.abs(value)) : 0));
  const display = loading ? null : (format ? format(value) : animated.toLocaleString());

  return (
    <div
      className="du-fade-up rounded-2xl border p-5"
      style={{
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
        animationDelay: `${delay ?? 0}ms`,
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted)' }}>
          {label}
        </span>
        <span style={{ color: 'var(--color-primary)', opacity: 0.65 }}>
          {getIcon(icon, { size: 15 })}
        </span>
      </div>
      {loading ? (
        <div className="du-skeleton" style={{ height: 34, width: '55%' }} />
      ) : (
        <div style={{ fontSize: 30, fontWeight: 700, color: 'var(--color-text)', lineHeight: 1, letterSpacing: '-0.02em' }}>
          {display}
          {suffix && !format && (
            <span style={{ fontSize: 15, color: 'var(--color-muted)', marginLeft: 3, fontWeight: 500 }}>{suffix}</span>
          )}
        </div>
      )}
    </div>
  );
}

function ActivityRow({ run, tools, index }) {
  const st = STATUS[run.status] ?? STATUS.error;
  return (
    <div
      className="du-fade-up flex items-start gap-3 py-3"
      style={{ borderBottom: '1px solid var(--color-border)', animationDelay: `${index * 55}ms` }}
    >
      <span
        style={{
          width: 8, height: 8, borderRadius: '50%',
          background: st.color, marginTop: 4, flexShrink: 0,
          animation: st.pulse ? 'duDotPulse 1.2s ease infinite' : undefined,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>
          {slugToDisplayName(run.agent_slug, tools)}
        </div>
        {run.summary_text && (
          <div style={{
            fontSize: 11, color: 'var(--color-muted)', marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {run.summary_text.length > 110 ? run.summary_text.slice(0, 110) + '…' : run.summary_text}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: 'var(--color-muted)' }}>{timeAgo(run.run_at)}</span>
        <span style={{
          fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
          color: st.color, padding: '1px 5px', borderRadius: 4,
          background: `${st.color}18`,
        }}>
          {st.label}
        </span>
      </div>
    </div>
  );
}

function SkeletonRow({ i }) {
  return (
    <div className="flex items-start gap-3 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
      <div className="du-skeleton" style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 4, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div className="du-skeleton" style={{ height: 12, width: '55%', marginBottom: 6 }} />
        <div className="du-skeleton" style={{ height: 10, width: '80%' }} />
      </div>
    </div>
  );
}

function ToolCard({ tool, index, onVisit }) {
  const getIcon = useIcon();
  return (
    <Link
      to={tool.path}
      onClick={() => onVisit(tool.id)}
      className="du-fade-up du-card-hover block rounded-2xl border p-4"
      style={{
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
        textDecoration: 'none',
        animationDelay: `${240 + index * 45}ms`,
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: 'rgba(var(--color-primary-rgb), 0.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 10, color: 'var(--color-primary)',
      }}>
        {getIcon(tool.icon, { size: 16 })}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 5 }}>
        {tool.name}
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-muted)', lineHeight: 1.55 }}>
        {tool.description.length > 85 ? tool.description.slice(0, 85) + '…' : tool.description}
      </div>
    </Link>
  );
}

function QuickAction({ label, icon, path, toolId, onVisit }) {
  const getIcon = useIcon();
  return (
    <Link
      to={path}
      onClick={() => onVisit(toolId)}
      className="du-card-hover flex items-center gap-2 rounded-xl border px-3 py-2.5"
      style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', textDecoration: 'none' }}
    >
      <span style={{ color: 'var(--color-primary)' }}>{getIcon(icon, { size: 14 })}</span>
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text)' }}>{label}</span>
    </Link>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: 'Campaign Dashboard', icon: 'bar-chart',   path: '/tools/campaign-dashboard',    id: 'campaign-dashboard' },
  { label: 'DiamondPlate Data',  icon: 'trending-up', path: '/tools/diamondplate-data',      id: 'diamondplate-data' },
  { label: 'Ads Monitor',        icon: 'monitor',     path: '/tools/google-ads-monitor',     id: 'google-ads-monitor' },
  { label: 'Doc Extractor',      icon: 'file-text',   path: '/tools/doc-extractor',          id: 'doc-extractor' },
  { label: 'High Intent',        icon: 'target',      path: '/tools/high-intent-advisor',    id: 'high-intent-advisor' },
  { label: 'WP Extractor',       icon: 'code',        path: '/tools/wp-theme-extractor',     id: 'wp-theme-extractor' },
];

export default function DashboardPage() {
  const { user }                 = useAuthStore();
  const { setLastVisitedTool }   = useToolStore();

  const primaryRole = user?.roles?.find(r => r.scope_type === 'global')?.name;
  const tools       = getPermittedTools(primaryRole);
  const firstName   = user?.firstName || user?.email?.split('@')[0] || 'there';

  const [activity,       setActivity]       = useState([]);
  const [roi,            setRoi]            = useState(null);
  const [loadingAct,     setLoadingAct]     = useState(true);
  const [loadingRoi,     setLoadingRoi]     = useState(true);

  useEffect(() => {
    api.get('/dashboard/recent-activity')
      .then(rows => setActivity(rows ?? []))
      .catch(() => {})
      .finally(() => setLoadingAct(false));

    api.get('/dashboard/roi-analysis?days=90')
      .then(data => setRoi(data))
      .catch(() => {})
      .finally(() => setLoadingRoi(false));
  }, []);

  const runsThisWeek = activity.filter(
    r => Date.now() - new Date(r.run_at).getTime() < 7 * 86400000
  ).length;

  const latestRoas = roi?.totals?.periodRoas ?? null;

  const roiChartData = (roi?.monthly ?? []).map(m => ({
    x:       m.month.slice(5),
    spend:   m.totalCost,
    revenue: m.revenue,
  }));

  const visibleActions = QUICK_ACTIONS.filter(a => tools.find(t => t.id === a.id));

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8">
      <style>{DASH_CSS}</style>

      {/* ── Hero ── */}
      <div className="du-fade-up flex items-end justify-between gap-4 flex-wrap" style={{ animationDelay: '0ms' }}>
        <div>
          <p style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 4 }}>
            {user?.orgName ?? 'MCP CuramTools'}
          </p>
          <h1 style={{ fontSize: 30, fontWeight: 700, color: 'var(--color-text)', letterSpacing: '-0.02em' }}>
            Hello, {firstName}
          </h1>
        </div>
        <Link
          to="/tools"
          style={{
            background: 'var(--color-primary)', color: '#fff',
            padding: '9px 18px', borderRadius: 10,
            fontSize: 13, fontWeight: 500, textDecoration: 'none',
          }}
        >
          Browse tools
        </Link>
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Runs this week"   value={runsThisWeek}    icon="play"        delay={60}  loading={loadingAct} />
        <StatCard label="Tools available"  value={tools.length}    icon="layers"      delay={110} />
        <StatCard label="Total runs"       value={activity.length} icon="activity"    delay={160} loading={loadingAct} />
        <StatCard
          label="90-day ROAS"
          value={latestRoas ?? 0}
          icon="trending-up"
          delay={210}
          loading={loadingRoi}
          format={v => v ? `${v.toFixed(2)}×` : '—'}
        />
      </div>

      {/* ── Main two-column ── */}
      <div className="grid md:grid-cols-5 gap-6 items-start">

        {/* Activity feed (2/5) */}
        <div
          className="du-fade-up md:col-span-2 rounded-2xl border overflow-hidden"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', animationDelay: '100ms' }}
        >
          <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>Recent Activity</h2>
          </div>
          <div className="px-5" style={{ maxHeight: 380, overflowY: 'auto' }}>
            {loadingAct
              ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} i={i} />)
              : activity.length === 0
                ? (
                  <p style={{ fontSize: 13, color: 'var(--color-muted)', textAlign: 'center', padding: '28px 0' }}>
                    No agent runs yet
                  </p>
                )
                : activity.map((run, i) => (
                  <ActivityRow key={run.id} run={run} tools={tools} index={i} />
                ))
            }
          </div>
        </div>

        {/* Right column: chart + quick actions (3/5) */}
        <div className="md:col-span-3 space-y-4">

          {/* ROI chart */}
          <div
            className="du-fade-up rounded-2xl border p-5"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', animationDelay: '140ms' }}
          >
            <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 16 }}>
              Monthly spend vs revenue (90 days)
            </h2>
            {loadingRoi ? (
              <div className="du-skeleton" style={{ height: 180 }} />
            ) : roiChartData.length === 0 ? (
              <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>No ROI data — connect Google Ads to populate</span>
              </div>
            ) : (
              <LineChart
                data={roiChartData}
                xKey="x"
                leftKey="spend"
                rightKey="revenue"
                leftLabel="Spend"
                rightLabel="Revenue"
                leftFormat={v => `$${Math.round(v).toLocaleString()}`}
                rightFormat={v => `$${Math.round(v).toLocaleString()}`}
                height={180}
              />
            )}
            {!loadingRoi && roiChartData.length > 0 && (
              <div className="flex gap-4 mt-3">
                {[
                  { color: 'var(--color-primary)', label: 'Spend (incl. mgmt fee)' },
                  { color: '#6C8EBF', label: 'Revenue' },
                ].map(({ color, label }) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <span style={{ width: 12, height: 3, borderRadius: 2, background: color, display: 'inline-block' }} />
                    <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>{label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick actions */}
          {visibleActions.length > 0 && (
            <div
              className="du-fade-up rounded-2xl border p-5"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', animationDelay: '180ms' }}
            >
              <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 12 }}>
                Quick launch
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {visibleActions.map(a => (
                  <QuickAction key={a.id} label={a.label} icon={a.icon} path={a.path} toolId={a.id} onVisit={setLastVisitedTool} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Tool grid ── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted)' }}>
            All tools
          </h2>
          <Link to="/tools" style={{ fontSize: 12, color: 'var(--color-primary)', textDecoration: 'none', fontWeight: 500 }}>
            View library →
          </Link>
        </div>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {tools.slice(0, 8).map((tool, i) => (
            <ToolCard key={tool.id} tool={tool} index={i} onVisit={setLastVisitedTool} />
          ))}
        </div>
      </section>
    </div>
  );
}
