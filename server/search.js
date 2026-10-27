import { TtlCache } from './cache.js';
import { toKrw } from './currency.js';
import { groupKey, normalize, relevance, tokenize, compact } from './text.js';
import { isEnabled } from './providers/index.js';

export const SORTS = ['relevance', 'price', 'discount'];
const MAX_GROUPS = 120;

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function isTimeout(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError';
}

function errorMessage(error) {
  if (isTimeout(error)) return '응답 시간 초과';
  if (error?.status === 429) return '요청 한도 초과 (잠시 후 다시 시도)';
  if (error?.status) return `스토어 응답 오류 (HTTP ${error.status})`;
  return '연결 실패';
}

function discountPercent(price, regular) {
  if (!price || !regular || regular.amount <= 0 || price.amount >= regular.amount) return 0;
  return Math.round((1 - price.amount / regular.amount) * 100);
}

function byPrice(a, b) {
  if (a.priceKRW === null) return b.priceKRW === null ? 0 : 1;
  if (b.priceKRW === null) return -1;
  return a.priceKRW - b.priceKRW;
}

function matchesAnyToken(query, offer) {
  const haystack = compact(`${offer.title} ${offer.creator ?? ''}`);
  return tokenize(query).some((token) => haystack.includes(token));
}

function enrich(offer, query, rates) {
  const priceKRW = toKrw(offer.price, rates);
  const regularKRW = offer.regular ? toKrw(offer.regular, rates) : null;
  return {
    source: offer.source,
    store: offer.store,
    title: offer.title,
    creator: offer.creator ?? null,
    category: offer.category,
    url: offer.url,
    image: isHttpUrl(offer.image) ? offer.image : null,
    price: offer.price,
    priceKRW,
    regularKRW: regularKRW !== null && priceKRW !== null && regularKRW > priceKRW ? regularKRW : null,
    discountPercent: discountPercent(offer.price, offer.regular),
    converted: String(offer.price.currency).toUpperCase() !== 'KRW',
    region: offer.region ?? null,
    platform: offer.platform ?? null,
    isFree: Boolean(offer.isFree),
    rentalKRW: offer.rental ? toKrw(offer.rental, rates) : null,
    voucher: offer.voucher ?? null,
    historyLowKRW: offer.historyLow ? toKrw(offer.historyLow, rates) : null,
    relevance: relevance(query, offer.title, offer.creator ?? ''),
  };
}

export function groupOffers(offers) {
  const groups = new Map();
  for (const offer of offers) {
    const key = groupKey(offer.category, offer.title);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(offer);
  }

  return [...groups].map(([key, members]) => {
    // 같은 스토어가 여러 provider에서 잡히면(예: CheapShark와 ITAD의 GOG) 더 싼 쪽만 남긴다.
    const cheapestPerStore = new Map();
    for (const offer of [...members].sort(byPrice)) {
      const storeKey = normalize(offer.store);
      if (!cheapestPerStore.has(storeKey)) cheapestPerStore.set(storeKey, offer);
    }
    const ranked = [...cheapestPerStore.values()];
    const first = members[0];
    const lows = members.map((o) => o.historyLowKRW).filter((v) => v !== null);

    return {
      id: key,
      title: first.title,
      creator: members.find((o) => o.creator)?.creator ?? null,
      category: first.category,
      image: members.find((o) => o.image)?.image ?? null,
      relevance: Math.max(...members.map((o) => o.relevance)),
      best: ranked[0],
      offers: ranked,
      storeCount: ranked.length,
      maxDiscount: Math.max(...ranked.map((o) => o.discountPercent)),
      historyLowKRW: lows.length ? Math.min(...lows) : null,
    };
  });
}

export function sortGroups(groups, sort) {
  const price = (a, b) => byPrice(a.best, b.best);
  const comparators = {
    relevance: (a, b) => b.relevance - a.relevance || price(a, b),
    // 최저가순이라도 검색어와 온전히 일치하는 상품을 먼저 보여준다. 그렇지 않으면 OST·DLC 같은 곁가지가 맨 위를 채운다.
    price: (a, b) => Number(b.relevance >= 1) - Number(a.relevance >= 1) || price(a, b) || b.relevance - a.relevance,
    discount: (a, b) => b.maxDiscount - a.maxDiscount || price(a, b),
  };
  return [...groups].sort(comparators[sort] ?? comparators.relevance);
}

export function createSearchService({
  providers,
  fetchJson,
  rateService,
  env = {},
  timeoutMs = 9000,
  cache = new TtlCache({ ttlMs: 10 * 60 * 1000 }),
  strictMatch = false,
  now = () => performance.now(),
}) {
  const inflight = new Map();

  async function runProvider(provider, query) {
    const key = `${provider.id}:${normalize(query)}`;
    const cached = cache.get(key);
    if (cached) return { offers: cached, cached: true };

    if (!inflight.has(key)) {
      // provider가 signal을 무시하더라도 timeoutMs 뒤에는 반드시 끝나도록 race를 건다.
      const controller = new AbortController();
      let timer;
      const timedOut = new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new DOMException(`${provider.id} timed out`, 'TimeoutError');
          controller.abort(error);
          reject(error);
        }, timeoutMs);
      });
      const task = Promise.race([provider.search(query, { fetchJson, signal: controller.signal, env }), timedOut])
        .then((offers) => {
          cache.set(key, offers);
          return offers;
        })
        .finally(() => {
          clearTimeout(timer);
          inflight.delete(key);
        });
      inflight.set(key, task);
    }
    return { offers: await inflight.get(key), cached: false };
  }

  return {
    providers,

    async search({ query, category = 'all', sort = 'relevance', excludeFree = false }) {
      const started = now();
      const selected = providers.filter((p) => category === 'all' || p.categories.includes(category));

      const [settled, rateInfo] = await Promise.all([
        Promise.all(
          selected.map(async (provider) => {
            const base = { id: provider.id, name: provider.name };
            if (!isEnabled(provider, env)) {
              return { source: { ...base, status: 'disabled', count: 0, message: `${provider.requiredEnv} 설정 필요` }, offers: [] };
            }
            const t0 = now();
            try {
              const { offers, cached } = await runProvider(provider, query);
              return {
                source: { ...base, status: 'ok', count: offers.length, ms: Math.round(now() - t0), cached },
                offers,
              };
            } catch (error) {
              return {
                source: { ...base, status: isTimeout(error) ? 'timeout' : 'error', count: 0, ms: Math.round(now() - t0), message: errorMessage(error) },
                offers: [],
              };
            }
          }),
        ),
        rateService.get(),
      ]);

      let offers = settled
        .flatMap((r) => r.offers)
        .filter((o) => o && o.title && isHttpUrl(o.url) && o.price && Number.isFinite(o.price.amount))
        .map((o) => enrich(o, query, rateInfo.rates));
      if (strictMatch) offers = offers.filter((o) => matchesAnyToken(query, o));
      if (excludeFree) offers = offers.filter((o) => !o.isFree);

      const groups = sortGroups(groupOffers(offers), sort);

      return {
        query,
        category,
        sort,
        total: groups.length,
        results: groups.slice(0, MAX_GROUPS),
        sources: settled.map((r) => r.source),
        currency: { base: 'KRW', fallback: rateInfo.fallback, updatedAt: rateInfo.updatedAt },
        tookMs: Math.round(now() - started),
      };
    },
  };
}
