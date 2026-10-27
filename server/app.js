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

function parseSearchParams(query) {
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  const category = typeof query.category === 'string' ? query.category : 'all';
  const sort = typeof query.sort === 'string' ? query.sort : 'price';

  if (!q) return { error: '검색어를 입력해 주세요.' };
  if (q.length > MAX_QUERY_LENGTH) return { error: `검색어는 ${MAX_QUERY_LENGTH}자까지 입력할 수 있습니다.` };
  if (!CATEGORY_IDS.has(category)) return { error: '알 수 없는 분류입니다.' };
  if (!SORTS.includes(sort)) return { error: '알 수 없는 정렬 방식입니다.' };
  return { query: q, category, sort, excludeFree: query.excludeFree === '1' };
}

export function createApp({ searchService, directory = null, env = {}, demo = false, rateLimitPerMinute = 30 }) {
  const app = express();
  app.disable('x-powered-by');
  const limiter = rateLimit({ limit: rateLimitPerMinute });
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

  app.get('/api/stores', (req, res) => {
    if (!directory) return res.status(404).json({ error: '스토어 목록이 없습니다.' });
    res.set('cache-control', 'public, max-age=3600');
    res.json(directory);
  });

  // 모든 스토어 검색이 끝난 뒤 한 번에 응답한다. AI 웹 검색이 켜져 있으면 수십 초 걸릴 수 있다.
  app.get('/api/search', limiter, async (req, res, next) => {
    const params = parseSearchParams(req.query);
    if (params.error) return res.status(400).json({ error: params.error });
    try {
      const result = await searchService.search(params);
      res.set('cache-control', 'no-store');
      res.json({ ...result, demo });
    } catch (error) {
      next(error);
    }
  });

  // Server-Sent Events: 스토어 하나가 끝날 때마다 지금까지 모인 결과(update)를, 마지막에 전체 결과(done)를 보낸다.
  app.get('/api/search/stream', limiter, async (req, res) => {
    const params = parseSearchParams(req.query);
    if (params.error) return res.status(400).json({ error: params.error });

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    let closed = false;
    res.on('close', () => {
      closed = true;
    });
    const send = (event, data) => {
      if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const heartbeat = setInterval(() => !closed && res.write(': ping\n\n'), 15_000);

    try {
      const result = await searchService.search(params, (partial) => send('update', { ...partial, demo }));
      send('done', { ...result, demo });
    } catch (error) {
      console.error(error);
      send('fail', { error: '서버 오류가 발생했습니다.' });
    } finally {
      clearInterval(heartbeat);
      res.end();
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
