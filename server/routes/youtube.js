'use strict';

/**
 * YouTube search, history, and favourites.
 *
 * Routes:
 *   GET    /search              — Search YouTube videos (saves to history)
 *   GET    /history             — User's recent searches (last 30)
 *   DELETE /history/:id         — Remove a history entry
 *   GET    /favourites          — User's saved videos
 *   POST   /favourites          — Save a video
 *   DELETE /favourites/:videoId — Remove a saved video
 *
 * Env: YOUTUBE_API_KEY
 */

const https   = require('https');
const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();
router.use(requireAuth);

function getKey() {
  const k = process.env.YOUTUBE_API_KEY;
  if (!k) throw new Error('YOUTUBE_API_KEY not configured');
  return k;
}

function ytGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://www.googleapis.com${path}`);
    const req = https.request(
      { hostname: url.hostname, path: url.pathname + url.search, method: 'GET', headers: { Accept: 'application/json' } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            if (res.statusCode >= 400) {
              reject(new Error(json.error?.message || `YouTube API error HTTP ${res.statusCode}`));
            } else {
              resolve(json);
            }
          } catch {
            reject(new Error('Invalid response from YouTube API'));
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// ── Search ────────────────────────────────────────────────────────────────────

router.get('/search', async (req, res) => {
  const { q, order = 'relevance', duration = 'any', publishedAfter } = req.query;
  if (!q?.trim()) return res.status(400).json({ error: 'Query is required.' });

  let key;
  try { key = getKey(); } catch (e) { return res.status(500).json({ error: e.message }); }

  try {
    const searchParams = new URLSearchParams({
      part: 'snippet',
      q: q.trim(),
      type: 'video',
      order,
      maxResults: '20',
      safeSearch: 'moderate',
      key,
    });
    if (duration && duration !== 'any') searchParams.set('videoDuration', duration);
    if (publishedAfter) searchParams.set('publishedAfter', publishedAfter);

    const searchData = await ytGet(`/youtube/v3/search?${searchParams}`);
    const items = searchData.items ?? [];

    if (!items.length) {
      await pool.query(
        `INSERT INTO youtube_search_history (user_id, org_id, query, filters, result_count) VALUES ($1,$2,$3,$4,$5)`,
        [req.user.id, req.user.orgId, q.trim(), JSON.stringify({ order, duration, publishedAfter: publishedAfter || null }), 0]
      );
      return res.json({ videos: [], totalResults: 0 });
    }

    const videoIds = items.map((i) => i.id.videoId).filter(Boolean).join(',');
    const detailsData = await ytGet(`/youtube/v3/videos?part=contentDetails,statistics&id=${encodeURIComponent(videoIds)}&key=${encodeURIComponent(key)}`);

    const detailsMap = {};
    for (const v of (detailsData.items ?? [])) {
      detailsMap[v.id] = {
        duration:  v.contentDetails?.duration,
        viewCount: v.statistics?.viewCount,
      };
    }

    const videos = items
      .filter((i) => i.id?.videoId)
      .map((item) => {
        const id = item.id.videoId;
        const s  = item.snippet;
        return {
          id,
          title:       s.title,
          description: s.description,
          channel:     s.channelTitle,
          publishedAt: s.publishedAt,
          thumbnail:   s.thumbnails?.medium?.url || s.thumbnails?.default?.url,
          duration:    detailsMap[id]?.duration,
          viewCount:   detailsMap[id]?.viewCount,
        };
      });

    await pool.query(
      `INSERT INTO youtube_search_history (user_id, org_id, query, filters, result_count) VALUES ($1,$2,$3,$4,$5)`,
      [req.user.id, req.user.orgId, q.trim(), JSON.stringify({ order, duration, publishedAfter: publishedAfter || null }), videos.length]
    );

    res.json({ videos, totalResults: searchData.pageInfo?.totalResults ?? videos.length });
  } catch (err) {
    console.error('[youtube/search]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── History ───────────────────────────────────────────────────────────────────

router.get('/history', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, query, filters, result_count, created_at
       FROM youtube_search_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 30`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[youtube/history]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/history/:id', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM youtube_search_history WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Favourites ────────────────────────────────────────────────────────────────

router.get('/favourites', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT video_id, title, channel, thumbnail, duration, view_count, published_at, created_at
       FROM youtube_favourites
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/favourites', async (req, res) => {
  const { videoId, title, channel, thumbnail, duration, viewCount, publishedAt } = req.body;
  if (!videoId) return res.status(400).json({ error: 'videoId required.' });
  try {
    await pool.query(
      `INSERT INTO youtube_favourites (user_id, org_id, video_id, title, channel, thumbnail, duration, view_count, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (user_id, video_id) DO NOTHING`,
      [req.user.id, req.user.orgId, videoId, title, channel || null, thumbnail || null, duration || null, viewCount || null, publishedAt || null]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/favourites/:videoId', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM youtube_favourites WHERE user_id = $1 AND video_id = $2',
      [req.user.id, req.params.videoId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
