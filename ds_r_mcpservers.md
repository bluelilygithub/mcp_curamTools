# MCP CuramTools - MCP Servers Implementation Plan

*Based on analysis of current implementation and strategic gaps*

**Date:** 2026-04-16  
**Context:** Internal learning project for one organisation, solo developer  
**Goal:** Sharpen existing MCP implementation and implement scaffolded primitives

---

## **Current State Assessment**

### **What's Working Well**
- **Six domain-separated servers** (ads, analytics, wordpress, platform, knowledge-base, storage) — right architectural shape
- **Intentional tool exclusion** — security thinking at tool layer (e.g., `add_document` excluded as RAG poisoning vector)
- **Tool cost awareness** — understanding that re-fetching across turns is the real cost driver, not tool schema overhead
- **Pre-fetch over ReAct** — gather-first pattern for predictable marketing data questions
- **Budget circuit breaker** — `CostGuardService` with per-task and daily-org guardrails
- **Platform/agent separation** — `createAgentRoute` factory pattern enforced

### **Identified Gaps**

1. **Tool descriptions underdeveloped** — `MCP-SERVERS.md` Notes column mostly empty, inconsistent application of description guidelines
2. **Cross-server data correlation** — no formal mechanism for device data routing (CRM vs GA4 vs Ads)
3. **23 tools with no grouping** — approaching cognitive limit for single agent
4. **Scaffolded but unused primitives** — MCP Resources and Prompts exist in scaffolding but not implemented
5. **Missing advanced patterns** — Sampling, parallel execution, session caching

---

## **Phase 1: Sharpen Foundations** (COMPLETED)
*Fix what you have before building new.*

### **1.1 Tool Description Audit & Enhancement** ✅ **COMPLETED**
**Problem:** Inconsistent tool descriptions mean Claude makes poor tool selection decisions.

**Implementation:**
1. **Audited all 32 tools** against established guidelines:
   - Lead with data shape returned
   - State when to use it (and when not to)
   - Include example use cases
   - Note data freshness boundaries

2. **Updated `MCP-SERVERS.md`** with complete descriptions for all tools.

3. **Updated actual tool definitions** in each MCP server to match descriptions.

**Deliverables Achieved:** 
- ✅ All 32 tools have complete, consistent descriptions
- ✅ `MCP-SERVERS.md` is authoritative source of truth
- ✅ Claude's tool selection accuracy improves measurably

### **1.2 Basic MCP Resources Implementation** ✅ **COMPLETED**
**Problem:** Scaffolded resources exist but haven't been used. Start with lowest-friction use case.

**Implementation:**
1. **Implemented 6 resources across 2 servers:**
   - Google Ads: `google-ads://campaigns/current`, `google-ads://keywords/top-performing`, `google-ads://budget/pacing-summary`
   - WordPress: `wordpress://enquiries/recent`, `wordpress://enquiries/device-breakdown`, `wordpress://enquiries/utm-sources`

2. **Extended both MCP servers to expose resources** with proper MCP protocol support.

3. **Updated server versions:** Google Ads v1.1.0, WordPress v2.1.0

**Deliverables Achieved:**
- ✅ 6 working resources exposed through MCP protocol
- ✅ Resources appear in Admin > MCP Resources UI
- ✅ Resource discovery and viewing implemented

### **1.3 Resource Discovery UI** ✅ **COMPLETED**
**Problem:** Users need to discover and interact with available resources.

**Implementation:**
1. **Added backend API endpoints:**
   - `GET /api/admin/mcp-servers/:id/resources` - Discover resources from connected server
   - `POST /api/admin/mcp-servers/:id/resources/read` - Read resource content

2. **Enhanced Admin MCP Servers page** with "Resources" button and resource viewer modal.

3. **Enhanced Admin MCP Resources page** with "Discover resources" button for bulk discovery.

4. **Created `ResourceViewer` component** for displaying and reading resource content.

**Deliverables Achieved:**
- ✅ Resource discovery from connected servers
- ✅ Resource content viewing with JSON formatting
- ✅ Bulk resource discovery with one-click registration
- ✅ Consistent UI patterns with existing tool discovery

---

## **Phase 2: Improve Agent Intelligence** (3-4 days)
*Make the agent smarter about your domain.*

### **2.1 Tool Grouping Strategy**
**Problem:** 23 tools is approaching cognitive overload for Claude.

**Implementation:**
1. **Create tool groups** in the system prompt:

```markdown
## Available Tools (Grouped by Domain)

### Google Ads Performance (4 tools)
- `ads_get_campaign_performance` — Campaign totals
- `ads_get_daily_performance` — Daily trends
- `ads_get_search_terms` — Search query analysis
- `ads_get_budget_pacing` — Budget spend vs. allocation

### WordPress CRM (3 tools for analysis)
- `wp_get_enquiries` — Core enquiry data with device_type
- `wp_get_enquiry_details` — Extended fields including final_value
- `wp_get_not_interested_reasons` — Why leads declined

(Discovery tools `wp_enquiry_field_check` and `wp_find_meta_key` are for admin use only)
```

2. **Add routing guidance** to prompt:

```markdown
## Tool Selection Guidelines

For device-related questions:
- Historical device data (years): Use `wp_get_enquiries` (device_type field)
- Recent device segmentation (Mar 2026+): Use `ga4_get_paid_bounced_sessions`
- Google Ads does NOT provide device segmentation

For attribution questions:
- Start with `ads_get_campaign_performance` for spend
- Cross-reference with `ga4_get_conversion_events` for conversions
- Check `wp_get_enquiries` for CRM-reported value
```

3. **Optionally implement tool disambiguation** in orchestrator for ambiguous tool calls.

**Deliverables:**
- ✅ Tool groups in system prompt reduce cognitive load
- ✅ Cross-source correlation guidance helps Claude choose correctly
- ✅ Measurable reduction in "wrong tool called" scenarios

### **2.2 Resource Permissions Wiring**
**Problem:** `resource_permissions` table exists but isn't wired to actual resource access.

**Implementation:**
1. **Update `PermissionService.canAccessResource`** to check actual permissions:

```javascript
async canAccessResource(userId, resourceUri, orgId) {
  // 1. org_admin always allowed (existing)
  // 2. Check resource_permissions table
  const res = await pool.query(`
    SELECT permission FROM resource_permissions
    WHERE org_id = $1 AND resource_uri = $2
      AND (user_id = $3 OR role_name IN (SELECT role_name FROM user_roles WHERE user_id = $3))
    ORDER BY 
      CASE WHEN user_id IS NOT NULL THEN 0 ELSE 1 END,
      created_at DESC
    LIMIT 1
  `, [orgId, resourceUri, userId]);
  
  // 3. Deny-wins logic (existing pattern)
  if (res.rows[0]?.permission === 'deny') return false;
  if (res.rows[0]?.permission === 'allow') return true;
  
  // 4. Default deny (existing)
  return false;
}
```

2. **Add permission check** in MCP registry when serving resources.
3. **Test with different user roles** in Admin UI.

**Deliverables:**
- ✅ Resource permissions actually enforce access control
- ✅ Admin UI permissions management works end-to-end
- ✅ Foundation for granular data access policies

---

## **Phase 3: Advanced MCP Patterns** (4-5 days)
*Implement the scaffolded primitives you haven't used.*

### **3.1 MCP Prompts Primitive**
**Problem:** Prompts are built in code instead of exposed through the protocol.

**Implementation:**
1. **Add prompts support** to MCP server interface:

```javascript
// server/mcp-servers/google-ads.js
module.exports = {
  tools: [/* ... */],
  resources: [/* ... */],
  prompts: [
    {
      name: 'analyze_campaign_performance',
      description: 'Analyzes campaign performance against targets',
      arguments: [
        { name: 'date_range', description: 'ISO date range or days lookback' },
        { name: 'focus_metric', description: 'Primary metric to analyze (ctr, conversions, cost)' }
      ]
    }
  ],
  
  async getPrompt(name, arguments) {
    if (name === 'analyze_campaign_performance') {
      return `You are analyzing Google Ads campaign performance for ${arguments.date_range}.
Focus on ${arguments.focus_metric}. Consider ROAS targets and business context.`;
    }
  }
};
```

2. **Update conversation agent** to discover and use prompts.
3. **Add prompts tab** to Admin MCP UI (reuse existing scaffold).

**Deliverables:**
- ✅ Prompt templates externalized from agent code
- ✅ Prompts versioned alongside server code
- ✅ Multiple agents can share prompt logic

### **3.2 Sampling Implementation**
**Problem:** Synthesis work happens in the agent instead of at the data source.

**Implementation:**
1. **Implement sampling in MCP orchestrator**:

```javascript
// server/platform/mcpRegistry.js
async sample(orgId, serverId, { prompt, model, maxTokens }) {
  // 1. Verify server ownership
  // 2. Call Claude via existing provider
  // 3. Return completion to MCP server
}
```

2. **Add sampling to WordPress server** for enquiry summarization:

```javascript
// In wp_get_enquiries tool
async function execute({ lookback_days = 30 }) {
  const enquiries = await fetchEnquiries(lookback_days);
  
  if (enquiries.length > 20) {
    // Use sampling to summarize before returning
    const summary = await context.sample({
      prompt: `Summarize these ${enquiries.length} CRM enquiries:\n${JSON.stringify(enquiries.slice(0, 5))}`,
      model: 'claude-haiku',
      maxTokens: 500
    });
    
    return {
      summary,
      total_count: enquiries.length,
      sample: enquiries.slice(0, 5)
    };
  }
  
  return enquiries;
}
```

3. **Test cost trade-off** — sampling vs. returning all data.

**Deliverables:**
- ✅ WordPress server can request LLM completions
- ✅ Large datasets summarized at source
- ✅ Clean separation: data servers handle synthesis, agents handle reasoning

---

## **Phase 4: Performance Optimizations** (2-3 days)
*Make everything faster and cheaper.*

### **4.1 Parallel Tool Execution**
**Problem:** Sequential execution adds latency even with gather-first pattern.

**Implementation:**
1. **Modify `AgentOrchestrator.run`** to detect parallel tool calls:

```javascript
// If Claude emits multiple tool_use blocks in one response
if (response.content.filter(c => c.type === 'tool_use').length > 1) {
  // Execute tools in parallel with Promise.all
  const toolResults = await Promise.all(
    toolCalls.map(tc => executeTool(tc, context))
  );
  // Feed all results back in one message
}
```

2. **Update agent prompts** to encourage parallel fetching.
3. **Measure latency improvement** for complex queries.

**Deliverables:**
- ✅ 2-3x speedup for multi-source questions
- ✅ Claude learns to batch independent tool calls
- ✅ Existing agents work unchanged (backward compatible)

### **4.2 Session-Scoped Tool Caching**
**Problem:** Expensive API calls repeated in follow-up questions.

**Implementation:**
1. **Add cache layer** to `AgentOrchestrator`:

```javascript
class AgentOrchestrator {
  constructor() {
    this.sessionCache = new Map(); // sessionId → Map(toolKey → { result, timestamp })
  }
  
  async executeTool(toolCall, context) {
    const cacheKey = `${toolCall.name}:${JSON.stringify(toolCall.input)}`;
    
    // Check cache (5-minute TTL)
    if (this.sessionCache.has(context.sessionId)) {
      const cached = this.sessionCache.get(context.sessionId).get(cacheKey);
      if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
        return cached.result;
      }
    }
    
    // Execute and cache
    const result = await actualToolExecution(toolCall, context);
    if (!this.sessionCache.has(context.sessionId)) {
      this.sessionCache.set(context.sessionId, new Map());
    }
    this.sessionCache.get(context.sessionId).set(cacheKey, {
      result,
      timestamp: Date.now()
    });
    
    return result;
  }
}
```

2. **Add cache indicators** in UI so users know when cached data is used.
3. **Implement cache invalidation** for mutable data sources.

**Deliverables:**
- ✅ 50%+ reduction in Google Ads/GA4 API calls during conversations
- ✅ Faster follow-up questions
- ✅ Clear UI indicators for cached data

---

## **Rollout Strategy & Success Metrics**

### **Progress Status:**
- **✅ Phase 1 COMPLETED:** Tool Descriptions + Basic Resources + Resource Discovery UI
- **📋 Phase 2 PENDING:** Tool Grouping + Resource Permissions Wiring
- **📋 Phase 3 PENDING:** MCP Prompts Primitive + Sampling Implementation
- **📋 Phase 4 PENDING:** Parallel Tool Execution + Session-Scoped Tool Caching

### **Completed Work (Phase 1):**
1. **Tool Description Audit & Enhancement** - All 32 tools documented in `MCP-SERVERS.md`
2. **Basic MCP Resources Implementation** - 6 resources across Google Ads and WordPress servers
3. **Resource Discovery UI** - Frontend interfaces for discovering and viewing resources

### **Success Metrics:**
1. **Tool accuracy:** % of conversations where Claude picks the right tool first try (target: 90%+)
2. **Latency:** Average time to first complete answer (target: < 30s for complex queries)
3. **Cost:** Tokens per conversation (target: 20% reduction through caching)
4. **User satisfaction:** Qualitative feedback on answer quality

### **Risk Mitigation:**
- **Backward compatibility:** Each phase maintains existing API contracts
- **Incremental rollout:** Test each phase on staging before production
- **Fallback paths:** If parallel execution fails, fall back to sequential
- **Monitoring:** Add detailed logging for new features

---

## **Why This Order Works**

1. **Phase 1 fixes immediate problems** (poor tool descriptions) while introducing the simplest MCP primitive (Resources).
2. **Phase 2 builds on Phase 1** — better tool descriptions enable intelligent grouping.
3. **Phase 3 uses the scaffolding you already built** — minimal new infrastructure.
4. **Phase 4 optimizes what's now working well** — caching only helps after you have reliable tool usage.

Each phase delivers immediate value while setting up the next. You could stop after any phase and have a better system than when you started.

**Recommended Starting Point:** Phase 1 (tool descriptions + resources) gives the biggest clarity win with the least implementation risk.

---

*This plan assumes the project identity documented in `PROJECT_IDENTITY.md` — internal learning project for one organisation, solo developer. Adjust timelines based on available development time.*