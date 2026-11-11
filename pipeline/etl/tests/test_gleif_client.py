"""Tests for GLEIF client batch relationship fetching."""
from unittest.mock import MagicMock, patch
import pytest
from gleif_client import GleifClient
from config import Config


def _mock_gleif_response():
    """Simulate GLEIF API response with ?include=direct-parent,ultimate-parent."""
    return {
        "data": [
            {
                "type": "lei-records",
                "id": "5493001KJTIIGC8Y1R12",
                "attributes": {
                    "lei": "5493001KJTIIGC8Y1R12",
                    "entity": {
                        "legalName": {"name": "Child Corp"},
                        "jurisdiction": "US-DE",
                        "legalAddress": {"country": "US", "city": "Wilmington"},
                    },
                    "registration": {"status": "ISSUED"},
                },
                "relationships": {
                    "direct-parent": {
                        "data": {"id": "PARENT001LEI00000000", "type": "lei-records"},
                    },
                    "ultimate-parent": {
                        "data": {"id": "ULTIMATELEIABC000000", "type": "lei-records"},
                    },
                },
            }
        ],
        "included": [
            {
                "type": "lei-records",
                "id": "PARENT001LEI00000000",
                "attributes": {
                    "lei": "PARENT001LEI00000000",
                    "entity": {
                        "legalName": {"name": "Parent Corp"},
                        "jurisdiction": "GB",
                        "legalAddress": {"country": "GB", "city": "London"},
                    },
                    "registration": {"status": "ISSUED"},
                },
            },
            {
                "type": "lei-records",
                "id": "ULTIMATELEIABC000000",
                "attributes": {
                    "lei": "ULTIMATELEIABC000000",
                    "entity": {
                        "legalName": {"name": "Ultimate Parent Inc"},
                        "jurisdiction": "US-NY",
                        "legalAddress": {"country": "US", "city": "New York"},
                    },
                    "registration": {"status": "ISSUED"},
                },
            },
        ],
    }


class TestGleifBatchFetch:
    def setup_method(self):
        self.config = Config()
        self.client = GleifClient(self.config)

    @patch("gleif_client.requests.Session")
    def test_batch_fetch_extracts_relationships_from_included(self, mock_session_cls):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = _mock_gleif_response()
        mock_resp.raise_for_status.return_value = None

        self.client.session = MagicMock()
        self.client.session.get.return_value = mock_resp

        companies, rels = self.client._fetch_batch(["5493001KJTIIGC8Y1R12"])

        assert len(companies) == 1
        assert companies[0]["lei"] == "5493001KJTIIGC8Y1R12"

        # Should have 2 relationships (direct + ultimate) extracted from included
        assert len(rels) == 2
        direct = [r for r in rels if r["relationship_type"] == "IS_DIRECTLY_CONSOLIDATED_BY"]
        ultimate = [r for r in rels if r["relationship_type"] == "IS_ULTIMATELY_CONSOLIDATED_BY"]
        assert len(direct) == 1
        assert direct[0]["parent_lei"] == "PARENT001LEI00000000"
        assert len(ultimate) == 1
        assert ultimate[0]["parent_lei"] == "ULTIMATELEIABC000000"

    @patch("gleif_client.requests.Session")
    def test_batch_fetch_no_extra_http_calls(self, mock_session_cls):
        """Ensure no per-company HTTP calls for parent LEIs."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = _mock_gleif_response()
        mock_resp.raise_for_status.return_value = None

        self.client.session = MagicMock()
        self.client.session.get.return_value = mock_resp

        self.client._fetch_batch(["5493001KJTIIGC8Y1R12"])

        # Should be exactly 1 HTTP call (the batch request), not 1 + N parent fetches
        assert self.client.session.get.call_count == 1
