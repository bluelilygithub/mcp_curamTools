'use strict';

/**
 * Starter app — minimal agent manifest.
 * Agent implementation lives in ./agents/ (appModule) not server/agents/.
 */

module.exports = [
  {
    slug:       'starter-hello',
    appModule:  'starter/agents/hello',
    export:     'runStarterHello',
    permission: 'org_member',
    rateLimit:  10,
  },
];
