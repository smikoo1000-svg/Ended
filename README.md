# Ended

비공식 마켓플레이스 매물(계정/구독/키)의 최저가·신규·가성비 모니터 + 알림.

## 실행
```
python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
uvicorn app.main:app --port 8000      # http://localhost:8000
pytest
```

## 사이트 추가
1. `sources.yaml` 의 `sources:` 에 블록 추가 (HTML 셀렉터 또는 JSON 경로, 예시 포함)
2. 연결 전 검증: `python -m tools.check_source <name> "Netflix"`
   - HTTP 상태, robots.txt 허용 여부, 셀렉터 매칭 수, 파싱 결과(정규화된 상품·별점·리뷰)를 보여줍니다.
3. robots.txt 가 막으면 기본적으로 수집하지 않습니다 (`respect_robots: false` 는 허락받은 경우만).

## 점수
- **상품 정규화** (`app/normalize.py`): 제목에서 브랜드·등급·기간을 뽑아 `netflix|premium|12m` 같은 키로 비교.
  1개월과 12개월은 가격 비교 대상이 아닙니다. 비교군이 3개 미만이면 월 단가로 같은 브랜드·등급과 비교.
- **신뢰도** (`app/scoring.py`): 별점을 리뷰 수로 보정(베이지안) + 리뷰/판매 건수.
- 가성비 점수 = (비교군 중앙값 ÷ 가격) × 신뢰도.
- 상품 키를 누르면 최저가/중앙값 추이 그래프 (수집할 때마다 스냅샷 저장).

## 배포
```
cp .env.example .env   # ADMIN_TOKEN, 알림 채널 설정
docker compose up -d --build
```
- 공개 서버면 **ADMIN_TOKEN 필수** (알림 규칙 변경·수동 새로고침 보호). 화면의 토큰 칸에 입력.
- 데이터는 `ended-data` 볼륨(`/data/ended.db`)에 저장. `/healthz` 로 상태 확인.
- 알림: `DISCORD_WEBHOOK_URL` 또는 `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`.
- 조회 API(`/api/search` 등)는 인증 없이 열려 있으니, 비공개로 쓰려면 리버스 프록시 인증이나 VPN 뒤에 두세요.
