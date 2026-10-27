# Ended — 디지털 상품 최저가 검색

검색어 하나로 여러 스토어를 동시에 찾아서 **게임·앱·전자책·오디오북·영화·음악**의 가장 싼 가격을 보여주는 사이트입니다.
같은 상품이 여러 스토어에 있으면 하나로 묶어 최저가 순으로 비교하고, 해외 스토어 가격은 원화로 환산합니다.

## 검색 결과: 파는 곳을 가장 싼 곳부터

"ChatGPT"처럼 상품 이름을 검색하면 그 상품을 파는 판매처를 모두 모아 **가장 싼 곳이 맨 위, 가장 비싼 곳이 맨 아래**에 오도록 보여줍니다. 각 줄에는 다음이 들어갑니다.

- 가격(원화 환산), 구독이면 월 기준 가격
- 공식 판매처 가격보다 얼마나(원·%) 싼지
- 판매처와 유형(공식 · 공인 판매처 · 키샵 · 개인 거래 · 쇼핑몰). 유형은 스토어 디렉터리(`/stores`)에서 찾습니다
- 판매자(마켓플레이스면 개별 판매자 이름), 평점과 평가 수, 판매 건수
- 구매 페이지 링크

결과는 Server-Sent Events(`GET /api/search/stream`)로 스토어가 응답하는 대로 화면에 추가됩니다. 일반 스토어 API는 1초 안팎, AI 웹 검색은 30초~1분 정도 걸립니다.

### AI 웹 검색 (Claude)

API가 없는 판매처(구독 서비스, 기프트카드·키 리셀러, 쿠팡·11번가 같은 오픈마켓 등)는 Claude가 웹 검색(`web_search`)과 페이지 열람(`web_fetch`)으로 찾아옵니다. `ANTHROPIC_API_KEY`를 설정하면 켜집니다.

- 모델: `claude-opus-5-5` (`AI_SEARCH_MODEL`로 변경 가능). 거절 시 서버 측 대체 모델(`fallbacks: "default"`)을 씁니다.
- 잘못된 정보 걸러내기: 검색 중에 실제로 나온 사이트의 링크만 남기고, 열어 본 페이지 본문에서 같은 가격 문구를 찾으면 "가격 확인됨"으로 표시합니다. 평점·판매 건수는 페이지에 나온 값만 쓰고, 없으면 "정보 없음"으로 보여줍니다.
- 비용: 웹 검색 1,000회당 $10에 토큰 비용이 더해집니다. 같은 검색어 결과는 6시간 동안 저장해 다시 쓰고, `AI_SEARCH_DAILY_LIMIT`(기본 200회)로 하루 호출 수를 제한합니다.

## 검색하는 스토어

| 분류 | 출처 | 지역/통화 | 설정 |
| --- | --- | --- | --- |
| 게임 | Steam 상점 검색 | 한국 (KRW) | 필요 없음 |
| 게임 | [CheapShark](https://apidocs.cheapshark.com/) — GOG, Humble, Fanatical, GreenManGaming, Epic 등 30여 곳 | 미국 (USD → 원화 환산) | 필요 없음 |
| 게임 | [IsThereAnyDeal](https://docs.isthereanydeal.com/) — 50여 곳 + 역대 최저가 | 한국 | `ITAD_API_KEY` |
| 앱 | App Store (iPhone·iPad·Mac) | 한국 (KRW) | 필요 없음 |
| 전자책 | Apple Books | 한국 (KRW) | 필요 없음 |
| 전자책 | Google Play 도서 | 한국 (KRW) | `GOOGLE_BOOKS_API_KEY` |
| 오디오북 / 영화 / 음악 | Apple Books · Apple TV · iTunes Store | 한국 (KRW) | 필요 없음 |
| 모든 분류 | AI 웹 검색 (Claude + 웹 검색) — 구독·리셀러·오픈마켓 등 | 페이지 표시 통화 → 원화 환산 | `ANTHROPIC_API_KEY` |

키가 없는 출처는 자동으로 꺼지고, 나머지 스토어만으로 검색합니다.
환율은 [open.er-api.com](https://open.er-api.com)에서 6시간마다 가져오며, 실패하면 내장 기본 환율을 쓰고 화면에 알려줍니다.

## 스토어 디렉터리 (`/stores`)

게임·앱·소프트웨어·전자책·음악·영화·강의·디자인 에셋·eSIM 등을 파는 사이트 **1,024곳**(서로 다른 도메인 1,009개)을 26개 분류로 모은 목록입니다.
공식 스토어부터 공인 리셀러, 비공인 키샵, 개인 거래 마켓, 가격 비교·핫딜 커뮤니티까지 유형별로 표시하고, 이름·주소·메모 검색과 지역·유형 필터를 지원합니다.

- 데이터: `data/stores/*.txt` (`이름 | URL | 지역 | 유형 | 메모` 형식, 한 줄에 한 곳)
- API: `GET /api/stores`
- 2026년 10월에 웹 검색과 공개 정보로 정리했으며, 각 링크가 지금도 열리는지는 하나하나 확인하지 않았습니다.

## 실행

Node.js 20 이상이 필요합니다.

```bash
npm install
npm start            # http://localhost:3000
```

- `npm run dev` — 파일이 바뀌면 자동 재시작
- `npm run demo` — 외부 API 없이 `fixtures/`의 **샘플 데이터**로 화면 확인 (실제 가격 아님, 화면에 표시됨)
- `npm test` — 테스트 실행

### 환경 변수

| 이름 | 설명 |
| --- | --- |
| `PORT` | 서버 포트 (기본 3000) |
| `ITAD_API_KEY` | IsThereAnyDeal API 키. https://isthereanydeal.com/apps/my/ 에서 무료 발급 |
| `GOOGLE_BOOKS_API_KEY` | Google Cloud 콘솔에서 Books API를 켜고 발급한 키 |
| `ANTHROPIC_API_KEY` | AI 웹 검색용 Claude API 키 (https://platform.claude.com) |
| `AI_SEARCH_MODEL` | AI 웹 검색 모델 (기본 `claude-opus-5-5`) |
| `AI_SEARCH_DAILY_LIMIT` | 하루 AI 웹 검색 최대 횟수 (기본 200) |
| `RATE_LIMIT_PER_MINUTE` | IP당 분당 검색 횟수 제한 (기본 30) |
| `TRUST_PROXY` | 리버스 프록시 뒤에서 실행할 때 Express `trust proxy` 값 (예: `1`) |
| `DEMO` | `1`이면 데모 모드 |

## 구조

```
server/
  index.js            서버 시작
  app.js              Express 라우트 (/api/search, /api/meta), 보안 헤더, 요청 제한
  search.js           여러 스토어 동시 검색 → 원화 환산 → 같은 상품 묶기 → 정렬
  directory.js        스토어 디렉터리 읽기·검증 (data/stores/*.txt)
  currency.js         환율 조회와 원화 환산
  text.js             제목 정규화, 검색어 일치도
  providers/          스토어별 연동 (steam, cheapshark, itad, itunes, googlebooks)
public/               화면 (빌드 없는 HTML/CSS/JS), stores.html = 스토어 디렉터리
data/stores/          스토어 디렉터리 원본 데이터
fixtures/             각 API 응답 형식의 샘플 (테스트·데모용)
test/                 node:test 테스트
```

### 스토어 추가하기

`server/providers/`에 아래 형태의 모듈을 만들고 `providers/index.js`의 `allProviders`에 넣으면 됩니다.

```js
export default {
  id: 'mystore',
  name: '내 스토어',
  categories: ['game'],          // game | app | ebook | audiobook | movie | music
  requiredEnv: 'MYSTORE_KEY',    // 선택: 이 환경 변수가 있을 때만 켜짐
  async search(query, { fetchJson, signal, env }) {
    // 반환: [{ source, store, title, category, url, image, price: { amount, currency },
    //          regular, region, platform, isFree }]
  },
};
```

## API

`GET /api/search?q=hades&category=game&sort=price&excludeFree=1`

- `category`: `all`(기본) · `game` · `app` · `ebook` · `audiobook` · `movie` · `music`
- `sort`: `price`(최저가순, 기본) · `discount`(공식가 대비 많이 싼 순) · `relevance`(관련도순)

응답의 `ranking.items[]`는 판매처를 가격순으로 줄 세운 목록이고(`rank`, `savingsKRW`, `seller`, `rating`, `sales`, `sellerType` 포함), `ranking.free[]`는 무료로 받을 수 있는 곳, `results[]`는 같은 상품끼리 묶은 목록입니다.
`sources[]`에는 스토어마다 성공/실패/시간 초과 여부가 들어 있어서 한 곳이 응답하지 않아도 나머지 결과는 그대로 보여줍니다.

## 알아둘 점

- 게임 스토어는 대부분 영문 제목으로 검색해야 결과가 잘 나옵니다.
- CheapShark 가격은 미국 스토어 기준이라 한국 계정에서는 살 수 없거나 가격이 다를 수 있습니다. 화면에 "미국 스토어 가격"으로 표시됩니다.
- 넷플릭스·유튜브 프리미엄 같은 구독 요금, 기프트카드, 키 리셀러(G2A 등)는 공개 API가 없어 아직 포함하지 않았습니다.
