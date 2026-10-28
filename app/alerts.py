"""Evaluate watch rules and push notifications (Discord / Telegram webhooks)."""
import logging
import os

import httpx

from .collector import now
from .scoring import score_listings

log = logging.getLogger("alerts")
MAX_NEW_PER_WATCH = 5  # avoids a flood on the first run


def matching(con, keyword: str) -> list[dict]:
    like = "%" + "%".join(keyword.split()) + "%"
    rows = con.execute("SELECT * FROM listings WHERE active=1 AND title LIKE ? COLLATE NOCASE", (like,)).fetchall()
    return score_listings([dict(r) for r in rows])


def _fmt(kind: str, r: dict, keyword: str) -> str:
    label = {"new": "🆕 신규 매물", "cheapest": "💰 최저가", "best_value": "⭐ 가성비 1위"}[kind]
    return (f"{label} [{keyword}]\n{r['title']}\n{int(r['price_krw']):,}원 · {r['source']} · "
            f"점수 {r['score']} · 신뢰도 {round(r['trust'] * 100)}% · 판매자 {r.get('seller') or '?'} "
            f"({r.get('seller_rating') or '-'}★, 리뷰 {r.get('seller_reviews') or '?'})\n{r['url']}")


def _already(con, wid, lid, kind, price) -> bool:
    row = con.execute("SELECT price_krw FROM alerts_sent WHERE watch_id=? AND listing_id=? AND kind=?",
                      (wid, lid, kind)).fetchone()
    return row is not None and price >= row["price_krw"]


def evaluate(con, new_ids: set[int]) -> list[tuple[str, str]]:
    """Returns [(kind, message)] to send and records them as sent."""
    out = []
    for w in con.execute("SELECT * FROM watches").fetchall():
        rows = matching(con, w["keyword"])
        if w["max_price_krw"]:
            rows = [r for r in rows if r["price_krw"] <= w["max_price_krw"]]
        if w["min_score"]:
            rows = [r for r in rows if r["score"] >= w["min_score"]]
        if not rows:
            continue
        picks = []
        if w["notify_new"]:
            picks += [("new", r) for r in sorted(rows, key=lambda r: r["price_krw"]) if r["id"] in new_ids][:MAX_NEW_PER_WATCH]
        if w["notify_cheapest"]:
            picks.append(("cheapest", min(rows, key=lambda r: r["price_krw"])))
        if w["notify_best_value"]:
            picks.append(("best_value", max(rows, key=lambda r: r["score"])))
        for kind, r in picks:
            if _already(con, w["id"], r["id"], kind, r["price_krw"]):
                continue
            con.execute("INSERT OR REPLACE INTO alerts_sent VALUES(?,?,?,?,?)",
                        (w["id"], r["id"], kind, r["price_krw"], now()))
            out.append((kind, _fmt(kind, r, w["keyword"])))
    con.commit()
    return out


async def send(messages: list[tuple[str, str]]):
    discord, tg_token, tg_chat = (os.getenv("DISCORD_WEBHOOK_URL"), os.getenv("TELEGRAM_BOT_TOKEN"),
                                  os.getenv("TELEGRAM_CHAT_ID"))
    if not messages:
        return
    if not (discord or (tg_token and tg_chat)):
        for _, m in messages:
            log.info("ALERT (no channel configured):\n%s", m)
        return
    async with httpx.AsyncClient(timeout=15) as c:
        for _, m in messages:
            try:
                if discord:
                    await c.post(discord, json={"content": m[:1900]})
                if tg_token and tg_chat:
                    await c.post(f"https://api.telegram.org/bot{tg_token}/sendMessage",
                                 json={"chat_id": tg_chat, "text": m[:4000]})
            except Exception as e:
                log.warning("notify failed: %s", e)
