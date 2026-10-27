// IsThereAnyDeal: 50개 이상 PC 게임 스토어의 지역별 가격과 역대 최저가.
// 무료 API 키(https://isthereanydeal.com/apps/my/)가 있어야 켜진다.
const API = 'https://api.isthereanydeal.com';
const MAX_GAMES = 12;

export default {
  id: 'itad',
  name: 'IsThereAnyDeal (PC 게임 50+ 스토어)',
  categories: ['game'],
  requiredEnv: 'ITAD_API_KEY',

  async search(query, { fetchJson, signal, env }) {
    const key = env.ITAD_API_KEY;
    const searchUrl = new URL(`${API}/games/search/v1`);
    searchUrl.searchParams.set('title', query);
    searchUrl.searchParams.set('results', String(MAX_GAMES));
    searchUrl.searchParams.set('key', key);
    const games = (await fetchJson(searchUrl.href, { signal })) ?? [];
    if (games.length === 0) return [];

    const pricesUrl = new URL(`${API}/games/prices/v3`);
    pricesUrl.searchParams.set('country', 'KR');
    pricesUrl.searchParams.set('nondeals', 'true');
    pricesUrl.searchParams.set('vouchers', 'true');
    pricesUrl.searchParams.set('key', key);
    const prices = await fetchJson(pricesUrl.href, { method: 'POST', body: games.map((game) => game.id), signal });

    const gameById = new Map(games.map((game) => [game.id, game]));
    return (prices ?? []).flatMap(({ id, deals = [], historyLow }) => {
      const game = gameById.get(id);
      if (!game) return [];
      const low = historyLow?.all ?? null;

      return deals.map((deal) => ({
        source: 'itad',
        store: deal.shop?.name ?? 'Unknown',
        title: game.title,
        category: 'game',
        url: deal.url,
        image: game.assets?.boxart ?? game.assets?.banner300 ?? null,
        price: { amount: deal.price.amount, currency: deal.price.currency },
        regular: deal.regular ? { amount: deal.regular.amount, currency: deal.regular.currency } : null,
        region: 'KR',
        platform: deal.platforms?.map((p) => p.name).join(', ') || null,
        isFree: deal.price.amount === 0,
        voucher: deal.voucher ?? null,
        historyLow: low ? { amount: low.amount, currency: low.currency } : null,
      }));
    });
  },
};
