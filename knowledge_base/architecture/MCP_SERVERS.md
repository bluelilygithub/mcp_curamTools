# MCP Servers

All servers are registered in Admin > MCP Servers and connect via stdio (local process).

---

## google-ads.js — 11 tools (+ 4 pending documentation)

| Tool | Description |
|---|---|
| `ads_get_campaign_performance` | Performance totals for every enabled campaign over date range |
| `ads_get_daily_performance` | Account-level daily metrics (date, impressions, clicks, cost, conversions) |
| `ads_get_search_terms` | Top 50 search queries that triggered ads, ordered by clicks DESC |
| `ads_get_budget_pacing` | Monthly budget pacing per campaign |
| `ads_generate_keyword_ideas` | Keyword ideas from competitor URL or seed keywords (AU volume) |
| `ads_get_auction_insights` | Competitor domains appearing in same auctions |
| `ads_get_impression_share_by_campaign` | Impression share, lost to rank, lost to budget per campaign |
| `ads_get_active_keywords` | All active keywords with match type, bid, campaign, ad group |
| `ads_get_change_history` | Recent account change events (bids, budgets, status, ad edits) |
| `ads_get_ad_group_ads` | All enabled RSA ads per campaign/ad group with ad strength |
| `ads_get_ad_asset_performance` | Performance labels for individual headlines/descriptions |

**Data Coverage:** ~March 2026 onwards only.

---

## google-analytics.js — 5 tools

| Tool | Description |
|---|---|
| `ga4_get_sessions_overview` | Daily GA4 session metrics (sessions, activeUsers, bounceRate) |
| `ga4_get_traffic_sources` | Sessions, conversions, revenue by traffic channel |
| `ga4_get_landing_page_performance` | Top 20 landing pages by sessions |
| `ga4_get_paid_bounced_sessions` | Paid search sessions by landing page + device category |
| `ga4_get_conversion_events` | Conversion events by event name and date |

**Data Coverage:** ~March 2026 onwards only.

---

## wordpress.js — 7 tools

| Tool | Description |
|---|---|
| `wp_get_enquiries` | Clientenquiry leads with UTM attribution, device, postcode, suburb |
| `wp_get_enquiry_details` | Extended CRM records with sales_rep, package_type, final_value |
| `wp_get_progress_details` | Enquiry Related Activities (follow-ups, actions, staff) |
| `wp_get_not_interested_reasons` | Leads with reason_not_interested values |
| `wp_enquiry_field_check` | Sample records with all meta keys/values (discovery tool) |
| `wp_find_meta_key` | Search bqq_postmeta for key/value patterns (discovery tool) |
| `wp_get_server_ip` | Outbound IP of MCP server process (diagnostic only) |

**Key facts:**
- Post type: `clientenquiry` | Tables: `bqq_posts` + `bqq_postmeta`
- ACF double-row: `reason_not_interested` = value; `_reason_not_interested` = ACF pointer (ignore)
- Direct MySQL via `mysql2` — bypasses SiteGround WAF
- Use `pool.query()` not `pool.execute()`

**Data Coverage:** Years of history — full dataset available.

---

## platform.js — 7 tools

| Tool | Description |
|---|---|
| `list_report_agents` | Lists all agent slugs with run counts and most recent run |
| `get_report_history` | Fetches historical report runs for a specific agent |
| `search_report_history` | Full-text search across all report summaries |
| `get_pending_suggestions` | Pending/monitoring suggestions for this org (High Intent Advisor) |
| `update_suggestion_outcome` | Update outcome_metrics, outcome_notes on a suggestion |
| `get_suggestion_history` | Full suggestion history (all statuses) for this org |
| `flag_prompt_for_review` | Raise a flag on a prompt needing admin review |

---

## knowledge-base.js — 3 tools

| Tool | Description |
|---|---|
| `search_knowledge` | Semantic similarity search across indexed content |
| `add_document` | Add custom document to knowledge base (NOT wired to conversation agent) |
| `list_knowledge_sources` | Lists what is indexed — source types, counts, dates |

---

## storage.js — 4 tools

| Tool | Description |
|---|---|
| `storage_put_file` | Upload file to S3 (base64-encoded bytes) |
| `storage_get_file` | Get pre-signed download URL (1-hour expiry) |
| `storage_list_files` | List stored files for an organisation |
| `storage_delete_file` | Permanently delete a stored file |

**Storage Pattern:** Files scoped as `org/<orgId>/<timestamp>-<filename>`

---

## Resources

### WordPress Resources
| URI | Description |
|---|---|
| `wordpress://enquiries/recent` | Last 50 enquiries (30 days) |
| `wordpress://enquiries/device-breakdown` | Enquiry volume by device (90 days) |
| `wordpress://enquiries/utm-sources` | Top 10 UTM sources (30 days) |

### Google Ads Resources
| URI | Description |
|---|---|
| `google-ads://campaigns/current` | Active campaigns with 7-day metrics |
| `google-ads://keywords/top-performing` | Top 20 keywords by conversions (30 days) |
| `google-ads://budget/pacing-summary` | Monthly budget pacing status |

---

## Tool Selection Guidelines

### Device Data Routing
- **Historical (years):** `wp_get_enquiries` (device_type field)
- **Recent (Mar 2026+):** `ga4_get_paid_bounced_sessions`
- **Google Ads:** Not segmented by device in current tool outputs

### Data Freshness Boundaries
| Source | Available from |
|---|---|
| Google Ads | ~March 2026 |
| GA4 | ~March 2026 |
| WordPress CRM | Years of history |
| Agent run history | Since deployment |

**CRITICAL:** Do NOT cross-reference CRM data with Google Ads/GA4 data for periods before March 2026.

---

## Conversation Agent — Tool Count: 25

Wires tools from: google-ads (11), google-analytics (5), wordpress (5), platform (4), knowledge-base (2).

## Ads Setup Architect — Tool Count: 7

Wires tools from: google-ads (4), wordpress (1), knowledge-base (1), plus `get_competitor_settings`.

---

## MCP Server Registration Notes

All servers use stdio transport:
- `node server/mcp-servers/google-ads.js`
- `node server/mcp-servers/google-analytics.js`
- `node server/mcp-servers/wordpress.js`
- `node server/mcp-servers/platform.js`
- `node server/mcp-servers/knowledge-base.js`
- `node server/mcp-servers/storage.js`

Required environment variables are inherited from the parent process.
