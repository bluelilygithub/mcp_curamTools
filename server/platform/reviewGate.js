'use strict';

function evaluateSpecCertificateGate(runResult = {}) {
  const data = runResult.data ?? runResult;
  const findings = Array.isArray(data.all_findings) ? data.all_findings : [];

  if (findings.length === 0) {
    return {
      allowed: false,
      reason: 'No findings are available for certificate export.',
      counts: { pending: 0, rejected: 0, resubmit: 0, total: 0 },
    };
  }

  const counts = {
    pending: findings.filter((finding) => finding.status === 'pending_review').length,
    rejected: findings.filter((finding) => finding.status === 'rejected').length,
    resubmit: findings.filter((finding) => finding.status === 'resubmit').length,
    total: findings.length,
  };

  if (counts.pending > 0 || counts.rejected > 0 || counts.resubmit > 0) {
    return {
      allowed: false,
      reason: `Certificate blocked: ${counts.pending} pending, ${counts.rejected} rejected, ${counts.resubmit} resubmit.`,
      counts,
    };
  }

  return {
    allowed: true,
    reason: 'All findings are reviewed and certificate export is allowed.',
    counts,
  };
}

module.exports = {
  evaluateSpecCertificateGate,
};
