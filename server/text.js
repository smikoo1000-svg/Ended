// 제목 정규화와 검색어 일치도 계산.
// 스토어마다 표기가 조금씩 달라서("ELDEN RING™", "Elden Ring") 같은 상품을 묶으려면
// 기호와 대소문자, 띄어쓰기를 걷어낸 키가 필요하다.

const SEPARATORS = /[^\p{L}\p{N}]+/gu;
const TRADEMARKS = /[™®©]/g;

export function normalize(text) {
  // NFKC는 ™를 "TM"으로 바꾸므로 기호를 먼저 지운다.
  return String(text ?? '')
    .replace(TRADEMARKS, '')
    .normalize('NFKC')
    .toLowerCase()
    .trim();
}

export function tokenize(text) {
  return normalize(text).split(SEPARATORS).filter(Boolean);
}

// 띄어쓰기·기호를 모두 제거한 형태. 한국어는 띄어쓰기가 제각각이라("해리포터" / "해리 포터") 이 형태로 비교한다.
export function compact(text) {
  return normalize(text).replace(SEPARATORS, '');
}

export function groupKey(category, title) {
  return `${category}:${compact(title)}`;
}

// 0 이상의 점수. 1 이상이면 검색어의 모든 단어가 제목(또는 제작자)에 들어 있다는 뜻.
export function relevance(query, title, creator = '') {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;

  const titleCompact = compact(title);
  const queryCompact = compact(query);
  const haystack = `${titleCompact} ${compact(creator)}`;

  const matched = queryTokens.filter((token) => haystack.includes(token)).length;
  let score = matched / queryTokens.length;
  if (score < 1 && queryCompact && haystack.includes(queryCompact)) score = 1;

  if (titleCompact === queryCompact) score += 1;
  else if (titleCompact.startsWith(queryCompact)) score += 0.5;

  // "OST", "DLC" 같은 덧붙은 단어가 많을수록 본편보다 뒤로 가도록 살짝 감점.
  const extraTokens = Math.max(0, tokenize(title).length - queryTokens.length);
  score -= Math.min(0.3, extraTokens * 0.03);

  return Math.max(0, Math.round(score * 1000) / 1000);
}
