/**
 * EmailTemplateService — admin-editable email templates.
 * Stores templates in email_templates table.
 * Falls back to hardcoded defaults (emailDefaults.js) when DB record is missing.
 *
 * Templates use {{variableName}} placeholders substituted at send time.
 */
const { pool } = require('../db');
const { EMAIL_DEFAULTS } = require('../utils/emailDefaults');

function findDefault(slug) {
  return EMAIL_DEFAULTS.find((t) => t.slug === slug) ?? null;
}

/**
 * Fetch template by slug. Falls back to emailDefaults if not in DB.
 * Always merges description + variables from the default definition.
 */
async function get(slug) {
  const res = await pool.query(
    `SELECT slug, subject, body_html, body_text FROM email_templates WHERE slug = $1`,
    [slug]
  );
  const def = findDefault(slug);
  if (res.rows.length > 0) {
    return {
      ...res.rows[0],
      description: def?.description ?? null,
      variables:   def?.variables   ?? [],
    };
  }
  if (!def) throw new Error(`Email template not found: ${slug}`);
  return def;
}

/**
 * Fetch template and substitute {{variable}} placeholders.
 * Returns { subject, html, text }.
 */
async function render(slug, vars = {}) {
  const tpl = await get(slug);
  const sub = (str) =>
    str.replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] !== undefined ? String(vars[key]) : `{{${key}}}`));
  return {
    subject: sub(tpl.subject),
    html: sub(tpl.body_html),
    text: sub(tpl.body_text),
  };
}

/**
 * List all templates ordered by slug.
 * Merges description + variables from emailDefaults so callers always get the full shape.
 */
async function list() {
  const res = await pool.query(
    `SELECT id, slug, subject, updated_at FROM email_templates ORDER BY slug`
  );
  return res.rows.map((row) => {
    const def = findDefault(row.slug);
    return {
      ...row,
      description: def?.description ?? null,
      variables:   def?.variables   ?? [],
    };
  });
}

/**
 * Save (create or update) a template.
 */
async function upsert(slug, { subject, body_html, body_text }, updatedBy = null) {
  const res = await pool.query(
    `INSERT INTO email_templates (slug, subject, body_html, body_text, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (slug)
     DO UPDATE SET subject = $2, body_html = $3, body_text = $4, updated_by = $5, updated_at = NOW()
     RETURNING *`,
    [slug, subject, body_html, body_text, updatedBy]
  );
  return res.rows[0];
}

/**
 * Restore a template to its hardcoded default.
 */
async function reset(slug, updatedBy = null) {
  const fallback = findDefault(slug);
  if (!fallback) throw new Error(`No default found for template: ${slug}`);
  return upsert(slug, fallback, updatedBy);
}

module.exports = { get, render, list, upsert, reset };
