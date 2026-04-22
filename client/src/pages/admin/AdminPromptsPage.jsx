/**
 * AdminPromptsPage — view and edit the system prompt for every MCP agent.
 *
 * Each row shows the agent name, a one-line descriptor, and a Custom/Default badge.
 * Toggling a row reveals: where it is used, its purpose, the full rendered prompt
 * in an editable textarea, and Save / Reset buttons.
 *
 * Prompts are stored in agent_configs.custom_prompt. When set, it completely
 * replaces the built-in prompt at runtime. Reset clears the override.
 */
import { useState, useEffect, useCallback } from 'react';
import api from '../../api/client';
import InlineBanner from '../../components/ui/InlineBanner';
import { fmtDate, fmtDateTime } from '../../utils/date';

// ── Agent metadata ────────────────────────────────────────────────────────────

const AGENTS = [
  {
    slug: 'google-ads-monitor',
    title: 'Google Ads Monitor',
    description: 'Campaign analysis, search terms, budget pacing, and AI recommendations.',
    usedIn: 'GoogleAdsMonitorPage → Dashboard tab → Google Ads Monitor card. Runs on demand or on schedule.',
    purpose: 'Fetches campaign performance, daily spend trends, search terms, and GA4 analytics. Produces a structured report with a summary, per-campaign analysis, search term buckets (converting / wasted spend / low CTR), and up to 8 prioritised recommendations.',
  },
  {
    slug: 'google-ads-change-impact',
    title: 'Change Impact',
    description: 'Narrative analysis of what changed in the account and how each change affected performance.',
    usedIn: 'GoogleAdsMonitorPage → Dashboard tab → Change Impact card.',
    purpose: 'Retrieves change history then cross-references with daily performance to find the exact date metrics shifted. Tells the story of each change — what happened, when, direction of impact, and corrective actions.',
  },
  {
    slug: 'google-ads-change-audit',
    title: 'Change Audit',
    description: 'Quantitative before/after metric comparison with a Positive / Neutral / Negative verdict per change.',
    usedIn: 'GoogleAdsMonitorPage → Dashboard tab → Change Audit card.',
    purpose: 'For each detected change, fetches separate before and after performance windows, computes deltas (CTR, CPA, conversions, daily cost), and assigns a verdict. Produces an audit log, a wins list, a concerns list, and recommendations.',
  },
  {
    slug: 'google-ads-strategic-review',
    title: 'Strategic Review',
    description: 'Validates user-submitted strategic observations against live data and surfaces counter-proposals.',
    usedIn: 'GoogleAdsMonitorPage → Dashboard tab → Strategic Review card.',
    purpose: 'The user enters free-form hypotheses. The agent pulls relevant data to test each one, returning a Verdict, Evidence, and Refinement per observation, plus up to 3 counter-proposals the user did not raise.',
  },
  {
    slug: 'google-ads-conversation',
    title: 'Conversation Agent',
    description: 'Multi-turn NLP conversation with full access to Ads, GA4, CRM, report history, and the knowledge base.',
    usedIn: 'GoogleAdsMonitorPage → Conversation tab (all threads) and History tab → HistoryChat inline conversations.',
    purpose: 'Powers persistent multi-turn conversations. Has 20 tools: 8 Google Ads, 5 GA4, 2 CRM (WordPress), 3 platform report history, 2 RAG knowledge base. Handles cross-session context. Also enforces data coverage boundaries (Ads/GA4 from March 2026; CRM has years of history).',
  },
  {
    slug: 'ads-attribution-summary',
    title: 'Attribution Summary',
    description: 'Cross-channel brief connecting ad spend, GA4 traffic, and WordPress enquiries.',
    usedIn: 'GoogleAdsMonitorPage → Dashboard tab → Attribution Summary card.',
    purpose: 'Pulls three data sources — campaign performance, GA4 sessions, and WordPress CRM enquiries — and produces a concise summary showing which campaigns generated actual leads with UTM attribution.',
  },
  {
    slug: 'ads-bounce-analysis',
    title: 'Bounce Analysis',
    description: 'Paid keywords matched to high-bounce landing pages, broken down by device.',
    usedIn: 'GoogleAdsMonitorPage → Dashboard tab → Bounce Analysis card.',
    purpose: 'Fetches paid search terms and GA4 paid bounce data. Cross-references by intent and landing page URL to identify which keywords are sending traffic to pages visitors immediately leave. Includes device breakdown (mobile / desktop / tablet).',
  },
  {
    slug: 'auction-insights',
    title: 'Auction Insights',
    description: 'Competitor impression share, top-of-page rates, and where the account is losing visibility.',
    usedIn: 'GoogleAdsMonitorPage → Dashboard tab → Auction Insights card.',
    purpose: 'Fetches auction insights (competitor domains in the same auctions) and the account\'s own impression share per campaign. Identifies which competitors are most aggressive and whether visibility loss is due to rank or budget.',
  },
  {
    slug: 'competitor-keyword-intel',
    title: 'Competitor Keywords',
    description: 'Keyword gaps — what competitors target that the account does not.',
    usedIn: 'GoogleAdsMonitorPage → Dashboard tab → Competitor Keywords card. Requires Standard Google Ads API access.',
    purpose: 'Analyses the account\'s current keyword set versus competitor keyword sets. Surfaces high-value gaps, graphene-specific emerging opportunities, and location-based terms with meaningful Australian search volume.',
  },
  {
    slug: 'not-interested-report',
    title: 'Not Interested Report',
    description: 'Diagnoses why wrong-products and wrong-location leads get through — ads targeting gaps vs sales qualification failures.',
    usedIn: 'NotInterestedReportPage (/tools/not-interested-report). Run on demand.',
    purpose: 'Pre-fetches all not-interested CRM leads (all time), filters to wrong_products and wrong_location categories, attaches progress notes (call records), and cross-references with Google Ads search terms, active keywords, and campaign performance. Produces two diagnostic lenses per reason category: Ads Signal (which campaigns/keywords attract wrong-fit traffic) and Sales Signal (what call notes reveal about qualification behaviour). CRM records without UTM data are treated as pre-tracking-era records and excluded from attribution analysis.',
  },
  {
    slug: 'ads-copy-playbook',
    title: 'Copy Playbook',
    description: 'Prescriptive optimization playbook — paste-ready replacements, negative keywords, asset pinning, wasted spend table, NSW structural fix, 30-day monitoring plan.',
    usedIn: 'GoogleAdsMonitorPage → Dashboard tab → Copy Playbook card. Run after Copy Diagnostic.',
    purpose: 'Report 2 in the copy audit workflow. Reads the latest ads-copy-diagnostic run result from the database as confirmed diagnostic input — does not re-diagnose. Pre-fetches fresh RSA ad copy, asset performance labels, search terms by ad group, and quality scores. Produces 8 structured sections: Priority Action List (≤15 items, TODAY/THIS WEEK/THIS MONTH), Wasted Spend Summary table, Headline Replacements table (30-char limit, paste-ready), Description Replacements table (90-char limit), Asset Pinning recommendations, Negative Keyword list, NSW Ad Group structural analysis (Option A vs B with recommendation), and a 4-week Monitoring Plan. Total output under 2,000 words.',
  },
  {
    slug: 'ads-copy-diagnostic',
    title: 'Copy Diagnostic',
    description: 'Formal ad copy audit — RSA headlines, descriptions, asset performance ratings, Quality Score components, search term alignment.',
    usedIn: 'GoogleAdsMonitorPage → Dashboard tab → Copy Diagnostic card. Run on demand.',
    purpose: 'Pre-fetches 7 data sources in parallel: all enabled RSA ads (headlines + descriptions), asset performance labels (BEST/GOOD/LOW/POOR) per asset, ad group performance metrics, top 20 search terms per ad group, keyword Quality Score components, GA4 landing page performance, and GA4 paid bounce sessions. Produces 6 sections: Summary, Campaign and Ad Group Review (per ad), Search Term Alignment Audit (per ad group), Competitive Copy Gap, Recommendations, and a Priority Action List of exactly 10 items ranked by urgency across three tiers (Fix Today / Fix This Week / Fix This Month).',
  },
  {
    slug: 'sql-nlp',
    title: 'SQL Console — NLP',
    description: 'Translates natural language questions into PostgreSQL queries against the platform admin database.',
    usedIn: 'Admin › SQL Console → NLP tab.',
    purpose: 'Receives the question and the live database schema, returns a single valid PostgreSQL query. Returns -- CANNOT_ANSWER: <reason> when the question requires data not present in the platform database (e.g. WordPress/CRM enquiry data). Schema and question are always injected at runtime after the instructions — include {{schema}} and {{question}} placeholders if writing a fully custom prompt, or omit them to have them appended automatically.',
  },
];

// ── Shared styles ─────────────────────────────────────────────────────────────

const inputStyle = {
  fontFamily: 'inherit', fontSize: 13,
  border: '1px solid var(--color-border)', borderRadius: 8,
  background: 'var(--color-bg)', color: 'var(--color-text)',
  padding: '8px 12px', outline: 'none',
};

// ── Row component ─────────────────────────────────────────────────────────────

function PromptRow({ agent, initialCustomPrompt, initialFlags, initialMeta, currentModel }) {
  const [open,     setOpen]     = useState(false);
  const [preview,  setPreview]  = useState('');
  const [edited,   setEdited]   = useState('');
  const [custom,   setCustom]   = useState(initialCustomPrompt ?? '');
  const [loading,  setLoading]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [banner,   setBanner]   = useState(null);
  const [dirty,    setDirty]    = useState(false);
  const [flags,    setFlags]    = useState(initialFlags ?? []);
  const [meta,     setMeta]     = useState(initialMeta ?? null);
  const [resolving, setResolving] = useState(null); // flag id being resolved

  const hasCustom = !!custom?.trim();
  const modelMismatch = meta?.model_at_last_edit && currentModel && meta.model_at_last_edit !== currentModel;

  // Lazy-load the full rendered prompt when first expanded
  useEffect(() => {
    if (!open || preview) return;
    setLoading(true);
    api.get(`/agent-configs/${agent.slug}/preview-prompt`)
      .then(({ preview: p }) => {
        setPreview(p);
        setEdited(p);
      })
      .catch(() => setBanner({ type: 'error', message: 'Failed to load prompt.' }))
      .finally(() => setLoading(false));
  }, [open, agent.slug, preview]);

  function handleChange(val) {
    setEdited(val);
    setDirty(val !== preview);
  }

  async function handleSave() {
    setSaving(true);
    setBanner(null);
    try {
      await api.put(`/agent-configs/${agent.slug}`, {
        custom_prompt:      edited,
        model_at_last_edit: currentModel ?? undefined,
      });
      setCustom(edited);
      setPreview(edited);
      setDirty(false);
      // Refresh meta so model_at_last_edit updates immediately
      const newMeta = await api.get(`/agent-configs/${agent.slug}/meta`).catch(() => null);
      if (newMeta) setMeta(newMeta);
      setBanner({ type: 'neutral', message: 'Custom prompt saved. It will be used on the next agent run.' });
    } catch (err) {
      setBanner({ type: 'error', message: err.message ?? 'Save failed.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleResolveFlag(flagId) {
    setResolving(flagId);
    try {
      await api.post(`/agent-configs/${agent.slug}/flags/${flagId}/resolve`, {});
      setFlags((prev) => prev.filter((f) => f.id !== flagId));
    } catch {
      // silent — flag stays visible
    } finally {
      setResolving(null);
    }
  }

  async function handleReset() {
    setSaving(true);
    setBanner(null);
    try {
      await api.put(`/agent-configs/${agent.slug}`, { custom_prompt: '' });
      setCustom('');
      // Reload the built-in prompt
      const { preview: p } = await api.get(`/agent-configs/${agent.slug}/preview-prompt`);
      setPreview(p);
      setEdited(p);
      setDirty(false);
      setBanner({ type: 'neutral', message: 'Reset to built-in prompt.' });
    } catch (err) {
      setBanner({ type: 'error', message: err.message ?? 'Reset failed.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      borderRadius: 14, border: '1px solid var(--color-border)',
      background: 'var(--color-surface)', overflow: 'hidden', fontFamily: 'inherit',
    }}>
      {/* ── Row header ───────────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', textAlign: 'left', background: 'none', border: 'none',
          cursor: 'pointer', padding: '13px 16px',
          display: 'flex', alignItems: 'center', gap: 10,
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--color-muted)', flexShrink: 0 }}>
          {open ? '▼' : '▶'}
        </span>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', flexShrink: 0 }}>
          {agent.title}
        </span>
        <span style={{ fontSize: 12, color: 'var(--color-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {agent.description}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, flexShrink: 0,
          background: hasCustom ? '#d9770620' : 'var(--color-border)',
          color: hasCustom ? '#d97706' : 'var(--color-muted)',
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          {hasCustom ? 'Custom' : 'Default'}
        </span>
        {flags.length > 0 && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, flexShrink: 0,
            background: '#ef444420', color: '#ef4444',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {flags.length} flag{flags.length !== 1 ? 's' : ''}
          </span>
        )}
        {modelMismatch && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, flexShrink: 0,
            background: '#8b5cf620', color: '#8b5cf6',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            Model changed
          </span>
        )}
      </button>

      {/* ── Expanded body ─────────────────────────────────────────────────── */}
      {open && (
        <div style={{ borderTop: '1px solid var(--color-border)', padding: 16 }}>

          {/* Where used + Purpose */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16,
          }}>
            <div style={{
              background: 'var(--color-bg)', borderRadius: 8, padding: '10px 14px',
              border: '1px solid var(--color-border)',
            }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                Where it's used
              </p>
              <p style={{ fontSize: 12, color: 'var(--color-text)', lineHeight: 1.5 }}>{agent.usedIn}</p>
            </div>
            <div style={{
              background: 'var(--color-bg)', borderRadius: 8, padding: '10px 14px',
              border: '1px solid var(--color-border)',
            }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                Purpose
              </p>
              <p style={{ fontSize: 12, color: 'var(--color-text)', lineHeight: 1.5 }}>{agent.purpose}</p>
            </div>
          </div>

          {/* Model mismatch warning */}
          {modelMismatch && (
            <div style={{
              marginBottom: 12, padding: '10px 14px', borderRadius: 8,
              background: '#8b5cf610', border: '1px solid #8b5cf640',
              fontSize: 12, color: '#8b5cf6',
            }}>
              <strong>Model changed:</strong> this prompt was last saved against <code>{meta.model_at_last_edit}</code>, but the current admin model is <code>{currentModel}</code>. Review and re-save to dismiss this warning.
            </div>
          )}

          {/* Open flags */}
          {flags.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Agent-raised flags
              </p>
              {flags.map((flag) => (
                <div key={flag.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px', borderRadius: 8, marginBottom: 6,
                  background: '#ef444410', border: '1px solid #ef444430',
                }}>
                  <span style={{ flex: 1, fontSize: 12, color: 'var(--color-text)' }}>{flag.reason}</span>
                  <span style={{ fontSize: 11, color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                    {fmtDate(flag.flagged_at)}
                  </span>
                  <button
                    onClick={() => handleResolveFlag(flag.id)}
                    disabled={resolving === flag.id}
                    style={{
                      fontSize: 11, padding: '3px 10px', borderRadius: 6, border: 'none',
                      background: '#ef4444', color: '#fff', cursor: resolving === flag.id ? 'not-allowed' : 'pointer',
                      opacity: resolving === flag.id ? 0.6 : 1,
                    }}
                  >
                    {resolving === flag.id ? '…' : 'Resolve'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Last saved meta */}
          {meta?.updated_at && (
            <p style={{ fontSize: 11, color: 'var(--color-muted)', marginBottom: 12 }}>
              Last saved {fmtDateTime(meta.updated_at)}{meta.updated_by_email ? ` by ${meta.updated_by_email}` : ''}{meta.model_at_last_edit ? ` · model: ${meta.model_at_last_edit}` : ''}
            </p>
          )}

          {banner && (
            <InlineBanner type={banner.type} message={banner.message}
              onDismiss={() => setBanner(null)} className="mb-3" />
          )}

          {/* Prompt textarea */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                System prompt {hasCustom ? '— custom override active' : '— built-in'}
              </p>
              {dirty && (
                <span style={{ fontSize: 11, color: '#d97706' }}>Unsaved changes</span>
              )}
            </div>
            {loading ? (
              <div style={{ padding: '24px', textAlign: 'center', fontSize: 12, color: 'var(--color-muted)' }}>
                Loading prompt…
              </div>
            ) : (
              <textarea
                value={edited}
                onChange={(e) => handleChange(e.target.value)}
                rows={20}
                style={{
                  ...inputStyle,
                  width: '100%', boxSizing: 'border-box',
                  resize: 'vertical', lineHeight: 1.6,
                  fontFamily: 'monospace', fontSize: 12,
                }}
              />
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={handleSave}
              disabled={saving || loading || !edited.trim()}
              style={{
                padding: '7px 16px', borderRadius: 8, fontSize: 13, fontFamily: 'inherit',
                background: 'var(--color-primary)', color: '#fff', border: 'none',
                cursor: saving || loading || !edited.trim() ? 'not-allowed' : 'pointer',
                opacity: saving || loading || !edited.trim() ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Save custom prompt'}
            </button>
            {hasCustom && (
              <button
                onClick={handleReset}
                disabled={saving || loading}
                style={{
                  padding: '7px 16px', borderRadius: 8, fontSize: 13, fontFamily: 'inherit',
                  background: 'transparent', color: 'var(--color-muted)',
                  border: '1px solid var(--color-border)',
                  cursor: saving || loading ? 'not-allowed' : 'pointer',
                  opacity: saving || loading ? 0.6 : 1,
                }}
              >
                Reset to default
              </button>
            )}
            <span style={{ fontSize: 11, color: 'var(--color-muted)', marginLeft: 4 }}>
              {hasCustom
                ? 'A custom prompt is active and overrides the built-in prompt at runtime.'
                : 'No override — the built-in prompt runs as-is. Edit and save to create a custom version.'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminPromptsPage() {
  const [configs,      setConfigs]      = useState({});
  const [flagsMap,     setFlagsMap]     = useState({});
  const [metaMap,      setMetaMap]      = useState({});
  const [currentModel, setCurrentModel] = useState(null);
  const [loading,      setLoading]      = useState(true);

  useEffect(() => {
    // Fetch operator configs, flags, and meta for all agents — plus the platform admin model
    const slugs = AGENTS.map((a) => a.slug);

    Promise.all([
      // Operator configs (custom_prompt)
      Promise.all(slugs.map((slug) =>
        api.get(`/agent-configs/${slug}`).then((cfg) => ({ slug, cfg })).catch(() => ({ slug, cfg: {} }))
      )),
      // Open flags per agent
      Promise.all(slugs.map((slug) =>
        api.get(`/agent-configs/${slug}/flags`).then((flags) => ({ slug, flags })).catch(() => ({ slug, flags: [] }))
      )),
      // Meta (updated_at, editor, model_at_last_edit)
      Promise.all(slugs.map((slug) =>
        api.get(`/agent-configs/${slug}/meta`).then((meta) => ({ slug, meta })).catch(() => ({ slug, meta: null }))
      )),
      // Current admin model for the conversation agent (representative slug)
      api.get('/admin/agents/google-ads-conversation').then((c) => c.model ?? null).catch(() => null),
    ]).then(([cfgResults, flagResults, metaResults, model]) => {
      const cfgMap = {};
      cfgResults.forEach(({ slug, cfg }) => { cfgMap[slug] = cfg; });
      const fMap = {};
      flagResults.forEach(({ slug, flags }) => { fMap[slug] = flags; });
      const mMap = {};
      metaResults.forEach(({ slug, meta }) => { mMap[slug] = meta; });
      setConfigs(cfgMap);
      setFlagsMap(fMap);
      setMetaMap(mMap);
      setCurrentModel(model);
      setLoading(false);
    });
  }, []);

  const customCount = Object.values(configs).filter((c) => c.custom_prompt?.trim()).length;
  const totalFlags  = Object.values(flagsMap).reduce((n, arr) => n + arr.length, 0);

  return (
    <div className="p-6 max-w-4xl mx-auto" style={{ fontFamily: 'inherit' }}>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
          MCP Prompts
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
          View and customise the system prompt for each agent.
          {!loading && customCount > 0 && (
            <span style={{ marginLeft: 8, color: '#d97706' }}>
              {customCount} custom override{customCount !== 1 ? 's' : ''} active.
            </span>
          )}
          {!loading && totalFlags > 0 && (
            <span style={{ marginLeft: 8, color: '#ef4444' }}>
              {totalFlags} open flag{totalFlags !== 1 ? 's' : ''} need review.
            </span>
          )}
        </p>
      </div>

      {/* Rows */}
      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', fontSize: 13, color: 'var(--color-muted)' }}>
          Loading…
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {AGENTS.map((agent) => (
            <PromptRow
              key={agent.slug}
              agent={agent}
              initialCustomPrompt={configs[agent.slug]?.custom_prompt ?? ''}
              initialFlags={flagsMap[agent.slug] ?? []}
              initialMeta={metaMap[agent.slug] ?? null}
              currentModel={currentModel}
            />
          ))}
        </div>
      )}
    </div>
  );
}
