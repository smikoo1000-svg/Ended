"""Triage candidate marketplaces before writing selectors.

    python -m tools.probe_sites [candidates.yaml]

For each site: reachable? blocked by a bot wall? robots.txt verdict for a search path?
Does the HTML contain data (server-rendered / JSON-LD / __NEXT_DATA__) or is it an empty JS shell?
Sites that are blocked or JS-only need a different approach than the generic HTML source.
"""
import asyncio
import re
import sys
from urllib.robotparser import RobotFileParser

import httpx
import yaml

from app.collector import UA

BOT_WALL = re.compile(r"just a moment|cf-chl|attention required|captcha|access denied|enable javascript", re.I)


async def probe(client, site):
    base, out = site["url"].rstrip("/"), {"name": site["name"]}
    try:
        rr = await client.get(base + "/robots.txt")
        rp = RobotFileParser()
        rp.parse(rr.text.splitlines() if rr.status_code == 200 else [])
        out["robots"] = "ok" if rp.can_fetch("EndedPriceBot", base + "/search?q=test") else "BLOCKS /search"
        r = await client.get(base + "/")
    except Exception as e:
        return out | {"status": f"unreachable ({type(e).__name__})"}
    html = r.text
    out["status"] = r.status_code
    out["bot_wall"] = bool(BOT_WALL.search(html[:5000])) or r.status_code in (403, 429, 503)
    out["data_in_html"] = ("__NEXT_DATA__" in html) or ("application/ld+json" in html) or len(re.findall(r"<a\s", html)) > 40
    out["verdict"] = ("skip: bot wall" if out["bot_wall"] else "skip: robots" if out["robots"] != "ok"
                      else "try generic html/json source" if out["data_in_html"] else "JS shell: look for its JSON API")
    return out


async def main(path):
    sites = yaml.safe_load(open(path, encoding="utf-8"))["sites"]
    async with httpx.AsyncClient(timeout=20, headers={"User-Agent": UA}, follow_redirects=True) as c:
        for s in sites:
            r = await probe(c, s)
            print(f"{r['name']:<18} {str(r.get('status')):<8} robots={r.get('robots','-'):<14} {r.get('verdict','')}")
            await asyncio.sleep(1.5)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "candidates.yaml"))
