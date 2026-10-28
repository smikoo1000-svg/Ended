import sqlite3
from pathlib import Path

DB_PATH = Path("ended.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    ext_id TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    category TEXT,
    price_krw REAL NOT NULL,
    orig_price REAL,
    currency TEXT,
    seller TEXT,
    seller_rating REAL,      -- 0..5, NULL if unknown
    seller_sales INTEGER,    -- completed sales count, NULL if unknown
    seller_reviews INTEGER,  -- number of reviews behind seller_rating, NULL if unknown
    stock INTEGER,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(source, ext_id)
);
CREATE INDEX IF NOT EXISTS idx_listings_first_seen ON listings(first_seen);
CREATE TABLE IF NOT EXISTS price_history (
    listing_id INTEGER NOT NULL,
    ts TEXT NOT NULL,
    price_krw REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS watches (
    id INTEGER PRIMARY KEY,
    keyword TEXT NOT NULL,
    max_price_krw REAL,
    min_score REAL,
    notify_new INTEGER NOT NULL DEFAULT 1,
    notify_cheapest INTEGER NOT NULL DEFAULT 1,
    notify_best_value INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS alerts_sent (
    watch_id INTEGER NOT NULL,
    listing_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    price_krw REAL NOT NULL,
    ts TEXT NOT NULL,
    PRIMARY KEY (watch_id, listing_id, kind)
);
CREATE TABLE IF NOT EXISTS source_status (
    source TEXT PRIMARY KEY,
    last_run TEXT,
    ok INTEGER,
    count INTEGER,
    error TEXT
);
"""


def connect(path=None) -> sqlite3.Connection:
    con = sqlite3.connect(str(path or DB_PATH), check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con
