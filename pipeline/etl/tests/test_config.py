"""Tests for ETL config module."""

import os
from unittest.mock import patch

from config import Config, check_stage_keys, STAGE_NAMES, STAGE_REQUIREMENTS


class TestCheckStageKeys:
    def test_free_stages_always_runnable(self):
        # Stages 1, 2, 3, 4 have no required keys
        for stage in [1, 2, 3, 4]:
            can_run, missing = check_stage_keys(stage)
            assert can_run is True
            assert missing == []

    def test_stage_with_missing_key(self):
        with patch.dict(os.environ, {}, clear=True):
            can_run, missing = check_stage_keys(5)
            assert can_run is False
            assert "LOGO_DEV_PUBLISHABLE_KEY" in missing

    def test_stage_with_present_key(self):
        with patch.dict(os.environ, {"FEC_API_KEY": "test-key"}):
            can_run, missing = check_stage_keys(7)
            assert can_run is True
            assert missing == []

    def test_unknown_stage_is_runnable(self):
        can_run, missing = check_stage_keys(999)
        assert can_run is True
        assert missing == []


class TestStageNames:
    def test_all_stages_have_names(self):
        for stage_num in STAGE_REQUIREMENTS:
            assert stage_num in STAGE_NAMES, f"Stage {stage_num} missing from STAGE_NAMES"


class TestConfig:
    def test_defaults(self):
        with patch.dict(os.environ, {}, clear=True):
            c = Config()
            assert c.neo4j_database == "neo4j"
            assert c.batch_size == 5000
            assert c.neo4j_pool_size == 50

    def test_env_overrides(self):
        with patch.dict(os.environ, {
            "NEO4J_URI": "bolt://custom:7687",
            "NEO4J_PASSWORD": "secret",
            "ETL_BATCH_SIZE": "1000",
        }):
            c = Config()
            assert c.neo4j_uri == "bolt://custom:7687"
            assert c.neo4j_password == "secret"
            assert c.batch_size == 1000

    def test_validate_fails_with_defaults(self):
        with patch.dict(os.environ, {}, clear=True):
            c = Config()
            assert c.validate() is False

    def test_validate_passes_with_proper_config(self):
        with patch.dict(os.environ, {
            "NEO4J_URI": "bolt://prod:7687",
            "NEO4J_PASSWORD": "real-password",
        }):
            c = Config()
            assert c.validate() is True
