import pathlib
import sys

from app import db
from app.crawler.base import Fetcher, parse_items
from app.crawler.sources import DEFAULTS, SOURCES

ROOT = pathlib.Path(__file__).resolve().parents[2]


def crawl_source(conn, source: dict, fetcher: Fetcher) -> int:
    cfg = {**DEFAULTS, **{k: v for k, v in source.items() if v}}
    n = 0
    for url in source["urls"]:
        if url.startswith("file:"):
            html = (ROOT / url[5:]).read_text(encoding="utf-8")
            base = ""
        else:
            html = fetcher.get(url)
            base = url
        if html is None:
            print(f"  skip {url} (blocked by robots.txt or fetch failed)", file=sys.stderr)
            continue
        for it in parse_items(html, cfg, base):
            db.upsert_offer(
                conn, category=source["category"], name=it.name,
                store=source["store"], price=it.price, url=it.url or url,
            )
            n += 1
    return n


def main():
    conn = db.connect()
    fetcher = Fetcher()
    for s in SOURCES:
        if not s.get("enabled"):
            continue
        print(f"{s['store']}: {crawl_source(conn, s, fetcher)} items")


if __name__ == "__main__":
    main()
