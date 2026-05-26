export function evaluateSpecCertificateGate(runResult = {}) {
  const findings = Array.isArray(runResult.all_findings) ? runResult.all_findings : [];

  const counts = {
    pending: findings.filter((finding) => finding.status === 'pending_review').length,
    rejected: findings.filter((finding) => finding.status === 'rejected').length,
    resubmit: findings.filter((finding) => finding.status === 'resubmit').length,
    total: findings.length,
  };

  const allowed = findings.length > 0 && counts.pending === 0 && counts.rejected === 0 && counts.resubmit === 0;
  return {
    allowed,
    reason: allowed
      ? 'All findings are reviewed and certificate export is allowed.'
      : `Certificate blocked: ${counts.pending} pending, ${counts.rejected} rejected, ${counts.resubmit} resubmit.`,
    counts,
  };
}
