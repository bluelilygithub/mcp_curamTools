# CRON.md — Scheduled Agent Jobs

**Project Context:** Internal learning project for one organisation, solo developer. See [PROJECT_IDENTITY.md](./PROJECT_IDENTITY.md).

> **Primary reader:** AI + human. Check this before adding or modifying scheduled agent runs.
> **Update trigger:** Any `AgentScheduler.register` call is added, changed, or removed in `server/routes/agents.js`.
> **Source of truth:** `server/routes/agents.js` — this file is derived from it.

All cron jobs registered via `AgentScheduler.register` in `server/routes/agents.js`. Schedules use node-cron expressions (UTC). AEST = UTC+10, AEDT = UTC+11.

---

## Active scheduled jobs

| Agent | Slug | Schedule (UTC) | Local time (AEST/AEDT) | Notes |
|---|---|---|---|---|
| Google Ads Monitor | `google-ads-monitor` | `0 6,18 * * *` | 4pm & 4am (AEDT) / 4pm & 4am (AEST) | Twice daily. Runs for all active customers via multi-customer array return. |
| AI Visibility Monitor | `ai-visibility-monitor` | `0 7 * * 1` | 5pm Monday (AEDT) / 5pm Monday (AEST) | Weekly. 26 geo-targeted web searches via Anthropic native `web_search` tool. |

---

## Deferred (pending QA)

| Agent | Slug | Planned schedule (UTC) | Condition to activate |
|---|---|---|---|
| High Intent Advisor | `high-intent-advisor` | `0 7 * * *` | Manual QA run confirms output quality. Add `AgentScheduler.register` in `agents.js` after sign-off. |

---

## Agents with no cron (on-demand only)

| Agent | Slug | Reason |
|---|---|---|
| Google Ads Freeform | `google-ads-freeform` | Ad-hoc questions — no fixed schedule makes sense |
| Google Ads Change Impact | `google-ads-change-impact` | On-demand after noticing a change |
| Google Ads Change Audit | `google-ads-change-audit` | On-demand |
| Ads Bounce Analysis | `ads-bounce-analysis` | On-demand |
| Auction Insights | `auction-insights` | On-demand |
| Competitor Keyword Intel | `competitor-keyword-intel` | On-demand |
| Google Ads Strategic Review | `google-ads-strategic-review` | On-demand |
| Ads Attribution Summary | `ads-attribution-summary` | On-demand |
| DiamondPlate Data | `diamondplate-data` | On-demand |
| Search Term Intelligence | `search-term-intelligence` | On-demand |
| Daypart Intelligence | `daypart-intelligence` | On-demand |
| Cost Per Booked Job | `cost-per-booked-job` | On-demand |
| Lead Velocity | `lead-velocity` | On-demand |
| Ads Setup Architect | `ads-setup-architect` | On-demand — by design |
| Not Interested Report | `not-interested-report` | On-demand — by design |

---

## How to add a new scheduled job

1. Register in `server/routes/agents.js` after the agent's `createAgentRoute` call:
   ```js
   AgentScheduler.register({
     slug:     'your-agent-slug',
     schedule: '0 7 * * *',   // UTC cron expression
     runFn:    runYourAgent,
   });
   ```
2. Add an entry to the Active table above.
3. Document the UTC↔local offset in a comment at the registration site.

**Schedule changes take effect immediately** — `AgentScheduler.updateSchedule` stops the existing job and re-registers with the new expression. No server restart required.

---

## Timezone note

Railway runs in UTC. All cron expressions are UTC. Blue Lily is AEST (UTC+10) in winter, AEDT (UTC+11) in summer. Convert before setting a schedule if a specific local time matters.

Example: to run at 6am AEST daily → `0 20 * * *` (previous UTC day); or use `0 6 * * *` UTC and accept ~6am display in summer, ~7am in winter.
