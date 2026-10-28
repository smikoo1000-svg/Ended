import asyncio

from app import alerts, collector, db
from app.scoring import score_listings, trust
from app.sources.base import Offer
from app.sources.generic import GenericSource

HTML = """<div class=c><a href="/p/1">Netflix 1개월</a><span class=p>9,900원</span><i class=s>shop</i></div>
<div class=c><a href="/p/2">no price</a></div>"""


def test_trust_orders_sellers():
    assert trust(5, 5000) > trust(4, 50) > trust(None, None) - 0.2
    assert 0.4 <= trust(0, 0) <= 1.0


def test_few_reviews_cannot_fake_trust():
    assert trust(5.0, None, 3) < trust(4.8, None, 2000)
    assert trust(4.8, None, 2000) > trust(None, None, None)


def test_cheap_unproven_seller_does_not_beat_proven():
    rows = [dict(price_krw=5000, seller_rating=None, seller_sales=None),
            dict(price_krw=6000, seller_rating=5, seller_sales=5000),
            dict(price_krw=9000, seller_rating=4, seller_sales=100)]
    s = score_listings(rows)
    assert s[1]["score"] > s[0]["score"]


def test_html_parse():
    src = GenericSource({"name": "x", "search_url": "https://a.test/?q={query}", "selectors": {
        "item": ".c", "title": "a", "link": "a", "price": ".p", "seller": ".s"}})
    out = src._parse_html(HTML, "https://a.test/")
    assert len(out) == 1 and out[0].price == 9900 and out[0].url == "https://a.test/p/1"


def test_new_cheapest_and_no_duplicate_alerts(tmp_path):
    con = db.connect(tmp_path / "t.db")
    con.execute("INSERT INTO watches(keyword,max_price_krw) VALUES('netflix', 10000)")
    ts = collector.now()
    ids = [collector.upsert(con, "s", Offer(f"{i}", f"Netflix {i}", "https://x.test", p, seller_rating=4.5, seller_sales=300),
                            {"KRW": 1}, ts)[0] for i, p in enumerate([9000, 12000, 8000])]
    msgs = alerts.evaluate(con, set(ids))
    kinds = [k for k, _ in msgs]
    assert kinds.count("new") == 2 and "cheapest" in kinds and "best_value" in kinds  # 12000 filtered out
    assert alerts.evaluate(con, set()) == []                                          # nothing re-sent
    collector.upsert(con, "s", Offer("2", "Netflix 2", "https://x.test", 7000, seller_rating=4.5, seller_sales=300), {"KRW": 1}, ts)
    assert any(k == "cheapest" for k, _ in alerts.evaluate(con, set()))               # price drop re-alerts


def test_collect_demo_end_to_end(tmp_path):
    con = db.connect(tmp_path / "t.db")
    cfg = {"settings": {"per_site_delay": 0}, "rates": {"KRW": 1}, "sources": [{"name": "d", "type": "demo"}]}
    res = asyncio.run(collector.collect(con, cfg, ["Netflix"]))
    assert res["total"] > 0 and res["new_ids"]
