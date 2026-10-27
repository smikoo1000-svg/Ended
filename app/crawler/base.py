"""Polite, config-driven crawler.

Each source is a dict of CSS selectors, so adding a store means adding config,
not code. The fetcher honours robots.txt and rate-limits per host.
"""
import re
import time
import urllib.robotparser
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

USER_AGENT = "CheapestDigitalBot/0.1 (+price comparison; respects robots.txt)"
MIN_DELAY = 2.0  # seconds between requests to the same host


@dataclass
class Item:
    name: str
    price: int
    url: str


def parse_price(text: str) -> int | None:
    """'12,900원', '₩12900', '$9.99' -> int (won as-is; dollars are not converted)."""
    m = re.search(r"\d[\d,]*", text or "")
    return int(m.group().replace(",", "")) if m else None


def parse_items(html: str, source: dict, base_url: str = "") -> list[Item]:
    soup = BeautifulSoup(html, "lxml")
    out = []
    for node in soup.select(source["item"]):
        name_el = node.select_one(source["name"])
        price_el = node.select_one(source["price"])
        if not name_el or not price_el:
            continue
        price = parse_price(price_el.get_text(" ", strip=True))
        if price is None:
            continue
        link_el = node.select_one(source.get("link", "a")) or node.find("a")
        href = link_el.get("href", "") if link_el else ""
        out.append(Item(name_el.get_text(" ", strip=True), price, urljoin(base_url, href)))
    return out


class Fetcher:
    def __init__(self, client: httpx.Client | None = None, delay: float = MIN_DELAY):
        self.client = client or httpx.Client(
            headers={"User-Agent": USER_AGENT}, timeout=15, follow_redirects=True
        )
        self.delay = delay
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self._last: dict[str, float] = {}

    def _allowed(self, url: str) -> bool:
        host = urlparse(url)
        origin = f"{host.scheme}://{host.netloc}"
        if origin not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                r = self.client.get(origin + "/robots.txt")
                rp.parse(r.text.splitlines() if r.status_code == 200 else [])
                self._robots[origin] = rp
            except httpx.HTTPError:
                self._robots[origin] = None  # unreachable robots.txt -> be conservative
        rp = self._robots[origin]
        return rp is not None and rp.can_fetch(USER_AGENT, url)

    def get(self, url: str) -> str | None:
        if not self._allowed(url):
            return None
        host = urlparse(url).netloc
        wait = self._last.get(host, 0) + self.delay - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self._last[host] = time.monotonic()
        try:
            r = self.client.get(url)
            r.raise_for_status()
            return r.text
        except httpx.HTTPError:
            return None
