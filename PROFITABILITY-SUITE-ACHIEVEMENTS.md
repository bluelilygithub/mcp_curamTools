# Profitability Suite — Achievement Log (April 2026)

This document summarizes the development of the **Profitability Suite**, a siloed Business Intelligence layer designed to shift Diamond Plate Australia's marketing from lead-volume focus to profit-centric growth.

## 1. Architectural Foundation
*   **Siloed Development:** Established a new directory structure for "Suite" tools to keep high-level strategic agents separate from routine monitoring tools.
    *   Server: `server/agents/profitabilitySuite/`
    *   Client: `client/src/pages/profitabilitySuite/`
*   **CRM Data Enhancement:** Modified the WordPress MCP server (`wordpress.js`) to capture **Postcode** and **Suburb** ACF fields. This enables geographic clustering and drive-time analysis for the Australian market.

## 2. New Agent: Ads Setup Architect
A senior-level strategic agent that designs high-performance Google Ads structures.

### Key Capabilities:
*   **Competitor Gap Analysis:** Pulls data for up to 10 competitors to identify service hooks and keyword opportunities.
*   **Diamond Plate Guardrails:** Hardcoded adherence to verified business parameters:
    *   12-year nationwide warranty.
    *   CSIRO-tested, 9H+ Graphene/Ceramic formulas.
    *   Price anchors: $790 (Ceramic) / $990 (Graphene).
*   **Account Blueprinting:** Generates campaign structures, ad group themes, prioritized keyword lists, and RSA copy within Google Ads character limits.

## 3. User Experience Enhancements
*   **Strategic Discussion View:** Integrated the existing `ConversationView` into the Architect tool. Users can now "Discuss this report" to refine the blueprint with the AI, supporting multimodal image uploads (screenshots) and persistent history.
*   **Model-Agnostic Intelligence:**
    *   Added a **Settings** tab to the tool for custom model selection.
    *   **Expert Guidance:** Provided a "Pros & Cons" breakdown for different models (Sonnet, Opus, GPT-4o, Gemini) to help users choose the right reasoning level for their budget and complexity needs.
    *   **Org Default Awareness:** The tool automatically respects and labels the organization-wide default model.

## 4. Live Data & Integrity Mandate
*   **Live Tool Integration:** Added `get_ad_group_ads` and `get_ad_asset_performance` to the **Ads Setup Architect** and **Conversation** agents. This allows them to read current RSA headlines, descriptions, and performance ratings directly from the Google Ads API.
*   **Truthful Reasoning:** Updated the system prompts for both agents with a **Live Verification Mandate (CRITICAL)**. This instructs the AI to never guess the state of the account based on historical reports and to always verify with live tools before claiming a change is "live."
*   **Operational Integrity:** The Architect now performs a "Current State Assessment" as its first step, ensuring all recommendations are built on top of what is actually running in the account right now.

## 5. Technical Integration
*   **Routing:** Registered the `/ads-setup-architect` endpoint in the server-side agents router.
*   **Configuration:** Added default admin and operator configs to `AgentConfigService.js`, including cost-control budget ceilings for web-search intensive tasks.
*   **Frontend Registry:** Added the tool to `tools.js` and `App.jsx` for seamless navigation from the main dashboard.

## 5. Next Steps (Roadmap)
*   **Profitability Oracle (True ROAS):** Implement the agent that joins `final_value` from CRM with Google Ads spend to calculate actual profit per campaign.
*   **Post-Click Leak Detective:** Build the technical auditor to identify friction points between clicks, GA4 sessions, and CRM leads.
*   **Radius Clustering:** Use the newly available postcode data to create "Drive-Time Tier" bidding recommendations.
