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

| Tool | Notes |
|---|---|
| `ads_get_campaign_performance` | |
| `ads_get_daily_performance` | |
| `ads_get_search_terms` | |
| `ads_get_budget_pacing` | |
| `ads_generate_keyword_ideas` | |
| `ads_get_auction_insights` | |
| `ads_get_impression_share_by_campaign` | |
| `ads_get_active_keywords` | |
| `ads_get_change_history` | |

---

## google-analytics.js — 5 tools

| Tool | Notes |
|---|---|
| `ga4_get_sessions_overview` | |
| `ga4_get_traffic_sources` | |
| `ga4_get_landing_page_performance` | |
| `ga4_get_paid_bounced_sessions` | Has device breakdown — use for mobile/desktop questions |
| `ga4_get_conversion_events` | |

---

## wordpress.js — 7 tools

| Tool | Notes |
|---|---|
| `wp_get_enquiries` | Core attribution fields; returns `device_type` on every record |
| `wp_get_enquiry_details` | Extended fields: sales_rep, package_type, enquiry_source, completion_date, final_value, technician, job_number + all core fields |
| `wp_get_progress_details` | progress_details ACF repeater; `entry_date` unreliable (ACF UI m/d vs d/m bug — do not use for timing); `next_event` reliable (operator-scheduled); `next_action`: Phone/Email/Appointment/Invoice/Warranty; `row_count=0` for no-activity leads |
| `wp_get_not_interested_reasons` | |
| `wp_enquiry_field_check` | Discovery tool — bypasses CRM privacy exclusions intentionally |
| `wp_find_meta_key` | Discovery tool — bypasses CRM privacy exclusions intentionally |
| `wp_get_server_ip` | Diagnostic only — not wired to conversation agent intentionally |

**WordPress CRM key facts:**
- Post type: `clientenquiry`
- Tables: `bqq_posts` + `bqq_postmeta` (all WP tables use `bqq_` prefix)
- Field storage: one row per field per post in `bqq_postmeta` as `meta_key` / `meta_value`
- ACF double-row: `reason_not_interested` = value; `_reason_not_interested` = ACF pointer (ignore — use plain key)
- Direct MySQL via `mysql2` — bypasses SiteGround WAF
- Use `pool.query()` not `pool.execute()` — avoids prepared-statement issues with LIMIT
- Embed LIMIT as integer string directly in SQL, not as a `?` placeholder

---

## platform.js — 4 tools

| Tool | Notes |
|---|---|
| `list_report_agents` | |
| `get_report_history` | |
| `search_report_history` | |
| `flag_prompt_for_review` | Not wired to conversation agent intentionally |

---

## knowledge-base.js — 3 tools

| Tool | Notes |
|---|---|
| `search_knowledge` | |
| `add_document` | **Not wired to conversation agent** — RAG poisoning vector. Excluded from exported tool array. Do not re-add without security review. |
| `list_knowledge_sources` | |

---

## storage.js — 4 tools

| Tool | Notes |
|---|---|
| `storage_put_file` | Files scoped as `org/<orgId>/<timestamp>-<filename>` |
| `storage_get_file` | |
| `storage_list_files` | |
| `storage_delete_file` | |

---

## Device data availability

Device is available in **all three systems** — never tell the user device data is unavailable:
- **CRM** `wp_get_enquiries` → `device_type` field (mobile / desktop / tablet) — years of history
- **GA4** `ga4_get_paid_bounced_sessions` → segmented by landing page + device — from March 2026
- **Google Ads** → not segmented by device in current tool outputs

---

## Conversation agent — tool count: 23

The conversation agent (`googleAdsConversation`) wires tools from: google-ads, google-analytics, wordpress, platform, knowledge-base. Current exported count: 23.

**Do not cut tools to reduce cost.** Tool schema overhead is fixed per turn. Re-fetching across turns is the actual cost driver. See SOUL.md.

---

## Data coverage boundaries

| Source | Available from |
|---|---|
| Google Ads | ~March 2026 |
| GA4 | ~March 2026 |
| WordPress CRM | Years of history |
| Agent run history | Since deployment |
