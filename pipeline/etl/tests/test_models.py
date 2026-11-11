"""Tests for ETL data models."""

import json

from models import (
    Brand,
    Company,
    Person,
    Product,
    Relationship,
    SourceEntry,
    Violation,
    now_iso,
)


class TestNowIso:
    def test_returns_iso_string(self):
        result = now_iso()
        assert "T" in result
        assert "+" in result or "Z" in result


class TestSourceEntry:
    def test_to_dict(self):
        entry = SourceEntry(
            source="wikidata",
            field_name="name",
            value="Apple Inc",
            confidence="high",
        )
        d = entry.to_dict()
        assert d["source"] == "wikidata"
        assert d["field_name"] == "name"
        assert d["value"] == "Apple Inc"
        assert d["confidence"] == "high"
        assert "fetched" in d


class TestCompany:
    def test_minimal_creation(self):
        c = Company(name="Test Corp")
        assert c.name == "Test Corp"
        assert c.lei is None
        assert c.data_sources == []

    def test_add_source_updates_data_sources(self):
        c = Company(name="Test Corp")
        c.add_source("wikidata", "name", "Test Corp")
        assert "wikidata" in c.data_sources
        assert c.source_count == 1

    def test_add_multiple_sources(self):
        c = Company(name="Test Corp", lei="ABCDEFGHIJ1234567890")
        c.add_source("wikidata", "name", "Test Corp")
        c.add_source("gleif", "lei", "ABCDEFGHIJ1234567890")
        assert c.source_count == 2
        assert "wikidata" in c.data_sources
        assert "gleif" in c.data_sources

    def test_sources_json_updated(self):
        c = Company(name="Test Corp")
        c.add_source("wikidata", "name", "Test Corp")
        parsed = json.loads(c.sources_json)
        assert len(parsed) == 1
        assert parsed[0]["source"] == "wikidata"

    def test_duplicate_source_not_added(self):
        c = Company(name="Test Corp")
        c.add_source("wikidata", "name", "Test Corp")
        c.add_source("wikidata", "website", "http://test.com")
        assert c.data_sources.count("wikidata") == 1
        assert c.source_count == 1

    def test_to_dict_excludes_none_and_private(self):
        c = Company(name="Test Corp")
        d = c.to_dict()
        assert "name" in d
        assert "_source_entries" not in d
        assert "lei" not in d  # None values excluded
        assert "source_count" in d

    def test_to_dict_includes_set_fields(self):
        c = Company(name="Apple", lei="529900HNOAA1KXQJUQ27", country="US")
        d = c.to_dict()
        assert d["lei"] == "529900HNOAA1KXQJUQ27"
        assert d["country"] == "US"


class TestBrand:
    def test_creation(self):
        b = Brand(name="Nike", wikidata_id="Q483915")
        assert b.name == "Nike"
        assert b.wikidata_id == "Q483915"

    def test_add_source(self):
        b = Brand(name="Nike")
        b.add_source("wikidata", "name", "Nike")
        assert "wikidata" in b.data_sources

    def test_to_dict(self):
        b = Brand(name="Nike", wikidata_id="Q483915")
        d = b.to_dict()
        assert d["name"] == "Nike"
        assert "_source_entries" not in d


class TestProduct:
    def test_creation(self):
        p = Product(name="iPhone 15", asin="B0CHX3TW6G")
        assert p.name == "iPhone 15"
        assert p.asin == "B0CHX3TW6G"
        assert p.barcode is None

    def test_to_dict(self):
        p = Product(name="iPhone 15", asin="B0CHX3TW6G", brand_name="Apple")
        d = p.to_dict()
        assert d["brand_name"] == "Apple"
        assert "barcode" not in d  # None excluded


class TestPerson:
    def test_creation(self):
        p = Person(name="Tim Cook", wikidata_id="Q265469", role="ceo")
        assert p.name == "Tim Cook"
        assert p.role == "ceo"

    def test_add_source(self):
        p = Person(name="Tim Cook")
        p.add_source("wikidata", "name", "Tim Cook")
        p.add_source("sec_edgar", "total_compensation", 98734596)
        assert len(set(p.data_sources)) == 2


class TestRelationship:
    def test_creation(self):
        r = Relationship(
            from_id="Q312",
            from_label="Company",
            from_field="wikidata_id",
            to_id="Q456",
            to_label="Company",
            to_field="wikidata_id",
            rel_type="SUBSIDIARY_OF",
            source="wikidata",
        )
        assert r.rel_type == "SUBSIDIARY_OF"

    def test_to_dict_adds_provenance(self):
        r = Relationship(
            from_id="Q312",
            from_label="Company",
            from_field="wikidata_id",
            to_id="Q456",
            to_label="Company",
            to_field="wikidata_id",
            rel_type="SUBSIDIARY_OF",
            source="wikidata",
            confidence="high",
        )
        d = r.to_dict()
        assert d["properties"]["source"] == "wikidata"
        assert d["properties"]["confidence"] == "high"
        assert "last_confirmed" in d["properties"]

    def test_corroborated_by(self):
        r = Relationship(
            from_id="Q312",
            from_label="Company",
            from_field="wikidata_id",
            to_id="Q456",
            to_label="Company",
            to_field="wikidata_id",
            rel_type="SUBSIDIARY_OF",
            source="wikidata",
            corroborated_by=["gleif"],
        )
        d = r.to_dict()
        assert "gleif" in d["properties"]["corroborated_by"]


class TestViolation:
    def test_creation(self):
        v = Violation(
            case_id="VT-001",
            company_name="Test Corp",
            agency="OSHA",
            offense_type="Safety",
            penalty_amount=50000.0,
            year=2024,
        )
        assert v.penalty_amount == 50000.0
        assert v.source == "violation_tracker"

    def test_to_dict(self):
        v = Violation(
            case_id="VT-001",
            company_name="Test Corp",
            agency="OSHA",
            offense_type="Safety",
            penalty_amount=50000.0,
            year=2024,
        )
        d = v.to_dict()
        assert d["case_id"] == "VT-001"
        assert "description" not in d  # None excluded
