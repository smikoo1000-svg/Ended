# Ended — 디지털 상품 최저가 검색

검색어 하나로 여러 스토어를 동시에 찾아서 **게임·앱·전자책·오디오북·영화·음악**의 가장 싼 가격을 보여주는 사이트입니다.
같은 상품이 여러 스토어에 있으면 하나로 묶어 최저가 순으로 비교하고, 해외 스토어 가격은 원화로 환산합니다.

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

키가 없는 출처는 자동으로 꺼지고, 나머지 스토어만으로 검색합니다.
환율은 [open.er-api.com](https://open.er-api.com)에서 6시간마다 가져오며, 실패하면 내장 기본 환율을 쓰고 화면에 알려줍니다.

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
| `RATE_LIMIT_PER_MINUTE` | IP당 분당 검색 횟수 제한 (기본 30) |
| `TRUST_PROXY` | 리버스 프록시 뒤에서 실행할 때 Express `trust proxy` 값 (예: `1`) |
| `DEMO` | `1`이면 데모 모드 |

## 구조

```
server/
  index.js            서버 시작
  app.js              Express 라우트 (/api/search, /api/meta), 보안 헤더, 요청 제한
  search.js           여러 스토어 동시 검색 → 원화 환산 → 같은 상품 묶기 → 정렬
  currency.js         환율 조회와 원화 환산
  text.js             제목 정규화, 검색어 일치도
  providers/          스토어별 연동 (steam, cheapshark, itad, itunes, googlebooks)
public/               화면 (빌드 없는 HTML/CSS/JS)
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
- `sort`: `relevance`(추천순, 기본) · `price`(최저가순) · `discount`(할인율순)

응답의 `results[]`는 상품 단위로 묶여 있고 `best`가 최저가, `offers`가 스토어별 가격(싼 순)입니다.
`sources[]`에는 스토어마다 성공/실패/시간 초과 여부가 들어 있어서 한 곳이 응답하지 않아도 나머지 결과는 그대로 보여줍니다.

## 알아둘 점

- 게임 스토어는 대부분 영문 제목으로 검색해야 결과가 잘 나옵니다.
- CheapShark 가격은 미국 스토어 기준이라 한국 계정에서는 살 수 없거나 가격이 다를 수 있습니다. 화면에 "미국 스토어 가격"으로 표시됩니다.
- 넷플릭스·유튜브 프리미엄 같은 구독 요금, 기프트카드, 키 리셀러(G2A 등)는 공개 API가 없어 아직 포함하지 않았습니다.
