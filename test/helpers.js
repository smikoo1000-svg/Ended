import { fixtureFetchJson } from '../server/demo.js';

// fixture를 돌려주면서 요청한 URL을 기록하는 가짜 fetchJson.
export function recordingFetch(overrides = {}) {
  const calls = [];
  const fetchJson = async (url, options = {}) => {
    calls.push({ url: new URL(url), options });
    for (const [match, handler] of Object.entries(overrides)) {
      if (url.includes(match)) return handler(url, options);
    }
    return fixtureFetchJson(url);
  };
  return { fetchJson, calls };
}

export const fixedRates = { get: async () => ({ rates: { KRW: 1, USD: 1400 }, fallback: false, updatedAt: '2026-10-27T00:00:00.000Z' }) };
