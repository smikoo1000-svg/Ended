# Ended

비공식 마켓플레이스 매물(계정/구독/키)의 최저가·신규·가성비 모니터 + 알림.

```
python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
uvicorn app.main:app --port 8000      # http://localhost:8000
pytest
```

- 사이트 추가: `sources.yaml` 의 `sources:` 에 블록 추가 (HTML 셀렉터 또는 JSON 경로)
- 알림 채널: 환경변수 `DISCORD_WEBHOOK_URL` 또는 `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`
- 가성비 점수 = (비교 매물 중앙값 ÷ 가격) × 신뢰도. 신뢰도는 별점(리뷰 수로 보정) + 리뷰/판매 건수 기반 (`app/scoring.py`)
