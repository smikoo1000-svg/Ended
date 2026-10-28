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

CURRENCIES = ("USD|EUR|GBP|TRY|PLN|BRL|SAR|AED|JPY|KRW|CAD|AUD|CHF|SEK|NOK|DKK|MXN|INR|COP|CLP|ARS|PEN|ZAR|PHP|IDR|"
              "THB|VND|NZD|RUB|UAH|CZK|HUF|RON|ILS|EGP|NGN|HKD|SGD|TWD|MYR")
_GIFTCARD = re.compile(r"gift ?card|top-?up|기프트|상품권|충전", re.I)
_SYMBOLS = {"$": "USD", "€": "EUR", "£": "GBP", "₩": "KRW", "¥": "JPY", "₺": "TRY", "zł": "PLN"}
_AMT = r"(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d{1,2})?)"
_FACE = [
    re.compile(rf"(?<![a-z])({CURRENCIES})\s?{_AMT}(?!\d)", re.I),      # "TRY 150", "USD 25"
    re.compile(rf"{_AMT}\s?({CURRENCIES})(?![a-z])", re.I),              # "100 USD"
    re.compile(rf"([$€£₩¥₺])\s?{_AMT}"),                                 # "$50.00"
]


def _amount(txt: str) -> float:
    if re.fullmatch(r"\d+,\d{1,2}", txt):      # decimal comma: "55,90"
        txt = txt.replace(",", ".")
    return float(txt.replace(",", ""))


def parse_face_value(t: str):
    """Gift-card denomination as (CURRENCY, amount), e.g. 'Netflix TRY 150 Gift Card' -> ('TRY', 150)."""
    t = t.replace("R$", "BRL ")
    for i, rx in enumerate(_FACE):
        m = rx.search(t)
        if not m:
            continue
        a, b = m.groups()
        cur, amt = (a, b) if i == 0 else ((b, a) if i == 1 else (_SYMBOLS[a], b))
        return cur.upper(), _amount(amt)
    return None


@dataclass
class Product:
    brand: Optional[str]
    tier: Optional[str]
    kind: Optional[str]
    months: Optional[float]
    lifetime: bool
    face: Optional[tuple] = None   # (currency, amount) for gift cards / top-ups
    giftcard: bool = False

    @property
    def key(self) -> Optional[str]:
        if not self.brand:
            return None
        if self.giftcard and not self.face and not self.months and not self.lifetime:
            return None  # denomination unknown: cards of different value must not be compared on price
        if self.face and not self.months and not self.lifetime:
            # denominations are different products: a 15 USD card and a 100 USD card are not comparable
            return f"{self.brand}|giftcard|{self.face[0]}{self.face[1]:g}"
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
    lifetime = bool(_LIFETIME.search(t))
    face = None if (months or lifetime) else parse_face_value(title)
    return Product(_first(t, BRANDS), _first(t, TIERS), _first(t, KINDS), months, lifetime, face, bool(_GIFTCARD.search(t)))


def unit_price(price_krw: float, p: Product) -> float:
    return round(price_krw / p.months, 0) if p.months and not p.lifetime else price_krw
