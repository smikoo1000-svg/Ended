// AI 웹 검색: Claude가 웹을 직접 검색·열람해서 상품을 파는 사이트와 가격을 찾아온다.
// API가 없는 스토어(구독 서비스, 기프트카드·키 리셀러, 국내 오픈마켓 등)까지 찾을 수 있다.
//
// 환각 방지: Claude가 보고한 판매처 URL은 이번 검색 중 실제로 나온 페이지(검색 결과·열람한 페이지)의
// 도메인일 때만 남긴다. 가격 문구가 열람한 페이지 본문에서 그대로 확인되면 verified 표시를 붙인다.
import Anthropic from '@anthropic-ai/sdk';

export const DEFAULT_MODEL = 'claude-opus-5-5';
const MAX_TURNS = 5;
const MAX_OFFERS = 25;

const CATEGORIES = ['game', 'app', 'ebook', 'audiobook', 'movie', 'music', 'subscription', 'giftcard', 'software', 'other'];

const REPORT_TOOL = {
  name: 'report_offers',
  description:
    'Report the offers you found for the requested product. Call this exactly once, after you have finished searching. ' +
    'Each offer is one store selling the product at a price you saw on a page during this task.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      offers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            store: { type: 'string', description: 'Name of the store or seller site, e.g. "OpenAI", "App Store", "쿠팡", "Eneba".' },
            url: { type: 'string', description: 'URL of the page where the price is shown.' },
            title: { type: 'string', description: 'Product or plan name as the store lists it, e.g. "ChatGPT Plus 1개월".' },
            category: { type: 'string', enum: CATEGORIES },
            price: { type: 'number', description: 'Price the buyer pays for this listing, as a number.' },
            currency: { type: 'string', description: 'ISO 4217 code of the price, e.g. KRW, USD.' },
            regular_price: { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'Price before discount if the page shows one.' },
            billing_months: { type: 'integer', description: 'Months covered by the price for subscriptions (1 monthly, 12 yearly). 0 for a one-time purchase.' },
            seller_type: { type: 'string', enum: ['official', 'authorized', 'reseller', 'marketplace', 'unknown'] },
            seller: {
              anyOf: [{ type: 'string' }, { type: 'null' }],
              description: 'Name of the individual seller when the store is a marketplace with many sellers (e.g. the merchant name on Eneba or 쿠팡). Null when the store sells it itself.',
            },
            rating: { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'Seller or store rating shown on the page or found in a review site during this task.' },
            rating_scale: { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'Maximum of the rating scale, e.g. 5 or 100.' },
            rating_count: { anyOf: [{ type: 'integer' }, { type: 'null' }], description: 'Number of ratings or reviews behind the rating.' },
            rating_source: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Where the rating comes from, e.g. "판매자 평점", "Trustpilot".' },
            sales_count: { anyOf: [{ type: 'integer' }, { type: 'null' }], description: 'Number of sales or completed orders the page shows for this listing or seller.' },
            evidence: { type: 'string', description: 'Exact text copied from the page that shows the price.' },
          },
          required: [
            'store', 'url', 'title', 'category', 'price', 'currency', 'regular_price', 'billing_months', 'seller_type',
            'seller', 'rating', 'rating_scale', 'rating_count', 'rating_source', 'sales_count', 'evidence',
          ],
          additionalProperties: false,
        },
      },
    },
    required: ['offers'],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `You are the price research engine behind a Korean price comparison site for digital products.
The user names a product. Find the online stores where a buyer in South Korea can buy it, and the price each store charges, so the site can list the offers from cheapest to most expensive.

How to search:
- Cover the official store, app stores with Korean prices, authorized resellers, gift card and key resellers, Korean open markets (쿠팡, 11번가, G마켓, 네이버 쇼핑) and price comparison sites. Search in Korean and in English.
- Open product pages when a search result does not show the price clearly.

What to report:
- Only prices you saw in a search result or a fetched page during this task. Copy the text that shows the price into evidence. Never fill in a price from memory or estimate one.
- url is the page that shows the price.
- Report the price in the currency the page shows. Prefer the Korean price when the store shows one.
- For subscriptions, report the price of the billed period and set billing_months (1 for monthly, 12 for yearly). Use 0 for one-time purchases.
- For marketplaces with many sellers, name the seller of the listing and give the seller's rating, review count and number of sales as the page shows them. For other stores, give the store's rating if you saw one (for example on a review site) while searching. Use null for anything you did not see; never guess these numbers.
- Leave out listings that sell shared or resold accounts, and pages where the product is clearly a different product with a similar name.
- Report at most ${MAX_OFFERS} offers. If you found none, report an empty list.
When you are done, call report_offers once.`;

const CATEGORY_HINTS = {
  game: '게임', app: '앱', ebook: '전자책', audiobook: '오디오북', movie: '영화', music: '음악',
};

function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

// 같은 사이트의 하위 도메인(store.example.com ↔ example.com)도 같은 출처로 본다.
function sameSite(a, b) {
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function normalizeSpace(text) {
  return String(text).replace(/\s+/g, ' ').trim().toLowerCase();
}

// 응답의 모든 서버 도구 결과에서 실제로 나온 URL과 페이지 본문을 모은다.
// 웹 검색(동적 필터링 포함) 결과 형태가 조금 달라도 놓치지 않도록 URL은 블록 전체에서 찾는다.
export function collectEvidence(content, into = { hosts: new Set(), texts: [] }) {
  for (const block of content ?? []) {
    if (!block || typeof block !== 'object' || !String(block.type).endsWith('_tool_result')) continue;
    if (block.type === 'web_fetch_tool_result' && block.content?.type === 'web_fetch_result') {
      const source = block.content.content?.source;
      if (source?.type === 'text' && source.data) into.texts.push(normalizeSpace(source.data));
    }
    const serialized = JSON.stringify(block);
    for (const match of serialized.matchAll(/https?:\/\/[^\s"'\\<>)]+/g)) {
      const host = hostOf(match[0]);
      if (host) into.hosts.add(host);
    }
    if (block.content?.stdout) into.texts.push(normalizeSpace(block.content.stdout));
  }
  return into;
}

export function toOffers(reported, evidence) {
  const hosts = [...evidence.hosts];
  return (reported ?? []).slice(0, MAX_OFFERS).flatMap((offer) => {
    const host = hostOf(offer.url);
    if (!host || !/^https?:/i.test(offer.url)) return [];
    if (!hosts.some((seen) => sameSite(host, seen))) return [];
    if (!Number.isFinite(offer.price) || offer.price < 0) return [];

    const quote = offer.evidence ? normalizeSpace(offer.evidence) : '';
    const verified = quote.length >= 3 && evidence.texts.some((text) => text.includes(quote));
    const currency = String(offer.currency || '').toUpperCase();
    return [{
      source: 'aiweb',
      store: offer.store,
      storeHost: host,
      title: offer.title,
      category: CATEGORIES.includes(offer.category) ? offer.category : 'other',
      url: offer.url,
      image: null,
      price: { amount: offer.price, currency },
      regular: Number.isFinite(offer.regular_price) && offer.regular_price > offer.price ? { amount: offer.regular_price, currency } : null,
      region: null,
      platform: null,
      isFree: offer.price === 0,
      billingMonths: Number.isInteger(offer.billing_months) && offer.billing_months > 0 ? offer.billing_months : null,
      sellerTypeHint: offer.seller_type,
      seller: offer.seller || null,
      rating: Number.isFinite(offer.rating) && offer.rating > 0
        ? {
            value: offer.rating,
            scale: Number.isFinite(offer.rating_scale) && offer.rating_scale > 0 ? offer.rating_scale : offer.rating > 5 ? 100 : 5,
            count: Number.isInteger(offer.rating_count) ? offer.rating_count : null,
            label: offer.rating_source || '평점',
          }
        : null,
      sales: Number.isInteger(offer.sales_count) && offer.sales_count >= 0 ? { count: offer.sales_count, label: '판매' } : null,
      evidence: offer.evidence || null,
      verified,
      found: true,
    }];
  });
}

function createDailyLimiter(limit, now = Date.now) {
  let day = null;
  let count = 0;
  return () => {
    const today = new Date(now()).toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      count = 0;
    }
    if (count >= limit) return false;
    count += 1;
    return true;
  };
}

export function createAiWebProvider({ client = null, model, dailyLimit, now } = {}) {
  let defaultClient = client;
  let allow = null;

  return {
    id: 'aiweb',
    name: 'AI 웹 검색 (Claude)',
    categories: ['*'],
    requiredEnv: 'ANTHROPIC_API_KEY',
    timeoutMs: 150_000,
    cacheTtlMs: 6 * 60 * 60 * 1000,

    async search(query, { signal, env, category = 'all', anthropic }) {
      allow ??= createDailyLimiter(dailyLimit ?? (Number(env.AI_SEARCH_DAILY_LIMIT) || 200), now);
      if (!allow()) throw Object.assign(new Error('daily AI search limit reached'), { code: 'DAILY_LIMIT' });

      defaultClient ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
      const api = anthropic ?? defaultClient;
      const hint = CATEGORY_HINTS[category] ? ` (분류: ${CATEGORY_HINTS[category]})` : '';
      const messages = [{ role: 'user', content: `상품: ${query}${hint}` }];
      const evidence = { hosts: new Set(), texts: [] };

      for (let turn = 0; turn < MAX_TURNS; turn += 1) {
        const response = await api.beta.messages.create(
          {
            model: model ?? env.AI_SEARCH_MODEL ?? DEFAULT_MODEL,
            max_tokens: 16000,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            output_config: { effort: 'medium' },
            system: SYSTEM_PROMPT,
            tools: [
              {
                type: 'web_search_20260209',
                name: 'web_search',
                max_uses: 6,
                user_location: { type: 'approximate', country: 'KR', timezone: 'Asia/Seoul' },
              },
              { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 6 },
              REPORT_TOOL,
            ],
            messages,
          },
          { signal },
        );

        collectEvidence(response.content, evidence);
        if (response.stop_reason === 'refusal') throw Object.assign(new Error('refused'), { code: 'REFUSAL' });

        const report = response.content.find((b) => b.type === 'tool_use' && b.name === 'report_offers');
        if (report) return toOffers(report.input?.offers, evidence);

        messages.push({ role: 'assistant', content: response.content });
        if (response.stop_reason === 'pause_turn') continue;
        if (response.stop_reason === 'end_turn') {
          messages.push({ role: 'user', content: 'report_offers 도구로 찾은 결과를 보고해 주세요.' });
          continue;
        }
        break;
      }
      return [];
    },
  };
}
