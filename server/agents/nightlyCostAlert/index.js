'use strict';

const AgentConfigService = require('../../platform/AgentConfigService');
const CostGuardService   = require('../../services/CostGuardService');
const EmailService       = require('../../services/EmailService');
const { pool }           = require('../../db');

const APP_URL = process.env.APP_URL || 'https://mcpcuramtools-production.up.railway.app';

const WARN_PCT  = 0.80;  // 80% — warning
const CRIT_PCT  = 1.00;  // 100% — critical / hard stop

async function getAdminEmails(orgId) {
  const res = await pool.query(
    `SELECT u.email
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r       ON r.id = ur.role_id
      WHERE u.org_id = $1
        AND r.name   = 'org_admin'
        AND u.email IS NOT NULL`,
    [orgId]
  );
  return res.rows.map((r) => r.email);
}

function buildEmail(level, spendAud, budgetAud) {
  const pct     = Math.round((spendAud / budgetAud) * 100);
  const colour  = level === 'critical' ? '#dc2626' : '#d97706';
  const label   = level === 'critical' ? 'CRITICAL — Daily Budget Reached' : 'Warning — 80% of Daily Budget Used';
  const subject = `[CuramTools] Cost Alert: ${pct}% of daily budget used`;

  const html = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
  <div style="background:${colour};color:#fff;padding:12px 20px;border-radius:8px;margin-bottom:24px">
    <strong>${label}</strong>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr>
      <td style="padding:8px 0;color:#6b7280">Today's spend</td>
      <td style="padding:8px 0;font-weight:600;text-align:right">$${spendAud.toFixed(2)} AUD</td>
    </tr>
    <tr>
      <td style="padding:8px 0;color:#6b7280">Daily ceiling</td>
      <td style="padding:8px 0;font-weight:600;text-align:right">$${budgetAud.toFixed(2)} AUD</td>
    </tr>
    <tr style="border-top:1px solid #e5e7eb">
      <td style="padding:8px 0;color:#6b7280">Used</td>
      <td style="padding:8px 0;font-weight:700;color:${colour};text-align:right">${pct}%</td>
    </tr>
  </table>
  <p style="font-size:13px;color:#6b7280;margin-top:20px">
    ${level === 'critical'
      ? 'New agent runs are blocked until tomorrow (UTC) or the ceiling is raised.'
      : 'Runs are still allowed. If spend continues at this pace the ceiling will be hit today.'}
  </p>
  <a href="${APP_URL}/admin/usage"
     style="display:inline-block;margin-top:16px;padding:10px 20px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-size:14px">
    View usage dashboard →
  </a>
</div>`;

  const text = `${label}\n\nToday's spend: $${spendAud.toFixed(2)} AUD\nDaily ceiling: $${budgetAud.toFixed(2)} AUD\nUsed: ${pct}%\n\n${APP_URL}/admin/usage`;

  return { subject, html, text };
}

async function runNightlyCostAlert(context) {
  const { orgId, emit } = context;

  emit('Checking daily spend vs budget ceiling…');

  const [budgetSettings, dailySpendAud, adminEmails] = await Promise.all([
    AgentConfigService.getOrgBudgetSettings(orgId),
    CostGuardService.getDailyOrgSpendAud(orgId),
    getAdminEmails(orgId),
  ]);

  const budgetAud = budgetSettings.max_daily_org_budget_aud;

  if (budgetAud == null) {
    emit('No daily budget ceiling configured — nothing to check.');
    return {
      result: {
        summary:       'No daily budget ceiling configured.',
        alertLevel:    'none',
        dailySpendAud,
        budgetAud:     null,
        alertsSent:    0,
      },
    };
  }

  const ratio     = dailySpendAud / budgetAud;
  const alertLevel = ratio >= CRIT_PCT ? 'critical' : ratio >= WARN_PCT ? 'warning' : 'none';

  emit(`Spend: $${dailySpendAud.toFixed(2)} / $${budgetAud.toFixed(2)} AUD (${Math.round(ratio * 100)}%) — ${alertLevel}`);

  let alertsSent = 0;

  if (alertLevel !== 'none') {
    if (adminEmails.length === 0) {
      emit('No org admin emails found — alert not delivered.');
    } else {
      const { subject, html, text } = buildEmail(alertLevel, dailySpendAud, budgetAud);
      for (const email of adminEmails) {
        await EmailService.send({ to: email, subject, html, text });
        alertsSent++;
      }
      emit(`Alert sent to ${alertsSent} admin(s).`);
    }
  }

  return {
    result: {
      summary:       alertLevel === 'none'
        ? `Spend $${dailySpendAud.toFixed(2)} AUD — within budget.`
        : `${alertLevel.toUpperCase()}: $${dailySpendAud.toFixed(2)} / $${budgetAud.toFixed(2)} AUD. Alert sent to ${alertsSent} admin(s).`,
      alertLevel,
      dailySpendAud,
      budgetAud,
      pctUsed:       Math.round(ratio * 100),
      alertsSent,
      adminEmails,
    },
  };
}

module.exports = { runNightlyCostAlert };
