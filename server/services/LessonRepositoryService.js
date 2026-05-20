'use strict';

/**
 * LessonRepositoryService — persistent lessons/rules for runtime agent prompts.
 *
 * Scope model:
 * - agent_id = 'ALL' applies to every agent
 * - org_id NULL applies to every organisation
 * - active lessons only are injected into runtime prompts
 */
const { pool } = require('../db');

const ALL = 'ALL';
const STATUSES = new Set(['active', 'disabled', 'under-review']);
const TITLE_MAX = 120;
const CONTENT_WARN = 2000;

function isSuperAdmin(user) {
  return user?.orgType === 'internal';
}

function orgParamToDb(value, user) {
  if (value === undefined || value === null || value === '') return user?.orgId ?? null;
  if (String(value).toUpperCase() === ALL) {
    if (!isSuperAdmin(user)) throw new Error('Only an internal org admin can create global organisation lessons.');
    return null;
  }
  const n = parseInt(value, 10);
  if (!Number.isInteger(n)) throw new Error('Invalid organisation.');
  if (!isSuperAdmin(user) && n !== user?.orgId) throw new Error('Organisation is outside your access scope.');
  return n;
}

function agentParamToDb(value) {
  const v = String(value ?? '').trim();
  if (!v) throw new Error('Agent is required.');
  if (v.toUpperCase() === ALL) return ALL;
  const { ADMIN_DEFAULTS, AGENT_MODEL_REQUIREMENTS } = require('../platform/AgentConfigService');
  if (
    !Object.prototype.hasOwnProperty.call(ADMIN_DEFAULTS, v) &&
    !Object.prototype.hasOwnProperty.call(AGENT_MODEL_REQUIREMENTS, v)
  ) {
    throw new Error('Agent is not registered in this platform.');
  }
  return v;
}

function cleanText(value) {
  return String(value ?? '').replace(/\u0000/g, '').trim();
}

function validateLessonInput(input, { partial = false } = {}) {
  const out = {};

  if (!partial || input.agent_id !== undefined || input.agentId !== undefined) {
    out.agent_id = agentParamToDb(input.agent_id ?? input.agentId);
  }

  if (!partial || input.category !== undefined) {
    out.category = cleanText(input.category).toLowerCase();
    if (!out.category) throw new Error('Category is required.');
  }

  if (!partial || input.title !== undefined) {
    out.title = cleanText(input.title);
    if (!out.title) throw new Error('Title is required.');
    if (out.title.length > TITLE_MAX) throw new Error(`Title must be ${TITLE_MAX} characters or fewer.`);
  }

  if (!partial || input.content !== undefined) {
    out.content = cleanText(input.content);
    if (!out.content) throw new Error('Content is required.');
  }

  if (!partial || input.status !== undefined) {
    out.status = cleanText(input.status || 'active');
    if (!STATUSES.has(out.status)) throw new Error('Invalid status.');
  }

  if (!partial || input.applied_from !== undefined || input.appliedFrom !== undefined) {
    const v = input.applied_from ?? input.appliedFrom;
    out.applied_from = cleanText(v) || new Date().toISOString().slice(0, 10);
  }

  if (input.applied_to !== undefined || input.appliedTo !== undefined) {
    const v = cleanText(input.applied_to ?? input.appliedTo);
    out.applied_to = v || null;
  }

  if (out.applied_to && out.applied_from && out.applied_to < out.applied_from) {
    throw new Error('Applied To must be on or after Applied From.');
  }

  return out;
}

function actorLabel(user) {
  if (!user) return 'system';
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name ? `${name} (${user.id})` : `${user.email ?? 'user'} (${user.id})`;
}

function auditEntry({ editedBy, field, previousValue, newValue, reason }) {
  return {
    edited_at:      new Date().toISOString(),
    edited_by:      editedBy,
    field_changed:  field,
    previous_value: previousValue,
    new_value:      newValue,
    reason:         reason ? cleanText(reason) : null,
  };
}

function toApi(row) {
  if (!row) return row;
  return {
    id:              row.id,
    agent_id:        row.agent_id,
    organisation_id: row.org_id == null ? ALL : row.org_id,
    organisation_name: row.org_id == null ? ALL : row.organisation_name,
    category:        row.category,
    title:           row.title,
    content:         row.content,
    status:          row.status,
    created_at:      row.created_at,
    created_by:      row.created_by,
    applied_from:    row.applied_from,
    applied_to:      row.applied_to,
    audit_log:       row.audit_log ?? [],
    updated_at:      row.updated_at,
    deleted_at:      row.deleted_at,
    is_agent_proposed: row.status === 'under-review' && row.created_by === row.agent_id,
  };
}

function dateOnly(value) {
  return value == null ? null : String(value).slice(0, 10);
}

function accessWhere(user, startIndex = 1, { includeGlobal = true } = {}) {
  if (isSuperAdmin(user)) return { sql: '1=1', params: [] };
  const params = [user.orgId];
  return {
    sql: includeGlobal ? `(l.org_id = $${startIndex} OR l.org_id IS NULL)` : `l.org_id = $${startIndex}`,
    params,
  };
}

async function listLessons(user, filters = {}) {
  const params = [];
  const clauses = ['l.deleted_at IS NULL'];

  const access = accessWhere(user, params.length + 1);
  clauses.push(access.sql);
  params.push(...access.params);

  const q = cleanText(filters.q ?? filters.search);
  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(l.title ILIKE $${params.length} OR l.content ILIKE $${params.length} OR l.category ILIKE $${params.length})`);
  }

  const agent = cleanText(filters.agent_id ?? filters.agent);
  if (agent && agent.toUpperCase() !== ALL) {
    params.push(agent);
    clauses.push(`l.agent_id = $${params.length}`);
  }

  const org = cleanText(filters.organisation_id ?? filters.org_id ?? filters.org);
  if (org) {
    if (org.toUpperCase() === ALL) {
      clauses.push('l.org_id IS NULL');
    } else {
      params.push(parseInt(org, 10));
      clauses.push(`l.org_id = $${params.length}`);
    }
  }

  const status = cleanText(filters.status);
  if (status && status !== 'all') {
    params.push(status);
    clauses.push(`l.status = $${params.length}`);
  }

  const categories = Array.isArray(filters.categories)
    ? filters.categories
    : cleanText(filters.categories).split(',').map((c) => c.trim()).filter(Boolean);
  if (categories.length > 0) {
    params.push(categories.map((c) => c.toLowerCase()));
    clauses.push(`l.category = ANY($${params.length})`);
  }

  if (filters.from) {
    params.push(filters.from);
    clauses.push(`l.applied_from >= $${params.length}::date`);
  }
  if (filters.to) {
    params.push(filters.to);
    clauses.push(`l.applied_from <= $${params.length}::date`);
  }

  const sortMap = {
    agent: 'l.agent_id',
    organisation: 'COALESCE(o.name, \'ALL\')',
    date: 'l.applied_from',
    applied_from: 'l.applied_from',
    category: 'l.category',
  };
  const sort = sortMap[filters.sort] ?? 'l.updated_at';
  const dir = String(filters.dir ?? '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.max(1, Math.min(100, parseInt(filters.limit, 10) || 25));
  const offset = Math.max(0, parseInt(filters.offset, 10) || 0);

  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT l.*, o.name AS organisation_name, COUNT(*) OVER() AS total_count
       FROM agent_lessons l
       LEFT JOIN organizations o ON o.id = l.org_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY ${sort} ${dir}, l.updated_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    rows: rows.map(toApi),
    total: Number(rows[0]?.total_count ?? 0),
    limit,
    offset,
  };
}

async function getLesson(id, user) {
  const params = [id];
  const access = accessWhere(user, 2);
  params.push(...access.params);
  const { rows } = await pool.query(
    `SELECT l.*, o.name AS organisation_name
       FROM agent_lessons l
       LEFT JOIN organizations o ON o.id = l.org_id
      WHERE l.id = $1 AND l.deleted_at IS NULL AND ${access.sql}`,
    params
  );
  return toApi(rows[0] ?? null);
}

async function createLesson(input, user) {
  const body = validateLessonInput(input);
  const orgId = orgParamToDb(input.organisation_id ?? input.org_id ?? input.orgId, user);
  const createdBy = String(user.id);
  const createdAudit = auditEntry({
    editedBy:      actorLabel(user),
    field:         'created',
    previousValue: null,
    newValue:      {
      agent_id: body.agent_id,
      organisation_id: orgId == null ? ALL : orgId,
      category: body.category,
      title: body.title,
      status: body.status,
    },
    reason:        input.reason ?? 'Initial creation',
  });

  const { rows } = await pool.query(
    `INSERT INTO agent_lessons
      (agent_id, org_id, category, title, content, status, created_by, applied_from, applied_to, audit_log)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     RETURNING *`,
    [
      body.agent_id, orgId, body.category, body.title, body.content,
      body.status, String(createdBy), body.applied_from, body.applied_to ?? null,
      JSON.stringify([createdAudit]),
    ]
  );
  return { lesson: toApi(rows[0]), content_warning: body.content.length > CONTENT_WARN };
}

async function updateLesson(id, input, user) {
  const existing = await getLesson(id, user);
  if (!existing) return null;

  const body = validateLessonInput(input, { partial: true });
  const updates = {};
  if (body.agent_id !== undefined) updates.agent_id = body.agent_id;
  if (input.organisation_id !== undefined || input.org_id !== undefined || input.orgId !== undefined) {
    updates.org_id = orgParamToDb(input.organisation_id ?? input.org_id ?? input.orgId, user);
  }
  for (const field of ['category', 'title', 'content', 'status', 'applied_from', 'applied_to']) {
    if (body[field] !== undefined) updates[field] = body[field];
  }

  const effectiveFrom = dateOnly(updates.applied_from ?? existing.applied_from);
  if (updates.applied_to && effectiveFrom && dateOnly(updates.applied_to) < effectiveFrom) {
    throw new Error('Applied To must be on or after Applied From.');
  }

  const changed = [];
  const dbToApiField = {
    org_id:       'organisation_id',
    agent_id:     'agent_id',
    applied_from: 'applied_from',
    applied_to:   'applied_to',
  };
  for (const [field, newValue] of Object.entries(updates)) {
    const apiField = dbToApiField[field] ?? field;
    const oldValue = field === 'org_id'
      ? (existing.organisation_id === ALL ? null : existing.organisation_id)
      : (field === 'applied_from' || field === 'applied_to')
          ? dateOnly(existing[apiField])
          : existing[apiField];
    const normalizedOld = oldValue == null ? null : String(oldValue);
    const normalizedNew = newValue == null ? null : String(field === 'applied_from' || field === 'applied_to' ? dateOnly(newValue) : newValue);
    if (normalizedOld !== normalizedNew) {
      changed.push({ field, apiField, oldValue, newValue });
    }
  }

  if (changed.length === 0) return existing;

  const auditEntries = changed.map((c) => auditEntry({
    editedBy:      actorLabel(user),
    field:         c.apiField,
    previousValue: c.oldValue,
    newValue:      c.field === 'org_id' && c.newValue == null ? ALL : c.newValue,
    reason:        input.reason,
  }));

  const setParts = changed.map((c, i) => `${c.field} = $${i + 2}`);
  const values = changed.map((c) => c.newValue);
  values.push(JSON.stringify(auditEntries));

  // Audit entries are appended with JSONB concatenation so prior history is
  // immutable and accumulates across every admin edit.
  const { rows } = await pool.query(
    `UPDATE agent_lessons
        SET ${setParts.join(', ')},
            audit_log = audit_log || $${values.length + 1}::jsonb,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, ...values]
  );
  return toApi(rows[0]);
}

async function deleteLesson(id, user, reason = null) {
  const existing = await getLesson(id, user);
  if (!existing) return false;
  const entry = auditEntry({
    editedBy:      actorLabel(user),
    field:         'deleted_at',
    previousValue: null,
    newValue:      new Date().toISOString(),
    reason:        reason ?? 'Soft delete',
  });
  await pool.query(
    `UPDATE agent_lessons
        SET deleted_at = NOW(),
            status = 'disabled',
            audit_log = audit_log || $2::jsonb,
            updated_at = NOW()
      WHERE id = $1`,
    [id, JSON.stringify([entry])]
  );
  return true;
}

async function listCategories(user) {
  const params = [];
  const clauses = ['deleted_at IS NULL'];
  const access = accessWhere(user, 1);
  clauses.push(access.sql.replace(/\bl\./g, ''));
  params.push(...access.params);
  const { rows } = await pool.query(
    `SELECT DISTINCT category FROM agent_lessons WHERE ${clauses.join(' AND ')} ORDER BY category ASC`,
    params
  );
  return rows.map((r) => r.category);
}

async function loadLessonsForAgent(agentId, organisationId) {
  const today = new Date().toISOString().slice(0, 10);
  // Runtime selection keeps only active, non-deleted lessons whose agent/org
  // scope and applied date window match this run; under-review proposals are excluded.
  const { rows } = await pool.query(
    `SELECT agent_id, org_id, category, title, content, applied_from
       FROM agent_lessons
      WHERE deleted_at IS NULL
        AND status = 'active'
        AND (agent_id = $1 OR agent_id = $2)
        AND (org_id = $3 OR org_id IS NULL)
        AND applied_from <= $4::date
        AND (applied_to IS NULL OR applied_to >= $4::date)
      ORDER BY
        CASE
          WHEN org_id = $3 AND agent_id = $1 THEN 1
          WHEN org_id = $3 AND agent_id = $2 THEN 2
          WHEN org_id IS NULL AND agent_id = $1 THEN 3
          ELSE 4
        END,
        applied_from DESC`,
    [agentId, ALL, organisationId, today]
  );

  if (rows.length === 0) return '';

  const byCategory = new Map();
  for (const row of rows) {
    if (!byCategory.has(row.category)) byCategory.set(row.category, []);
    byCategory.get(row.category).push(row);
  }

  const parts = [
    '## Lessons & Rules Repository',
    'The following active lessons apply to this run. Treat them as behavioural guidance unless they conflict with higher-priority system instructions.',
  ];

  for (const [category, lessons] of byCategory) {
    parts.push(`\n### ${category}`);
    for (const lesson of lessons) {
      const scope = `${lesson.agent_id}/${lesson.org_id == null ? ALL : lesson.org_id}`;
      parts.push(`- **${lesson.title}** (${scope}, from ${lesson.applied_from}):\n${lesson.content}`);
    }
  }

  return parts.join('\n');
}

async function proposeLesson(agentId, organisationId, category, title, content) {
  const body = validateLessonInput({
    agent_id: agentId,
    category,
    title,
    content,
    status: 'under-review',
    applied_from: new Date().toISOString().slice(0, 10),
  });
  const { rows } = await pool.query(
    `INSERT INTO agent_lessons
      (agent_id, org_id, category, title, content, status, created_by, applied_from, audit_log)
     VALUES ($1,$2,$3,$4,$5,'under-review',$1,CURRENT_DATE,$6::jsonb)
     RETURNING id`,
    [
      body.agent_id,
      parseInt(organisationId, 10),
      body.category,
      body.title,
      body.content,
      JSON.stringify([auditEntry({
        editedBy:      agentId,
        field:         'created',
        previousValue: null,
        newValue:      'Agent-proposed lesson awaiting admin review',
        reason:        'agent reflection',
      })]),
    ]
  );
  return rows[0].id;
}

module.exports = {
  ALL,
  CONTENT_WARN,
  isSuperAdmin,
  listLessons,
  getLesson,
  createLesson,
  updateLesson,
  deleteLesson,
  listCategories,
  loadLessonsForAgent,
  proposeLesson,
};
