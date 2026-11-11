"""
Stage 4: Wikidata Product IDs
Fetches ASIN and UPC codes for products from Wikidata.
Delegates to WikidataClient.fetch_product_ids().
"""

import logging
from typing import List, Dict

from config import Config
from wikidata_client import WikidataClient
from models import now_iso

logger = logging.getLogger(__name__)


def enrich(config: Config) -> Dict:
    """
    Fetch ASINs and UPCs from Wikidata.
    Returns dict with 'products' and 'brand_product_rels'.
    """
    client = WikidataClient(config)
    raw = client.fetch_product_ids()

    products = []
    brand_product_rels = []
    seen = set()

    for item in raw:
        asin = item.get("asin")
        upc = item.get("upc")
        name = item.get("name", "")

        key = asin or upc or name
        if not key or key in seen:
            continue
        seen.add(key)

        product = {
            "name": name,
            "asin": asin,
            "upc": upc,
            "barcode": upc,  # UPC is a type of barcode
            "brand_name": item.get("brand_name"),
            "data_sources": ["wikidata"],
            "sources_json": f'[{{"source":"wikidata","field":"product_id","value":"{key}","fetched":"{now_iso()}","confidence":"high"}}]',
            "last_updated": now_iso(),
        }
        products.append(product)

        brand_name = item.get("brand_name")
        brand_wikidata_id = item.get("brand_wikidata_id")

        if brand_name or brand_wikidata_id:
            brand_product_rels.append({
                "barcode": upc,
                "asin": asin,
                "brand_name": brand_name or "",
                "brand_wikidata_id": brand_wikidata_id or "",
                "source": "wikidata",
            })

    logger.info(
        f"Stage 4: found {len(products)} products with ASIN/UPC, "
        f"{len(brand_product_rels)} brand-product relationships from Wikidata"
    )
    return {"products": products, "brand_product_rels": brand_product_rels}
