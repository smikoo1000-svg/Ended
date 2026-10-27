import { TtlCache } from './cache.js';
import { toKrw } from './currency.js';
import { groupKey, normalize, relevance, tokenize, compact } from './text.js';
import { isEnabled } from './providers/index.js';

// price(최저가순)가 기본. 같은 상품을 파는 판매처를 가장 싼 곳부터 줄 세운다.
export const SORTS = ['price', 'discount', 'relevance'];
const MAX_GROUPS = 120;
const MAX_RANKING = 150;

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function isTimeout(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError';
}

function errorMessage(error) {
  if (isTimeout(error)) return '응답 시간 초과';
  if (error?.code === 'DAILY_LIMIT') return '오늘 AI 검색 한도를 다 썼어요';
  if (error?.code === 'REFUSAL') return 'AI가 이 검색을 처리하지 않았어요';
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

function byCompare(a, b) {
  if (a.compareKRW === null) return b.compareKRW === null ? 0 : 1;
  if (b.compareKRW === null) return -1;
  return a.compareKRW - b.compareKRW;
}

function matchesAnyToken(query, offer) {
  const haystack = compact(`${offer.title} ${offer.creator ?? ''}`);
  return tokenize(query).some((token) => haystack.includes(token));
}

function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

// 스토어 디렉터리(1,000여 곳)로 판매처가 공식인지, 공인 리셀러인지, 키샵·개인 거래인지 알아낸다.
export function createSellerIndex(directory) {
  const byHost = new Map();
  const byName = new Map();
  for (const store of directory?.stores ?? []) {
    const host = store.host.toLowerCase();
    // 같은 도메인에 여러 항목이 있으면(예: Humble Bundle / Humble Choice 구독 페이지) 사이트 대표 주소에 가까운 항목을 쓴다.
    const depth = (entry) => new URL(entry.url).pathname.replace(/\/$/, '').length;
    if (!byHost.has(host) || depth(store) < depth(byHost.get(host))) byHost.set(host, store);
    const name = compact(store.name);
    if (!byName.has(name)) byName.set(name, store);
  }
  return (offer) => {
    for (const candidate of [offer.storeHost, hostOf(offer.url)]) {
      let host = candidate?.toLowerCase().replace(/^www\./, '');
      while (host && host.includes('.')) {
        if (byHost.has(host)) return byHost.get(host);
        host = host.slice(host.indexOf('.') + 1);
      }
      // storeHost가 있으면 링크(가격 비교 사이트 경유 등)로는 판단하지 않는다.
      if (offer.storeHost) break;
    }
    return byName.get(compact(offer.store)) ?? null;
  };
}

const HINT_TO_TYPE = { official: 'official', authorized: 'authorized', reseller: 'keyshop', marketplace: 'marketplace' };

function enrich(offer, query, rates, lookupSeller) {
  const priceKRW = toKrw(offer.price, rates);
  const regularKRW = offer.regular ? toKrw(offer.regular, rates) : null;
  const months = offer.billingMonths ?? null;
  const known = lookupSeller(offer);
  return {
    source: offer.source,
    store: offer.store,
    storeHost: offer.storeHost ?? known?.host ?? hostOf(offer.url),
    sellerType: known?.type ?? HINT_TO_TYPE[offer.sellerTypeHint] ?? null,
    seller: offer.seller ?? null,
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
    billingMonths: months,
    // 구독은 한 달 기준으로 바꿔서 비교한다 (12개월 이용권과 1개월 이용권을 공정하게 비교).
    compareKRW: priceKRW !== null && months > 1 ? Math.round(priceKRW / months) : priceKRW,
    region: offer.region ?? null,
    platform: offer.platform ?? null,
    isFree: Boolean(offer.isFree),
    rentalKRW: offer.rental ? toKrw(offer.rental, rates) : null,
    voucher: offer.voucher ?? null,
    historyLowKRW: offer.historyLow ? toKrw(offer.historyLow, rates) : null,
    rating: offer.rating ?? null,
    sales: offer.sales ?? null,
    verified: offer.verified ?? null,
    evidence: offer.evidence ?? null,
    found: Boolean(offer.found),
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

// 검색한 상품을 파는 판매처 전체를 한 줄로 세운다. 맨 위가 가장 싼 곳, 맨 아래가 가장 비싼 곳.
// 기준가는 공식 판매처 가격(없으면 가장 비싼 가격)이고, 각 판매처가 기준가보다 얼마나 싼지 함께 계산한다.
export function buildRanking(offers, sort = 'price') {
  let candidates = offers.filter((o) => o.found || o.relevance >= 1);
  if (candidates.length === 0) candidates = offers.filter((o) => o.relevance > 0);

  const seen = new Set();
  candidates = candidates.filter((o) => {
    // 같은 페이지에 여러 요금제가 있을 수 있으니(Plus·Pro) 주소와 상품명을 함께 본다.
    const key = `${o.url.replace(/#.*$/, '').replace(/\/$/, '').toLowerCase()}|${compact(o.title)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const free = candidates.filter((o) => o.isFree || o.priceKRW === 0);
  const paid = candidates.filter((o) => !free.includes(o) && o.priceKRW !== null);

  const official = paid.filter((o) => o.sellerType === 'official').map((o) => o.compareKRW);
  const reference = official.length
    ? { kind: 'official', priceKRW: Math.min(...official) }
    : paid.length > 1
      ? { kind: 'highest', priceKRW: Math.max(...paid.map((o) => o.compareKRW)) }
      : null;

  const items = paid.map((o) => {
    const savingsKRW = reference && reference.priceKRW > o.compareKRW ? reference.priceKRW - o.compareKRW : 0;
    return {
      ...o,
      savingsKRW,
      savingsPercent: savingsKRW ? Math.round((savingsKRW / reference.priceKRW) * 100) : 0,
    };
  });

  const comparators = {
    price: (a, b) => byCompare(a, b) || b.relevance - a.relevance,
    discount: (a, b) => b.savingsPercent - a.savingsPercent || b.discountPercent - a.discountPercent || byCompare(a, b),
    relevance: (a, b) => b.relevance - a.relevance || byCompare(a, b),
  };
  items.sort(comparators[sort] ?? comparators.price);
  items.forEach((item, index) => {
    item.rank = index + 1;
  });

  return { items: items.slice(0, MAX_RANKING), total: items.length, free, reference };
}

export function createSearchService({
  providers,
  fetchJson,
  rateService,
  directory = null,
  env = {},
  timeoutMs = 9000,
  cache = new TtlCache({ ttlMs: 10 * 60 * 1000 }),
  strictMatch = false,
  anthropic = undefined,
  now = () => performance.now(),
}) {
  const inflight = new Map();
  const lookupSeller = createSellerIndex(directory);

  function appliesTo(provider, category) {
    return category === 'all' || provider.categories.includes('*') || provider.categories.includes(category);
  }

  async function runProvider(provider, query, category) {
    const scope = provider.categories.includes('*') ? `${category}:` : '';
    const key = `${provider.id}:${scope}${normalize(query)}`;
    const cached = cache.get(key);
    if (cached) return { offers: cached, cached: true };

    if (!inflight.has(key)) {
      // provider가 signal을 무시하더라도 정해진 시간 뒤에는 반드시 끝나도록 race를 건다.
      const controller = new AbortController();
      const limit = provider.timeoutMs ?? timeoutMs;
      let timer;
      const timedOut = new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new DOMException(`${provider.id} timed out`, 'TimeoutError');
          controller.abort(error);
          reject(error);
        }, limit);
      });
      const task = Promise.race([provider.search(query, { fetchJson, signal: controller.signal, env, category, anthropic }), timedOut])
        .then((offers) => {
          cache.set(key, offers, provider.cacheTtlMs);
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

  function assemble({ query, category, sort, excludeFree }, settled, rateInfo, started) {
    let offers = settled
      .flatMap((r) => r.offers)
      .filter((o) => o && o.title && isHttpUrl(o.url) && o.price && Number.isFinite(o.price.amount))
      .map((o) => enrich(o, query, rateInfo.rates, lookupSeller));
    if (strictMatch) offers = offers.filter((o) => matchesAnyToken(query, o));
    if (excludeFree) offers = offers.filter((o) => !o.isFree);

    const groups = sortGroups(groupOffers(offers), sort);
    const ranking = buildRanking(offers, sort);

    return {
      query,
      category,
      sort,
      total: groups.length,
      ranking,
      results: groups.slice(0, MAX_GROUPS),
      sources: settled.map((r) => r.source),
      currency: { base: 'KRW', fallback: rateInfo.fallback, updatedAt: rateInfo.updatedAt },
      done: settled.every((r) => r.source.status !== 'pending'),
      tookMs: Math.round(now() - started),
    };
  }

  // 스토어마다 응답 속도가 다르므로(일반 API 1초 안팎, AI 웹 검색 수십 초) 끝나는 대로 onUpdate로 중간 결과를 알린다.
  async function search(params, onUpdate) {
    const request = { category: 'all', sort: 'price', excludeFree: false, ...params };
    const started = now();
    const selected = providers.filter((p) => appliesTo(p, request.category));
    const settled = selected.map((p) => ({
      source: { id: p.id, name: p.name, status: 'pending', count: 0 },
      offers: [],
    }));
    const rateInfo = await rateService.get();

    await Promise.all(
      selected.map(async (provider, i) => {
        const base = { id: provider.id, name: provider.name };
        if (!isEnabled(provider, env)) {
          settled[i] = { source: { ...base, status: 'disabled', count: 0, message: `${provider.requiredEnv} 설정 필요` }, offers: [] };
          return;
        }
        const t0 = now();
        try {
          const { offers, cached } = await runProvider(provider, request.query, request.category);
          settled[i] = { source: { ...base, status: 'ok', count: offers.length, ms: Math.round(now() - t0), cached }, offers };
        } catch (error) {
          settled[i] = {
            source: { ...base, status: isTimeout(error) ? 'timeout' : 'error', count: 0, ms: Math.round(now() - t0), message: errorMessage(error) },
            offers: [],
          };
        }
        if (onUpdate && settled.some((r) => r.source.status === 'pending')) onUpdate(assemble(request, settled, rateInfo, started));
      }),
    );

    return assemble(request, settled, rateInfo, started);
  }

  return { providers, search };
}
