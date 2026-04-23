# MCP-SERVERS.md

**Project Context:** Internal learning project for one organisation, solo developer. See [PROJECT_IDENTITY.md](./PROJECT_IDENTITY.md).

> **Primary reader:** AI coding session writing or modifying agents.
> **Update trigger:** Any MCP server tool is added, removed, or renamed.
> **This is the source of truth.** If an agent calls a tool not listed here, something is wrong.

---

## Registered servers

All servers are registered in Admin > MCP Servers and connect via stdio (local process) or HTTP/SSE.

---

## google-ads.js — 9 tools

| Tool | Description | Data Shape | When to Use |
|---|---|---|---|
| `ads_get_campaign_performance` | Performance totals for every enabled Google Ads campaign over the date range. Returns id, name, status, monthly budget (AUD), impressions, clicks, cost (AUD), conversions, CTR, and average CPC. | `[{id, name, status, budget_aud, impressions, clicks, cost_aud, conversions, ctr, avg_cpc}]` | First call for any question about campaign efficiency, spend, or conversion rates. Does not include daily trend data. |
| `ads_get_daily_performance` | Account-level daily metrics: date, impressions, clicks, cost (AUD), conversions — one row per day ordered ASC. | `[{date, impressions, clicks, cost_aud, conversions}]` | For trend analysis, pacing, or identifying performance spikes/drops. Account-level totals only — not per-campaign. |
| `ads_get_search_terms` | Top 50 actual user search queries that triggered ads, ordered by clicks DESC. Returns term, status, impressions, clicks, cost (AUD), conversions, CTR. | `[{term, status, impressions, clicks, cost_aud, conversions, ctr}]` | For intent analysis, wasted spend, negative keyword identification, or ad relevance questions. |
| `ads_get_budget_pacing` | Monthly budget pacing per campaign: campaign name, monthly budget (AUD), spend to date (AUD). Uses THIS_MONTH segment. | `[{campaign_name, monthly_budget_aud, spend_to_date_aud}]` | For budget questions or checking if campaigns are on track. |
| `ads_generate_keyword_ideas` | Generate keyword ideas from a competitor URL or seed keyword list using Google Ads Keyword Plan Idea Service. Returns keywords with Australian monthly search volume, competition level, and CPC range (AUD). | `[{keyword, avg_monthly_searches, competition, low_top_of_page_bid_aud, high_top_of_page_bid_aud}]` | For keyword research, gap analysis, or expanding campaign reach. |
| `ads_get_auction_insights` | Competitor domains appearing in the same auctions as the account. For each competitor: impression share, top-of-page rate, absolute top-of-page rate, outranking share. | `[{domain, impression_share, top_of_page_rate, abs_top_of_page_rate, outranking_share}]` | For competitor analysis or visibility questions. |
| `ads_get_impression_share_by_campaign` | Account impression share per campaign: impression share, lost to rank, lost to budget, top-of-page rate, absolute top-of-page rate. | `[{campaign_name, impression_share, lost_impression_share_rank, lost_impression_share_budget, top_of_page_rate, abs_top_of_page_rate}]` | To diagnose visibility loss or budget vs quality issues. |
| `ads_get_active_keywords` | All active keywords currently in the account: keyword text, match type, bid (AUD), campaign name, ad group name. Up to 200 keywords ordered by bid DESC. | `[{keyword_text, match_type, bid_aud, campaign_name, ad_group_name}]` | For keyword strategy, gap analysis, or bid questions. |
| `ads_get_change_history` | Recent account change events: bid changes, budget adjustments, status changes, ad edits, keyword additions/removals. Returns changedAt, resourceType, changedFields, clientType, operation, campaignName. | `[{changed_at, resource_type, changed_fields, client_type, operation, campaign_name}]` | For any question about what changed recently in the account. |
| `ads_get_ad_group_ads` | All enabled RSA ads per campaign and ad group. Returns campaign, adGroup, adId, adStrength (EXCELLENT/GOOD/AVERAGE/POOR/UNSPECIFIED), finalUrls, headlines (text + pinnedField), descriptions (text + pinnedField). | `[{campaign, adGroup, adId, adStrength, finalUrls, headlines, descriptions}]` | Use for ad copy analysis and copy diagnostic reports. |
| `ads_get_ad_asset_performance` | Asset performance labels for every active RSA asset from the Google Ads asset view. Returns campaign, adGroup, adId, fieldType (HEADLINE/DESCRIPTION), performanceLabel (BEST/GOOD/LOW/POOR/UNRATED/LEARNING), pinnedField, and text. | `[{campaign, adGroup, adId, fieldType, performanceLabel, text}]` | Use to identify which specific headlines and descriptions are rated Poor and should be replaced. |

**Data Coverage:** Google Ads data available from ~March 2026 onwards only.

---

## google-analytics.js — 5 tools

| Tool | Description | Data Shape | When to Use |
|---|---|---|---|
| `ga4_get_sessions_overview` | Daily GA4 session metrics: date, sessions, activeUsers, newUsers, bounceRate (decimal, e.g. 0.42 = 42%). Ordered by date ASC. | `[{date, sessions, active_users, new_users, bounce_rate}]` | To identify traffic trends and paid traffic quality over time. |
| `ga4_get_traffic_sources` | Sessions, conversions, and revenue grouped by traffic channel (Organic Search, Paid Search, Direct, etc.). | `[{channel, sessions, conversions, revenue}]` | To understand channel mix and relative contribution of paid vs organic traffic. |
| `ga4_get_landing_page_performance` | Top 20 landing pages by sessions: sessions, conversions, bounce rate, average session duration. | `[{landing_page, sessions, conversions, bounce_rate, avg_session_duration}]` | To identify which pages paid traffic lands on and whether they convert. |
| `ga4_get_paid_bounced_sessions` | GA4 sessions from paid search (cpc medium) grouped by landing page and device category. Returns sessions, bounce rate, and average session duration per landing page + device combination. | `[{landing_page, device_category, sessions, bounce_rate, avg_session_duration}]` | To find which landing pages are failing paid traffic and whether mobile or desktop is worse. **Has device breakdown.** |
| `ga4_get_conversion_events` | Conversion events by event name and date: event count and conversion count. Only returns events with at least one conversion. | `[{event_name, date, event_count, conversion_count}]` | To understand when and how often users complete key actions. |

**Data Coverage:** GA4 data available from ~March 2026 onwards only.

---

## wordpress.js — 7 tools

| Tool | Description | Data Shape | When to Use |
|---|---|---|---|
| `wp_get_enquiries` | Fetch clientenquiry leads directly from WordPress database. Includes UTM attribution, search term, device type, landing page, gclid, GA4 client ID, enquiry status, reason_not_interested, **postcode**, and **suburb**. Years of history available. | `[{id, date, enquiry_status, utm_source, utm_medium, utm_campaign, utm_ad_group, utm_term, utm_content, search_term, device_type, landing_page, referral_page, gclid, ga4_client_id, reason_not_interested, postcode, suburb}]` | For lead volume, attribution, device analysis, or any question about what happened after the click. **Returns device_type on every record.** `search_term` is always null — GA4 does not capture per-lead search queries. |
| `wp_get_enquiry_details` | Extended clientenquiry records with full CRM fields: sales_rep, package_type, enquiry_source, contacted_date, invoiced_date, completion_date, appointment_date, calculated_value, final_value, technician, job_number, **postcode**, and **suburb**. | `[{id, date, enquiry_status, utm_source, utm_medium, utm_campaign, device_type, landing_page, gclid, reason_not_interested, job_number, sales_rep, package_type, enquiry_source, contacted_date, invoiced_date, completion_date, appointment_date, calculated_value, final_value, technician, postcode, suburb}]` | For lead velocity, pipeline value, sales rep performance, or financial analysis. |
| `wp_get_progress_details` | Fetch progress_details ACF repeater rows (Enquiry Related Activities). Each row: entry_date (d/m/Y g:i a), next_event (scheduled follow-up), next_action (Phone/Email/Appointment/Invoice/Warranty), event_message, staff_member. Posts with zero activity have row_count=0. | `[{post_id, enquiry_date, row_count, rows: [{index, entry_date, next_event, next_action, event_message, staff_member}]}]` | For follow-up intensity, response time analysis, stale lead detection, or activity tracking. **entry_date unreliable (ACF UI bug).** |
| `wp_get_not_interested_reasons` | Returns all clientenquiry records that have a reason_not_interested value, with their UTM attribution. | `[{id, date, reason_not_interested, enquiry_status, utm_source, utm_campaign, utm_medium, device_type, search_term}]` | Specifically for analysing why leads did not proceed. **Known values for reason_not_interested: `wrong_products`, `wrong_location`, `too_expensive`, `not_specified`.** `search_term` is always null — GA4 does not capture per-lead search queries; do not rely on this field. |
| `wp_enquiry_field_check` | Returns a sample of recent clientenquiry records with all meta keys and values. | `[{id, date, keys: [], sample: {}}]` | **Discovery tool** — to diagnose which fields are populated and what values they hold. Bypasses CRM privacy exclusions. |
| `wp_find_meta_key` | Search bqq_postmeta for rows matching a key or value pattern. | `[{meta_key, meta_value, post_id, post_type}]` | **Discovery tool** — to find the exact meta_key a field is stored under. Bypasses CRM privacy exclusions. |
| `wp_get_server_ip` | Returns the outbound IP address of this MCP server process. | `{ip: string}` | **Diagnostic only** — not wired to conversation agent. |

**WordPress CRM key facts:**
- Post type: `clientenquiry`
- Tables: `bqq_posts` + `bqq_postmeta` (all WP tables use `bqq_` prefix)
- Field storage: one row per field per post in `bqq_postmeta` as `meta_key` / `meta_value`
- ACF double-row: `reason_not_interested` = value; `_reason_not_interested` = ACF pointer (ignore — use plain key)
- Direct MySQL via `mysql2` — bypasses SiteGround WAF
- Use `pool.query()` not `pool.execute()` — avoids prepared-statement issues with LIMIT
- Embed LIMIT as integer string directly in SQL, not as a `?` placeholder

**Data Coverage:** WordPress CRM has years of history — full dataset available regardless of date range.

---

## WordPress Resources — 3 resources

| Resource URI | Name | Description | MIME Type |
|---|---|---|---|
| `wordpress://enquiries/recent` | Recent Enquiries | Last 50 client enquiries with basic attribution data (last 30 days). | `application/json` |
| `wordpress://enquiries/device-breakdown` | Device Breakdown | Enquiry volume by device type (mobile/desktop/tablet) over the last 90 days. | `application/json` |
| `wordpress://enquiries/utm-sources` | Top UTM Sources | Top 10 UTM sources by enquiry volume over the last 30 days. | `application/json` |

---

## Google Ads Resources — 3 resources

| Resource URI | Name | Description | MIME Type |
|---|---|---|---|
| `google-ads://campaigns/current` | Current Campaigns | List of all active Google Ads campaigns with basic performance metrics from the last 7 days. | `application/json` |
| `google-ads://keywords/top-performing` | Top Performing Keywords | Top 20 keywords by conversions over the last 30 days. | `application/json` |
| `google-ads://budget/pacing-summary` | Budget Pacing Summary | Monthly budget pacing status for all campaigns. | `application/json` |

---

## platform.js — 7 tools

| Tool | Description | Data Shape | When to Use |
|---|---|---|---|
| `list_report_agents` | Lists all agent slugs that have stored report history, with their run counts and most recent run date. | `[{slug, run_count, last_run, total_cost_aud}]` | Call this first to discover what historical data is available. |
| `get_report_history` | Fetches historical report runs for a specific agent. Returns the full summary text and key metadata. | `[{id, run_at, start_date, end_date, cost_aud, summary}]` | To analyse trends, compare periods, or answer questions about what past reports found. |
| `search_report_history` | Full-text search across all stored report summaries by topic or keyword. Returns matching runs with relevant excerpts. | `[{id, slug, run_at, start_date, end_date, summary}]` | To find reports that mentioned a specific topic, campaign, keyword, or issue. |
| `get_pending_suggestions` | Returns all `agent_suggestions` rows with status `pending` or `monitoring` for this org, ordered by priority (high first) then created_at DESC. | `[{id, category, priority, suggestion_text, rationale, status, baseline_metrics, outcome_notes, created_at, reviewed_at}]` | Used by High Intent Advisor (Phase 1) to review its own prior suggestions before generating new ones. `cacheable: false`. |
| `update_suggestion_outcome` | Updates `outcome_metrics`, `outcome_notes`, `reviewed_at`, and optionally `status` on an `agent_suggestions` row. Org-scoped — must match suggestion's org. | `{updated: true, suggestion_id}` | Used by High Intent Advisor (Phase 1) to record whether a past suggestion moved the needle. `cacheable: false`. |
| `get_suggestion_history` | Returns full suggestion history for this org (all statuses: pending, monitoring, acted_on, dismissed), ordered by created_at DESC. Limit default 100, max 200. | `[{user_action, user_reason, outcome_notes, outcome_metrics, baseline_metrics, created_at, acted_on_at, reviewed_at, category, priority, suggestion_text, rationale, status}]` | Used by High Intent Advisor (Phase 1) to identify patterns — what gets acted on, what gets dismissed and why, which suggestion types fail to move metrics. `cacheable: false`. |
| `flag_prompt_for_review` | Raise a flag on a prompt that needs admin review. | `{flagged: true, slug, reason}` | **Not wired to conversation agent** — call when you notice your own system prompt is outdated or references stale context. |

---

## knowledge-base.js — 3 tools

| Tool | Description | Data Shape | When to Use |
|---|---|---|---|
| `search_knowledge` | Semantic similarity search across all indexed content — agent report summaries and custom documents. | `[{source_type, source_id, metadata, similarity, content}]` | To find relevant context for any question. More powerful than keyword search — finds conceptually related content. |
| `add_document` | Add a custom document to the knowledge base. | `{ok: true, source_id, title}` | **Not wired to conversation agent** — RAG poisoning vector. Excluded from exported tool array. Do not re-add without security review. |
| `list_knowledge_sources` | Lists what is indexed in the knowledge base — source types, counts, and most recent entry dates. | `[{source_type, category, count, last_indexed}]` | To understand what content is available for semantic search. |

---

## storage.js — 4 tools

| Tool | Description | Data Shape | When to Use |
|---|---|---|---|
| `storage_put_file` | Upload a file to S3 storage. Accepts base64-encoded bytes and a content type. Returns a storageKey. | `{storageKey, bucket, size}` | To store files generated by agents (reports, exports, images). |
| `storage_get_file` | Get a pre-signed download URL for a stored file. The URL expires after 1 hour. | `{url, expiresAt, storageKey}` | To retrieve stored files for download or processing. |
| `storage_list_files` | List files stored for an organisation. Returns key, filename, size, and upload date. | `{files: [{storageKey, filename, size, lastModified}], count, prefix}` | To browse stored files or check what's available. |
| `storage_delete_file` | Permanently delete a stored file by its storageKey. | `{deleted: true, storageKey}` | To clean up temporary or outdated files. |

**Storage Pattern:** Files scoped as `org/<orgId>/<timestamp>-<filename>`

---

## Tool Selection Guidelines

### Device Data Routing
Device data is available in **all three systems** — never tell the user device data is unavailable:
- **Historical device data (years)**: Use `wp_get_enquiries` (device_type field)
- **Recent device segmentation (Mar 2026+)**: Use `ga4_get_paid_bounced_sessions` 
- **Google Ads**: Not segmented by device in current tool outputs

### Attribution Questions
- **Start with**: `ads_get_campaign_performance` for spend
- **Cross-reference with**: `ga4_get_conversion_events` for conversions
- **Check**: `wp_get_enquiries` for CRM-reported value

### Data Freshness Boundaries
| Source | Available from | Notes |
|---|---|---|
| Google Ads | ~March 2026 | Campaign performance, keywords, changes |
| GA4 | ~March 2026 | Sessions, conversions, device breakdown |
| WordPress CRM | Years of history | Full lead dataset with device_type |
| Agent run history | Since deployment | Stored report summaries |

**CRITICAL:** Do NOT cross-reference CRM data with Google Ads/GA4 data for periods before March 2026. There is no matching Google-side data for that period.

---

## Conversation Agent — Tool Count: 25

The conversation agent (`googleAdsConversation`) wires tools from: google-ads (11), google-analytics (5), wordpress (5 — excludes `wp_get_server_ip`), platform (4 — excludes `get_pending_suggestions`, `update_suggestion_outcome`, `get_suggestion_history`, `flag_prompt_for_review`), knowledge-base (2 — excludes `add_document`). Current exported count: 25.

---

## Ads Setup Architect Agent — Tool Count: 7
Registered in `server/agents/profitabilitySuite/adsSetupArchitect/`.

| Tool | Description | When to Use |
|---|---|---|
| `get_competitor_settings` | Retrieve the configured list of 10 competitors and their websites for this organization. | First step for competitor-based setup analysis. |
| `ads_generate_keyword_ideas` | Generate keyword ideas from a competitor URL. Returns keywords with AU volume and CPC. | For keyword research and gap analysis. |
| `ads_get_ad_group_ads` | Current live RSA ad copy: headlines, descriptions, and ad strength for all enabled ads. | **Live Verification Mandate:** verify current copy before proposing changes. |
| `ads_get_ad_asset_performance` | Current performance labels (BEST, GOOD, LOW, POOR) for individual headlines and descriptions. | Identify failing assets that need replacement. |
| `ads_get_auction_insights` | Competitor domains appearing in the same auctions as the account. | For competitor analysis or visibility questions. |
| `wp_get_enquiry_details` | Extended CRM records with final_value and enquiry themes. | Find high-performing lead sources. |
| `search_knowledge` | Search knowledge base for Diamond Plate product info, differentiators, and SOPs. | Ensure ad copy aligns with brand guardrails. |


**Cost Optimization:** Tool schema overhead is fixed per turn. Re-fetching across turns is the actual cost driver. Do not cut tools to reduce cost — focus on reducing re-fetches through caching and intelligent tool selection.

---

## MCP Server Registration Notes

All servers use stdio transport with these command patterns:
- `google-ads.js`: `node server/mcp-servers/google-ads.js`
- `google-analytics.js`: `node server/mcp-servers/google-analytics.js`
- `wordpress.js`: `node server/mcp-servers/wordpress.js`
- `platform.js`: `node server/mcp-servers/platform.js`
- `knowledge-base.js`: `node server/mcp-servers/knowledge-base.js`
- `storage.js`: `node server/mcp-servers/storage.js`

Required environment variables are inherited from the parent process via Railway environment configuration.



