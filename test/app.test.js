import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { createSearchService } from '../server/search.js';
import { loadDirectory } from '../server/directory.js';
import { fixtureAnthropic } from '../server/demo.js';
import { allProviders } from '../server/providers/index.js';
import { fixedRates, recordingFetch } from './helpers.js';

let server;
let base;

before(async () => {
  const { fetchJson } = recordingFetch();
  const directory = await loadDirectory();
  const searchService = createSearchService({
    providers: allProviders,
    fetchJson,
    rateService: fixedRates,
    directory,
    env: { ANTHROPIC_API_KEY: 'k' },
    anthropic: fixtureAnthropic(),
    strictMatch: true,
  });
  const app = createApp({ searchService, directory, demo: true, rateLimitPerMinute: 8 });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('serves the page with security headers', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.match(await res.text(), /디지털 상품/);
});

test('meta lists categories and which sources need keys', async () => {
  const meta = await (await fetch(`${base}/api/meta`)).json();
  assert.equal(meta.demo, true);
  assert.ok(meta.categories.some((c) => c.id === 'game'));
  assert.equal(meta.sources.find((s) => s.id === 'itad').enabled, false);
  assert.equal(meta.sources.find((s) => s.id === 'steam').enabled, true);
});

test('store directory is served as JSON and as a page', async () => {
  const res = await fetch(`${base}/api/stores`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.stores.length >= 1000);
  assert.ok(data.types.official.label);

  const page = await fetch(`${base}/stores`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /디지털 스토어 디렉터리/);
});

test('search returns grouped results', async () => {
  const res = await fetch(`${base}/api/search?q=stardew&category=game&sort=price`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.demo, true);
  assert.equal(data.results[0].title, 'Stardew Valley');
  assert.equal(data.results[0].best.store, 'Steam');
});

test('stream sends partial updates and a final ranking', async () => {
  const res = await fetch(`${base}/api/search/stream?q=chatgpt`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const text = await res.text();
  const events = [...text.matchAll(/event: (\w+)\ndata: (.*)\n\n/g)].map(([, name, data]) => ({ name, data: JSON.parse(data) }));

  assert.ok(events.some((e) => e.name === 'update' && e.data.done === false));
  const done = events.at(-1);
  assert.equal(done.name, 'done');
  assert.equal(done.data.done, true);
  assert.equal(done.data.ranking.items[0].store, 'Eneba');
});

test('stream rejects bad input with JSON before opening the stream', async () => {
  const res = await fetch(`${base}/api/search/stream?q=`);
  assert.equal(res.status, 400);
});

test('search validates input', async () => {
  for (const [qs, pattern] of [
    ['', /검색어/],
    [`q=${'a'.repeat(101)}`, /100자/],
    ['q=x&category=nope', /분류/],
    ['q=x&sort=nope', /정렬/],
  ]) {
    const res = await fetch(`${base}/api/search?${qs}`);
    assert.equal(res.status, 400, qs);
    assert.match((await res.json()).error, pattern);
  }
});

test('unknown api routes return JSON 404', async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Not found' });
});

test('search is rate limited per client', async () => {
  let last;
  for (let i = 0; i < 10; i += 1) last = await fetch(`${base}/api/search?q=hades&category=game`);
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) > 0);
});
