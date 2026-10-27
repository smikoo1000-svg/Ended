// Apple의 iTunes Search API (한국 스토어). 앱·전자책·오디오북·영화·음악을 같은 형식으로 돌려준다.
// 판매하지 않는 항목은 가격이 없거나 음수(-1)로 온다.
const PLATFORM_BY_KIND = {
  software: 'iPhone·iPad',
  'mac-software': 'Mac',
};

function biggerArtwork(url) {
  return url ? url.replace(/\/\d+x\d+bb\./, '/300x300bb.') : null;
}

function pickPrice(item) {
  for (const value of [item.price, item.trackPrice, item.collectionPrice]) {
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function makeItunesProvider({ id, name, category, store, media, entity }) {
  return {
    id,
    name,
    categories: [category],

    async search(query, { fetchJson, signal }) {
      const url = new URL('https://itunes.apple.com/search');
      url.searchParams.set('term', query);
      url.searchParams.set('country', 'KR');
      url.searchParams.set('lang', 'ko_kr');
      url.searchParams.set('media', media);
      url.searchParams.set('entity', entity);
      url.searchParams.set('limit', '25');
      const data = await fetchJson(url.href, { signal });

      return (data?.results ?? []).flatMap((item) => {
        const amount = pickPrice(item);
        const title = item.trackName ?? item.collectionName;
        const link = item.trackViewUrl ?? item.collectionViewUrl;
        if (amount === null || !title || !link) return [];
        const rental = Number.isFinite(item.trackRentalPrice) && item.trackRentalPrice > 0 ? item.trackRentalPrice : null;

        return [{
          source: id,
          store,
          title,
          creator: item.artistName ?? item.sellerName ?? null,
          category,
          url: link,
          image: biggerArtwork(item.artworkUrl100 ?? item.artworkUrl60),
          price: { amount, currency: item.currency ?? 'KRW' },
          regular: null,
          region: 'KR',
          platform: PLATFORM_BY_KIND[item.kind] ?? null,
          isFree: amount === 0,
          rental: rental !== null ? { amount: rental, currency: item.currency ?? 'KRW' } : null,
          rating: Number.isFinite(item.averageUserRating) && item.userRatingCount > 0
            ? { value: Math.round(item.averageUserRating * 10) / 10, scale: 5, count: item.userRatingCount, label: '사용자 평점' }
            : null,
        }];
      });
    },
  };
}

export const appStore = makeItunesProvider({
  id: 'appstore',
  name: 'App Store (한국)',
  category: 'app',
  store: 'App Store',
  media: 'software',
  entity: 'software,macSoftware',
});

export const appleBooks = makeItunesProvider({
  id: 'applebooks',
  name: 'Apple Books (한국)',
  category: 'ebook',
  store: 'Apple Books',
  media: 'ebook',
  entity: 'ebook',
});

export const appleAudiobooks = makeItunesProvider({
  id: 'appleaudiobooks',
  name: 'Apple Books 오디오북 (한국)',
  category: 'audiobook',
  store: 'Apple Books',
  media: 'audiobook',
  entity: 'audiobook',
});

export const itunesMovies = makeItunesProvider({
  id: 'itunesmovies',
  name: 'Apple TV 영화 (한국)',
  category: 'movie',
  store: 'Apple TV',
  media: 'movie',
  entity: 'movie',
});

export const itunesMusic = makeItunesProvider({
  id: 'itunesmusic',
  name: 'iTunes 음악 (한국)',
  category: 'music',
  store: 'iTunes Store',
  media: 'music',
  entity: 'album',
});
