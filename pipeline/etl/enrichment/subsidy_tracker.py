"""
Stage 17: Subsidy Tracker (Good Jobs First) — Corporate Subsidies
670K+ subsidy awards — tax breaks, grants, loans to corporations.

Uses cloudscraper to bypass Cloudflare protection on goodjobsfirst.org.
"""

import logging
import re
import time
from typing import List, Dict, Optional
from urllib.parse import quote

try:
    import cloudscraper

    HAS_CLOUDSCRAPER = True
except ImportError:
    HAS_CLOUDSCRAPER = False

from config import Config
from models import now_iso

logger = logging.getLogger(__name__)

# Default maximum pages to scrape per company (100 rows per page)
DEFAULT_MAX_PAGES = 20


def _clean_html(text: str) -> str:
    """Strip HTML tags and whitespace from a string."""
    return re.sub(r"<[^>]+>", "", text).strip()


def _parse_amount(text: str) -> float:
    """Parse a dollar amount string like '$11,951,972' into a float."""
    cleaned = re.sub(r"[^0-9.]", "", text)
    try:
        return float(cleaned)
    except (ValueError, TypeError):
        return 0


def _parse_subsidy_results(html: str, company_name: str) -> List[Dict]:
    """
    Parse Subsidy Tracker search results HTML.

    Actual column order (from the main data table):
      0: Company  1: Location  2: Subsidy Source  3: Year
      4: Subsidy Value  5: Loan/Bailout Value  6: Type of Subsidy
    """
    subsidies = []
    if not html:
        return subsidies

    # Find the largest table (the data table, not the summary tables)
    tables = re.findall(
        r"<table[^>]*>(.*?)</table>", html, re.DOTALL | re.IGNORECASE
    )
    if not tables:
        return subsidies

    data_table = max(tables, key=len)

    cell_pattern = re.compile(r"<td[^>]*>(.*?)</td>", re.DOTALL | re.IGNORECASE)
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", data_table, re.DOTALL | re.IGNORECASE)

    for row_html in rows:
        cells = cell_pattern.findall(row_html)
        if len(cells) < 5:
            continue

        company = _clean_html(cells[0])
        state = _clean_html(cells[1])
        subsidy_source = _clean_html(cells[2])
        year_str = _clean_html(cells[3])
        subsidy_value_str = _clean_html(cells[4])
        loan_value_str = _clean_html(cells[5]) if len(cells) > 5 else ""
        subsidy_type = _clean_html(cells[6]) if len(cells) > 6 else ""

        subsidy_value = _parse_amount(subsidy_value_str)
        loan_value = _parse_amount(loan_value_str)
        amount = subsidy_value or loan_value

        # Parse year
        year_match = re.search(r"((?:19|20)\d{2})", year_str)
        year = int(year_match.group(1)) if year_match else None

        if amount > 0 or subsidy_type:
            subsidies.append(
                {
                    "company_name": company_name,
                    "company": company,
                    "subsidy_type": subsidy_type or None,
                    "subsidy_source": subsidy_source or None,
                    "amount": amount if amount > 0 else None,
                    "subsidy_value": subsidy_value if subsidy_value > 0 else None,
                    "loan_value": loan_value if loan_value > 0 else None,
                    "year": year,
                    "state": state or None,
                    "source": "subsidy_tracker",
                    "last_updated": now_iso(),
                }
            )

    return subsidies


def _get_max_page(html: str) -> int:
    """Extract the highest page number from the pager."""
    pager_match = re.search(
        r'<ul[^>]*class="[^"]*pager[^"]*"[^>]*>(.*?)</ul>',
        html,
        re.DOTALL | re.IGNORECASE,
    )
    if not pager_match:
        return 1
    page_numbers = re.findall(r"page=(\d+)", pager_match.group(0))
    if not page_numbers:
        return 1
    return max(int(p) for p in page_numbers)


def _create_scraper() -> Optional[object]:
    """Create a cloudscraper session, or return None if unavailable."""
    if not HAS_CLOUDSCRAPER:
        logger.error(
            "Stage 17: cloudscraper not installed. Subsidy Tracker is behind "
            "Cloudflare and cannot be scraped with plain requests. "
            "Install with: pip install cloudscraper"
        )
        return None
    return cloudscraper.create_scraper()


def _fetch_page(scraper, url: str, retries: int = 3) -> Optional[str]:
    """Fetch a page with retries, handling Cloudflare challenges."""
    for attempt in range(retries):
        try:
            resp = scraper.get(url, timeout=30)
            if resp.status_code == 403:
                logger.warning(
                    f"ST: Cloudflare 403 on {url} (attempt {attempt + 1}/{retries})"
                )
                time.sleep(5 * (attempt + 1))
                continue
            if resp.status_code == 429:
                wait = int(resp.headers.get("Retry-After", 30))
                logger.warning(f"ST: Rate limited on {url}, waiting {wait}s")
                time.sleep(wait)
                continue
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.text
        except Exception as e:
            logger.warning(f"ST: Request attempt {attempt + 1} failed for {url}: {e}")
            if attempt < retries - 1:
                time.sleep(3 * (attempt + 1))
    return None


def _scrape_parent(scraper, company_name: str, base_url: str, max_pages: int = DEFAULT_MAX_PAGES) -> tuple[List[Dict], bool]:
    """Scrape all pages of subsidies for a parent company."""
    encoded_name = quote(company_name)

    # First page uses /parent/{name} URL
    first_url = f"{base_url}/parent/{encoded_name}"
    html = _fetch_page(scraper, first_url)
    if not html:
        return [], False

    # Check if Cloudflare challenge page leaked through
    if "Just a moment" in html[:500] and "challenge" in html[:2000]:
        logger.warning(
            f"ST: Cloudflare challenge page returned for {company_name}. "
            "cloudscraper could not bypass protection."
        )
        return [], False

    all_subsidies = _parse_subsidy_results(html, company_name)
    max_page = _get_max_page(html)
    truncated = max_page > max_pages
    if truncated:
        logger.warning(
            f"ST: truncating {company_name} at {max_pages} pages "
            f"(site reports {max_page} pages)"
        )

    # Fetch remaining pages (page 2+)
    for page in range(2, min(max_page + 1, max_pages + 1)):
        page_url = f"{base_url}/?parent={encoded_name}&page={page}"
        time.sleep(0.5)  # polite delay between pages
        page_html = _fetch_page(scraper, page_url)
        if not page_html:
            break
        page_subsidies = _parse_subsidy_results(page_html, company_name)
        if not page_subsidies:
            break
        all_subsidies.extend(page_subsidies)

    return all_subsidies, truncated


def enrich(company_names: List[str], config: Config,
           on_progress=None) -> List[Dict]:
    """
    Scrape Subsidy Tracker for corporate subsidy data.
    Returns list of Subsidy dicts.

    Args:
        on_progress: Optional callback(company_name, index) called after each company.
    """
    scraper = _create_scraper()
    if scraper is None:
        logger.warning(
            "Stage 17: SKIPPED — cannot access Subsidy Tracker without cloudscraper. "
            "goodjobsfirst.org is behind Cloudflare."
        )
        return []

    all_subsidies = []
    truncated_companies = 0
    max_pages = max(1, int(getattr(config, "subsidy_tracker_max_pages_per_company", DEFAULT_MAX_PAGES) or DEFAULT_MAX_PAGES))

    for i, company_name in enumerate(company_names):
        subsidies, truncated = _scrape_parent(
            scraper, company_name, config.subsidy_tracker_base, max_pages=max_pages
        )
        all_subsidies.extend(subsidies)
        if truncated:
            truncated_companies += 1

        if subsidies:
            total = sum(s.get("amount", 0) or 0 for s in subsidies)
            logger.debug(
                f"Subsidies: {company_name} -> {len(subsidies)} awards, "
                f"${total:,.0f} total"
            )

        if on_progress:
            on_progress(company_name, i)
        time.sleep(0.5)  # polite delay between companies

    logger.info(
        f"Stage 17: found {len(all_subsidies)} subsidy records from Subsidy Tracker "
        f"(truncated companies: {truncated_companies}, page cap: {max_pages})"
    )
    return all_subsidies
