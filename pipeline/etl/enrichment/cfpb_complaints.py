"""
Stage 20: CFPB Consumer Complaints
Downloads the bulk complaints CSV from CFPB and filters by company name.

The download is cached in S3 keyed by the upstream Last-Modified header so
repeat invocations within the same publish window can skip the slow CFPB
download and pull from the same-region S3 bucket instead. Set the env var
``CFPB_CACHE_S3_BUCKET`` (or the existing ``S3_BUCKET``) to enable caching.
"""

import csv
import io
import logging
import os
import re
import string
import zipfile
from typing import Dict, List, Optional

import requests

from config import Config
from models import now_iso

try:
    import boto3
    from botocore.exceptions import ClientError
    _HAS_BOTO3 = True
except ImportError:  # pragma: no cover — boto3 is in requirements.txt
    _HAS_BOTO3 = False

logger = logging.getLogger(__name__)

DEFAULT_MAX_COMPLAINTS_PER_COMPANY = 100
DEFAULT_CFPB_BULK_CSV_URL = "https://files.consumerfinance.gov/ccdb/complaints.csv.zip"
DEFAULT_CACHE_KEY = "cfpb-cache/complaints.csv.zip"
# Cache validator: ETag is stable across Akamai POPs; Last-Modified is not.
_CACHE_VALIDATOR_META_KEY = "cfpb-etag"

# Suffix tokens to strip during normalization
_SUFFIX_RE = re.compile(r"\b(INC|LLC|CORP|CORPORATION|COMPANY|CO)\b", flags=re.IGNORECASE)
# Punctuation to remove
_PUNCT_TRANS = str.maketrans("", "", ".,&")


def _normalize_name(name: str) -> str:
    """
    Normalize a company name for matching:
    - uppercase
    - strip whitespace
    - remove punctuation in [.,&]
    - strip suffix tokens INC|LLC|CORP|CORPORATION|COMPANY|CO
    """
    name = name.upper().strip()
    name = name.translate(_PUNCT_TRANS)
    name = _SUFFIX_RE.sub("", name)
    # Collapse multiple spaces
    name = " ".join(name.split())
    return name


def _direct_download(url: str, timeout: int = 600) -> bytes:
    """Pull the ZIP from CFPB into memory via streamed BytesIO writes."""
    resp = requests.get(url, timeout=timeout, stream=True)
    resp.raise_for_status()
    buf = io.BytesIO()
    for chunk in resp.iter_content(chunk_size=1 << 20):  # 1 MB chunks
        buf.write(chunk)
    return buf.getvalue()


def _probe_cfpb_validator(url: str, timeout: int = 30) -> str:
    """Return the upstream ETag (preferred) or Last-Modified as a cache validator.

    CFPB is fronted by Akamai; Last-Modified varies across POPs for the same
    file, but the ETag is content-hash-based and stable. We prefer ETag and
    fall back to Last-Modified only if ETag is missing.
    """
    try:
        head = requests.head(url, timeout=timeout, allow_redirects=True)
        head.raise_for_status()
        etag = head.headers.get("ETag", "").strip()
        if etag:
            return etag
        return head.headers.get("Last-Modified", "")
    except requests.RequestException as e:
        logger.warning(f"Stage 20: HEAD {url} failed: {e}")
        return ""


def _try_cache_read(s3_client, bucket: str, key: str, expected_validator: str) -> Optional[bytes]:
    """Return cached bytes only if S3's stored validator matches expected."""
    try:
        head = s3_client.head_object(Bucket=bucket, Key=key)
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("NoSuchKey", "NotFound", "404"):
            logger.info(f"Stage 20: no cache yet at s3://{bucket}/{key}")
        else:
            logger.warning(f"Stage 20: cache HEAD failed ({code}); falling back to direct download")
        return None
    cached = (head.get("Metadata") or {}).get(_CACHE_VALIDATOR_META_KEY, "")
    if cached and cached == expected_validator:
        logger.info(f"Stage 20: cache HIT (validator={cached!r}); fetching from s3://{bucket}/{key}")
        buf = io.BytesIO()
        s3_client.download_fileobj(bucket, key, buf)
        data = buf.getvalue()
        logger.info(f"Stage 20: cache served {len(data)} bytes")
        return data
    logger.info(f"Stage 20: cache MISS (cached={cached!r}, upstream={expected_validator!r}); will refresh")
    return None


def _try_cache_write(s3_client, bucket: str, key: str, data: bytes, validator: str) -> None:
    """Write data to S3 with the upstream cache validator as object metadata."""
    try:
        s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=data,
            Metadata={_CACHE_VALIDATOR_META_KEY: validator},
        )
        logger.info(f"Stage 20: wrote cache to s3://{bucket}/{key}")
    except ClientError as e:
        logger.warning(f"Stage 20: cache write failed: {e}")


def _download_zip_bytes(url: str, *, cache_bucket: Optional[str] = None,
                        cache_key: str = DEFAULT_CACHE_KEY) -> Optional[bytes]:
    """Download the CFPB bulk ZIP, optionally serving from / writing to S3 cache.

    Accumulates chunks via BytesIO to avoid the O(n²) cost of repeated bytes
    concatenation; expects Lambda memory ≥3 GB for the 1.8 GB-compressed dump.

    Cache semantics: if ``cache_bucket`` is set and CFPB's current
    ``Last-Modified`` header matches the value stored on the cached S3 object,
    serve the cached bytes (same-region S3 download is ~10× faster than
    pulling from CFPB's CDN). Otherwise download fresh and update the cache.
    """
    logger.info(f"Stage 20: downloading CFPB bulk CSV from {url}")

    validator = _probe_cfpb_validator(url) if cache_bucket and _HAS_BOTO3 else ""

    if cache_bucket and validator and _HAS_BOTO3:
        s3 = boto3.client("s3")
        cached = _try_cache_read(s3, cache_bucket, cache_key, validator)
        if cached is not None:
            return cached

    data = _direct_download(url)
    logger.info(f"Stage 20: downloaded {len(data)} bytes")

    if cache_bucket and validator and _HAS_BOTO3:
        _try_cache_write(boto3.client("s3"), cache_bucket, cache_key, data, validator)

    return data


def enrich(company_names: List[str], config: Config, on_progress=None) -> List[Dict]:
    """
    Download CFPB bulk complaints CSV, filter by company name, and return
    ConsumerComplaint dicts ready for neo4j_writer.merge_consumer_complaints().
    """
    max_per_company = max(
        1,
        int(getattr(config, "cfpb_max_complaints_per_company", DEFAULT_MAX_COMPLAINTS_PER_COMPANY) or DEFAULT_MAX_COMPLAINTS_PER_COMPANY),
    )

    url = getattr(config, "cfpb_bulk_csv_url", DEFAULT_CFPB_BULK_CSV_URL)

    # Build normalized-name lookup dict: normalized -> original name
    lookup: Dict[str, str] = {}
    for original in company_names:
        if original:
            norm = _normalize_name(original)
            if norm:
                lookup[norm] = original

    if not lookup:
        logger.warning("Stage 20: no valid company names provided")
        return []

    cache_bucket = os.getenv("CFPB_CACHE_S3_BUCKET") or os.getenv("S3_BUCKET") or None
    zip_bytes = _download_zip_bytes(url, cache_bucket=cache_bucket)
    if not zip_bytes:
        logger.warning("Stage 20: failed to download CFPB bulk CSV")
        return []

    complaints: List[Dict] = []
    seen_ids: set = set()
    counts: Dict[str, int] = {}
    companies_seen: set = set()
    truncated_companies = 0
    row_count = 0

    with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
        names = zf.namelist()
        csv_names = [n for n in names if n.lower().endswith(".csv")]
        if not csv_names:
            logger.error("Stage 20: no CSV found in ZIP")
            return []
        csv_name = csv_names[0]

        with zf.open(csv_name) as binary_stream:
            text_stream = io.TextIOWrapper(binary_stream, encoding="utf-8", errors="replace")
            reader = csv.DictReader(text_stream)
            for row in reader:
                row_count += 1
                if row_count % 500000 == 0:
                    logger.info(
                        f"Stage 20: processed {row_count} CFPB rows, "
                        f"{len(complaints)} complaints so far"
                    )

                company = (row.get("Company") or "").strip()
                if not company:
                    continue

                norm_company = _normalize_name(company)
                matched_original = lookup.get(norm_company)
                if not matched_original:
                    continue

                # Per-company cap
                current_count = counts.get(matched_original, 0)
                if current_count >= max_per_company:
                    if matched_original not in companies_seen:
                        companies_seen.add(matched_original)
                        if on_progress:
                            on_progress(matched_original, len(companies_seen) - 1)
                    continue

                complaint_id = str(row.get("Complaint ID", "")).strip()
                if not complaint_id or complaint_id in seen_ids:
                    continue
                seen_ids.add(complaint_id)

                counts[matched_original] = current_count + 1
                if counts[matched_original] == max_per_company:
                    truncated_companies += 1
                    logger.warning(
                        f"CFPB: result cap reached for {matched_original} "
                        f"(configured max/company={max_per_company})"
                    )

                if matched_original not in companies_seen:
                    companies_seen.add(matched_original)
                    if on_progress:
                        on_progress(matched_original, len(companies_seen) - 1)

                complaints.append({
                    "complaint_id": complaint_id,
                    "company_name": matched_original,
                    "product": row.get("Product", ""),
                    "issue": row.get("Issue", ""),
                    "sub_issue": row.get("Sub-issue", ""),
                    "state": row.get("State", ""),
                    "date_received": row.get("Date received", ""),
                    "company_response": row.get("Company response to consumer", ""),
                    "timely_response": row.get("Timely response?", "").strip().lower() == "yes",
                    "consumer_disputed": row.get("Consumer disputed?", "").strip().lower() == "yes",
                    "source": "cfpb",
                    "last_updated": now_iso(),
                })

    logger.info(
        f"Stage 20: found {len(complaints)} consumer complaints "
        f"from {len(companies_seen)} companies "
        f"(possible truncations: {truncated_companies}, max/company: {max_per_company})"
    )
    return complaints
