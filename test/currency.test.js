import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRateService, FALLBACK_KRW_RATES, toKrw } from '../server/currency.js';
import { fixtureFetchJson } from '../server/demo.js';

test('rate service converts a USD-based table into KRW per unit', async () => {
  const service = createRateService({ fetchJson: fixtureFetchJson });
  const { rates, fallback, updatedAt } = await service.get();
  assert.equal(fallback, false);
  assert.equal(rates.KRW, 1);
  assert.equal(rates.USD, 1400);
  assert.equal(Math.round(rates.EUR), 1600);
  assert.equal(updatedAt, new Date(1761523201 * 1000).toISOString());
});

test('rate service falls back to built-in rates and retries after a few minutes', async () => {
  let t = 0;
  let calls = 0;
  const service = createRateService({
    fetchJson: async () => {
      calls += 1;
      throw new Error('offline');
    },
    now: () => t,
  });

  const first = await service.get();
  assert.equal(first.fallback, true);
  assert.deepEqual(first.rates, FALLBACK_KRW_RATES);

  t += 60 * 1000;
  await service.get();
  assert.equal(calls, 1, 'fallback is reused for a short while');

  t += 5 * 60 * 1000;
  await service.get();
  assert.equal(calls, 2, 'then the live API is tried again');
});

test('rate service caches successful loads and shares concurrent requests', async () => {
  let calls = 0;
  const service = createRateService({
    fetchJson: async (url) => {
      calls += 1;
      return fixtureFetchJson(url);
    },
  });
  await Promise.all([service.get(), service.get(), service.get()]);
  await service.get();
  assert.equal(calls, 1);
});

test('toKrw rounds and returns null for unknown currencies', () => {
  const rates = { KRW: 1, USD: 1400 };
  assert.equal(toKrw({ amount: 9.99, currency: 'USD' }, rates), 13986);
  assert.equal(toKrw({ amount: 10800, currency: 'krw' }, rates), 10800);
  assert.equal(toKrw({ amount: 5, currency: 'XYZ' }, rates), null);
  assert.equal(toKrw(null, rates), null);
});
