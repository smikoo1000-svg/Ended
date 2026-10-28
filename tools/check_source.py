"""Try a marketplace config before enabling it.

    python -m tools.check_source <name> "<query>" [sources.yaml]

Prints HTTP status, robots.txt verdict, how many items the selector matched,
and the parsed offers (with normalized product + trust inputs), so you can see
exactly which selector is wrong instead of silently getting zero results.
"""
import asyncio
import sys

import httpx

from app import collector, normalize
from app.sources.generic import GenericSource


async def main(name, query, path):
    cfg = collector.load_config(path)
    sc = next((s for s in cfg["sources"] if s["name"] == name), None)
    if not sc:
        sys.exit(f"no source named {name!r}; have: {[s['name'] for s in cfg['sources']]}")
    src = GenericSource(sc)
    async with httpx.AsyncClient(timeout=20, headers={"User-Agent": collector.UA}, follow_redirects=True) as client:
        url = sc["search_url"].replace("{query}", query)
        print("URL      :", url)
        print("robots   :", "allowed" if await src._allowed(client, url) else "BLOCKED")
        r = await client.get(url, headers=sc.get("headers"))
        print("HTTP     :", r.status_code, f"({len(r.text)} bytes)")
        if sc.get("type", "html") == "html":
            from bs4 import BeautifulSoup
            n = len(BeautifulSoup(r.text, "html.parser").select(sc["selectors"]["item"]))
            print("items    :", n, "matched by selectors.item", "" if n else "<- selector wrong, or page is rendered by JS / bot-blocked")
        offers = await src.search(client, query)
    print("parsed   :", len(offers))
    for o in offers[:8]:
        p = normalize.parse(o.title)
        print(f"  {o.price:>10,.0f} {o.currency} | {o.title[:50]!r} | {p.key} | "
              f"rating={o.seller_rating} reviews={o.seller_reviews} sales={o.seller_sales}")
    missing = [f for f in ("seller_rating", "seller_reviews", "seller_sales") if offers and not any(getattr(o, f) for o in offers)]
    if missing:
        print("note     : never extracted ->", ", ".join(missing), "(trust score will be pessimistic for this site)")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "sources.yaml"))
