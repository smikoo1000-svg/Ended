const REGION_LABELS = {
  KR: '한국', GLOBAL: '글로벌', US: '미국', UK: '영국', EU: '유럽', DE: '독일', FR: '프랑스', PL: '폴란드',
  NL: '네덜란드', ES: '스페인', IT: '이탈리아', SE: '스웨덴', BE: '벨기에', CZ: '체코', JP: '일본', CN: '중국',
  TW: '대만', RU: '러시아', TR: '튀르키예', BR: '브라질', MX: '멕시코', IN: '인도', SEA: '동남아', ID: '인도네시아',
  SG: '싱가포르', AU: '호주', CA: '캐나다', AE: '중동', SA: '사우디', EG: '이집트',
};

const $ = (selector) => document.querySelector(selector);
const els = {
  total: $('#total'),
  q: $('#q'),
  region: $('#region'),
  types: $('#types'),
  cats: $('#cats'),
  results: $('#results'),
  legend: $('#legend'),
};

const state = { q: '', region: 'all', hiddenTypes: new Set(), category: 'all' };
let data = null;

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

const regionLabel = (code) => REGION_LABELS[code] ?? code;
const fmt = (n) => n.toLocaleString('ko-KR');

// 검색어는 이름·주소·메모·분류·지역 어디에 있어도 찾는다. 띄어쓰기는 무시한다.
function haystack(store) {
  const category = data.categoryById.get(store.category)?.label ?? '';
  return `${store.name} ${store.host} ${store.note ?? ''} ${category} ${regionLabel(store.region)} ${data.types[store.type].label}`
    .toLowerCase()
    .replace(/\s+/g, '');
}

function matches(store, { ignoreType = false, ignoreCategory = false } = {}) {
  if (state.region !== 'all' && store.region !== state.region) return false;
  if (!ignoreType && state.hiddenTypes.has(store.type)) return false;
  if (!ignoreCategory && state.category !== 'all' && store.category !== state.category) return false;
  if (state.q) {
    const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.every((t) => store.search.includes(t))) return false;
  }
  return true;
}

function countBy(list, key) {
  const counts = new Map();
  for (const item of list) counts.set(item[key], (counts.get(item[key]) ?? 0) + 1);
  return counts;
}

function renderTypes() {
  const counts = countBy(data.stores.filter((s) => matches(s, { ignoreType: true })), 'type');
  els.types.replaceChildren(
    ...Object.entries(data.types).map(([id, type]) =>
      h('button', {
        type: 'button',
        class: `type-chip t-${id}`,
        'aria-pressed': String(!state.hiddenTypes.has(id)),
        title: type.description,
        onclick: () => {
          if (state.hiddenTypes.has(id)) state.hiddenTypes.delete(id);
          else state.hiddenTypes.add(id);
          render();
        },
      }, h('span', { class: 'dot', 'aria-hidden': 'true' }), type.label, h('span', { class: 'n' }, fmt(counts.get(id) ?? 0))),
    ),
  );
}

function renderCats(visibleAll) {
  const counts = countBy(visibleAll, 'category');
  const button = (id, label, n) =>
    h('button', {
      type: 'button',
      class: 'cat',
      'aria-current': String(state.category === id),
      disabled: n === 0 && state.category !== id,
      onclick: () => {
        state.category = id;
        render();
        els.results.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      },
    }, h('span', {}, label), h('span', { class: 'n' }, fmt(n)));
  els.cats.replaceChildren(
    button('all', '전체', visibleAll.length),
    ...data.categories.map((c) => button(c.id, c.label, counts.get(c.id) ?? 0)),
  );
}

function storeItem(store) {
  const type = data.types[store.type];
  return h('li', { class: 'store' },
    h('a', { href: store.url, target: '_blank', rel: 'noopener noreferrer' },
      h('span', { class: 'name' }, store.name),
      h('span', { class: 'host' }, store.host),
    ),
    h('div', { class: 'meta' },
      h('span', { class: `badge t-${store.type}`, title: type.description }, type.label),
      h('span', { class: 'region' }, regionLabel(store.region)),
    ),
    store.note ? h('p', { class: 'note' }, store.note) : null,
  );
}

function renderResults(visible) {
  if (visible.length === 0) {
    els.results.replaceChildren(h('p', { class: 'empty' }, '조건에 맞는 사이트가 없어요. 검색어를 줄이거나 유형·지역 필터를 바꿔 보세요.'));
    return;
  }
  const byCategory = new Map();
  for (const store of visible) {
    if (!byCategory.has(store.category)) byCategory.set(store.category, []);
    byCategory.get(store.category).push(store);
  }
  els.results.replaceChildren(
    ...data.categories
      .filter((c) => byCategory.has(c.id))
      .map((c) => {
        const items = byCategory.get(c.id);
        return h('section', { class: 'group', 'aria-label': c.label },
          h('h2', {}, c.label, h('span', { class: 'n' }, `${fmt(items.length)}곳`)),
          h('ul', { class: 'list' }, items.map(storeItem)),
        );
      }),
  );
}

function render() {
  const visibleAll = data.stores.filter((s) => matches(s, { ignoreCategory: true }));
  const visible = state.category === 'all' ? visibleAll : visibleAll.filter((s) => s.category === state.category);
  renderTypes();
  renderCats(visibleAll);
  renderResults(visible);
}

function renderStatic() {
  els.total.textContent = fmt(data.stores.length);

  const regions = [...countBy(data.stores, 'region')].sort((a, b) => {
    const rank = (code) => (code === 'KR' ? 0 : code === 'GLOBAL' ? 1 : 2);
    return rank(a[0]) - rank(b[0]) || b[1] - a[1];
  });
  els.region.replaceChildren(
    h('option', { value: 'all' }, `모든 지역 (${fmt(data.stores.length)})`),
    ...regions.map(([code, n]) => h('option', { value: code }, `${regionLabel(code)} (${fmt(n)})`)),
  );

  els.legend.replaceChildren(
    ...Object.entries(data.types).map(([id, type]) =>
      h('div', {}, h('dt', { class: `badge t-${id}` }, type.label), h('dd', {}, type.description)),
    ),
  );
}

let timer;
els.q.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    state.q = els.q.value.trim();
    render();
  }, 80);
});
els.region.addEventListener('change', () => {
  state.region = els.region.value;
  render();
});

async function init() {
  try {
    data = window.STORE_DIRECTORY ?? (await (await fetch('/api/stores')).json());
  } catch {
    els.results.replaceChildren(h('p', { class: 'empty' }, '목록을 불러오지 못했어요. 새로고침해 보세요.'));
    return;
  }
  data.categoryById = new Map(data.categories.map((c) => [c.id, c]));
  for (const store of data.stores) store.search = haystack(store);
  renderStatic();
  render();
}

init();
