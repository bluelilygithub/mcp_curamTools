'use strict';

/**
 * Engineering app — agent manifest (demo suite, specs, tenders).
 */

module.exports = [
  {
    slug:       'demo-spec-anomaly-investigator',
    module:     'demoSpecAnomalyInvestigator',
    export:     'runDemoSpecAnomalyInvestigator',
    permission: 'org_member',
    rateLimit:  3,
  },
  {
    slug:       'demo-document-analyzer',
    module:     'demoSuite/documentAnalyzer',
    export:     'runDocumentAnalyzer',
    permission: 'org_member',
    rateLimit:  20,
  },
  {
    slug:       'spec-validator',
    module:     'specValidator/index',
    export:     'runSpecValidator',
    permission: 'org_member',
    rateLimit:  10,
  },
  {
    slug:       'demo-spec-validator',
    module:     'specValidator/index',
    export:     'runSpecValidator',
    permission: 'org_member',
    rateLimit:  20,
  },
  {
    slug:       'demo-tender-response',
    module:     'demoSuite/tenderResponse',
    export:     'runTenderResponse',
    permission: 'org_member',
    rateLimit:  10,
  },
];
