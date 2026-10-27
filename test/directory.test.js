import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadDirectory, parseDirectory } from '../server/directory.js';

test('the store directory loads with 1,000+ unique https links', async () => {
  const { stores, categories, types } = await loadDirectory();
  assert.ok(stores.length >= 1000, `${stores.length} stores`);

  const urls = stores.map((s) => s.url.replace(/\/$/, '').toLowerCase());
  assert.equal(new Set(urls).size, urls.length, 'no duplicate links');
  assert.ok(stores.every((s) => s.url.startsWith('https://')));
  assert.ok(stores.every((s) => types[s.type]));

  const ids = new Set(categories.map((c) => c.id));
  assert.ok(stores.every((s) => ids.has(s.category)));
  assert.equal(categories.reduce((sum, c) => sum + c.count, 0), stores.length);
  assert.ok(categories.every((c) => c.label && c.count > 0));
});

test('parseDirectory merges categories across files and reports bad lines', () => {
  const { stores, categories, errors } = parseDirectory([
    { name: 'a.txt', text: '## game | 게임\nSteam | https://store.steampowered.com | GLOBAL | official | 메모\n' },
    {
      name: 'b.txt',
      text: [
        '## game | 게임',
        'GOG | https://www.gog.com | GLOBAL | official |',
        'Broken | http://insecure.example | US | official |',
        'Wrong | https://x.example | US | sketchy |',
        'Short | https://y.example | US',
      ].join('\n'),
    },
  ]);
  assert.equal(categories.length, 1);
  assert.equal(categories[0].count, 2);
  assert.deepEqual(stores.map((s) => s.host), ['store.steampowered.com', 'gog.com']);
  assert.equal(stores[1].note, null);
  assert.equal(errors.length, 3);
});
