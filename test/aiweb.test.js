import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAiWebProvider, collectEvidence, toOffers, DEFAULT_MODEL } from '../server/providers/aiweb.js';

const fixture = JSON.parse(await readFile(new URL('../fixtures/claude-websearch.json', import.meta.url), 'utf8'));

function fakeClient(responses) {
  const requests = [];
  return {
    requests,
    beta: {
      messages: {
        create: async (body) => {
          requests.push(structuredClone(body));
          const next = responses.shift();
          if (!next) throw new Error('no more responses');
          return next;
        },
      },
    },
  };
}

const env = { ANTHROPIC_API_KEY: 'test' };

test('sends one request with web search, web fetch and the strict report tool', async () => {
  const client = fakeClient([structuredClone(fixture)]);
  const provider = createAiWebProvider();
  await provider.search('ChatGPT', { env, anthropic: client, category: 'all' });

  const [body] = client.requests;
  assert.equal(body.model, DEFAULT_MODEL);
  assert.equal(body.model, 'claude-opus-5-5');
  assert.deepEqual(body.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(body.fallbacks, 'default');
  assert.deepEqual(body.tools.map((t) => t.type ?? t.name), ['web_search_20260209', 'web_fetch_20260209', 'report_offers']);
  assert.equal(body.tools[0].user_location.country, 'KR');
  assert.equal(body.tools[2].strict, true);
  assert.equal(body.tool_choice, undefined, 'forced tool choice is rejected on this model');
  assert.match(body.messages[0].content, /ChatGPT/);
});

test('keeps only offers from sites that appeared in the search, and marks prices seen in fetched pages', async () => {
  const provider = createAiWebProvider();
  const offers = await provider.search('ChatGPT', { env, anthropic: fakeClient([structuredClone(fixture)]) });

  assert.ok(!offers.some((o) => o.url.includes('cheap-gpt.example')), 'unseen site is dropped');
  assert.equal(offers.length, 9);

  const plus = offers.find((o) => o.title === 'ChatGPT Plus 월 구독');
  assert.deepEqual(plus.price, { amount: 20, currency: 'USD' });
  assert.equal(plus.billingMonths, 1);
  assert.equal(plus.verified, true, '"$20 / month" is in the fetched pricing page');

  const appStore = offers.find((o) => o.store === 'App Store');
  assert.equal(appStore.verified, false, 'search result text is encrypted, so the price is not confirmed');

  const eneba = offers.find((o) => o.store === 'Eneba');
  assert.equal(eneba.seller, 'DemoDigital');
  assert.deepEqual(eneba.rating, { value: 4.9, scale: 5, count: 12431, label: '판매자 평점' });
  assert.deepEqual(eneba.sales, { count: 3210, label: '판매' });
  assert.deepEqual(eneba.regular, { amount: 20, currency: 'USD' });
  assert.equal(eneba.verified, true);

  const g2a = offers.find((o) => o.store === 'G2A');
  assert.equal(g2a.rating.scale, 100);
  assert.equal(g2a.storeHost, 'g2a.com');

  const yearly = offers.find((o) => o.store === 'Bitrefill');
  assert.equal(yearly.billingMonths, 12);
  assert.ok(offers.every((o) => o.found && o.source === 'aiweb'));
});

test('continues after pause_turn and asks for the report once if the model stops without it', async () => {
  const toolUse = fixture.content.find((b) => b.type === 'tool_use');
  const searchBlocks = fixture.content.filter((b) => b.type !== 'tool_use');
  const client = fakeClient([
    { content: searchBlocks.slice(0, 3), stop_reason: 'pause_turn' },
    { content: [...searchBlocks.slice(3)], stop_reason: 'end_turn' },
    { content: [toolUse], stop_reason: 'tool_use' },
  ]);
  const offers = await createAiWebProvider().search('ChatGPT', { env, anthropic: client });

  assert.equal(client.requests.length, 3);
  assert.equal(client.requests[1].messages.at(-1).role, 'assistant', 'paused turn is sent back as is');
  assert.equal(client.requests[2].messages.at(-1).role, 'user');
  assert.match(client.requests[2].messages.at(-1).content, /report_offers/);
  assert.ok(offers.length > 0, 'evidence from earlier turns still counts');
});

test('a refusal becomes an error the search service can report', async () => {
  const client = fakeClient([{ content: [], stop_reason: 'refusal' }]);
  await assert.rejects(createAiWebProvider().search('x', { env, anthropic: client }), { code: 'REFUSAL' });
});

test('stops calling the API after the daily limit', async () => {
  const provider = createAiWebProvider({ dailyLimit: 1 });
  const client = fakeClient([structuredClone(fixture), structuredClone(fixture)]);
  await provider.search('ChatGPT', { env, anthropic: client });
  await assert.rejects(provider.search('Claude', { env, anthropic: client }), { code: 'DAILY_LIMIT' });
  assert.equal(client.requests.length, 1);
});

test('collectEvidence reads hosts from any tool result, including errors and code output', () => {
  const evidence = collectEvidence([
    { type: 'text', text: 'see https://not-a-tool-result.example' },
    { type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
    { type: 'bash_code_execution_tool_result', content: { stdout: 'https://www.shop.example/item 12,900원' } },
  ]);
  assert.deepEqual([...evidence.hosts], ['shop.example']);
  assert.ok(evidence.texts[0].includes('12,900원'));

  const [offer] = toOffers(
    [{ store: 'Shop', url: 'https://m.shop.example/item', title: 'x', category: 'other', price: 12900, currency: 'krw', regular_price: null,
      billing_months: 0, seller_type: 'unknown', seller: null, rating: null, rating_scale: null, rating_count: null, rating_source: null,
      sales_count: null, evidence: '12,900원' }],
    evidence,
  );
  assert.equal(offer.price.currency, 'KRW');
  assert.equal(offer.billingMonths, null);
  assert.equal(offer.verified, true);
  assert.equal(offer.rating, null);
});
