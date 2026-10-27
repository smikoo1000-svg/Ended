// CheapShark: Steam·GOG·Humble·Fanatical·GreenManGaming·Epic 등 30여 개 PC 게임 스토어의 가격을 한 번에 조회한다.
// 가격은 모두 미국 스토어 기준(USD)이다.
const STORES_URL = 'https://www.cheapshark.com/api/1.0/stores';

// 스토어 목록 API가 실패했을 때 쓰는 기본값.
const FALLBACK_STORES = {
  1: 'Steam', 2: 'GamersGate', 3: 'GreenManGaming', 4: 'Amazon', 5: 'GameStop', 6: 'Direct2Drive',
  7: 'GOG', 8: 'EA App', 11: 'Humble Store', 13: 'Ubisoft Store', 15: 'Fanatical', 16: 'Gamesrocket',
  21: 'WinGameStore', 23: 'GameBillet', 24: 'Voidu', 25: 'Epic Games Store', 27: 'Gamesplanet',
  28: 'Gamesload', 29: '2Game', 30: 'IndieGala', 31: 'Blizzard Shop', 33: 'DLGamer', 34: 'Noctre',
  35: 'DreamGame',
};

// Steam은 steam provider가 한국 가격으로 따로 조회하므로 미국 가격은 빼는 게 덜 헷갈린다.
const EXCLUDED_STORE_IDS = new Set(['1']);

let storeNames = null;

async function loadStoreNames(fetchJson, signal) {
  if (storeNames) return storeNames;
  try {
    const stores = await fetchJson(STORES_URL, { signal });
    const names = {};
    for (const store of stores) names[store.storeID] = store.storeName;
    storeNames = names;
  } catch {
    return FALLBACK_STORES;
  }
  return storeNames;
}

export function resetStoreNames() {
  storeNames = null;
}

export default {
  id: 'cheapshark',
  name: 'PC 게임 스토어 30+ (CheapShark)',
  categories: ['game'],

  async search(query, { fetchJson, signal }) {
    const url = new URL('https://www.cheapshark.com/api/1.0/deals');
    url.searchParams.set('title', query);
    url.searchParams.set('pageSize', '60');
    url.searchParams.set('sortBy', 'Price');

    const [deals, names] = await Promise.all([fetchJson(url.href, { signal }), loadStoreNames(fetchJson, signal)]);

    return (deals ?? [])
      .filter((deal) => !EXCLUDED_STORE_IDS.has(String(deal.storeID)))
      .map((deal) => {
        const sale = Number(deal.salePrice);
        const normal = Number(deal.normalPrice);
        return {
          source: 'cheapshark',
          store: names[deal.storeID] ?? FALLBACK_STORES[deal.storeID] ?? `스토어 #${deal.storeID}`,
          title: deal.title,
          category: 'game',
          url: `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(deal.dealID)}`,
          image: deal.thumb || null,
          price: { amount: sale, currency: 'USD' },
          regular: Number.isFinite(normal) ? { amount: normal, currency: 'USD' } : null,
          region: 'US',
          platform: 'PC',
          isFree: sale === 0,
        };
      });
  },
};
