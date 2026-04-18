'use strict';

/**
 * In-process sliding window rate limiter.
 * No external dependency — uses a Map keyed by identity string.
 *
 * Usage:
 *   const limiter = createRateLimiter({ windowMs: 60_000, max: 20 });
 *   router.post('/path', limiter, handler);
 *
 * Identity defaults to req.user.id when available, falling back to IP.
 */

function createRateLimiter({ windowMs = 60_000, max = 20, keyFn } = {}) {
  const store = new Map(); // key → [timestamp, ...]

  // Prune stale entries every windowMs to avoid unbounded growth
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, hits] of store) {
      const recent = hits.filter((t) => t > cutoff);
      if (recent.length === 0) store.delete(key);
      else store.set(key, recent);
    }
  }, windowMs).unref();

  return function rateLimitMiddleware(req, res, next) {
    const key = keyFn
      ? keyFn(req)
      : (req.user?.id ?? req.ip ?? 'unknown');

    const now = Date.now();
    const cutoff = now - windowMs;
    const hits = (store.get(key) ?? []).filter((t) => t > cutoff);

    if (hits.length >= max) {
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', 0);
      res.setHeader('X-RateLimit-Reset', new Date(now + windowMs).toISOString());
      return res.status(429).json({
        error: `Too many requests. Limit is ${max} per ${windowMs / 1000}s.`,
      });
    }

    hits.push(now);
    store.set(key, hits);
    
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', max - hits.length);
    res.setHeader('X-RateLimit-Reset', new Date(now + windowMs).toISOString());
    next();
  };
}

/**
 * Auth-specific rate limiter for login, register, password reset endpoints.
 * Limits to 5 attempts per 15 minutes per IP:email combination.
 */
function createAuthRateLimiter() {
  return createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    keyFn: (req) => {
      const email = req.body?.email?.toLowerCase()?.trim() || 'unknown';
      return `${req.ip}:${email}`;
    },
  });
}

module.exports = { createRateLimiter, createAuthRateLimiter };
