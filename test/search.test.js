import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createSearchService } from '../server/search.js';
import { allProviders } from '../server/providers/index.js';
import { resetStoreNames } from '../server/providers/cheapshark.js';
import { fixedRates, recordingFetch } from './helpers.js';

beforeEach(() => resetStoreNames());

function service(options = {}) {
  const { fetchJson, calls } = recordingFetch(options.overrides);
  const svc = createSearchService({
    providers: allProviders,
    fetchJson,
    rateService: fixedRates,
    env: { ITAD_API_KEY: 'k', GOOGLE_BOOKS_API_KEY: 'k' },
    strictMatch: true,
    ...options,
  });
  return { svc, calls };
}

test('the same game from several stores becomes one result with the cheapest offer first', async () => {
  const { svc } = service();
  const data = await svc.search({ query: 'hades', category: 'game' });

  const hades = data.results.find((g) => g.title === 'Hades');
  // 원화 환산 기준: Steam KR ₩10,800 < Fanatical $8.24(₩11,536) < GOG $8.99(₩12,586) < …
  const prices = hades.offers.map((o) => o.priceKRW);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  assert.equal(hades.best.store, 'Steam');
  assert.equal(hades.best.priceKRW, 10800);
  assert.equal(hades.best.discountPercent, 60);
  assert.equal(hades.best.converted, false);

  // GOG는 CheapShark($9.99)와 ITAD($8.99) 양쪽에서 잡히지만 더 싼 한 개만 남는다.
  const gog = hades.offers.filter((o) => o.store === 'GOG');
  assert.equal(gog.length, 1);
  assert.equal(gog[0].priceKRW, Math.round(8.99 * 1400));
  assert.equal(gog[0].converted, true);

  assert.equal(hades.storeCount, hades.offers.length);
  assert.equal(hades.historyLowKRW, 6750);
});

test('relevance sort puts the exact title before DLC and bundles', async () => {
  const { svc } = service();
  const data = await svc.search({ query: 'elden ring', category: 'game' });
  assert.equal(data.results[0].title, 'ELDEN RING');
  assert.equal(data.results[1].title, 'ELDEN RING Shadow of the Erdtree');
});

test('price sort orders full matches by their lowest price', async () => {
  const { svc } = service();
  const data = await svc.search({ query: 'elden ring', category: 'game', sort: 'price' });
  const prices = data.results.map((g) => g.best.priceKRW);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  // CheapShark GMG $33.99 → ₩47,586 이 Steam KR ₩44,800 보다 비싸므로 Steam이 최저가.
  assert.equal(data.results[0].best.store, 'Steam');
});

test('discount sort uses the biggest discount in each group', async () => {
  const { svc } = service();
  const data = await svc.search({ query: 'hollow knight cyberpunk hades', category: 'game', sort: 'discount' });
  const discounts = data.results.map((g) => g.maxDiscount);
  assert.deepEqual(discounts, [...discounts].sort((a, b) => b - a));
});

test('category "all" searches every enabled provider and reports each status', async () => {
  const { svc } = service();
  const data = await svc.search({ query: 'dune' });
  const ids = data.sources.map((s) => s.id);
  assert.deepEqual(ids, allProviders.map((p) => p.id));
  assert.ok(data.sources.every((s) => s.status === 'ok'));

  const categories = new Set(data.results.map((g) => g.category));
  for (const c of ['ebook', 'audiobook', 'movie', 'music']) assert.ok(categories.has(c), c);

  const ebook = data.results.find((g) => g.category === 'ebook' && g.title === 'Dune');
  assert.deepEqual(ebook.offers.map((o) => o.store), ['Google Play 도서', 'Apple Books']);

  const movie = data.results.find((g) => g.category === 'movie' && g.title === 'Dune');
  assert.equal(movie.best.priceKRW, 8800);
  assert.equal(movie.best.rentalKRW, 3300);
});

test('a category only calls providers for that category', async () => {
  const { svc, calls } = service();
  const data = await svc.search({ query: 'procreate', category: 'app' });
  assert.deepEqual(data.sources.map((s) => s.id), ['appstore']);
  assert.ok(calls.every((c) => c.url.hostname === 'itunes.apple.com'));
});

test('providers without a key are reported as disabled and not called', async () => {
  const { svc, calls } = service({ env: {} });
  const data = await svc.search({ query: 'hades', category: 'game' });
  const itad = data.sources.find((s) => s.id === 'itad');
  assert.equal(itad.status, 'disabled');
  assert.match(itad.message, /ITAD_API_KEY/);
  assert.ok(!calls.some((c) => c.url.hostname === 'api.isthereanydeal.com'));
});

test('one failing store does not break the search', async () => {
  const { svc } = service({
    overrides: {
      'store.steampowered.com': () => {
        throw Object.assign(new Error('HTTP 503'), { status: 503 });
      },
    },
  });
  const data = await svc.search({ query: 'hades', category: 'game' });
  const steam = data.sources.find((s) => s.id === 'steam');
  assert.equal(steam.status, 'error');
  assert.match(steam.message, /503/);
  assert.ok(data.results.some((g) => g.title === 'Hades'));
});

test('a slow store times out without holding up the response', async () => {
  const { svc } = service({
    timeoutMs: 50,
    overrides: { 'www.cheapshark.com/api/1.0/deals': () => new Promise(() => {}) },
  });
  const started = Date.now();
  const data = await svc.search({ query: 'hades', category: 'game' });
  assert.ok(Date.now() - started < 1000);
  assert.equal(data.sources.find((s) => s.id === 'cheapshark').status, 'timeout');
  assert.equal(data.sources.find((s) => s.id === 'steam').status, 'ok');
});

test('results are cached per provider and query', async () => {
  const { svc, calls } = service();
  await svc.search({ query: 'Hades', category: 'game' });
  const first = calls.length;
  const again = await svc.search({ query: 'hades ', category: 'game' });
  assert.equal(calls.length, first);
  assert.ok(again.sources.every((s) => s.cached));
});

test('excludeFree drops free items', async () => {
  const { svc } = service();
  const withFree = await svc.search({ query: 'notion', category: 'app' });
  assert.ok(withFree.results.some((g) => g.best.isFree));
  const paidOnly = await svc.search({ query: 'notion', category: 'app', excludeFree: true });
  assert.ok(!paidOnly.results.some((g) => g.best.isFree));
});

test('offers with unsafe links are dropped and unsafe images cleared', async () => {
  const fake = {
    id: 'fake',
    name: 'Fake',
    categories: ['game'],
    search: async () => [
      { source: 'fake', store: 'A', title: 'Hades', category: 'game', url: 'javascript:alert(1)', price: { amount: 1, currency: 'KRW' } },
      { source: 'fake', store: 'B', title: 'Hades', category: 'game', url: 'https://b.example/hades', image: 'javascript:alert(1)', price: { amount: 2, currency: 'KRW' } },
    ],
  };
  const svc = createSearchService({ providers: [fake], fetchJson: async () => ({}), rateService: fixedRates });
  const [hades] = (await svc.search({ query: 'hades' })).results;
  assert.deepEqual(hades.offers.map((o) => o.store), ['B']);
  assert.equal(hades.image, null);
});
