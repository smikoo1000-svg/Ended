"""Affiliate product feed source (Awin / FlexOffers / merchant CSV feeds).

Feeds are the sanctioned way to get a marketplace's catalogue: join the affiliate program,
copy the feed URL, put it in an env var (it usually embeds your API key), and reference it as
${VAR} in sources.yaml. The feed is downloaded at most once per `ttl` seconds and searched locally.
Feeds carry no seller ratings, so these sources get a conservative trust score.
"""
import csv
import gzip
import io
import os
import re
import time

from .base import Offer, Source
from .generic import _num

_CACHE: dict[str, tuple[float, list[Offer]]] = {}


def expand_env(url: str) -> str:
    out = os.path.expandvars(url)
    if re.search(r"\$\{?\w+\}?", out):
        raise RuntimeError(f"environment variable missing for feed url: {url!r}")
    return out


class FeedSource(Source):
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.name = cfg["name"]
        self.delay = cfg.get("delay", 0.1)  # one cached download, local search: no need to wait between queries

    def parse(self, raw: bytes) -> list[Offer]:
        c, col = self.cfg, self.cfg["columns"]
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        text = raw.decode(c.get("encoding", "utf-8-sig"), errors="replace")
        div = c.get("price_divisor", 1)
        out = []
        for row in csv.DictReader(io.StringIO(text), delimiter=c.get("delimiter", ",")):
            title, link, price = row.get(col["title"]), row.get(col["link"]), _num(row.get(col["price"]))
            if not (title and link and price):
                continue
            if "stock" in col and row.get(col["stock"], "1").strip().lower() in ("0", "false", "no", "out of stock"):
                continue
            cur = row.get(col["currency"]) if "currency" in col else None
            out.append(Offer(ext_id=row.get(col.get("id", ""), "") or link, title=title, url=link, price=price / div,
                             currency=(cur or c.get("currency", "USD")).upper(), category=row.get(col.get("category", ""))))
        return out

    async def _load(self, client) -> list[Offer]:
        url = expand_env(self.cfg["url"])
        hit = _CACHE.get(url)
        if hit and time.time() - hit[0] < self.cfg.get("ttl", 3600):
            return hit[1]
        r = await client.get(url, timeout=120)
        r.raise_for_status()
        offers = self.parse(r.content)
        _CACHE[url] = (time.time(), offers)
        return offers

    async def search(self, client, query: str) -> list[Offer]:
        words = query.lower().split()
        return [o for o in await self._load(client) if all(w in o.title.lower() for w in words)][:300]
