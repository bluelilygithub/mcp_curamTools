'use strict';

const DATA_GAP_AGENT_SLUGS = new Set([
  'ads-copy-diagnostic',
  'ads-copy-playbook',
  'ads-copy-gate',
  'google-ads-monitor',
  'keyword-opportunity',
  'ai-visibility-monitor',
]);

function normaliseSourceId(value) {
  return String(value ?? '')
    .replace(/[`*_]/g, '')
    .trim()
    .toLowerCase();
}

function inferRowCount(result) {
  if (Array.isArray(result)) return result.length;
  if (!result || typeof result !== 'object') return null;
  if (typeof result.resultRowCount === 'number') return result.resultRowCount;
  if (typeof result.rowCount === 'number') return result.rowCount;

  const candidateKeys = ['rows', 'data', 'items', 'results', 'records', 'campaigns', 'keywords', 'searchTerms'];
  for (const key of candidateKeys) {
    if (Array.isArray(result[key])) return result[key].length;
  }

  return null;
}

function summariseDataGapSource(result) {
  if (result && typeof result === 'object' && (
    Object.prototype.hasOwnProperty.call(result, 'resultWasEmpty') ||
    Object.prototype.hasOwnProperty.call(result, 'resultHadError')
  )) {
    return result;
  }

  const resultHadError = !!(result && typeof result === 'object' && result.error);
  const resultRowCount = inferRowCount(result);
  const resultWasEmpty = !resultHadError && resultRowCount === 0;
  const type = Array.isArray(result) ? 'array' : result === null ? 'null' : typeof result;
  const keys = result && typeof result === 'object' && !Array.isArray(result)
    ? Object.keys(result).slice(0, 20)
    : [];

  return {
    type,
    resultRowCount,
    resultWasEmpty,
    resultHadError,
    error: resultHadError ? String(result.error) : null,
    keys,
  };
}

function summariseDataGapSources(sources = {}) {
  return Object.fromEntries(
    Object.entries(sources).map(([sourceId, result]) => [sourceId, summariseDataGapSource(result)])
  );
}

function extractDataGaps(text) {
  if (!text) return { sectionPresent: false, gaps: [] };

  const lines = String(text).split('\n');
  const startIndex = lines.findIndex((line) => (
    /^(?:#{1,6}\s*)?(?:\d+[.)]\s*)?Data Gaps\s*:?\s*$/i.test(line.trim())
  ));
  if (startIndex === -1) return { sectionPresent: false, gaps: [] };

  const bodyLines = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const isNextHeading =
      /^(?:#{1,6}\s+)\S/.test(trimmed) ||
      /^(?:\d+[.)]\s+)[A-Z][A-Za-z0-9 &/-]+$/.test(trimmed);

    if (isNextHeading) break;
    bodyLines.push(line);
  }

  const body = bodyLines.join('\n').trim();
  if (!body || /no data gaps detected/i.test(body)) {
    return { sectionPresent: true, gaps: [] };
  }

  const gaps = body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.match(/^(?:[-*]|\d+[.)])\s+(.*)$/)?.[1]?.trim())
    .filter(Boolean)
    .map((item) => {
      const [sourcePart, ...rest] = item.split(':');
      const source = rest.length > 0
        ? sourcePart.replace(/[`*]/g, '').trim()
        : 'data_gaps';
      const statement = rest.length > 0 ? rest.join(':').trim() : item;
      return { source, statement };
    });

  return { sectionPresent: true, gaps };
}

function findDeclaredGapForSource(gaps, sourceId) {
  const normalisedSource = normaliseSourceId(sourceId);
  return gaps.find((gap) => normaliseSourceId(gap.source) === normalisedSource);
}

function buildDataGapReview({ slug, summary, evidenceSources = {} }) {
  if (!DATA_GAP_AGENT_SLUGS.has(slug)) {
    return { applies: false, dataGaps: [], dataGapReview: null, boundsFailed: [] };
  }

  const { sectionPresent, gaps } = extractDataGaps(summary);
  const boundsFailed = [];
  const confirmedGaps = [];
  const silentGaps = [];
  const fabricatedGaps = [];

  if (!sectionPresent) {
    boundsFailed.push({
      tool: 'data_gaps',
      category: 'missing_gap_section',
      severity: 'review',
      message: 'Required Data Gaps section was missing from the agent output.',
    });
  }

  for (const [sourceId, source] of Object.entries(evidenceSources)) {
    const declared = findDeclaredGapForSource(gaps, sourceId);
    const weakSource = !!source?.resultHadError || !!source?.resultWasEmpty;

    if (weakSource && declared) {
      confirmedGaps.push({ source: sourceId, statement: declared.statement, evidence: source });
    } else if (weakSource && !declared) {
      const message = source?.resultHadError
        ? (source.reviewMessage ?? `Source returned an error but was not acknowledged in Data Gaps: ${source.error ?? 'unknown error'}`)
        : (source.reviewMessage ?? 'Source returned no rows but was not acknowledged in Data Gaps.');
      const gap = {
        source: sourceId,
        label: source?.label ?? sourceId,
        message,
        evidence: source,
        details: source?.details ?? [],
        action: source?.action ?? null,
        evidenceLevel: source?.evidenceLevel ?? null,
      };
      silentGaps.push(gap);
      boundsFailed.push({
        tool: sourceId,
        label: source?.label ?? sourceId,
        category: 'silent_data_gap',
        severity: 'review',
        message,
        details: source?.details ?? [],
        action: source?.action ?? null,
        evidenceLevel: source?.evidenceLevel ?? null,
      });
    }
  }

  return {
    applies: true,
    dataGaps: gaps,
    dataGapReview: {
      sectionPresent,
      checkedSources: evidenceSources,
      confirmedGaps,
      silentGaps,
      fabricatedGaps,
    },
    boundsFailed,
  };
}

module.exports = {
  DATA_GAP_AGENT_SLUGS,
  summariseDataGapSource,
  summariseDataGapSources,
  extractDataGaps,
  buildDataGapReview,
};
