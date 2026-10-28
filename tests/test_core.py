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


def test_normalize_titles():
    from app.normalize import parse
    a = parse("넷플릭스 프리미엄 4K 12개월 (정식)")
    assert (a.brand, a.tier, a.months, a.key) == ("netflix", "premium", 12, "netflix|premium|12m")
    b = parse("ChatGPT Plus 1 Year account")
    assert (b.brand, b.tier, b.months) == ("chatgpt", "plus", 12)
    assert parse("Windows 11 Pro lifetime key").key == "windows|pro|life"
    assert parse("product review").tier is None      # "pro" must not match inside "product"
    assert parse("random thing").key is None


def test_duration_is_not_a_price_difference():
    rows = [dict(price_krw=p, product_key=k, duration_months=m, unit_price_krw=p / m, seller_rating=4.5, seller_reviews=100)
            for p, k, m in [(10000, "netflix|premium|1m", 1), (11000, "netflix|premium|1m", 1), (12000, "netflix|premium|1m", 1),
                            (100000, "netflix|premium|12m", 12)]]
    s = score_listings(rows)
    assert s[3]["score"] < 150 and s[0]["group_size"] == 3 and s[3]["group_size"] == 1


def test_history_and_auth(tmp_path, monkeypatch):
    monkeypatch.setenv("ENDED_DB", str(tmp_path / "a.db"))
    monkeypatch.setenv("ADMIN_TOKEN", "s3cret")
    import importlib
    from fastapi.testclient import TestClient
    import app.db, app.main
    importlib.reload(app.db); m = importlib.reload(app.main)
    c = TestClient(m.app)
    assert c.post("/api/watches", json={"keyword": "x"}).status_code == 401
    assert c.post("/api/watches", json={"keyword": "x"}, headers={"X-Admin-Token": "s3cret"}).status_code == 200
    assert c.get("/healthz").json() == {"ok": True}
    ts = collector.now()
    collector.upsert(m.con, "s", Offer("1", "Netflix Premium 1개월", "https://x.test", 9000), {"KRW": 1}, ts)
    collector.snapshot(m.con, ts); m.con.commit()
    h = c.get("/api/history", params={"product_key": "netflix|premium|1m"}).json()
    assert h and h[0]["min_price_krw"] == 9000
    assert c.get("/api/listings/1/history").json()[0]["price_krw"] == 9000


def test_gift_card_face_value():
    from app.normalize import parse
    assert parse("Netflix TRY 150 Gift Card TR").key == "netflix|giftcard|TRY150"
    assert parse("Netflix 100 USD").key == "netflix|giftcard|USD100"
    assert parse("$50.00 USD Netflix Gift Card").key == "netflix|giftcard|USD50"
    assert parse("Netflix Gift Card BRL 55,90 BR").face == ("BRL", 55.9)
    assert parse("Netflix Premium 1개월").key == "netflix|premium|1m"   # duration wins, no face value


def test_bogus_price_is_dropped(tmp_path):
    con = db.connect(tmp_path / "t.db")
    rates = {"KRW": 1, "EUR": 1500, "TRY": 33}
    ok = collector.upsert(con, "s", Offer("1", "Netflix TRY 150 Gift Card", "https://x.test", 12.74, "EUR"), rates, collector.now())
    bad = collector.upsert(con, "s", Offer("2", "Netflix TRY 400 Gift Card", "https://x.test", 10499, "EUR"), rates, collector.now())
    assert ok[0] and bad[0] is None


def test_feed_source_parse_and_filter(monkeypatch):
    import gzip
    from app.sources.feed import FeedSource, expand_env
    csv_text = ("aw_product_id,product_name,aw_deep_link,search_price,currency,in_stock\n"
                "1,Netflix Premium 1 Month,https://ex.test/1,9.99,EUR,1\n"
                "2,Netflix Basic 1 Month,https://ex.test/2,4.50,EUR,0\n"
                "3,Spotify Premium 12 Months,https://ex.test/3,\"39,90\",EUR,1\n")
    src = FeedSource({"name": "f", "url": "x", "columns": {"id": "aw_product_id", "title": "product_name", "link": "aw_deep_link",
                                                            "price": "search_price", "currency": "currency", "stock": "in_stock"}})
    offers = src.parse(gzip.compress(csv_text.encode()))
    assert [o.ext_id for o in offers] == ["1", "3"]            # out-of-stock row dropped, gzip handled
    assert offers[0].price == 9.99 and offers[0].currency == "EUR"
    assert offers[1].price == 39.9                              # decimal comma, not 3990
    monkeypatch.delenv("NOPE_FEED", raising=False)
    import pytest
    with pytest.raises(RuntimeError):
        expand_env("https://x.test/${NOPE_FEED}")


def test_more_currencies_and_unknown_denomination():
    from app.normalize import parse
    assert parse("Netflix Gift Card 20000 COP CO").key == "netflix|giftcard|COP20000"
    assert parse("Netflix 70,00 R$ (BRL - Brazil) Gift Card").face == ("BRL", 70.0)
    assert parse("Netflix Gift Card").key is None            # denomination unknown -> not comparable
