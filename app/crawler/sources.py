"""Store definitions. Add a store by appending a dict; no code needed.

Selectors for real stores are TEMPLATES: page markup changes and must be checked
against the live site (and its terms of service / robots.txt) before enabling.
"""

SOURCES = [
    {
        # Local fixture so the whole pipeline runs and is testable offline.
        "store": "데모스토어A",
        "category": "game",
        "urls": ["file:fixtures/demo_a.html"],
        "item": ".product",
        "enabled": True,
    },
    {
        "store": "데모스토어B",
        "category": "game",
        "urls": ["file:fixtures/demo_b.html"],
        "item": ".product",
        "enabled": True,
    },
    {
        "store": "데모스토어C",
        "category": "software",
        "urls": ["file:fixtures/demo_c.html"],
        "item": ".product",
        "enabled": True,
    },
    {
        # TEMPLATE - fill in a real store's URL/selectors, verify robots.txt/ToS, then enable.
        "store": "example-store",
        "category": "ebook",
        "urls": ["https://example.com/ebooks?page=1"],
        "item": ".product-card",
        "enabled": False,
    },
]

# Shared selector defaults used by the demo fixtures.
DEFAULTS = {"name": ".title", "price": ".price", "link": "a"}
