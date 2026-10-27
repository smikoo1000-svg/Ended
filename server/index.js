import { createApp } from './app.js';
import { createRateService } from './currency.js';
import { fixtureFetchJson } from './demo.js';
import { fetchJson } from './http.js';
import { allProviders } from './providers/index.js';
import { createSearchService } from './search.js';

const env = process.env;
const demo = env.DEMO === '1';
const fetcher = demo ? fixtureFetchJson : fetchJson;

const searchService = createSearchService({
  providers: allProviders,
  fetchJson: fetcher,
  rateService: createRateService({ fetchJson: fetcher }),
  env,
  // 데모 fixture는 검색어와 상관없이 같은 응답을 돌려주므로 서버에서 한 번 더 걸러낸다.
  strictMatch: demo,
});

const app = createApp({ searchService, env, demo, rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE) || 30 });
const port = Number(env.PORT) || 3000;

app.listen(port, () => {
  console.log(`Ended 실행 중: http://localhost:${port}${demo ? ' (데모 모드 - 샘플 데이터)' : ''}`);
});
