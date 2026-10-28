"""Value score: how good a deal is, adjusted for how trustworthy the seller is.

score = price_advantage * trust
  price_advantage = median price of *comparable* listings / this price (capped)
  trust           = 0.4..1.0, built from star rating, review count and sales volume

Comparable = same brand|tier|duration (product_key). If that group is too small,
fall back to brand|tier compared on price-per-month. Rows without a recognised
product are compared with each other on raw price.

The star rating is shrunk toward a neutral prior by the number of reviews
(Bayesian average), so 5.0★ from 3 reviews ranks below 4.8★ from 2,000 reviews.
Unknown data is treated pessimistically: gray-market sellers vary wildly in
reliability and a cheap listing from an unrated seller must not win by default.
"""
import math
import statistics

PRIOR_RATING = 3.5   # what we assume about a seller we know nothing about
PRIOR_WEIGHT = 10    # "virtual reviews" pulling toward the prior
MIN_GROUP = 3


def bayes_rating(rating, reviews) -> float:
    if rating is None:
        return PRIOR_RATING
    n = reviews or 0
    return (max(0.0, min(rating, 5.0)) * n + PRIOR_RATING * PRIOR_WEIGHT) / (n + PRIOR_WEIGHT)


def volume(reviews, sales) -> float:
    """0..1; ~1000 reviews or sales is treated as fully established."""
    n = max(reviews or 0, sales or 0)
    return min(math.log10(n + 1) / 3.0, 1.0)


def trust(rating, sales, reviews=None) -> float:
    q = bayes_rating(rating, reviews) / 5.0
    return round(0.4 + 0.6 * (0.6 * q + 0.4 * volume(reviews, sales)), 3)


def _groups(rows):
    """Yield (list_of_rows, price_getter) comparison groups."""
    exact, coarse = {}, {}
    for r in rows:
        pk = r.get("product_key")
        exact.setdefault(pk, []).append(r)
    for pk, grp in exact.items():
        if pk is None or len(grp) >= MIN_GROUP:
            yield grp, lambda r: r["price_krw"]
        else:
            for r in grp:  # brand|tier, per-month price, only when duration is known
                base = pk.rsplit("|", 1)[0]
                if r.get("duration_months") and r.get("unit_price_krw"):
                    coarse.setdefault(base, []).append(r)
                else:
                    yield [r], lambda r: r["price_krw"]
    for grp in coarse.values():
        yield grp, lambda r: r.get("unit_price_krw") or r["price_krw"]


def score_listings(rows: list[dict]) -> list[dict]:
    """Adds `trust` and `score` to each row."""
    for grp, price in _groups(rows):
        med = statistics.median(price(r) for r in grp)
        for r in grp:
            p = price(r)
            adv = min(med / p, 3.0) if p > 0 else 0
            r["trust"] = trust(r.get("seller_rating"), r.get("seller_sales"), r.get("seller_reviews"))
            r["score"] = round(adv * r["trust"] * 100, 1)
            r["group_size"] = len(grp)
    return rows
