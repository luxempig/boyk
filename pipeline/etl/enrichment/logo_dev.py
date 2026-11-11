"""
Boyk ETL — Stage 5: Logo.dev logos for companies and brands (hotlinked)

logo.dev's free plan licenses hotlinking with visible attribution; storing
copies needs Pro ("Pro and Enterprise plans include a license to store logos on
your own infrastructure"). So this stage downloads nothing: it writes an
img.logo.dev URL carrying the publishable key, and the web and iOS apps show
"Logos provided by Logo.dev". Domains logo.dev doesn't know get its generated
letter monogram, which serves as the placeholder.

Usage:
    logos = logo_dev.enrich(companies, config)
    # Returns [{"eid": ..., "domain": "example.com",
    #           "logo_url": "https://img.logo.dev/example.com?token=pk_...&size=200&format=png"}]
"""

import logging
from typing import Any, Dict, List
from urllib.parse import quote

logger = logging.getLogger("etl.logo_dev")

LOGO_SIZE = 200


def hotlink_url(domain: str, publishable_key: str) -> str:
    """The img.logo.dev URL for a domain's logo."""
    return f"https://img.logo.dev/{quote(domain)}?token={publishable_key}&size={LOGO_SIZE}&format=png"


def enrich(entities: List[Dict[str, Any]], config: Any) -> List[Dict[str, Any]]:
    """
    Build a hotlink logo URL for each company or brand that has a website.

    Args:
        entities: dicts with "eid" (the node's element id) and "website"
        config: Config object with logo_dev_publishable_key

    Returns:
        {"eid", "domain", "logo_url"} for each entity with a usable domain.
    """
    api_key = config.logo_dev_publishable_key
    if not api_key:
        logger.warning("LOGO_DEV_PUBLISHABLE_KEY not set, skipping logo enrichment")
        return []

    logos = []
    for entity in entities:
        domain = _extract_domain(entity.get("website", ""))
        if domain:
            logos.append({"eid": entity["eid"], "domain": domain,
                          "logo_url": hotlink_url(domain, api_key)})
    logger.info(f"Logo.dev: {len(logos)} hotlink URLs for {len(entities)} entities")
    return logos


def _extract_domain(url: str) -> str | None:
    """Extract clean domain from a URL or website string."""
    if not url:
        return None

    url = url.strip().lower()

    # Remove protocol
    for prefix in ("https://", "http://", "www."):
        if url.startswith(prefix):
            url = url[len(prefix):]

    # Remove path/query
    url = url.split("/")[0].split("?")[0].split("#")[0]

    # Basic validation
    if "." not in url or len(url) < 4:
        return None

    return url
