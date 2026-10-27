// Steam 상점 검색 (한국 지역 가격).
// storesearch API는 가격을 "센트 단위"(원화도 ×100)로 돌려준다. 무료 상품에는 price 필드가 없다.
const PATHS = { app: 'app', sub: 'sub', bundle: 'bundle' };

export default {
  id: 'steam',
  name: 'Steam (한국)',
  categories: ['game'],

  async search(query, { fetchJson, signal }) {
    const url = new URL('https://store.steampowered.com/api/storesearch/');
    url.searchParams.set('term', query);
    url.searchParams.set('cc', 'KR');
    url.searchParams.set('l', 'korean');
    const data = await fetchJson(url.href, { signal });

    return (data?.items ?? []).map((item) => {
      const path = PATHS[item.type] ?? 'app';
      const price = item.price
        ? { amount: item.price.final / 100, currency: item.price.currency }
        : { amount: 0, currency: 'KRW' };
      const regular = item.price ? { amount: item.price.initial / 100, currency: item.price.currency } : null;
      const platforms = Object.entries(item.platforms ?? {})
        .filter(([, supported]) => supported)
        .map(([name]) => name);

      return {
        source: 'steam',
        store: 'Steam',
        title: item.name,
        category: 'game',
        url: `https://store.steampowered.com/${path}/${item.id}/`,
        image: item.tiny_image ?? null,
        price,
        regular,
        region: 'KR',
        platform: platforms.join(', ') || null,
        isFree: !item.price,
      };
    });
  },
};
