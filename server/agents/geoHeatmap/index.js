'use strict';

const https = require('https');
const { agentOrchestrator }  = require('../../platform/AgentOrchestrator');
const AgentConfigService     = require('../../platform/AgentConfigService');
const { getWordPressServer, callMcpTool } = require('../../platform/mcpTools');
const { buildSystemPrompt }  = require('./prompt');
const { pool }               = require('../../db');

const TOOL_SLUG = 'geo-heatmap';

// Nominatim rate limit: 1 req/sec
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: { 'User-Agent': 'mcp-curamtools/1.0 (admin@bluelily.com.au)' },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Nominatim JSON parse failed: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function geocodeSuburb(suburb, postcode, state, address) {
  // Normalise inputs — cache key is lowercase+trimmed so "BLACK ROCK" and "Black Rock" share one entry
  const s  = (suburb   || '').trim().toLowerCase();
  const pc = (postcode || '').trim();
  const st = (state    || '').trim().toLowerCase();
  const ad = (address  || '').trim().toLowerCase();

  let query;
  if (s && st)  query = `${s}, ${st}, Australia`;
  else if (s)   query = `${s}, Australia`;
  else if (pc)  query = `${pc}, Australia`;
  else if (ad)  query = `${ad}, Australia`;
  else          return { coords: null, fromCache: false };

  // Check cache
  const cached = await pool.query(
    'SELECT lat, lng FROM geocode_cache WHERE query = $1',
    [query]
  );
  if (cached.rows.length > 0) {
    const { lat, lng } = cached.rows[0];
    return { coords: lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : null, fromCache: true };
  }

  // Nominatim lookup
  const encoded = encodeURIComponent(query);
  const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&countrycodes=au&limit=1`;

  let lat = null, lng = null;
  try {
    const results = await httpsGet(url);
    if (results && results.length > 0) {
      lat = parseFloat(results[0].lat);
      lng = parseFloat(results[0].lon);
    }
  } catch (e) {
    console.warn('[geo-heatmap] Nominatim error for', query, e.message);
  }

  // Store result in cache (null result also cached to avoid repeat misses)
  await pool.query(
    'INSERT INTO geocode_cache (query, lat, lng) VALUES ($1, $2, $3) ON CONFLICT (query) DO NOTHING',
    [query, lat, lng]
  );

  return { coords: lat && lng ? { lat, lng } : null, fromCache: false };
}

async function runGeoHeatmap(context) {
  const { orgId, req, emit } = context;

  const adminConfig = Object.keys(context.adminConfig ?? {}).length > 0
    ? context.adminConfig
    : await AgentConfigService.getAdminConfig(TOOL_SLUG);

  const model         = context.req?.body?.model || adminConfig.model || 'claude-sonnet-4-6';
  const startDate     = req?.body?.startDate ?? null;
  const endDate       = req?.body?.endDate   ?? null;

  if (!startDate || !endDate) {
    throw new Error('startDate and endDate are required.');
  }

  emit('Fetching CRM enquiries…');

  const wpServer = await getWordPressServer(orgId);
  const rawEnquiries = await callMcpTool(orgId, wpServer, 'wp_get_enquiries', {
    start_date: startDate,
    end_date:   endDate,
    limit:      3000,
  }).catch((e) => { throw new Error('CRM fetch failed: ' + e.message); });

  const enquiries = Array.isArray(rawEnquiries) ? rawEnquiries : [];
  emit(`${enquiries.length} enquiries loaded. Grouping by suburb/postcode…`);

  // Group into two buckets
  const notInterestedMap = {};
  const activeMap        = {};

  for (const enq of enquiries) {
    const suburb   = (enq.suburb   || '').trim().toLowerCase();
    const postcode = (enq.postcode || '').trim();
    const state    = (enq.state    || '').trim().toLowerCase();
    const address  = (enq.address  || '').trim().toLowerCase();
    if (!suburb && !postcode && !address) continue;

    const key = `${suburb}|${postcode}|${state}|${address}`;
    const isNI = enq.reason_not_interested && String(enq.reason_not_interested).trim() !== '';

    if (isNI) {
      notInterestedMap[key] = (notInterestedMap[key] || 0) + 1;
    } else {
      activeMap[key] = (activeMap[key] || 0) + 1;
    }
  }

  // Collect all unique suburb/postcode combos that need geocoding
  const allKeys = new Set([...Object.keys(notInterestedMap), ...Object.keys(activeMap)]);
  const geocoded = {};

  emit(`Geocoding ${allKeys.size} unique locations…`);

  let i = 0;
  for (const key of allKeys) {
    const [suburb, postcode, state, address] = key.split('|');
    const { coords, fromCache } = await geocodeSuburb(suburb, postcode, state, address);
    geocoded[key] = coords;
    i++;
    if (i % 10 === 0) emit(`Geocoded ${i}/${allKeys.size}…`);
    if (!fromCache) await sleep(1100); // Nominatim 1 req/sec limit (skip for cache hits)
  }

  // Build merged locations array
  const locMap = {};
  for (const key of allKeys) {
    const coords = geocoded[key];
    if (!coords) continue;
    const [suburb, postcode, state] = key.split('|');
    locMap[key] = {
      suburb:        suburb   || null,
      postcode:      postcode || null,
      state:         state    || null,
      lat:           coords.lat,
      lng:           coords.lng,
      notInterested: notInterestedMap[key] || 0,
      active:        activeMap[key]        || 0,
    };
  }

  const locations = Object.values(locMap);
  const notInterestedTotal = Object.values(notInterestedMap).reduce((s, n) => s + n, 0);
  const activeTotal        = Object.values(activeMap).reduce((s, n) => s + n, 0);
  const geocodedCount      = locations.length;
  const skippedCount       = allKeys.size - geocodedCount;

  emit(`Geocoding complete: ${geocodedCount} located, ${skippedCount} skipped. Generating observations…`);

  // Sort top 20 each for Claude context
  const topNI = [...locations]
    .filter((l) => l.notInterested > 0)
    .sort((a, b) => b.notInterested - a.notInterested)
    .slice(0, 20);
  const topActive = [...locations]
    .filter((l) => l.active > 0)
    .sort((a, b) => b.active - a.active)
    .slice(0, 20);

  const payload = {
    period:              `${startDate} to ${endDate}`,
    totalEnquiries:      enquiries.length,
    notInterestedTotal,
    activeTotal,
    geocodedLocations:   geocodedCount,
    geocodingNote:       skippedCount > 0
      ? `${skippedCount} suburb/postcode combinations could not be matched by Nominatim — geocoding limitation, not missing CRM data.`
      : 'All locations geocoded successfully.',
    topNotInterested:    topNI,
    topActive,
  };

  const userMessage =
    `Analyse the geographic lead distribution for ${startDate} to ${endDate}.\n\n` +
    `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(adminConfig),
    userMessage,
    tools:         [],
    maxIterations: 1,
    model,
    maxTokens:     adminConfig.max_tokens     ?? 2048,
    fallbackModel: adminConfig.fallback_model ?? null,
    onStep:        emit,
    context:       { ...context, toolSlug: TOOL_SLUG },
  });

  return {
    result: {
      summary: result?.summary ?? '',
      data: {
        locations,
        notInterestedTotal,
        activeTotal,
        geocodedCount,
        skippedCount,
      },
    },
    trace,
    tokensUsed,
  };
}

module.exports = { runGeoHeatmap };
