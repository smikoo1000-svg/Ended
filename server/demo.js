// 데모 모드: 실제 스토어 대신 fixtures/ 폴더의 샘플 응답을 돌려준다.
// 네트워크가 막힌 환경에서 화면을 확인하거나 개발할 때 쓰며, 가격은 실제 가격이 아니다.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

// URL → fixture 파일 이름
export function fixtureFor(url) {
  const { hostname, pathname, searchParams } = new URL(url);
  if (hostname === 'store.steampowered.com') return 'steam-search.json';
  if (hostname === 'www.cheapshark.com') return pathname.endsWith('/stores') ? 'cheapshark-stores.json' : 'cheapshark-deals.json';
  if (hostname === 'itunes.apple.com') return `itunes-${searchParams.get('media')}.json`;
  if (hostname === 'www.googleapis.com') return 'googlebooks.json';
  if (hostname === 'open.er-api.com') return 'rates.json';
  if (hostname === 'api.isthereanydeal.com') return pathname.includes('/prices/') ? 'itad-prices.json' : 'itad-search.json';
  return null;
}

export async function fixtureFetchJson(url) {
  const name = fixtureFor(url);
  if (!name) throw new Error(`no fixture for ${url}`);
  return JSON.parse(await readFile(path.join(FIXTURES_DIR, name), 'utf8'));
}
