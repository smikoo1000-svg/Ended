"""Config-driven source: adding a marketplace = adding a block in sources.yaml.

type: html -> CSS selectors; type: json -> dotted paths into the response.
"""
import re
from urllib.parse import quote_plus, urljoin

from bs4 import BeautifulSoup

from .base import Offer, Source


def _num(text):
    if text is None:
        return None
    m = re.sub(r"[^\d.]", "", str(text).replace(",", ""))
    try:
        return float(m) if m else None
    except ValueError:
        return None


def _dig(obj, path):
    for part in (path or "").split("."):
        if part == "":
            continue
        if isinstance(obj, list):
            obj = obj[int(part)]
        else:
            obj = obj.get(part) if isinstance(obj, dict) else None
        if obj is None:
            return None
    return obj


class GenericSource(Source):
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.name = cfg["name"]

    async def search(self, client, query: str) -> list[Offer]:
        c = self.cfg
        url = c["search_url"].replace("{query}", quote_plus(query))
        resp = await client.get(url, headers=c.get("headers"))
        resp.raise_for_status()
        if c.get("type", "html") == "json":
            return self._parse_json(resp.json(), url)
        return self._parse_html(resp.text, url)

    def _parse_html(self, html, base):
        c, sel = self.cfg, self.cfg["selectors"]
        soup = BeautifulSoup(html, "html.parser")
        out = []
        for item in soup.select(sel["item"]):
            def pick(key, attr=None):
                if key not in sel:
                    return None
                el = item.select_one(sel[key])
                if not el:
                    return None
                return el.get(attr) if attr else el.get_text(" ", strip=True)

            title, link, price = pick("title"), pick("link", "href"), _num(pick("price"))
            if not (title and link and price):
                continue
            link = urljoin(base, link)
            out.append(Offer(
                ext_id=pick("id") or link, title=title, url=link, price=price,
                currency=c.get("currency", "KRW"), category=c.get("category"),
                seller=pick("seller"), seller_rating=_num(pick("rating")),
                seller_sales=int(_num(pick("sales")) or 0) or None,
                seller_reviews=int(_num(pick("reviews")) or 0) or None,
                stock=int(_num(pick("stock")) or 0) or None))
        return out

    def _parse_json(self, data, base):
        c, f = self.cfg, self.cfg["fields"]
        out = []
        for it in _dig(data, c.get("items_path", "")) or []:
            title, link, price = _dig(it, f["title"]), _dig(it, f["link"]), _num(_dig(it, f["price"]))
            if not (title and link and price):
                continue
            link = urljoin(base, str(link))
            g = lambda k: _dig(it, f[k]) if k in f else None  # noqa: E731
            out.append(Offer(
                ext_id=str(g("id") or link), title=str(title), url=link, price=price,
                currency=c.get("currency", "KRW"), category=c.get("category"),
                seller=g("seller"), seller_rating=_num(g("rating")),
                seller_sales=int(_num(g("sales")) or 0) or None,
                seller_reviews=int(_num(g("reviews")) or 0) or None,
                stock=int(_num(g("stock")) or 0) or None))
        return out
