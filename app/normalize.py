"""Turn free-form listing titles into a comparable product key.

"넷플릭스 프리미엄 4K 12개월 (정식)"  ->  brand=netflix tier=premium months=12
Two listings are only compared on price when they share brand, tier and duration,
because "Netflix 1 month" vs "Netflix 12 months" is not a price difference.
"""
import re
from dataclasses import dataclass
from typing import Optional

BRANDS = {
    "netflix": ["netflix", "넷플릭스", "넷플"],
    "youtube": ["youtube", "유튜브"],
    "spotify": ["spotify", "스포티파이"],
    "chatgpt": ["chatgpt", "chat gpt", "챗gpt", "챗지피티", "openai"],
    "claude": ["claude", "클로드"],
    "gemini": ["gemini", "제미나이", "google ai"],
    "disney": ["disney", "디즈니"],
    "wavve": ["wavve", "웨이브"],
    "tving": ["tving", "티빙"],
    "windows": ["windows", "윈도우", "윈도"],
    "office": ["office", "오피스", "microsoft 365", "ms365"],
    "adobe": ["adobe", "어도비", "photoshop", "포토샵", "creative cloud"],
    "steam": ["steam", "스팀"],
    "xbox": ["xbox", "엑스박스", "game pass", "게임패스"],
    "playstation": ["playstation", "플레이스테이션", "psn", "ps plus"],
    "nintendo": ["nintendo", "닌텐도"],
    "canva": ["canva", "캔바"],
    "notion": ["notion", "노션"],
}
TIERS = {
    "premium": ["premium", "프리미엄"], "plus": ["plus", "플러스"], "pro": ["pro", "프로"],
    "basic": ["basic", "베이직"], "standard": ["standard", "스탠다드"], "family": ["family", "패밀리"],
    "student": ["student", "학생"], "ultimate": ["ultimate", "얼티밋"], "max": ["max", "맥스"],
    "team": ["team", "팀"], "individual": ["individual", "개인"],
}
KINDS = {
    "key": ["key", "키", "시리얼", "serial", "라이선스", "license", "코드", "code"],
    "account": ["account", "계정", "공유", "shared"],
    "sub": ["subscription", "구독", "멤버십", "membership"],
}
_DUR = [
    (re.compile(r"(\d+(?:\.\d+)?)\s*(?:개월|달|months?|mos?|m)\b", re.I), 1.0),
    (re.compile(r"(\d+(?:\.\d+)?)\s*(?:년|years?|yrs?|y)\b", re.I), 12.0),
    (re.compile(r"(\d+(?:\.\d+)?)\s*(?:주|weeks?|w)\b", re.I), 7 / 30),
    (re.compile(r"(\d+(?:\.\d+)?)\s*(?:일|days?|d)\b", re.I), 1 / 30),
]
_LIFETIME = re.compile(r"평생|영구|lifetime|permanent", re.I)


@dataclass
class Product:
    brand: Optional[str]
    tier: Optional[str]
    kind: Optional[str]
    months: Optional[float]
    lifetime: bool

    @property
    def key(self) -> Optional[str]:
        if not self.brand:
            return None
        dur = "life" if self.lifetime else (f"{self.months:g}m" if self.months else "?")
        return f"{self.brand}|{self.tier or '-'}|{dur}"


def _first(text: str, table: dict) -> Optional[str]:
    best = None
    for name, words in table.items():
        for w in words:
            # short ASCII words must match as whole tokens ("pro" must not hit "product")
            pat = rf"(?<![a-z0-9]){re.escape(w)}(?![a-z0-9])" if w.isascii() and len(w) <= 4 else re.escape(w)
            m = re.search(pat, text)
            if m and (best is None or m.start() < best[0]):
                best = (m.start(), name)
    return best[1] if best else None


def parse(title: str) -> Product:
    t = title.lower()
    months = None
    for rx, mult in _DUR:
        m = rx.search(t)
        if m:
            months = round(float(m.group(1)) * mult, 3)
            break
    return Product(_first(t, BRANDS), _first(t, TIERS), _first(t, KINDS), months, bool(_LIFETIME.search(t)))


def unit_price(price_krw: float, p: Product) -> float:
    return round(price_krw / p.months, 0) if p.months and not p.lifetime else price_krw
