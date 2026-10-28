from dataclasses import dataclass
from typing import Optional


@dataclass
class Offer:
    ext_id: str
    title: str
    url: str
    price: float                 # in `currency`
    currency: str = "KRW"
    category: Optional[str] = None
    seller: Optional[str] = None
    seller_rating: Optional[float] = None
    seller_sales: Optional[int] = None
    seller_reviews: Optional[int] = None
    stock: Optional[int] = None


class Source:
    name: str

    async def search(self, client, query: str) -> list[Offer]:
        raise NotImplementedError
