'use strict';

/**
 * sanitize.js — Shared prompt-injection detection utility.
 *
 * Standardised pattern for all agents that accept user-provided text or
 * filenames.  Import and call before sending user content to an LLM.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   const { scanInjection, sanitiseFileName, sanitiseText } = require('../../utils/sanitize');
 *
 *   const check = scanInjection(userInput);
 *   if (!check.clean) throw new Error('Input rejected: prompt injection detected.');
 *
 * ── Principles ────────────────────────────────────────────────────────────────
 *
 * 1. Patterns are deliberately narrow to avoid false positives on legitimate
 *    engineering / business text (e.g. "the stormwater system: you must ensure…"
 *    is normal specification language, not an injection attempt).
 *
 * 2. Only patterns that are extremely unlikely to appear in legitimate
 *    documents are included.
 *
 * 3. The scan targets the user-supplied *filename* and any *custom prompt*
 *    text, NOT the document body itself — document content is scanned for
 *    analysis, not injection.
 */

// ── Patterns ──────────────────────────────────────────────────────────────────

const INJECTION_PATTERNS = [
  /ignore\s+(previous|above|prior)\s+instructions?\s+(and|\.|$)/gi,
  /\[INST\]/g,
  /<\|im_start\|>/g,
  /forget\s+(all\s+)?(your\s+)?(instructions?|training|guidelines)/gi,
  /disregard\s+(all\s+)?(previous|prior)\s+(instructions?|directions)/gi,
];

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * Scan a string for prompt-injection patterns.
 *
 * @param {string} text — User-supplied text (filename, custom prompt, etc.)
 * @returns {{ clean: boolean }}
 *   `{ clean: true }` if no patterns matched.
 *   `{ clean: false }` if a pattern was found.
 */
function scanInjection(text) {
  if (typeof text !== 'string' || !text) return { clean: true };
  for (const re of INJECTION_PATTERNS) {
    re.lastIndex = 0;
    const hit = re.test(text);
    re.lastIndex = 0;
    if (hit) return { clean: false };
  }
  return { clean: true };
}

/**
 * Sanitise a filename for safe logging / display.
 * Strips null bytes and control characters.
 *
 * @param {string} name
 * @returns {string}
 */
function sanitiseFileName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/[\x00-\x1f]/g, '').trim();
}

/**
 * Sanitise free-text input for safe inclusion in prompts.
 * Strips null bytes and control characters (but preserves newlines).
 *
 * @param {string} text
 * @returns {string}
 */
function sanitiseText(text) {
  if (typeof text !== 'string') return '';
  // Remove null bytes and control characters except \n, \r, \t
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim();
}

module.exports = { scanInjection, sanitiseFileName, sanitiseText };
