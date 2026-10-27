export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

const USER_AGENT = 'EndedPriceSearch/0.1 (+https://github.com/smikoo1000-svg/Ended)';

// 모든 provider가 공유하는 JSON 요청 함수. 테스트와 데모 모드에서는 이 함수만 바꿔 끼운다.
export async function fetchJson(url, { method = 'GET', body, headers = {}, signal, timeoutMs = 8000 } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const res = await fetch(url, {
    method,
    headers: {
      accept: 'application/json',
      'user-agent': USER_AGENT,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!res.ok) throw new HttpError(res.status, url);
  return res.json();
}
