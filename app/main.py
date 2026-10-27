import pathlib

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import db

STATIC = pathlib.Path(__file__).resolve().parent.parent / "static"
CATEGORIES = {"game": "게임", "software": "소프트웨어", "subscription": "구독",
              "ebook": "전자책", "course": "강의", "app": "앱"}

app = FastAPI(title="최저가 디지털 상품")


@app.get("/api/categories")
def categories():
    return [{"id": k, "label": v} for k, v in CATEGORIES.items()]


@app.get("/api/search")
def search(q: str = "", category: str = "", sort: str = Query("price", pattern="^(price|name)$"),
           limit: int = Query(50, ge=1, le=200)):
    conn = db.connect()
    sql = """SELECT p.id, p.name, p.category, MIN(o.price) AS best_price,
                    COUNT(o.id) AS store_count,
                    (SELECT store FROM offers WHERE product_id = p.id ORDER BY price LIMIT 1) AS best_store
             FROM products p JOIN offers o ON o.product_id = p.id WHERE 1=1"""
    args: list = []
    if q.strip():
        k = db.normalize(q)
        if not k:  # query was only punctuation
            return []
        sql += " AND p.key LIKE ?"
        args.append("%" + k + "%")  # normalize() leaves only [0-9a-z가-힣], so no LIKE wildcards
    if category:
        sql += " AND p.category = ?"
        args.append(category)
    sql += " GROUP BY p.id ORDER BY " + ("best_price" if sort == "price" else "p.name") + " LIMIT ?"
    args.append(limit)
    return [dict(r) for r in conn.execute(sql, args)]


@app.get("/api/products/{pid}")
def product(pid: int):
    conn = db.connect()
    p = conn.execute("SELECT * FROM products WHERE id = ?", (pid,)).fetchone()
    if not p:
        raise HTTPException(404, "not found")
    offers = [dict(r) for r in conn.execute(
        "SELECT id, store, price, url, updated_at FROM offers WHERE product_id = ? ORDER BY price", (pid,))]
    for o in offers:
        o["history"] = [dict(r) for r in conn.execute(
            "SELECT price, at FROM price_history WHERE offer_id = ? ORDER BY at", (o["id"],))]
    return {"id": p["id"], "name": p["name"], "category": p["category"], "offers": offers}


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")
