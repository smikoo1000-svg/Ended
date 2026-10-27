# 최저가 디지털 상품

여러 스토어의 디지털 상품(게임, 소프트웨어, 구독, 전자책, 강의, 앱) 가격을 수집해 가장 싼 곳을 보여주는 사이트.

## 실행

```bash
pip install -r requirements.txt
python -m app.crawler.run          # 활성화된 소스를 크롤링해 DB(cheapest.db)에 저장
uvicorn app.main:app --reload      # http://localhost:8000
pytest
```

## 구조

- `app/crawler/sources.py` — 스토어 정의(URL + CSS 셀렉터). **스토어 추가 = 설정 한 덩어리 추가**
- `app/crawler/base.py` — 크롤러. robots.txt 준수, 호스트별 2초 간격, 식별 가능한 User-Agent
- `app/db.py` — SQLite. 상품명을 정규화해 스토어가 달라도 같은 상품으로 묶고, 가격 변동 이력 저장
- `app/main.py` — `/api/search`, `/api/products/{id}`, `/api/categories`
- `static/index.html` — 검색 + 카테고리 + 스토어별 가격 비교 UI

## 현재 상태 / 한계

- 데모 소스 3개는 `fixtures/`의 로컬 HTML이라 오프라인에서도 전체 흐름이 동작합니다 (가짜 데이터).
- 실제 스토어는 `example-store` 템플릿처럼 추가하세요. **셀렉터는 실제 사이트에서 확인해야 하고**,
  해당 사이트의 이용약관과 robots.txt가 크롤링을 허용하는지 먼저 확인해야 합니다 (robots.txt가 막으면 크롤러가 자동으로 건너뜁니다).
- JS로 렌더링되는 페이지는 현재 지원하지 않습니다 (Playwright 도입 필요).
- 가격은 숫자만 추출하며 환율 변환은 하지 않습니다 (원화 스토어 기준).
- 정기 갱신은 cron 등으로 `python -m app.crawler.run`을 주기 실행하세요.
