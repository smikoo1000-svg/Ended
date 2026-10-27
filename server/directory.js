// 디지털 상품 판매처 디렉터리. data/stores/*.txt 를 읽어 하나의 목록으로 만든다.
// 파일 형식: "## 분류ID | 분류 이름" 줄 아래에 "이름 | URL | 지역 | 유형 | 메모" 줄을 나열한다.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DIRECTORY_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'stores');

export const STORE_TYPES = {
  official: { label: '공식', description: '제조사·플랫폼이 직접 판매' },
  authorized: { label: '공인 판매처', description: '퍼블리셔에게 정식으로 받은 키·코드를 판매' },
  keyshop: { label: '키샵', description: '출처가 불분명한 키를 직접 판매. 싸지만 회수·지역 제한 위험이 있음' },
  marketplace: { label: '개인 거래', description: '개인 판매자 장터. 가장 싸지만 사기·회수 위험이 가장 큼' },
  compare: { label: '가격 비교', description: '여러 스토어의 가격을 모아 비교' },
  community: { label: '핫딜 커뮤니티', description: '사용자들이 할인 정보를 공유' },
  free: { label: '무료', description: '무료로 받거나 이용' },
  store: { label: '쇼핑몰', description: '종합몰·오픈마켓' },
};

export function parseDirectory(files) {
  const categories = new Map();
  const stores = [];
  const errors = [];

  for (const { name, text } of files) {
    let category = null;
    text.split('\n').forEach((raw, index) => {
      const line = raw.trim();
      const where = `${name}:${index + 1}`;
      if (line.startsWith('## ')) {
        const [id, label] = line.slice(3).split('|').map((s) => s.trim());
        if (!categories.has(id)) categories.set(id, { id, label, count: 0 });
        category = categories.get(id);
        return;
      }
      if (!line || line.startsWith('#')) return;

      const parts = line.split('|').map((s) => s.trim());
      if (parts.length !== 5) return errors.push(`${where}: 칸이 5개가 아님`);
      const [storeName, url, region, type, note] = parts;
      if (!category) return errors.push(`${where}: 분류(## ...) 없이 항목이 나옴`);
      if (!STORE_TYPES[type]) return errors.push(`${where}: 알 수 없는 유형 ${type}`);
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        return errors.push(`${where}: 잘못된 URL ${url}`);
      }
      if (parsed.protocol !== 'https:') return errors.push(`${where}: https가 아님 ${url}`);

      category.count += 1;
      stores.push({
        name: storeName,
        url,
        host: parsed.host.replace(/^www\./, ''),
        region,
        type,
        note: note || null,
        category: category.id,
      });
    });
  }

  return { categories: [...categories.values()], stores, types: STORE_TYPES, errors };
}

export async function loadDirectory(dir = DIRECTORY_DIR) {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.txt')).sort();
  const files = await Promise.all(names.map(async (name) => ({ name, text: await readFile(path.join(dir, name), 'utf8') })));
  const directory = parseDirectory(files);
  if (directory.errors.length) throw new Error(`스토어 목록 오류:\n${directory.errors.join('\n')}`);
  const { errors, ...rest } = directory;
  return rest;
}
