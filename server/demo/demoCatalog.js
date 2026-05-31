/**
 * DEMO_CATALOG — platform-level registry of available demo agents.
 * Code-registered (not DB) because catalog entries are tied to deployed agent code.
 * Per-org assignment lives in org_agent_manifest (DB).
 *
 * To add a new demo agent:
 *   1. Add an entry here
 *   2. Build the agent under server/agents/demoSuite/<slug>/
 *   3. Add the client page under client/src/pages/demo/
 *   4. Add the route to App.jsx demo section
 *   5. Assign to client orgs via Admin > Demo Manifest
 */

const DEMO_CATALOG = {
  'demo-document-analyzer': {
    name: 'Document Analyzer',
    description: 'Upload a PDF or image — extract structured fields, confidence scores, and flagged clauses using Claude Vision.',
    category: 'operations',
    icon: 'file-text',
    pattern: 'extraction',
  },
  'web-intelligence': {
    name: 'Web Intelligence',
    description: 'Enter any URL and receive a structured analysis — content themes, tone, audience signals, and competitive positioning.',
    category: 'marketing',
    icon: 'globe',
    pattern: 'prefetch',
  },
  'conversation-assistant': {
    name: 'AI Assistant',
    description: 'Ask questions in plain English. The assistant reasons over your business context, searches past findings, and builds on prior answers.',
    category: 'general',
    icon: 'message-circle',
    pattern: 'react',
  },
  'demo-spec-validator': {
    name: 'Spec Validator',
    description: 'Validates hydraulic services calculation documents. Extracts quantitative claims, runs deterministic Python verification of pipe velocities, pressure drops and pressure budgets, and produces a reviewer-ready finding set with full calculation working.',
    category: 'Engineering',
    icon: 'file-check',
    pattern: 'three-stage-pipeline',
  },
  'demo-spec-anomaly-investigator': {
    name: 'Spec Anomaly Investigator',
    description: 'Upload a hydraulic specification PDF. The agent investigates for likely problems using hypothesis-driven reasoning — before Spec Validator runs formal compliance calculations. Shows what a ReAct investigation loop looks like on a real engineering document.',
    category: 'Engineering',
    icon: 'search',
    pattern: 'react-investigation',
  },
  'demo-tender-response': {
    name: 'Tender Response Generator',
    description: 'Upload an RFT PDF — extract compliance requirements, run deterministic checks against a pre-loaded evidence pack, and generate first-draft response paragraphs with inline evidence citations.',
    category: 'Engineering',
    icon: 'file-text',
    pattern: 'four-stage-pipeline',
  },
};

module.exports = { DEMO_CATALOG };
