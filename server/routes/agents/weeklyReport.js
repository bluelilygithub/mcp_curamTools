/**
 * Weekly Performance Report agent route.
 */

const { createAgentRoute } = require('../../platform/createAgentRoute');
const { runWeeklyReport } = require('../../agents/weekly-report/index');

const weeklyReportRouter = createAgentRoute({
  slug: 'weekly-report',
  runFn: runWeeklyReport,
  requiredPermission: 'member',
});

module.exports = { weeklyReportRouter };