// Google Play 도서 (Google Books API). 키 없는 익명 호출은 할당량이 0이라 API 키가 있어야 켜진다.
function https(url) {
  return url ? url.replace(/^http:\/\//, 'https://') : null;
}

export default {
  id: 'googlebooks',
  name: 'Google Play 도서',
  categories: ['ebook'],
  requiredEnv: 'GOOGLE_BOOKS_API_KEY',

  async search(query, { fetchJson, signal, env }) {
    const url = new URL('https://www.googleapis.com/books/v1/volumes');
    url.searchParams.set('q', query);
    url.searchParams.set('country', 'KR');
    url.searchParams.set('filter', 'ebooks');
    url.searchParams.set('printType', 'books');
    url.searchParams.set('maxResults', '30');
    url.searchParams.set('key', env.GOOGLE_BOOKS_API_KEY);
    const data = await fetchJson(url.href, { signal });

    return (data?.items ?? []).flatMap((volume) => {
      const info = volume.volumeInfo ?? {};
      const sale = volume.saleInfo ?? {};
      const isFree = sale.saleability === 'FREE';
      const retail = sale.retailPrice;
      const list = sale.listPrice;
      if (!info.title || (!isFree && !retail)) return [];

      return [{
        source: 'googlebooks',
        store: 'Google Play 도서',
        title: info.subtitle ? `${info.title}: ${info.subtitle}` : info.title,
        creator: info.authors?.join(', ') ?? null,
        category: 'ebook',
        url: https(sale.buyLink ?? info.canonicalVolumeLink ?? info.infoLink),
        image: https(info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail),
        price: isFree ? { amount: 0, currency: 'KRW' } : { amount: retail.amount, currency: retail.currencyCode },
        regular: list ? { amount: list.amount, currency: list.currencyCode } : null,
        region: sale.country ?? 'KR',
        platform: null,
        isFree,
      }];
    });
  },
};
