const $ = (selector) => document.querySelector(selector);

const els = {
  form: $('#search-form'),
  input: $('#q'),
  categories: $('#categories'),
  suggestions: $('#suggestions'),
  notices: $('#notices'),
  area: $('#results-area'),
  summary: $('#summary'),
  sort: $('#sort'),
  excludeFree: $('#exclude-free'),
  viewRanking: $('#view-ranking'),
  viewGroups: $('#view-groups'),
  sources: $('#sources'),
  reference: $('#reference'),
  freeStrip: $('#free-strip'),
  results: $('#results'),
};

const CATEGORY_LABELS = {
  game: '게임', app: '앱', ebook: '전자책', audiobook: '오디오북', movie: '영화', music: '음악',
  subscription: '구독', software: '소프트웨어', giftcard: '기프트카드', other: '기타',
};
const CATEGORY_ICONS = { game: '🎮', app: '📱', ebook: '📖', audiobook: '🎧', movie: '🎬', music: '🎵', subscription: '🔁', software: '💿', giftcard: '🎁' };
const REGION_LABELS = { KR: '한국 스토어', US: '미국 스토어' };
// 판매처 유형. 스토어 디렉터리(/stores)와 같은 기준이다.
const SELLER_TYPES = {
  official: { label: '공식', tone: 'good' },
  authorized: { label: '공인 판매처', tone: 'good' },
  keyshop: { label: '키샵 (비공인)', tone: 'warn' },
  marketplace: { label: '개인 거래 (주의)', tone: 'bad' },
  compare: { label: '가격 비교', tone: 'muted' },
  community: { label: '커뮤니티', tone: 'muted' },
  free: { label: '무료', tone: 'good' },
  store: { label: '쇼핑몰', tone: 'muted' },
};

const krw = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' });
const num = new Intl.NumberFormat('ko-KR');
const state = { q: '', category: 'all', sort: 'price', excludeFree: false, view: 'ranking', meta: null, data: null };
let stream = null;
let ticker = null;

// 작은 DOM 헬퍼. 외부 데이터는 항상 textContent로 넣어서 HTML로 해석되지 않게 한다.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function formatMoney({ amount, currency }) {
  try {
    return new Intl.NumberFormat('ko-KR', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

function priceNode(offer) {
  if (offer.isFree || offer.priceKRW === 0) return h('span', { class: 'price free' }, '무료');
  if (offer.priceKRW === null) return h('span', { class: 'price' }, formatMoney(offer.price));
  return h('span', { class: 'price' }, offer.converted ? h('span', { class: 'approx' }, '약') : null, krw.format(offer.priceKRW));
}

function periodLabel(months) {
  if (!months) return null;
  if (months === 1) return '/월';
  if (months === 12) return '/년';
  return `/${months}개월`;
}

function readUrl() {
  const params = new URLSearchParams(location.search);
  state.q = params.get('q')?.trim() ?? '';
  state.category = params.get('category') ?? 'all';
  state.sort = params.get('sort') ?? 'price';
  state.excludeFree = params.get('excludeFree') === '1';
  state.view = params.get('view') === 'groups' ? 'groups' : 'ranking';
}

function writeUrl({ replace = false } = {}) {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.category !== 'all') params.set('category', state.category);
  if (state.sort !== 'price') params.set('sort', state.sort);
  if (state.excludeFree) params.set('excludeFree', '1');
  if (state.view !== 'ranking') params.set('view', state.view);
  const qs = params.toString();
  history[replace ? 'replaceState' : 'pushState'](null, '', qs ? `?${qs}` : location.pathname);
}

function syncControls() {
  els.input.value = state.q;
  els.sort.value = state.sort;
  els.excludeFree.checked = state.excludeFree;
  els.viewRanking.setAttribute('aria-pressed', String(state.view === 'ranking'));
  els.viewGroups.setAttribute('aria-pressed', String(state.view === 'groups'));
  for (const chip of els.categories.children) chip.setAttribute('aria-checked', String(chip.dataset.id === state.category));
  document.body.classList.toggle('has-query', Boolean(state.q));
  document.title = state.q ? `${state.q} 최저가 · Ended` : 'Ended · 디지털 상품 최저가 검색';
}

function renderCategories(categories) {
  const all = [{ id: 'all', label: '전체' }, ...categories];
  els.categories.replaceChildren(
    ...all.map((c) =>
      h('button', {
        type: 'button',
        class: 'chip',
        role: 'radio',
        'data-id': c.id,
        'aria-checked': String(c.id === state.category),
        onclick: () => {
          state.category = c.id;
          writeUrl();
          run();
        },
      }, c.label),
    ),
  );
}

function renderNotices(data) {
  const notices = [];
  if (state.meta?.demo || data?.demo) {
    notices.push(h('p', { class: 'notice' }, '데모 모드입니다. 화면 확인용 샘플 데이터라서 실제 가격·판매자·평점이 아니에요.'));
  }
  if (data?.currency?.fallback) {
    notices.push(h('p', { class: 'notice' }, '환율 정보를 불러오지 못해 기본 환율로 계산했어요. 해외 가격은 대략적인 금액이에요.'));
  }
  els.notices.replaceChildren(...notices);
}

function renderSources(sources, elapsed) {
  // API 키가 없어 꺼진 스토어는 운영자 설정 문제라 방문자에게는 보여주지 않는다.
  els.sources.replaceChildren(
    ...sources.filter((s) => s.status !== 'disabled').map((s) => {
      let detail = s.status === 'ok' ? `${s.count}개` : s.message ?? '실패';
      if (s.status === 'pending') detail = s.id === 'aiweb' ? `웹 검색 중… ${elapsed}초 (보통 30초~1분)` : '검색 중…';
      return h('li', { class: `source ${s.status}`, title: s.message ?? '' }, h('span', { class: 'name' }, s.name), detail);
    }),
  );
}

// ── 가격순 목록 ──────────────────────────────────────────────

function sellerBadge(offer) {
  const type = SELLER_TYPES[offer.sellerType];
  return type
    ? h('span', { class: `seller-type ${type.tone}` }, type.label)
    : h('span', { class: 'seller-type muted' }, '유형 확인 안 됨');
}

function ratingText(rating) {
  if (!rating) return h('span', { class: 'missing' }, '정보 없음');
  const value = rating.scale === 100 ? `${num.format(rating.value)}%` : `★ ${rating.value} / ${rating.scale}`;
  return h('span', {}, value, rating.count ? ` (${num.format(rating.count)}명)` : null, h('span', { class: 'fact-source' }, ` · ${rating.label}`));
}

function salesText(offer) {
  if (offer.sales) return `판매 ${num.format(offer.sales.count)}건`;
  return h('span', { class: 'missing' }, '정보 없음');
}

function rankRow(offer, reference) {
  const url = safeUrl(offer.url);
  const period = periodLabel(offer.billingMonths);
  const monthly = offer.billingMonths > 1 ? `월 ${krw.format(offer.compareKRW)}` : null;
  const referenceWord = reference?.kind === 'official' ? '공식가' : '최고가';

  return h('li', { class: 'rank-row' },
    h('div', { class: 'rank-no', 'aria-label': `${offer.rank}위` }, String(offer.rank)),
    h('div', { class: 'rank-main' },
      h('div', { class: 'rank-price' },
        priceNode(offer),
        period ? h('span', { class: 'period' }, period) : null,
        offer.converted ? h('span', { class: 'original' }, formatMoney(offer.price)) : null,
        offer.regularKRW ? h('span', { class: 'regular' }, krw.format(offer.regularKRW)) : null,
        monthly ? h('span', { class: 'monthly' }, monthly) : null,
      ),
      offer.savingsKRW > 0
        ? h('p', { class: 'savings' }, `${referenceWord}보다 ${krw.format(offer.savingsKRW)} (${offer.savingsPercent}%) 싸요`)
        : offer.discountPercent > 0
          ? h('p', { class: 'savings' }, `정가보다 ${offer.discountPercent}% 할인`)
          : null,
      h('h3', { class: 'rank-title' }, offer.title),
      h('dl', { class: 'facts' },
        h('div', {}, h('dt', {}, '판매처'), h('dd', {}, h('strong', {}, offer.store), ' ', sellerBadge(offer))),
        h('div', {}, h('dt', {}, '판매자'), h('dd', {}, offer.seller ?? (offer.sellerType === 'marketplace' ? h('span', { class: 'missing' }, '정보 없음') : `${offer.store} 직접 판매`))),
        h('div', {}, h('dt', {}, '평점'), h('dd', {}, ratingText(offer.rating))),
        h('div', {}, h('dt', {}, '거래내역'), h('dd', {}, salesText(offer))),
      ),
      h('p', { class: 'rank-meta' },
        hostOf(offer.url),
        offer.region ? ` · ${REGION_LABELS[offer.region] ?? offer.region}` : null,
        offer.platform ? ` · ${offer.platform}` : null,
        offer.found ? ' · AI 웹 검색' : null,
        offer.found ? (offer.verified ? h('span', { class: 'verified' }, ' · 가격 확인됨') : h('span', { class: 'unverified' }, ' · 구매 전 가격 확인 필요')) : null,
      ),
    ),
    url ? h('a', { class: 'buy', href: url, target: '_blank', rel: 'noopener noreferrer nofollow' }, '구매 페이지 →') : null,
  );
}

function renderRanking(data) {
  const { ranking } = data;
  const reference = ranking.reference;
  if (reference) {
    els.reference.hidden = false;
    els.reference.textContent = reference.kind === 'official'
      ? `기준가: 공식 판매처 최저가 ${krw.format(reference.priceKRW)}. 아래 "얼마나 싼지"는 이 가격과 비교한 값이에요.`
      : `공식 판매처를 찾지 못해 가장 비싼 곳(${krw.format(reference.priceKRW)})과 비교했어요.`;
  } else {
    els.reference.hidden = true;
  }

  if (ranking.free.length && !state.excludeFree) {
    els.freeStrip.hidden = false;
    els.freeStrip.replaceChildren(
      h('strong', {}, '무료로 받을 수 있는 곳 '),
      ...ranking.free.slice(0, 8).flatMap((o, i) => {
        const url = safeUrl(o.url);
        const label = `${o.title} (${o.store})`;
        return [i ? ' · ' : '', url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer nofollow' }, label) : label];
      }),
      ranking.free.some((o) => o.category === 'app') ? h('span', { class: 'fact-source' }, ' · 앱은 무료여도 앱 안 결제가 따로 있을 수 있어요') : null,
    );
  } else {
    els.freeStrip.hidden = true;
  }

  if (ranking.items.length === 0) {
    return [h('li', { class: 'empty' }, data.done ? emptyMessage(data) : '판매처를 찾는 중이에요…')];
  }
  return ranking.items.map((o) => rankRow(o, reference));
}

function emptyMessage(data) {
  if (data.sources.every((s) => s.status !== 'ok')) return '스토어에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.';
  return '파는 곳을 찾지 못했어요. 상품 이름을 영문이나 다른 표기로 검색해 보세요.';
}

// ── 상품별 묶기 ──────────────────────────────────────────────

function offerRow(offer, index) {
  const url = safeUrl(offer.url);
  const notes = [SELLER_TYPES[offer.sellerType]?.label, REGION_LABELS[offer.region], offer.platform, offer.voucher ? `쿠폰 ${offer.voucher}` : null].filter(Boolean);
  return h('tr', { class: index === 0 ? 'cheapest' : null },
    h('td', {}, offer.store, notes.length ? h('span', { class: 'sub' }, notes.join(' · ')) : null),
    h('td', { class: 'p' },
      offer.isFree ? '무료' : offer.priceKRW !== null ? `${offer.converted ? '약 ' : ''}${krw.format(offer.priceKRW)}` : formatMoney(offer.price),
      offer.converted && !offer.isFree ? h('span', { class: 'sub' }, formatMoney(offer.price)) : null,
    ),
    h('td', { class: 'l' }, url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer nofollow' }, '보기') : null),
  );
}

function card(group) {
  const best = group.best;
  const bestUrl = safeUrl(best.url);
  const image = safeUrl(group.image);
  const thumb = h('div', { class: 'thumb', 'aria-hidden': 'true' }, CATEGORY_ICONS[group.category] ?? '🛒');
  if (image) {
    const img = h('img', { src: image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', decoding: 'async' });
    img.addEventListener('error', () => img.remove(), { once: true });
    thumb.append(img);
  }

  const regionNote = best.region === 'US' ? h('span', { class: 'region-us' }, ' · 미국 스토어 가격') : null;

  return h('li', { class: `card ${group.category}` },
    thumb,
    h('div', { class: 'card-body' },
      h('div', { class: 'badges' },
        h('span', { class: 'badge' }, CATEGORY_LABELS[group.category] ?? group.category),
        best.isFree ? h('span', { class: 'badge free' }, '무료') : null,
        best.discountPercent > 0 ? h('span', { class: 'badge discount' }, `-${best.discountPercent}%`) : null,
        best.platform ? h('span', { class: 'badge' }, best.platform) : null,
      ),
      h('h3', {}, group.title),
      group.creator ? h('p', { class: 'creator' }, group.creator) : null,
      h('div', { class: 'best' },
        priceNode(best),
        best.regularKRW ? h('span', { class: 'regular' }, krw.format(best.regularKRW)) : null,
        best.converted && !best.isFree ? h('span', { class: 'original' }, formatMoney(best.price)) : null,
      ),
      h('p', { class: 'where' }, group.storeCount > 1 ? '최저가 ' : '', h('strong', {}, best.store), regionNote,
        best.rentalKRW ? ` · 대여 ${krw.format(best.rentalKRW)}` : null),
      group.historyLowKRW !== null ? h('p', { class: 'history-low' }, `역대 최저가 ${krw.format(group.historyLowKRW)}`) : null,
      h('div', { class: 'actions' },
        bestUrl ? h('a', { class: 'buy', href: bestUrl, target: '_blank', rel: 'noopener noreferrer nofollow' }, `${best.store}에서 보기`) : null,
        group.storeCount > 1
          ? h('details', { class: 'offers' },
              h('summary', {}, `스토어 ${group.storeCount}곳 가격 비교`),
              h('table', {}, h('tbody', {}, group.offers.map(offerRow))),
            )
          : null,
      ),
    ),
  );
}

// ── 공통 ────────────────────────────────────────────────────

function renderLoading() {
  els.area.hidden = false;
  els.summary.textContent = `"${state.q}" 파는 곳을 찾는 중…`;
  els.sources.replaceChildren();
  els.reference.hidden = true;
  els.freeStrip.hidden = true;
  els.results.className = 'results';
  els.results.replaceChildren(...Array.from({ length: 4 }, () => h('li', { class: 'skeleton', 'aria-hidden': 'true' })));
}

function render(data, elapsed = 0) {
  renderNotices(data);
  renderSources(data.sources, elapsed);
  const okCount = data.sources.filter((s) => s.status === 'ok').length;
  const pending = data.sources.filter((s) => s.status === 'pending').length;
  const items = data.ranking.items;

  if (state.view === 'ranking') {
    els.summary.replaceChildren(
      h('strong', {}, `판매처 ${num.format(data.ranking.total)}곳`),
      items.length > 1
        ? ` · ${items.some((o) => o.billingMonths) ? '월 ' : ''}${krw.format(Math.min(...items.map((o) => o.compareKRW)))} ~ ${krw.format(Math.max(...items.map((o) => o.compareKRW)))}`
        : '',
      pending ? ` · ${pending}곳 더 찾는 중` : ` · 스토어 ${okCount}곳 검색 · ${(data.tookMs / 1000).toFixed(1)}초`,
    );
    els.results.className = 'results ranking';
    els.results.replaceChildren(...renderRanking(data));
  } else {
    els.reference.hidden = true;
    els.freeStrip.hidden = true;
    els.summary.replaceChildren(
      h('strong', {}, `${num.format(data.total)}개 상품`),
      pending ? ` · ${pending}곳 더 찾는 중` : ` · 스토어 ${okCount}곳 검색 · ${(data.tookMs / 1000).toFixed(1)}초`,
    );
    els.results.className = 'results';
    els.results.replaceChildren(...(data.results.length ? data.results.map(card) : [h('li', { class: 'empty' }, data.done ? emptyMessage(data) : '찾는 중이에요…')]));
  }
}

function renderError(message) {
  els.area.hidden = false;
  els.summary.textContent = '';
  els.sources.replaceChildren();
  els.reference.hidden = true;
  els.freeStrip.hidden = true;
  els.results.replaceChildren(h('li', { class: 'empty' }, message));
}

function stop() {
  stream?.close();
  stream = null;
  clearInterval(ticker);
}

// 서버가 스토어별로 끝나는 대로 결과를 보내준다(Server-Sent Events). 빠른 스토어 결과가 먼저 보이고 AI 웹 검색 결과가 나중에 합쳐진다.
function run() {
  syncControls();
  stop();
  state.data = null;
  if (!state.q) {
    els.area.hidden = true;
    renderNotices(null);
    return;
  }

  renderLoading();
  const params = new URLSearchParams({ q: state.q, category: state.category, sort: state.sort });
  if (state.excludeFree) params.set('excludeFree', '1');

  const started = Date.now();
  const elapsed = () => Math.round((Date.now() - started) / 1000);
  const source = new EventSource(`/api/search/stream?${params}`);
  stream = source;
  // 경과 시간 표시만 갱신한다. 목록 전체를 다시 그리면 사용자가 보던 위치·펼친 항목이 흔들린다.
  ticker = setInterval(() => state.data && renderSources(state.data.sources, elapsed()), 1000);

  const handle = (event) => {
    if (stream !== source) return;
    state.data = JSON.parse(event.data);
    render(state.data, elapsed());
    if (event.type === 'done') stop();
  };
  source.addEventListener('update', handle);
  source.addEventListener('done', handle);
  source.addEventListener('fail', (event) => {
    if (stream !== source) return;
    stop();
    renderError(JSON.parse(event.data).error ?? '검색에 실패했어요.');
  });
  source.onerror = () => {
    if (stream !== source) return;
    stop();
    if (state.data) render(state.data, elapsed());
    else renderError('서버에 연결하지 못했어요. 검색어를 확인하고 잠시 후 다시 시도해 주세요.');
  };
}

els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  state.q = els.input.value.trim();
  writeUrl();
  run();
});

els.sort.addEventListener('change', () => {
  state.sort = els.sort.value;
  writeUrl({ replace: true });
  run();
});

els.excludeFree.addEventListener('change', () => {
  state.excludeFree = els.excludeFree.checked;
  writeUrl({ replace: true });
  run();
});

for (const [button, view] of [[els.viewRanking, 'ranking'], [els.viewGroups, 'groups']]) {
  button.addEventListener('click', () => {
    if (state.view === view) return;
    state.view = view;
    writeUrl({ replace: true });
    syncControls();
    // 이미 받은 결과를 다시 그리기만 한다. 검색을 다시 하지 않는다.
    if (state.data) render(state.data);
  });
}

els.suggestions.addEventListener('click', (event) => {
  const q = event.target.closest('button')?.dataset.q;
  if (!q) return;
  state.q = q;
  writeUrl();
  run();
});

window.addEventListener('popstate', () => {
  readUrl();
  run();
});

async function init() {
  readUrl();
  try {
    state.meta = await (await fetch('/api/meta')).json();
    renderCategories(state.meta.categories);
  } catch {
    renderCategories(Object.entries(CATEGORY_LABELS).map(([id, label]) => ({ id, label })));
  }
  renderNotices(null);
  run();
}

init();
