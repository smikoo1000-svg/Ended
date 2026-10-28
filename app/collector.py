import asyncio
import logging
import time
from datetime import datetime, timezone

import httpx
import yaml

from . import normalize
from .sources.demo import DemoSource
from .sources.generic import GenericSource

log = logging.getLogger("collector")
UA = "Mozilla/5.0 (compatible; EndedPriceBot/0.1)"


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_config(path="sources.yaml") -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def build_sources(cfg: dict):
    out = []
    for s in cfg.get("sources", []):
        out.append(DemoSource(s) if s.get("type") == "demo" else GenericSource(s))
    return out


def upsert(con, source: str, offer, rates: dict, ts: str):
    """Returns (listing_id, is_new, price_dropped)."""
    price_krw = round(offer.price * rates.get(offer.currency, 1), 0)
    prod = normalize.parse(offer.title)
    unit = normalize.unit_price(price_krw, prod)
    row = con.execute("SELECT id, price_krw FROM listings WHERE source=? AND ext_id=?",
                      (source, offer.ext_id)).fetchone()
    if row is None:
        cur = con.execute(
            """INSERT INTO listings(source, ext_id, title, url, category, price_krw, orig_price, currency,
               seller, seller_rating, seller_sales, seller_reviews, stock, brand, product_key,
               duration_months, unit_price_krw, first_seen, last_seen)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (source, offer.ext_id, offer.title, offer.url, offer.category, price_krw, offer.price,
             offer.currency, offer.seller, offer.seller_rating, offer.seller_sales, offer.seller_reviews, offer.stock,
             prod.brand, prod.key, prod.months, unit, ts, ts))
        con.execute("INSERT INTO price_history VALUES(?,?,?)", (cur.lastrowid, ts, price_krw))
        return cur.lastrowid, True, False
    dropped = price_krw < row["price_krw"]
    if price_krw != row["price_krw"]:
        con.execute("INSERT INTO price_history VALUES(?,?,?)", (row["id"], ts, price_krw))
    con.execute("""UPDATE listings SET title=?, url=?, price_krw=?, orig_price=?, seller_rating=?,
                   seller_sales=?, seller_reviews=?, stock=?, brand=?, product_key=?, duration_months=?,
                   unit_price_krw=?, last_seen=?, active=1 WHERE id=?""",
                (offer.title, offer.url, price_krw, offer.price, offer.seller_rating,
                 offer.seller_sales, offer.seller_reviews, offer.stock,
                 prod.brand, prod.key, prod.months, unit, ts, row["id"]))
    return row["id"], False, dropped


def snapshot(con, ts: str):
    """Record min/median price per product_key so price trends can be charted."""
    import statistics
    groups = {}
    for r in con.execute("SELECT product_key, price_krw FROM listings WHERE active=1 AND product_key IS NOT NULL"):
        groups.setdefault(r["product_key"], []).append(r["price_krw"])
    for pk, prices in groups.items():
        con.execute("INSERT INTO market_snapshots VALUES(?,?,?,?,?)",
                    (pk, ts, min(prices), statistics.median(prices), len(prices)))


async def _run_source(src, client, queries, delay, sem):
    offers, err = [], None
    async with sem:
        for q in queries:
            try:
                offers += await src.search(client, q)
            except Exception as e:  # one broken site must not stop the others
                err = f"{type(e).__name__}: {e}"
                log.warning("%s failed for %r: %s", src.name, q, err)
            await asyncio.sleep(delay)
    return src.name, offers, err


async def collect(con, cfg: dict, queries: list[str]) -> dict:
    """One full pass over every source. Returns stats and ids of new listings."""
    if not queries:
        return {"new_ids": [], "run_ts": now(), "total": 0}
    st = cfg.get("settings", {})
    rates = cfg.get("rates", {"KRW": 1})
    sem = asyncio.Semaphore(st.get("concurrency", 8))
    run_ts = now()
    async with httpx.AsyncClient(timeout=20, headers={"User-Agent": UA}, follow_redirects=True) as client:
        results = await asyncio.gather(*[
            _run_source(s, client, queries, st.get("per_site_delay", 2.0), sem)
            for s in build_sources(cfg)])
    new_ids, total = [], 0
    for name, offers, err in results:
        for o in offers:
            lid, is_new, _ = upsert(con, name, o, rates, run_ts)
            if is_new:
                new_ids.append(lid)
        total += len(offers)
        con.execute("INSERT OR REPLACE INTO source_status VALUES(?,?,?,?,?)",
                    (name, run_ts, 0 if err and not offers else 1, len(offers), err))
    # anything not refreshed for 3 intervals is considered gone (sold out / removed)
    cutoff = datetime.fromtimestamp(time.time() - 3 * st.get("interval_seconds", 300), timezone.utc)
    con.execute("UPDATE listings SET active=0 WHERE last_seen < ?", (cutoff.isoformat(timespec="seconds"),))
    snapshot(con, run_ts)
    con.commit()
    return {"new_ids": new_ids, "run_ts": run_ts, "total": total}
