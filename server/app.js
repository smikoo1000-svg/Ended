import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, isEnabled } from './providers/index.js';
import { SORTS } from './search.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MAX_QUERY_LENGTH = 100;
const CATEGORY_IDS = new Set(['all', ...CATEGORIES.map((c) => c.id)]);

// 외부 스토어 API를 보호하기 위한 IP별 간단한 요청 제한 (분당 limit회).
function rateLimit({ limit = 30, windowMs = 60_000, now = Date.now } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const t = now();
    const entry = hits.get(req.ip);
    if (!entry || t - entry.start >= windowMs) {
      hits.set(req.ip, { start: t, count: 1 });
      if (hits.size > 10_000) {
        for (const [ip, e] of hits) if (t - e.start >= windowMs) hits.delete(ip);
      }
      return next();
    }
    entry.count += 1;
    if (entry.count > limit) {
      res.set('retry-after', String(Math.ceil((entry.start + windowMs - t) / 1000)));
      return res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
    }
    next();
  };
}

export function createApp({ searchService, env = {}, demo = false, rateLimitPerMinute = 30 }) {
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', env.TRUST_PROXY);

  app.use((req, res, next) => {
    res.set({
      'content-security-policy':
        "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    });
    next();
  });

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.get('/api/meta', (req, res) => {
    res.json({
      demo,
      categories: CATEGORIES,
      sorts: SORTS,
      sources: searchService.providers.map((p) => ({
        id: p.id,
        name: p.name,
        categories: p.categories,
        enabled: isEnabled(p, env),
      })),
    });
  });

  app.get('/api/search', rateLimit({ limit: rateLimitPerMinute }), async (req, res, next) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const category = typeof req.query.category === 'string' ? req.query.category : 'all';
    const sort = typeof req.query.sort === 'string' ? req.query.sort : 'relevance';

    if (!query) return res.status(400).json({ error: '검색어를 입력해 주세요.' });
    if (query.length > MAX_QUERY_LENGTH) return res.status(400).json({ error: `검색어는 ${MAX_QUERY_LENGTH}자까지 입력할 수 있습니다.` });
    if (!CATEGORY_IDS.has(category)) return res.status(400).json({ error: '알 수 없는 분류입니다.' });
    if (!SORTS.includes(sort)) return res.status(400).json({ error: '알 수 없는 정렬 방식입니다.' });

    try {
      const result = await searchService.search({ query, category, sort, excludeFree: req.query.excludeFree === '1' });
      res.set('cache-control', 'no-store');
      res.json({ ...result, demo });
    } catch (error) {
      next(error);
    }
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'], maxAge: '1h' }));

  app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  });

  return app;
}
