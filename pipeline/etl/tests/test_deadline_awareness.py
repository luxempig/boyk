"""Deadline awareness for Lambda-bounded runs.

Stage 19 alone burns 672 s of a 900 s Lambda. Before this, a batch that started
one stage too many was killed mid-write — no summary, no alert, no completed run
in 112 days. The pipeline must decline to start work it cannot finish.
"""
from unittest.mock import MagicMock, patch

import pytest

import run_etl
from run_etl import (
    ETLPipeline,
    STAGE_EST_SECONDS,
    DEADLINE_SAFETY_MARGIN_SECONDS,
    DEFAULT_STAGE_EST_SECONDS,
)


@pytest.fixture
def mock_config(tmp_path):
    from config import Config
    config = MagicMock(spec=Config)
    config.neo4j_uri = "bolt://localhost:7687"
    config.neo4j_user = "neo4j"
    config.neo4j_password = "test"
    config.neo4j_database = "neo4j"
    config.neo4j_pool_size = 4
    config.batch_size = 500
    config.cache_dir = str(tmp_path / "cache")
    config.etl_rotate_capped_stages = True
    return config


@pytest.fixture
def pipeline(mock_config):
    with patch("run_etl.Neo4jWriter"), patch("run_etl.WikidataClient"), patch("run_etl.GleifClient"):
        yield lambda **kw: ETLPipeline(mock_config, **kw)


class TestBudgetCheck:
    def test_unbounded_run_always_has_budget(self, pipeline):
        p = pipeline()  # no deadline_fn — CLI run
        assert p._has_budget_for(19)
        assert p._deferred_stages == []

    def test_ample_time_permits_the_stage(self, pipeline):
        p = pipeline(deadline_fn=lambda: 900.0)
        assert p._has_budget_for(19)
        assert p._deferred_stages == []

    def test_insufficient_time_defers_the_stage(self, pipeline):
        # Stage 19 needs ~700s + margin; 300s left is not enough.
        p = pipeline(deadline_fn=lambda: 300.0)
        assert not p._has_budget_for(19)
        assert p._deferred_stages == [(19, STAGE_EST_SECONDS[19] + DEADLINE_SAFETY_MARGIN_SECONDS, 300)]

    def test_boundary_is_inclusive(self, pipeline):
        exactly = STAGE_EST_SECONDS[16] + DEADLINE_SAFETY_MARGIN_SECONDS
        assert pipeline(deadline_fn=lambda: float(exactly))._has_budget_for(16)
        assert not pipeline(deadline_fn=lambda: exactly - 1.0)._has_budget_for(16)

    def test_unknown_stage_uses_conservative_default(self, pipeline):
        assert 999 not in STAGE_EST_SECONDS
        p = pipeline(deadline_fn=lambda: float(DEFAULT_STAGE_EST_SECONDS + DEADLINE_SAFETY_MARGIN_SECONDS))
        assert p._has_budget_for(999)
        p2 = pipeline(deadline_fn=lambda: 10.0)
        assert not p2._has_budget_for(999)

    def test_broken_clock_does_not_block_the_run(self, pipeline):
        """A deadline we cannot read must not silently stop all work."""
        def boom():
            raise RuntimeError("no context")
        p = pipeline(deadline_fn=boom)
        assert p._has_budget_for(19)

    def test_run_stage_returns_without_running_when_deferred(self, pipeline):
        p = pipeline(deadline_fn=lambda: 5.0)
        func = MagicMock()
        p._run_stage(19, func)
        func.assert_not_called()


class TestStageRotation:
    def test_unbounded_run_keeps_natural_order(self, pipeline):
        p = pipeline()
        assert p._rotate_stage_order([11, 12, 16, 17]) == [11, 12, 16, 17]

    def test_single_stage_is_unchanged(self, pipeline):
        p = pipeline(deadline_fn=lambda: 900.0)
        assert p._rotate_stage_order([16]) == [16]

    def test_rotation_preserves_membership(self, pipeline):
        p = pipeline(deadline_fn=lambda: 900.0)
        stages = [11, 12, 16, 17]
        assert sorted(p._rotate_stage_order(stages)) == stages

    def test_every_stage_leads_on_some_day(self, pipeline):
        """Every stage must reach the front on some day, or the tail starves."""
        p = pipeline(deadline_fn=lambda: 900.0)
        stages = [11, 12, 16, 17]
        leaders = set()
        base = 1788053490  # a fixed instant; the calendar date is irrelevant
        for offset in range(len(stages)):
            with patch.object(run_etl.time, "time", return_value=base + offset * 86400):
                leaders.add(p._rotate_stage_order(stages)[0])
        assert leaders == set(stages), "consecutive days must cycle through every position"

    def test_rotation_survives_a_month_boundary(self, pipeline):
        """A YYYYMMDD-derived shift jumps by 70 on Aug 31 -> Sep 1 and skips positions."""
        p = pipeline(deadline_fn=lambda: 900.0)
        stages = [11, 12, 16, 17]
        base = 1787961600  # 2026-08-29, so the window spans into September
        leaders = []
        for offset in range(8):
            with patch.object(run_etl.time, "time", return_value=base + offset * 86400):
                leaders.append(p._rotate_stage_order(stages)[0])
        assert set(leaders) == set(stages)
