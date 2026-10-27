import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import steam from '../server/providers/steam.js';
import cheapshark, { resetStoreNames } from '../server/providers/cheapshark.js';
import itad from '../server/providers/itad.js';
import googlebooks from '../server/providers/googlebooks.js';
import { appStore, appleBooks, appleAudiobooks, itunesMovies, itunesMusic } from '../server/providers/itunes.js';
import { recordingFetch } from './helpers.js';

beforeEach(() => resetStoreNames());

test('steam: queries the Korean store and converts cent amounts', async () => {
  const { fetchJson, calls } = recordingFetch();
  const offers = await steam.search('hades', { fetchJson, env: {} });

  assert.equal(calls[0].url.searchParams.get('cc'), 'KR');
  assert.equal(calls[0].url.searchParams.get('term'), 'hades');

  const hades = offers.find((o) => o.title === 'Hades');
  assert.deepEqual(hades.price, { amount: 10800, currency: 'KRW' });
  assert.deepEqual(hades.regular, { amount: 27000, currency: 'KRW' });
  assert.equal(hades.url, 'https://store.steampowered.com/app/1145360/');
  assert.equal(hades.platform, 'windows, mac');

  const free = offers.find((o) => o.title === 'Path of Exile');
  assert.equal(free.isFree, true);
  assert.equal(free.price.amount, 0);

  const bundle = offers.find((o) => o.title.includes('Bundle'));
  assert.equal(bundle.url, 'https://store.steampowered.com/bundle/50511/');
});

test('cheapshark: maps store ids to names, drops US Steam, links via redirect', async () => {
  const { fetchJson, calls } = recordingFetch();
  const offers = await cheapshark.search('elden ring', { fetchJson, env: {} });

  const deals = calls.find((c) => c.url.pathname.endsWith('/deals'));
  assert.equal(deals.url.searchParams.get('title'), 'elden ring');

  assert.ok(offers.every((o) => o.store !== 'Steam'), 'Steam offers come from the steam provider instead');
  const gmg = offers.find((o) => o.title === 'ELDEN RING' && o.store === 'GreenManGaming');
  assert.deepEqual(gmg.price, { amount: 35.99, currency: 'USD' });
  assert.deepEqual(gmg.regular, { amount: 59.99, currency: 'USD' });
  assert.equal(gmg.url, 'https://www.cheapshark.com/redirect?dealID=demo-er-gmg');
  assert.equal(gmg.region, 'US');
});

test('cheapshark: falls back to built-in store names when the store list fails', async () => {
  const { fetchJson } = recordingFetch({
    '/stores': () => {
      throw new Error('down');
    },
  });
  const offers = await cheapshark.search('hades', { fetchJson, env: {} });
  assert.ok(offers.some((o) => o.store === 'GOG'));
  assert.ok(offers.some((o) => o.store === 'Epic Games Store'));
});

test('appstore: keeps free and paid apps, skips items without a price', async () => {
  const { fetchJson, calls } = recordingFetch();
  const offers = await appStore.search('procreate', { fetchJson, env: {} });

  assert.equal(calls[0].url.searchParams.get('country'), 'KR');
  assert.equal(calls[0].url.searchParams.get('entity'), 'software,macSoftware');
  assert.ok(!offers.some((o) => o.title === 'Unpriced Sample App'));

  const procreate = offers.find((o) => o.title === 'Procreate');
  assert.deepEqual(procreate.price, { amount: 19000, currency: 'KRW' });
  assert.equal(procreate.platform, 'iPhone·iPad');
  assert.match(procreate.image, /300x300bb\.jpg$/);
  assert.equal(offers.find((o) => o.title === 'Things 3').platform, 'Mac');
  assert.equal(offers.find((o) => o.title.startsWith('Notion')).isFree, true);
});

test('itunes: ebooks, audiobooks, movies (with rental) and albums', async () => {
  const { fetchJson } = recordingFetch();
  const ctx = { fetchJson, env: {} };

  const [book] = await appleBooks.search('해리', ctx);
  assert.equal(book.category, 'ebook');
  assert.equal(book.creator, 'J.K. 롤링');

  const [audio] = await appleAudiobooks.search('dune', ctx);
  assert.equal(audio.title, 'Dune');
  assert.equal(audio.price.amount, 25000);
  assert.match(audio.url, /audiobook/);

  const movies = await itunesMovies.search('dune', ctx);
  const part2 = movies.find((m) => m.title === '듄: 파트 2');
  assert.equal(part2.price.amount, 11000);
  assert.deepEqual(part2.rental, { amount: 5500, currency: 'KRW' });

  const albums = await itunesMusic.search('dune', ctx);
  assert.equal(albums.length, 1, 'albums with price -1 are not for sale');
  assert.equal(albums[0].creator, 'Hans Zimmer');
});

test('googlebooks: requires a key, upgrades links to https, handles free and unpriced books', async () => {
  assert.equal(googlebooks.requiredEnv, 'GOOGLE_BOOKS_API_KEY');
  const { fetchJson, calls } = recordingFetch();
  const offers = await googlebooks.search('dune', { fetchJson, env: { GOOGLE_BOOKS_API_KEY: 'k' } });

  assert.equal(calls[0].url.searchParams.get('key'), 'k');
  assert.equal(calls[0].url.searchParams.get('country'), 'KR');
  assert.ok(!offers.some((o) => o.title === 'Not For Sale Book'));

  const hp = offers.find((o) => o.title === '해리 포터와 마법사의 돌');
  assert.deepEqual(hp.price, { amount: 8820, currency: 'KRW' });
  assert.deepEqual(hp.regular, { amount: 9800, currency: 'KRW' });
  assert.match(hp.image, /^https:\/\//);
  assert.match(hp.url, /^https:\/\/play\.google\.com\//);

  const alice = offers.find((o) => o.title.startsWith('Alice'));
  assert.equal(alice.isFree, true);
  assert.ok(offers.find((o) => o.title.startsWith('Atomic Habits:')), 'subtitle is appended');
});

test('itad: searches then posts ids for KR prices, attaches history low', async () => {
  const { fetchJson, calls } = recordingFetch();
  const offers = await itad.search('hades', { fetchJson, env: { ITAD_API_KEY: 'secret' } });

  const pricesCall = calls.find((c) => c.url.pathname === '/games/prices/v3');
  assert.equal(pricesCall.options.method, 'POST');
  assert.equal(pricesCall.url.searchParams.get('country'), 'KR');
  assert.equal(pricesCall.options.body.length, 2);

  assert.equal(offers.length, 3);
  const fanatical = offers.find((o) => o.store === 'Fanatical');
  assert.deepEqual(fanatical.price, { amount: 8.24, currency: 'USD' });
  assert.equal(fanatical.voucher, 'SAVE10');
  assert.deepEqual(fanatical.historyLow, { amount: 6750, currency: 'KRW' });
  assert.equal(fanatical.image, 'https://assets.isthereanydeal.com/sample/hades/boxart.jpg');
});

test('itad: skips the prices call when search finds nothing', async () => {
  const { fetchJson, calls } = recordingFetch({ '/games/search/': () => [] });
  assert.deepEqual(await itad.search('zzz', { fetchJson, env: { ITAD_API_KEY: 'k' } }), []);
  assert.equal(calls.length, 1);
});
