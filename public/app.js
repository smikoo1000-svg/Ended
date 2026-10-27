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
  sources: $('#sources'),
  results: $('#results'),
};

const CATEGORY_LABELS = { game: '게임', app: '앱', ebook: '전자책', audiobook: '오디오북', movie: '영화', music: '음악' };
const CATEGORY_ICONS = { game: '🎮', app: '📱', ebook: '📖', audiobook: '🎧', movie: '🎬', music: '🎵' };
const REGION_LABELS = { KR: '한국 스토어', US: '미국 스토어' };

const krw = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' });
const state = { q: '', category: 'all', sort: 'relevance', excludeFree: false, meta: null };
let controller = null;

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

function readUrl() {
  const params = new URLSearchParams(location.search);
  state.q = params.get('q')?.trim() ?? '';
  state.category = params.get('category') ?? 'all';
  state.sort = params.get('sort') ?? 'relevance';
  state.excludeFree = params.get('excludeFree') === '1';
}

function writeUrl({ replace = false } = {}) {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.category !== 'all') params.set('category', state.category);
  if (state.sort !== 'relevance') params.set('sort', state.sort);
  if (state.excludeFree) params.set('excludeFree', '1');
  const qs = params.toString();
  const url = qs ? `?${qs}` : location.pathname;
  history[replace ? 'replaceState' : 'pushState'](null, '', url);
}

function syncControls() {
  els.input.value = state.q;
  els.sort.value = state.sort;
  els.excludeFree.checked = state.excludeFree;
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
    notices.push(h('p', { class: 'notice' }, '데모 모드입니다. 화면 확인용 샘플 데이터라서 실제 가격이 아니에요.'));
  }
  if (data?.currency?.fallback) {
    notices.push(h('p', { class: 'notice' }, '환율 정보를 불러오지 못해 기본 환율로 계산했어요. 해외 가격은 대략적인 금액이에요.'));
  }
  els.notices.replaceChildren(...notices);
}

function renderSources(sources) {
  // API 키가 없어 꺼진 스토어는 운영자 설정 문제라 방문자에게는 보여주지 않는다.
  els.sources.replaceChildren(
    ...sources.filter((s) => s.status !== 'disabled').map((s) => {
      const detail = s.status === 'ok' ? `${s.count}개` : s.message ?? '실패';
      return h('li', { class: `source ${s.status}`, title: s.message ?? '' }, h('span', { class: 'name' }, s.name), detail);
    }),
  );
}

function offerRow(offer, index) {
  const url = safeUrl(offer.url);
  const notes = [REGION_LABELS[offer.region] ?? null, offer.platform, offer.voucher ? `쿠폰 ${offer.voucher}` : null].filter(Boolean);
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

function renderLoading() {
  els.area.hidden = false;
  els.summary.textContent = `"${state.q}" 검색 중…`;
  els.sources.replaceChildren();
  els.results.replaceChildren(...Array.from({ length: 4 }, () => h('li', { class: 'skeleton', 'aria-hidden': 'true' })));
}

function renderResults(data) {
  renderNotices(data);
  renderSources(data.sources);
  const okCount = data.sources.filter((s) => s.status === 'ok').length;
  els.summary.replaceChildren(
    h('strong', {}, `${data.total.toLocaleString('ko-KR')}개 상품`),
    ` · 스토어 ${okCount}곳 검색 · ${(data.tookMs / 1000).toFixed(1)}초`,
  );

  if (data.results.length === 0) {
    const failed = data.sources.every((s) => s.status !== 'ok');
    els.results.replaceChildren(
      h('li', { class: 'empty' }, failed ? '스토어에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.' : '검색 결과가 없어요. 영문 제목이나 다른 분류로 검색해 보세요.'),
    );
    return;
  }
  els.results.replaceChildren(...data.results.map(card));
}

function renderError(message) {
  els.area.hidden = false;
  els.summary.textContent = '';
  els.sources.replaceChildren();
  els.results.replaceChildren(h('li', { class: 'empty' }, message));
}

async function run() {
  syncControls();
  controller?.abort();
  if (!state.q) {
    els.area.hidden = true;
    renderNotices(null);
    return;
  }

  controller = new AbortController();
  renderLoading();
  const params = new URLSearchParams({ q: state.q, category: state.category, sort: state.sort });
  if (state.excludeFree) params.set('excludeFree', '1');

  try {
    const res = await fetch(`/api/search?${params}`, { signal: controller.signal });
    const data = await res.json();
    if (!res.ok) return renderError(data.error ?? '검색에 실패했어요.');
    renderResults(data);
  } catch (error) {
    if (error.name !== 'AbortError') renderError('서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
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
