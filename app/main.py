import asyncio
import logging
import os
import secrets
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import alerts, collector, db
from .scoring import score_listings

logging.basicConfig(level=logging.INFO)
con = db.connect()
cfg = collector.load_config(os.getenv("ENDED_CONFIG", "sources.yaml"))
lock = asyncio.Lock()


async def run_once():
    async with lock:
        st = cfg.get("settings", {})
        queries = sorted({w["keyword"] for w in con.execute("SELECT keyword FROM watches")} | set(st.get("queries", [])))
        res = await collector.collect(con, cfg, queries)
        await alerts.send(alerts.evaluate(con, set(res["new_ids"])))
        return res


async def loop():
    while True:
        try:
            await run_once()
        except Exception:
            logging.exception("collect loop error")
        await asyncio.sleep(cfg.get("settings", {}).get("interval_seconds", 300))


@asynccontextmanager
async def lifespan(_):
    task = asyncio.create_task(loop())
    yield
    task.cancel()

app = FastAPI(title="Ended", lifespan=lifespan)


def admin(x_admin_token: str | None = Header(default=None)):
    """If ADMIN_TOKEN is set, every state-changing endpoint requires it. Set it when exposing the app publicly."""
    token = os.getenv("ADMIN_TOKEN")
    if token and not secrets.compare_digest(x_admin_token or "", token):
        raise HTTPException(401, "invalid or missing X-Admin-Token")


class Watch(BaseModel):
    keyword: str
    max_price_krw: float | None = None
    min_score: float | None = None
    notify_new: bool = True
    notify_cheapest: bool = True
    notify_best_value: bool = True


@app.get("/api/search")
def search(q: str, sort: str = "price", limit: int = 100):
    """sort: price (cheapest) | new (newest) | value (best score)"""
    rows = alerts.matching(con, q)
    key = {"price": lambda r: r["price_krw"], "new": lambda r: r["first_seen"], "value": lambda r: r["score"]}.get(sort)
    if key is None:
        raise HTTPException(400, "sort must be price|new|value")
    rows.sort(key=key, reverse=sort != "price")
    return {"count": len(rows), "items": rows[:limit]}


@app.post("/api/refresh", dependencies=[Depends(admin)])
async def refresh(q: str | None = None):
    if q:
        res = await collector.collect(con, cfg, [q])
        return {"total": res["total"], "new": len(res["new_ids"])}
    res = await run_once()
    return {"total": res["total"], "new": len(res["new_ids"])}


@app.get("/api/watches")
def list_watches():
    return [dict(r) for r in con.execute("SELECT * FROM watches")]


@app.post("/api/watches", dependencies=[Depends(admin)])
def add_watch(w: Watch):
    cur = con.execute(
        "INSERT INTO watches(keyword,max_price_krw,min_score,notify_new,notify_cheapest,notify_best_value) VALUES(?,?,?,?,?,?)",
        (w.keyword.strip(), w.max_price_krw, w.min_score, w.notify_new, w.notify_cheapest, w.notify_best_value))
    con.commit()
    return {"id": cur.lastrowid}


@app.delete("/api/watches/{wid}", dependencies=[Depends(admin)])
def del_watch(wid: int):
    con.execute("DELETE FROM watches WHERE id=?", (wid,))
    con.execute("DELETE FROM alerts_sent WHERE watch_id=?", (wid,))
    con.commit()
    return {"ok": True}


@app.get("/api/alerts")
def recent_alerts(limit: int = 50):
    rows = con.execute("""SELECT a.kind, a.ts, a.price_krw, w.keyword, l.title, l.url, l.source
                          FROM alerts_sent a JOIN listings l ON l.id=a.listing_id JOIN watches w ON w.id=a.watch_id
                          ORDER BY a.ts DESC LIMIT ?""", (limit,)).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/history")
def history(product_key: str, days: int = 30):
    """Market-wide min/median price trend for one comparable product (brand|tier|duration)."""
    rows = con.execute(
        """SELECT ts, min_price_krw, median_price_krw, n FROM market_snapshots
           WHERE product_key=? AND ts >= datetime('now', ?) ORDER BY ts""", (product_key, f"-{int(days)} days")).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/listings/{lid}/history")
def listing_history(lid: int):
    return [dict(r) for r in con.execute("SELECT ts, price_krw FROM price_history WHERE listing_id=? ORDER BY ts", (lid,))]


@app.get("/healthz")
def healthz():
    con.execute("SELECT 1")
    return {"ok": True}


@app.get("/api/sources")
def sources():
    return [dict(r) for r in con.execute("SELECT * FROM source_status ORDER BY source")]


@app.get("/")
def index():
    return FileResponse("static/index.html")


app.mount("/static", StaticFiles(directory="static"), name="static")
