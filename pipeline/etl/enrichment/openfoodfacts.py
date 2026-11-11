"""
Stage 3: Open Food Facts / Open Beauty Facts / Open Products Facts
Fetches products with barcodes and links them to brands.
"""

import logging
import time
import concurrent.futures
from typing import List, Dict

import requests

from config import Config
from enrichment import safe_get, RateLimiter
from models import now_iso

logger = logging.getLogger(__name__)

SOURCES = [
    ("openfoodfacts", "https://world.openfoodfacts.org/api/v2"),
    ("openbeautyfacts", "https://world.openbeautyfacts.org/api/v2"),
    ("openproductsfacts", "https://world.openproductsfacts.org/api/v2"),
]


def enrich(company_names: List[str], config: Config) -> Dict:
    """
    Search Open*Facts for products by brand name.
    Returns dict with 'products' and 'brand_product_rels'.
    """
    products = []
    brand_product_rels = []
    seen_barcodes = set()
    page_size = max(1, int(getattr(config, "openfoodfacts_page_size", 100) or 100))
    max_pages_per_source = max(1, int(getattr(config, "openfoodfacts_max_pages_per_source", 1) or 1))
    truncation_events = 0
    workers = max(4, config.max_workers)

    def process_company(company_name):
        # Each worker gets its own session and rate limiter for true parallelism
        local_session = requests.Session()
        local_session.headers.update({"User-Agent": "BoykETL/2.0"})
        local_rate_limiter = RateLimiter(0.5)
        local_products = []
        local_rels = []
        local_truncated = 0
        for source_name, base_url in SOURCES:
            reached_cap = False
            for page in range(1, max_pages_per_source + 1):
                url = f"{base_url}/search"
                params = {
                    "brands_tags": company_name.lower().replace(" ", "-"),
                    "fields": "code,product_name,brands,categories_tags",
                    "page_size": page_size,
                    "page": page,
                    "json": 1,
                }
                data = safe_get(local_session, url, params=params, timeout=20, rate_limiter=local_rate_limiter)
                if not data:
                    break

                page_products = data.get("products", [])
                if not page_products:
                    break

                for product in page_products:
                    barcode = product.get("code", "")
                    if not barcode:
                        continue

                    name = product.get("product_name", "")
                    if not name:
                        continue

                    brands = product.get("brands", "")
                    categories = product.get("categories_tags", [])
                    category = categories[0].replace("en:", "") if categories else None

                    local_products.append({
                        "barcode": barcode,
                        "name": name,
                        "brand_name": brands or company_name,
                        "category": category,
                        "data_sources": [source_name],
                        "sources_json": f'[{{"source":"{source_name}","field":"barcode","value":"{barcode}","fetched":"{now_iso()}","confidence":"high"}}]',
                        "last_updated": now_iso(),
                    })

                    local_rels.append({
                        "barcode": barcode,
                        "asin": None,
                        "brand_name": brands or company_name,
                        "source": source_name,
                    })

                if len(page_products) < page_size:
                    break
                if page >= max_pages_per_source:
                    reached_cap = True

            if reached_cap:
                local_truncated += 1
                logger.warning(
                    f"Open*Facts: truncating {company_name} on {source_name} at "
                    f"{max_pages_per_source} page(s) x {page_size} results"
                )
        return local_products, local_rels, local_truncated

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(process_company, name) for name in company_names]
        for future in concurrent.futures.as_completed(futures):
            res = future.result()
            if res:
                for p in res[0]:
                    if p["barcode"] not in seen_barcodes:
                        seen_barcodes.add(p["barcode"])
                        products.append(p)
                brand_product_rels.extend(res[1])
                truncation_events += res[2]

    logger.info(
        f"Stage 3: found {len(products)} products across Open*Facts "
        f"(truncation events: {truncation_events}, page cap per source: {max_pages_per_source}, page size: {page_size})"
    )
    return {"products": products, "brand_product_rels": brand_product_rels}
