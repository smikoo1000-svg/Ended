import os
import re
import sqlite3
import time

DB_PATH = os.environ.get("CHEAPEST_DB", "cheapest.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    key TEXT NOT NULL,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    UNIQUE (category, key)
);
CREATE TABLE IF NOT EXISTS offers (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    store TEXT NOT NULL,
    price INTEGER NOT NULL,
    url TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (product_id, store)
);
CREATE TABLE IF NOT EXISTS price_history (
    offer_id INTEGER NOT NULL REFERENCES offers(id),
    price INTEGER NOT NULL,
    at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_offers_price ON offers(price);
"""

_NOISE = re.compile(r"[^0-9a-z가-힣]+")
_EDITION = re.compile(
    r"\b(standard|deluxe|ultimate|premium|digital|key|global|steam|pc|edition)\b|"
    r"(스팀|키|글로벌|에디션)"
)


def normalize(name: str) -> str:
    """Product-matching key so the same item from different stores groups together."""
    s = _EDITION.sub(" ", name.lower())
    return _NOISE.sub("", s)


def connect(path: str | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(path or DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def upsert_offer(conn, *, category, name, store, price, url, now=None):
    now = now or int(time.time())
    key = normalize(name)
    if not key or price <= 0:
        return
    conn.execute(
        "INSERT OR IGNORE INTO products (key, category, name) VALUES (?, ?, ?)",
        (key, category, name),
    )
    pid = conn.execute(
        "SELECT id FROM products WHERE category = ? AND key = ?", (category, key)
    ).fetchone()["id"]
    row = conn.execute(
        "SELECT id, price FROM offers WHERE product_id = ? AND store = ?", (pid, store)
    ).fetchone()
    if row is None:
        oid = conn.execute(
            "INSERT INTO offers (product_id, store, price, url, updated_at) VALUES (?,?,?,?,?)",
            (pid, store, price, url, now),
        ).lastrowid
        conn.execute("INSERT INTO price_history VALUES (?,?,?)", (oid, price, now))
    else:
        oid = row["id"]
        conn.execute(
            "UPDATE offers SET price = ?, url = ?, updated_at = ? WHERE id = ?",
            (price, url, now, oid),
        )
        if row["price"] != price:
            conn.execute("INSERT INTO price_history VALUES (?,?,?)", (oid, price, now))
    conn.commit()
