"""
Boyk ETL Enrichment Modules
Each module handles one external data source and returns structured data with provenance.
"""

import logging
import time
import threading
from typing import Optional

import requests
from urllib.parse import urlparse


logger = logging.getLogger(__name__)

# Set when a stage hits its deadline; see halt_requests().
_halted = threading.Event()

class RateLimiter:
    def __init__(self, rate_limit: float):
        self.rate_limit = rate_limit
        self.lock = threading.Lock()
        self.last_call = 0.0

    def wait(self):
        # Once halted there is nothing left to pace, and pacing is expensive: a
        # pool draining 271 queued companies at FDA's 40 req/min spends over two
        # minutes here alone, which outlasts the time reserved for winding down
        # and gets the invocation killed anyway. Every concurrent stage pays this
        # before its request, so the check belongs here rather than per module.
        if _halted.is_set():
            return
        with self.lock:
            now = time.time()
            elapsed = now - self.last_call
            if elapsed < self.rate_limit:
                time.sleep(self.rate_limit - elapsed)
            self.last_call = time.time()

# ── Dead-upstream circuit breaker ─────────────────────────────
# A host that refuses every request still costs a full retry-and-backoff cycle
# per company. GDELT did this for two consecutive nights: the stage never
# finished, so the 900s Lambda was killed and stages 21, 22 and 27 never ran.
#
# Failures are counted per ATTEMPT, not per exhausted request. Counting whole
# requests needed ~75 dead attempts to reach the old threshold, which took
# longer than the budget it was meant to protect.
HOST_FAILURE_LIMIT = 20
# A server answering 429 forever must not spin: cap how many times one request
# will honour Retry-After before giving up on it.
MAX_THROTTLE_WAITS = 6

_host_failures = {}
_host_failures_lock = threading.Lock()
_host_breaker_logged = set()


def _host_of(url: str) -> str:
    try:
        return urlparse(url).netloc or url
    except Exception:
        return url


def host_is_down(url: str) -> bool:
    """True once a host has failed enough consecutive attempts to be written off.

    Safe to call before doing any per-request work — notably before a rate
    limiter's sleep, which otherwise dominates the cost of draining the
    already-queued work of a concurrent stage.
    """
    host = _host_of(url)
    with _host_failures_lock:
        if _host_failures.get(host, 0) < HOST_FAILURE_LIMIT:
            return False
        first_time = host not in _host_breaker_logged
        if first_time:
            _host_breaker_logged.add(host)
    if first_time:
        logger.error(
            f"Circuit breaker OPEN for {host} after {HOST_FAILURE_LIMIT} consecutive "
            f"failed attempts. Skipping it for the rest of this stage."
        )
    return True


def _record_host_failure(url: str) -> None:
    host = _host_of(url)
    with _host_failures_lock:
        _host_failures[host] = _host_failures.get(host, 0) + 1


def _record_host_success(url: str) -> None:
    host = _host_of(url)
    with _host_failures_lock:
        if _host_failures.get(host):
            _host_failures[host] = 0
            _host_breaker_logged.discard(host)


# ── Global halt ───────────────────────────────────────────────
# Six enrichment modules fan out over a ThreadPoolExecutor and queue every
# company up front. Raising inside a worker does not stop the others: leaving
# the `with` block calls shutdown(wait=True), which waits for every queued
# future, and each one still performs its full HTTP request before reporting
# progress. That drain outlives the deadline, so the runtime kills the
# invocation before the exception can surface — which is why stages 21, 22 and
# 26 all died at exactly 900s with no summary.
#
# Setting this flag turns every outstanding request into an immediate no-op, so
# the pool drains in seconds and the stage can report that it was cut short.
def halt_requests() -> None:
    """Make all further HTTP calls no-ops so a thread pool drains immediately."""
    _halted.set()


def requests_halted() -> bool:
    return _halted.is_set()


def reset_circuit_breakers() -> None:
    """Clear breaker and halt state so one stage does not mute the next."""
    _halted.clear()
    with _host_failures_lock:
        _host_failures.clear()
        _host_breaker_logged.clear()


def safe_get(session: requests.Session, url: str, params: dict = None,
             headers: dict = None, timeout: int = 30, retries: int = 3,
             rate_limiter: Optional[RateLimiter] = None) -> Optional[dict]:
    """GET with retries, rate-limit handling, and JSON parsing."""
    if _halted.is_set() or host_is_down(url):
        return None
    attempt = 0
    throttled = 0
    while attempt < retries:
        if _halted.is_set():
            return None
        try:
            if rate_limiter:
                rate_limiter.wait()
            resp = session.get(url, params=params, headers=headers, timeout=timeout)
            if resp.status_code == 429:
                # Bounded: a server that answers 429 forever used to spin here
                # indefinitely, because `continue` skipped the attempt increment.
                # Nothing above this call can interrupt it, so it must self-limit.
                throttled += 1
                if throttled > MAX_THROTTLE_WAITS:
                    logger.warning(
                        f"Giving up on {url} after {throttled} consecutive 429s"
                    )
                    _record_host_failure(url)
                    return None
                wait = int(resp.headers.get("Retry-After", 30))
                logger.warning(f"Rate limited on {url}, waiting {wait}s")
                time.sleep(wait)
                continue
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            data = resp.json()
            _record_host_success(url)
            return data
        except requests.exceptions.JSONDecodeError:
            logger.warning(f"JSON decode error for {url}")
            return None
        except Exception as e:
            logger.warning(f"Request attempt {attempt + 1} failed for {url}: {e}")
            _record_host_failure(url)
            attempt += 1
            if attempt < retries:
                time.sleep(2 * attempt)
    return None


def safe_get_text(session: requests.Session, url: str, params: dict = None,
                  headers: dict = None, timeout: int = 30, retries: int = 3,
                  rate_limiter: Optional[RateLimiter] = None) -> Optional[str]:
    """GET with retries returning raw text (for scraping)."""
    if _halted.is_set() or host_is_down(url):
        return None
    attempt = 0
    throttled = 0
    while attempt < retries:
        if _halted.is_set():
            return None
        try:
            if rate_limiter:
                rate_limiter.wait()
            resp = session.get(url, params=params, headers=headers, timeout=timeout)
            if resp.status_code == 429:
                throttled += 1
                if throttled > MAX_THROTTLE_WAITS:
                    logger.warning(
                        f"Giving up on {url} after {throttled} consecutive 429s"
                    )
                    _record_host_failure(url)
                    return None
                wait = int(resp.headers.get("Retry-After", 30))
                logger.warning(f"Rate limited on {url}, waiting {wait}s")
                time.sleep(wait)
                continue
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.text
        except Exception as e:
            logger.warning(f"Request attempt {attempt + 1} failed for {url}: {e}")
            _record_host_failure(url)
            attempt += 1
            if attempt < retries:
                time.sleep(2 * attempt)
    return None
