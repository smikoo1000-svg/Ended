// 모든 가격을 원화(KRW)로 환산한다.
// 환율 API를 쓸 수 없을 때는 아래 대략적인 기본값을 쓰고, 화면에 "기본 환율 사용 중"이라고 표시한다.
export const FALLBACK_KRW_RATES = {
  KRW: 1,
  USD: 1400,
  EUR: 1600,
  GBP: 1850,
  JPY: 9.3,
  CNY: 195,
  CAD: 1000,
  AUD: 900,
  CHF: 1700,
  HKD: 180,
  TWD: 44,
  SGD: 1050,
};

const RATES_URL = 'https://open.er-api.com/v6/latest/USD';

export function createRateService({ fetchJson, ttlMs = 6 * 60 * 60 * 1000, now = Date.now } = {}) {
  let cached = null;
  let inflight = null;

  async function load() {
    try {
      const data = await fetchJson(RATES_URL, { timeoutMs: 5000 });
      if (data?.result !== 'success' || !data.rates?.KRW) throw new Error('unexpected rate payload');
      const krwPerUsd = data.rates.KRW;
      const rates = { KRW: 1 };
      for (const [code, perUsd] of Object.entries(data.rates)) {
        if (perUsd > 0) rates[code] = krwPerUsd / perUsd;
      }
      return {
        rates,
        updatedAt: data.time_last_update_unix ? new Date(data.time_last_update_unix * 1000).toISOString() : null,
        fallback: false,
        loadedAt: now(),
      };
    } catch {
      // 실패한 경우엔 5분 뒤 다시 시도하도록 짧게만 보관한다.
      return { rates: { ...FALLBACK_KRW_RATES }, updatedAt: null, fallback: true, loadedAt: now() - ttlMs + 5 * 60 * 1000 };
    }
  }

  return {
    async get() {
      if (cached && now() - cached.loadedAt < ttlMs) return cached;
      inflight ??= load().finally(() => {
        inflight = null;
      });
      cached = await inflight;
      return cached;
    },
  };
}

export function toKrw(money, rates) {
  if (!money || !Number.isFinite(money.amount)) return null;
  const currency = String(money.currency || '').toUpperCase();
  const rate = rates[currency];
  if (!rate) return null;
  return Math.round(money.amount * rate);
}
