"""Offline demo source so the whole pipeline can be tried without hitting any site."""
import random
import time

from .base import Offer, Source

PRODUCTS = ["Netflix Premium 1개월", "YouTube Premium 12개월", "ChatGPT Plus 1개월",
            "Spotify Premium 6개월", "Windows 11 Pro 키", "Adobe Creative Cloud 1개월"]


class DemoSource(Source):
    def __init__(self, cfg):
        self.name = cfg["name"]
        self.base = cfg.get("base_price", 10000)

    async def search(self, client, query):
        rnd = random.Random(f"{self.name}{query}{int(time.time() // 120)}")
        out = []
        for p in PRODUCTS:
            if query.lower() not in p.lower():
                continue
            for i in range(rnd.randint(1, 3)):
                out.append(Offer(
                    ext_id=f"{p}-{i}", title=f"{p} (판매자{i})", url=f"https://example.invalid/{self.name}/{i}",
                    price=round(self.base * rnd.uniform(0.5, 1.4), -2), category="demo",
                    seller=f"seller{rnd.randint(1, 50)}", seller_rating=round(rnd.uniform(3, 5), 1),
                    seller_sales=rnd.choice([None, 5, 80, 900, 5000]),
                    seller_reviews=rnd.choice([None, 2, 40, 600, 3000])))
        return out
