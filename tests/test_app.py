import pytest
from fastapi.testclient import TestClient

from app import db
from app.crawler.base import parse_price
from app.crawler.run import crawl_source
from app.crawler.sources import SOURCES


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "t.db"))
    conn = db.connect()

    class NoNet:  # demo sources are file: fixtures, so the fetcher is never used
        pass

    for s in SOURCES:
        if s["enabled"]:
            crawl_source(conn, s, NoNet())
    from app.main import app
    return TestClient(app)


def test_parse_price():
    assert parse_price("12,900원") == 12900
    assert parse_price("no price") is None


def test_same_product_groups_across_stores_and_cheapest_wins(client):
    r = client.get("/api/search", params={"q": "elden ring"}).json()
    assert len(r) == 1
    assert r[0]["best_price"] == 49900 and r[0]["store_count"] == 2
    assert r[0]["best_store"] == "데모스토어B"


def test_category_filter_and_sort(client):
    r = client.get("/api/search", params={"category": "game"}).json()
    assert [x["best_price"] for x in r] == sorted(x["best_price"] for x in r)
    assert all(x["category"] == "game" for x in r)


def test_like_wildcards_are_escaped(client):
    assert client.get("/api/search", params={"q": "%"}).json() == []


def test_price_history_only_on_change(tmp_path):
    conn = db.connect(str(tmp_path / "h.db"))
    kw = dict(category="game", name="X", store="S", url="https://s/x")
    db.upsert_offer(conn, price=100, **kw)
    db.upsert_offer(conn, price=100, **kw)
    db.upsert_offer(conn, price=90, **kw)
    assert conn.execute("SELECT COUNT(*) FROM price_history").fetchone()[0] == 2


def test_product_detail_404(client):
    assert client.get("/api/products/9999").status_code == 404
