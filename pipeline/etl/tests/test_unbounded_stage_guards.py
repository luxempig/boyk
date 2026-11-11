"""Guards against a stage running until the runtime kills the invocation.

On 2026-08-30 and 08-31 the [21,22,26,27] batch timed out at exactly 900s, twice
a night plus two Lambda retries each. Stage 26 started against a GDELT endpoint
that refused every connection; each failure retried with backoff, so the stage
had no natural end and consumed the whole budget. Stages 21, 22 and 27 never ran.
Checking the budget only at stage entry cannot catch that — the checks below are
the ones that can.
"""
from unittest.mock import MagicMock, patch

import pytest
import requests

import enrichment
from enrichment import (
    safe_get,
    reset_circuit_breakers,
    host_is_down,
    HOST_FAILURE_LIMIT,
    MAX_THROTTLE_WAITS,
)
import run_etl
from run_etl import ETLPipeline, StageDeadlineExceeded, DEADLINE_ABORT_MARGIN_SECONDS


@pytest.fixture(autouse=True)
def _clean_breakers():
    reset_circuit_breakers()
    yield
    reset_circuit_breakers()


@pytest.fixture
def mock_config(tmp_path):
    from config import Config
    c = MagicMock(spec=Config)
    c.neo4j_uri = "bolt://localhost:7687"
    c.neo4j_user = "neo4j"
    c.neo4j_password = "test"
    c.neo4j_database = "neo4j"
    c.neo4j_pool_size = 4
    c.batch_size = 500
    c.cache_dir = str(tmp_path / "cache")
    c.etl_rotate_capped_stages = True
    return c


@pytest.fixture
def pipeline(mock_config):
    with patch("run_etl.Neo4jWriter"), patch("run_etl.WikidataClient"), patch("run_etl.GleifClient"):
        yield lambda **kw: ETLPipeline(mock_config, **kw)


class TestDeadlineInsideAStage:
    def test_progress_callback_aborts_when_time_is_nearly_up(self, pipeline):
        p = pipeline(deadline_fn=lambda: DEADLINE_ABORT_MARGIN_SECONDS - 1)
        with pytest.raises(StageDeadlineExceeded):
            p._save_progress_periodic(26, "Acme", 1)

    def test_progress_callback_continues_with_time_left(self, pipeline):
        p = pipeline(deadline_fn=lambda: 600.0)
        p._save_progress_periodic(26, "Acme", 1)  # must not raise

    def test_unbounded_cli_run_never_aborts(self, pipeline):
        p = pipeline()  # no deadline_fn
        p._save_progress_periodic(26, "Acme", 1)

    def test_cut_short_is_not_recorded_as_a_failure(self, pipeline):
        """A stage that stands down cleanly must not look like a crash.

        Models the real shape of the incident: the stage has ample budget when it
        starts, then its upstream stalls and the clock runs out mid-loop.
        """
        clock = iter([900.0] * 3 + [1.0] * 50)
        p = pipeline(deadline_fn=lambda: next(clock), force=True)
        p._company_names = ["Acme"]

        def stage_that_runs_long():
            for i in range(50):
                p._save_progress_periodic(26, f"Company {i}", i)

        p._run_stage(26, stage_that_runs_long)
        assert [n for n, _ in p._cut_short_stages] == [26]
        assert p._failed_stages == []
        assert 26 not in p._completed_stages

    def test_a_real_error_is_still_a_failure(self, pipeline):
        # Enough time that the stage starts (stage 26's estimate is 780s); a
        # shorter budget would defer it, which is not what this test is about.
        p = pipeline(deadline_fn=lambda: 3600.0, force=True)
        p._company_names = ["Acme"]

        def boom():
            raise ValueError("upstream returned nonsense")

        p._run_stage(26, boom)
        assert [n for n, _ in p._failed_stages] == [26]
        assert p._cut_short_stages == []


class TestDeadUpstreamBreaker:
    def _always_fails(self):
        session = MagicMock()
        session.get.side_effect = requests.exceptions.ConnectionError("refused")
        return session

    def test_breaker_opens_and_stops_dialling_a_dead_host(self):
        session = self._always_fails()
        url = "https://api.gdeltproject.org/api/v2/doc/doc"
        # One attempt per call, so this many calls reaches the attempt threshold.
        for _ in range(HOST_FAILURE_LIMIT):
            assert safe_get(session, url, retries=1) is None
        assert host_is_down(url)
        calls_before = session.get.call_count
        for _ in range(50):
            assert safe_get(session, url, retries=1) is None
        assert session.get.call_count == calls_before, (
            "an open breaker must issue no further requests to that host"
        )

    def test_breaker_is_per_host(self):
        session = self._always_fails()
        dead = "https://api.gdeltproject.org/api/v2/doc/doc"
        for _ in range(HOST_FAILURE_LIMIT + 5):
            safe_get(session, dead, retries=1)
        assert host_is_down(dead)
        healthy = MagicMock()
        healthy.get.return_value = MagicMock(status_code=200, json=lambda: {"ok": True})
        assert safe_get(healthy, "https://echodata.epa.gov/echo", retries=1) == {"ok": True}

    def test_success_resets_the_failure_run(self):
        session = MagicMock()
        ok = MagicMock(status_code=200, json=lambda: {"ok": True})
        session.get.side_effect = (
            [requests.exceptions.ConnectionError("x")] * (HOST_FAILURE_LIMIT - 1)
            + [ok]
            + [requests.exceptions.ConnectionError("x")] * 10
        )
        url = "https://flaky.example.com/api"
        for _ in range(HOST_FAILURE_LIMIT - 1):
            safe_get(session, url, retries=1)
        assert safe_get(session, url, retries=1) == {"ok": True}
        before = session.get.call_count
        safe_get(session, url, retries=1)
        assert session.get.call_count > before, "a success must clear the failure run"

    def test_reset_reopens_a_tripped_host(self):
        session = self._always_fails()
        url = "https://api.gdeltproject.org/api/v2/doc/doc"
        for _ in range(HOST_FAILURE_LIMIT + 5):
            safe_get(session, url, retries=1)
        reset_circuit_breakers()
        before = session.get.call_count
        safe_get(session, url, retries=1)
        assert session.get.call_count > before


class TestThrottleLoopIsBounded:
    def test_perpetual_429_terminates(self):
        """`continue` on 429 skipped the attempt counter, so this spun forever."""
        session = MagicMock()
        session.get.return_value = MagicMock(status_code=429, headers={"Retry-After": "0"})
        with patch.object(enrichment.time, "sleep"):
            assert safe_get(session, "https://throttled.example.com/api", retries=3) is None
        assert session.get.call_count <= MAX_THROTTLE_WAITS + 1


class TestConcurrentStageDrain:
    """The shape that actually killed stages 21, 22 and 26.

    A pool holds every company queued up front. Raising inside one worker does
    not stop the rest: leaving the `with` block waits for all of them, and each
    still performs its request before reporting progress. The drain outlived the
    deadline, so the runtime killed the invocation and no summary was ever
    written. Halting requests is what makes that drain cheap.
    """

    def test_halt_makes_queued_requests_no_ops(self):
        session = MagicMock()
        session.get.return_value = MagicMock(status_code=200, json=lambda: {"ok": True})
        url = "https://example.com/api"
        assert safe_get(session, url) == {"ok": True}
        enrichment.halt_requests()
        before = session.get.call_count
        for _ in range(100):
            assert safe_get(session, url) is None
        assert session.get.call_count == before, "halted requests must not touch the network"

    def test_reset_clears_the_halt(self):
        enrichment.halt_requests()
        assert enrichment.requests_halted()
        reset_circuit_breakers()
        assert not enrichment.requests_halted()

    def test_pool_drains_promptly_once_the_deadline_hits(self, pipeline):
        """End-to-end: a pool of queued work must not outlive the deadline."""
        import concurrent.futures

        clock = iter([900.0] * 3 + [1.0] * 500)
        p = pipeline(deadline_fn=lambda: next(clock), force=True)
        p._company_names = ["c"]
        session = MagicMock()
        session.get.return_value = MagicMock(status_code=200, json=lambda: {"ok": True})
        names = [f"Company {i}" for i in range(200)]

        def worker(args):
            i, name = args
            safe_get(session, "https://example.com/api")   # folds once halted
            p._save_progress_periodic(26, name, i)

        def stage():
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
                futures = [ex.submit(worker, (i, n)) for i, n in enumerate(names)]
                for f in concurrent.futures.as_completed(futures):
                    f.result()

        p._run_stage(26, stage)

        assert [n for n, _ in p._cut_short_stages] == [26], "must report being cut short"
        assert p._failed_stages == []
        assert session.get.call_count < len(names), (
            "queued work must stop hitting the network once the deadline passes"
        )


class TestRateLimiterFoldsWhenHalted:
    """Pacing is the dominant drain cost, so it has to stop too.

    FDA paces at 40 req/min. Draining 271 queued companies across 3 workers
    spends over two minutes in the limiter alone — longer than the wind-down
    reserve — so halting only the HTTP calls was not enough to save the run.
    """

    def test_halted_waits_are_free(self):
        rl = enrichment.RateLimiter(1.5)
        enrichment.halt_requests()
        import time as _t
        start = _t.monotonic()
        for _ in range(200):
            rl.wait()
        assert _t.monotonic() - start < 0.5

    def test_pacing_resumes_after_reset(self):
        rl = enrichment.RateLimiter(0.05)
        enrichment.halt_requests()
        reset_circuit_breakers()
        import time as _t
        start = _t.monotonic()
        rl.wait()
        rl.wait()
        assert _t.monotonic() - start >= 0.04, "pacing must resume once the halt clears"
