"""Value score: how good a deal is, adjusted for how trustworthy the seller is.

score = price_advantage * trust
  price_advantage = median price of comparable listings / this price (capped)
  trust           = 0.4..1.0, built from star rating, review count and sales volume

The star rating is shrunk toward a neutral prior by the number of reviews
(Bayesian average), so 5.0★ from 3 reviews ranks below 4.8★ from 2,000 reviews.
Unknown data is treated pessimistically: gray-market sellers vary wildly in
reliability and a cheap listing from an unrated seller must not win by default.
"""
import math
import statistics

PRIOR_RATING = 3.5   # what we assume about a seller we know nothing about
PRIOR_WEIGHT = 10    # "virtual reviews" pulling toward the prior


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


def score_listings(rows: list[dict]) -> list[dict]:
    """Adds `trust` and `score` to each row."""
    if not rows:
        return rows
    med = statistics.median(r["price_krw"] for r in rows)
    for r in rows:
        adv = min(med / r["price_krw"], 3.0) if r["price_krw"] > 0 else 0
        r["trust"] = trust(r.get("seller_rating"), r.get("seller_sales"), r.get("seller_reviews"))
        r["score"] = round(adv * r["trust"] * 100, 1)
    return rows
