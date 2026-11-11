"""Tests for wikidata_client.py helper functions."""

from unittest.mock import patch

import pytest

from wikidata_client import WikidataClient, _clean_name, _sanitize
from config import Config


@pytest.fixture(autouse=True)
def _no_sleep():
    with patch("wikidata_client.time.sleep"):
        yield


class TestCleanName:
    def test_strips_double_quotes(self):
        assert _clean_name('"APR"') == "APR"

    def test_strips_single_quotes(self):
        assert _clean_name("'Nike'") == "Nike"

    def test_strips_mixed_quotes(self):
        assert _clean_name("\"'Test'\"") == "Test"

    def test_strips_whitespace_and_quotes(self):
        assert _clean_name('  "Pepsi"  ') == "Pepsi"

    def test_no_op_for_clean_name(self):
        assert _clean_name("Apple Inc") == "Apple Inc"

    def test_returns_empty_string(self):
        assert _clean_name("") == ""

    def test_returns_none_for_none(self):
        assert _clean_name(None) is None

    def test_preserves_internal_quotes(self):
        assert _clean_name('Ben "Jerry" Smith') == 'Ben "Jerry" Smith'

    def test_only_quotes(self):
        assert _clean_name('""') == ""

    def test_nested_quotes(self):
        assert _clean_name('"\'value\'"') == "value"


class TestSanitize:
    def test_removes_control_characters(self):
        assert _sanitize("hello\x00world") == "helloworld"
        assert _sanitize("test\x07value") == "testvalue"

    def test_preserves_newlines_and_tabs(self):
        # \n = \x0a, \t = \x09, \r = \x0d — these should be preserved
        assert _sanitize("hello\nworld") == "hello\nworld"
        assert _sanitize("hello\tworld") == "hello\tworld"
        assert _sanitize("hello\rworld") == "hello\rworld"

    def test_no_op_for_clean_text(self):
        assert _sanitize("clean text") == "clean text"

    def test_returns_empty_for_empty(self):
        assert _sanitize("") == ""

    def test_returns_falsy_input(self):
        assert _sanitize(None) is None


class TestFetchCompaniesLogo:
    def setup_method(self):
        self.config = Config()
        self.client = WikidataClient(self.config)

    @patch.object(WikidataClient, '_query')
    def test_fetch_companies_includes_logo_url(self, mock_query):
        mock_query.return_value = [{
            "company": {"type": "uri", "value": "http://www.wikidata.org/entity/Q312"},
            "companyLabel": {"type": "literal", "value": "Apple Inc."},
            "lei": {"type": "literal", "value": "HWUPKR0MPOU8FGXBT394"},
            "website": {"type": "uri", "value": "https://apple.com"},
            "logo": {"type": "uri", "value": "http://commons.wikimedia.org/wiki/Special:FilePath/Apple_logo_black.svg"},
        }]
        companies = self.client.fetch_companies_with_lei()
        assert len(companies) == 1
        assert companies[0]["logo_url"] == "http://commons.wikimedia.org/wiki/Special:FilePath/Apple_logo_black.svg"

    @patch.object(WikidataClient, '_query')
    def test_fetch_companies_logo_url_none_when_missing(self, mock_query):
        mock_query.return_value = [{
            "company": {"type": "uri", "value": "http://www.wikidata.org/entity/Q312"},
            "companyLabel": {"type": "literal", "value": "Apple Inc."},
            "lei": {"type": "literal", "value": "HWUPKR0MPOU8FGXBT394"},
        }]
        companies = self.client.fetch_companies_with_lei()
        assert companies[0]["logo_url"] is None


def _uri(qid):
    return {"type": "uri", "value": f"http://www.wikidata.org/entity/{qid}"}


def _subsidiary_endpoint(pairs, qualifiers=()):
    """Fake _query for fetch_subsidiaries' query shapes.

    pairs: (child, parent, child_class, parent_class) tuples.
    Q4830453 (business) and Q783794 (company) stand in for the class closure.
    """
    def fake(sparql):
        if "wdt:P279*" in sparql:
            return [{"cls": _uri("Q4830453")}, {"cls": _uri("Q783794")}]
        if "SELECT ?child ?parent WHERE" in sparql:
            return [{"child": _uri(c), "parent": _uri(p)} for c, p, _, _ in pairs]
        if "?item p:P749 []" in sparql:
            return [{"item": _uri(c), "type": _uri(ct)} for c, _, ct, _ in pairs]
        if "ps:P749 ?item" in sparql:
            return [{"item": _uri(p), "type": _uri(pt)} for _, p, _, pt in pairs]
        return list(qualifiers)
    return fake


class TestFetchSubsidiaries:
    def setup_method(self):
        self.config = Config()
        self.client = WikidataClient(self.config)

    @patch.object(WikidataClient, '_query')
    def test_fetch_subsidiaries_includes_source_url(self, mock_query):
        mock_query.side_effect = _subsidiary_endpoint(
            [("Q95", "Q21077", "Q4830453", "Q783794")],
            [{"child": _uri("Q95"), "parent": _uri("Q21077"),
              "refUrl": {"type": "uri", "value": "https://abc.xyz/investor/"}},
             {"child": _uri("Q95"), "parent": _uri("Q21077"),
              "percentage": {"type": "literal", "value": "1.0"}}],
        )
        rels = self.client.fetch_subsidiaries()
        assert len(rels) == 1
        assert rels[0]["child_wikidata_id"] == "Q95"
        assert rels[0]["parent_wikidata_id"] == "Q21077"
        assert rels[0]["source_url"] == "https://abc.xyz/investor/"
        assert rels[0]["ownership_percentage"] == 100.0

    @patch.object(WikidataClient, '_query')
    def test_fetch_subsidiaries_handles_missing_refs(self, mock_query):
        mock_query.side_effect = _subsidiary_endpoint([("Q95", "Q21077", "Q4830453", "Q783794")])
        rels = self.client.fetch_subsidiaries()
        assert rels[0]["source_url"] is None
        assert rels[0]["ownership_percentage"] is None

    @patch.object(WikidataClient, '_query')
    def test_non_business_ends_are_dropped(self, mock_query):
        # Q3914 (school) is not in the business class closure.
        mock_query.side_effect = _subsidiary_endpoint([
            ("Q1", "Q2", "Q4830453", "Q783794"),
            ("Q3", "Q6", "Q3914", "Q783794"),
            ("Q4", "Q5", "Q4830453", "Q3914"),
        ])
        rels = self.client.fetch_subsidiaries()
        assert [(r["child_wikidata_id"], r["parent_wikidata_id"]) for r in rels] == [("Q1", "Q2")]


class TestFetchFinancialEntityIds:
    def setup_method(self):
        self.config = Config()
        self.client = WikidataClient(self.config)

    @patch.object(WikidataClient, '_query')
    def test_returns_set_of_wikidata_ids(self, mock_query):
        mock_query.return_value = [
            {"entity": {"type": "uri", "value": "http://www.wikidata.org/entity/Q219635"}},
            {"entity": {"type": "uri", "value": "http://www.wikidata.org/entity/Q192840"}},
        ]
        result = self.client.fetch_financial_entity_ids()
        assert isinstance(result, set)
        assert "Q219635" in result
        assert "Q192840" in result
        assert len(result) == 2


class TestFetchBrandsLogo:
    def setup_method(self):
        self.config = Config()
        self.client = WikidataClient(self.config)

    @patch.object(WikidataClient, '_query')
    def test_fetch_brands_includes_logo_url(self, mock_query):
        mock_query.return_value = [{
            "brand": {"type": "uri", "value": "http://www.wikidata.org/entity/Q2085235"},
            "brandLabel": {"type": "literal", "value": "Nike"},
            "owner": {"type": "uri", "value": "http://www.wikidata.org/entity/Q483151"},
            "ownerLabel": {"type": "literal", "value": "Nike, Inc."},
            "website": {"type": "uri", "value": "https://nike.com"},
            "logo": {"type": "uri", "value": "http://commons.wikimedia.org/wiki/Special:FilePath/Nike_swoosh.svg"},
        }]
        brands = self.client.fetch_brands()
        assert len(brands) == 1
        assert brands[0]["logo_url"] == "http://commons.wikimedia.org/wiki/Special:FilePath/Nike_swoosh.svg"

    @patch.object(WikidataClient, '_query')
    def test_fetch_brands_logo_url_none_when_missing(self, mock_query):
        mock_query.return_value = [{
            "brand": {"type": "uri", "value": "http://www.wikidata.org/entity/Q2085235"},
            "brandLabel": {"type": "literal", "value": "Nike"},
        }]
        brands = self.client.fetch_brands()
        assert brands[0]["logo_url"] is None


class TestExtendedProperties:
    @patch("wikidata_client.time.sleep")
    @patch.object(WikidataClient, '_query')
    def test_values_are_labelled_from_a_separate_lookup(self, mock_query, _sleep):
        def fake(sparql):
            if "VALUES ?item" in sparql:
                assert "wd:Q30" in sparql and "wd:Q60" in sparql
                return [{"item": _uri("Q30"), "itemLabel": {"value": "United States"}},
                        {"item": _uri("Q60"), "itemLabel": {"value": "New York City"}}]
            assert "SERVICE wikibase:label" not in sparql
            return [{"company": _uri("Q1"), "lei": {"value": "LEI1"},
                     "country": _uri("Q30"), "hqCity": _uri("Q60"),
                     "employees": {"value": "1200"}}]
        mock_query.side_effect = fake
        rows = WikidataClient(Config()).fetch_extended_properties()
        assert rows[0]["country"] == "United States"
        assert rows[0]["hq_city"] == "New York City"
        assert rows[0]["industry"] is None
        assert rows[0]["employees"] == 1200


def test_label_languages_prefer_mul_over_other_languages():
    # Walmart (Q483551) lost its "en" label in favour of "mul"; without "mul"
    # early in the list its name fell through to Japanese.
    from wikidata_client import LABEL_LANGUAGES
    langs = LABEL_LANGUAGES.split(",")
    assert langs[:2] == ["en", "mul"]
    src = open(__import__("wikidata_client").__file__).read()
    assert src.count('wikibase:language "en,de') == 0


class TestStageOneNames:
    @patch.object(WikidataClient, '_query')
    def test_company_names_come_from_the_label_lookup(self, mock_query):
        def fake(sparql):
            if "VALUES ?item" in sparql:
                assert "SERVICE wikibase:label" in sparql
                return [{"item": _uri("Q483551"), "itemLabel": {"value": "Walmart"}}]
            assert "SERVICE wikibase:label" not in sparql
            return [{"company": _uri("Q483551"), "lei": {"value": "Y87794H0US1R65VBXU25"}},
                    {"company": _uri("Q999"), "lei": {"value": "LEI999"}}]
        mock_query.side_effect = fake
        by_qid = {c["wikidata_id"]: c for c in WikidataClient(Config()).fetch_companies_with_lei()}
        assert by_qid["Q483551"]["name"] == "Walmart"
        # No label in any language: the QID, as the label service returned.
        assert by_qid["Q999"]["name"] == "Q999"

    @patch.object(WikidataClient, '_query')
    def test_brands_keep_only_business_owners_one_row_each(self, mock_query):
        def fake(sparql):
            if "wdt:P279* wd:Q431289" in sparql:
                return [{"cls": _uri("Q431289")}]
            if "wdt:P279*" in sparql:
                return [{"cls": _uri("Q4830453")}]
            if "pq:P1107" in sparql:
                return [{"brand": _uri(b), "owner": _uri(o), "st": {"value": f"s-{b}-{o}"}}
                        for b, o in (("Q1", "Q10"), ("Q1", "Q11"), ("Q2", "Q12"))]
            if "?ownerType" in sparql:
                return [{"brand": _uri("Q1"), "owner": _uri("Q10"), "ownerType": _uri("Q4830453")},
                        {"brand": _uri("Q1"), "owner": _uri("Q11"), "ownerType": _uri("Q4830453")},
                        {"brand": _uri("Q2"), "owner": _uri("Q12"), "ownerType": _uri("Q3914")}]
            if "VALUES ?item" in sparql:
                return [{"item": _uri("Q1"), "itemLabel": {"value": "KitKat"}}]
            return [{"brand": _uri("Q1"), "website": {"value": "https://kitkat.com"}},
                    {"brand": _uri("Q1"), "website": {"value": "https://kitkat.co.uk"}},
                    {"brand": _uri("Q2"), "website": {"value": "https://www.acme-foods.com"}}]
        mock_query.side_effect = fake
        rows = WikidataClient(Config()).fetch_brands()
        assert [(r["wikidata_id"], r["owner_wikidata_id"]) for r in rows] == [
            ("Q1", "Q10"), ("Q1", "Q11"), ("Q2", None)]
        assert rows[0]["name"] == "KitKat" and rows[0]["website"] == "https://kitkat.com"
        # Unlabelled brand: named from its website, as before.
        assert rows[2]["name"] == "Acme Foods"

    @patch.object(WikidataClient, '_query')
    def test_brand_owners_exclude_shareholders_and_past_owners(self, mock_query):
        # P127 lists index funds with a proportion (Vanguard 4.5% of Walmart)
        # and past owners with an end time (Duracell <- P&G until 2014).
        def st(b, o, sid, pct=None, end=None):
            row = {"brand": _uri(b), "owner": _uri(o), "st": {"value": sid}}
            if pct is not None:
                row["pct"] = {"value": pct}
            if end is not None:
                row["end"] = {"value": end}
            return row
        mock_query.return_value = [
            st("Q1", "Q10", "a", pct="0.0451"),                      # 4.5% shareholder
            st("Q1", "Q11", "b", pct="0.95"),                        # 95%: controls it
            st("Q2", "Q20", "c", end="2014-01-01T00:00:00Z"),        # sold in 2014
            st("Q3", "Q30", "d", end="2001-01-01T00:00:00Z"),        # sold, then
            st("Q3", "Q30", "e"),                                    # bought back
            st("Q4", "Q40", "f", end="2999-01-01T00:00:00Z"),        # ends in future
            st("Q5", "Q5", "g"),                                     # itself
            st("Q6", "Q60", "h", pct="60"),                          # percent form
        ]
        client = WikidataClient(Config())
        kept = client._controlling_brand_owners("wd:Q431289")
        assert kept == {("Q1", "Q11"), ("Q3", "Q30"), ("Q4", "Q40"), ("Q5", "Q5"), ("Q6", "Q60")}
        # Retraction only ever acts on these; a pair missing from a run is
        # not in either set, so a partial fetch deletes nothing.
        assert client.rejected_brand_owners == {("Q1", "Q10"), ("Q2", "Q20"), ("Q5", "Q5")}

    @patch.object(WikidataClient, '_query')
    def test_standing_edges_are_checked_per_brand_not_per_class(self, mock_query):
        # Shell plc is no longer typed as a brand, so the class-based pass
        # never sees its 3-8% index-fund "owners"; asking by QID does.
        mock_query.return_value = [
            {"brand": _uri("Q154950"), "owner": _uri("Q219635"), "st": {"value": "s1"}, "pct": {"value": "0.0832"}},
            {"brand": _uri("Q154950"), "owner": _uri("Q999"), "st": {"value": "s2"}},
        ]
        standing = {("Q154950", "Q219635"), ("Q154950", "Q999"), ("Q7", "Q70"), ("Q8", "Q8")}
        rejected = WikidataClient(Config()).rejected_owner_pairs(standing)
        # Q7->Q70 has no statement in the answer: re-modelled, not ended, so kept.
        assert rejected == {("Q154950", "Q219635"), ("Q8", "Q8")}
        assert "VALUES ?brand" in mock_query.call_args[0][0]

    @patch.object(WikidataClient, '_query')
    def test_owner_check_outage_retracts_nothing(self, mock_query):
        # WDQS failing a batch must not fail stage 1, and only positive
        # evidence retracts, so an unanswered batch rejects nothing.
        mock_query.side_effect = RuntimeError("SPARQL query failed after 3 attempts")
        rejected = WikidataClient(Config()).rejected_owner_pairs({("Q1", "Q10"), ("Q2", "Q2")})
        assert rejected == {("Q2", "Q2")}

    @patch.object(WikidataClient, '_query')
    def test_shareholders_are_current_minority_stakes(self, mock_query):
        def st(c, h, pct, end=None, ref=None):
            row = {"company": _uri(c), "holder": _uri(h), "pct": {"value": pct}}
            if end: row["end"] = {"value": end}
            if ref: row["ref"] = {"value": ref}
            return row
        mock_query.return_value = [
            st("Q1", "Q10", "0.0451", ref="https://example.com/13f"),   # Vanguard 4.5%: kept
            st("Q1", "Q10", "0.03"),                                   # older, smaller: max wins
            st("Q1", "Q11", "0.4795"),                                 # 47.95%: kept (minority)
            st("Q2", "Q20", "0.60"),                                   # majority: an owner, not an investor
            st("Q3", "Q30", "0.10", end="2014-01-01T00:00:00Z"),       # sold
            st("Q4", "Q4", "0.05"),                                    # itself
        ]
        rows = WikidataClient(Config()).fetch_company_shareholders()
        got = {(r["company_wikidata_id"], r["investor_wikidata_id"]): r["ownership_percentage"] for r in rows}
        assert got == {("Q1", "Q10"): 4.51, ("Q1", "Q11"): 47.95}
        assert all(r["wikidata_property"] == "P127" for r in rows)
        assert next(r for r in rows if r["investor_wikidata_id"] == "Q10")["source_url"] == "https://example.com/13f"


def test_public_sector_and_business_lists_do_not_overlap():
    from wikidata_client import BUSINESS_OVERRIDE_CLASSES, PUBLIC_SECTOR_CLASSES
    assert not (PUBLIC_SECTOR_CLASSES & BUSINESS_OVERRIDE_CLASSES)
    # Q43229 (organization) is neither: Hasbro and Décathlon carry it, and so
    # do public bodies, so it decides nothing.
    assert "Q43229" not in PUBLIC_SECTOR_CLASSES
    assert "Q43229" not in BUSINESS_OVERRIDE_CLASSES


class TestBusinessClassification:
    @patch.object(WikidataClient, '_query')
    def test_lei_company_types_are_fetched_on_their_own(self, mock_query):
        # As an OPTIONAL inside the extended query, each class repeated every
        # other column: 351K rows and 448MB instead of 123K rows.
        mock_query.return_value = [
            {"company": _uri("Q1"), "type": _uri("Q4830453")},
            {"company": _uri("Q1"), "type": _uri("Q891723")},
            {"company": _uri("Q2"), "type": _uri("Q3918")},
        ]
        types = WikidataClient(Config()).fetch_lei_company_types()
        assert types == {"Q1": {"Q4830453", "Q891723"}, "Q2": {"Q3918"}}
        assert "OPTIONAL" not in mock_query.call_args[0][0]

    @patch("wikidata_client.time.sleep")
    @patch.object(WikidataClient, '_query')
    def test_subsidiary_fetch_records_which_items_are_public_bodies(self, mock_query, _sleep):
        mock_query.side_effect = _subsidiary_endpoint([
            ("Q1", "Q2", "Q4830453", "Q43229"),   # a business under an "organization"
            ("Q3", "Q6", "Q3914", "Q783794"),     # a school
        ])
        client = WikidataClient(Config())
        client.fetch_subsidiaries()
        assert client.typed_items == {"Q1", "Q2", "Q3", "Q6"}
        assert client.public_sector_items == {"Q3"}


class TestPublicSectorRule:
    def setup_method(self):
        self.client = WikidataClient(Config())

    @pytest.mark.parametrize("classes", [
        {"Q43229"},               # Hasbro, Décathlon, Holcim: "organization" only
        {"Q43229", "Q141145821"}, # Société Générale: organization + systemically important bank
        {"Q18127"},               # record label — outside Wikidata's business closure
        {"Q730038"},              # credit institution — likewise
        {"Q4830453"},             # business
        set(),
    ])
    def test_companies_are_not_public_sector(self, classes):
        # Requiring a business class dropped 388 real ownership edges
        # (Parmalat -> Lactalis, Lafarge -> Holcim), so absence proves nothing.
        assert not self.client.is_public_sector(classes)

    @pytest.mark.parametrize("classes", [
        {"Q3918"},                # university
        {"Q515", "Q62049"},       # city, county seat
        {"Q31855"},               # research institute (CNRS labs)
        {"Q152081"},              # concentration camp
        {"Q126807"},              # kindergarten
    ])
    def test_public_bodies_are_recognised(self, classes):
        assert self.client.is_public_sector(classes)

    def test_a_corporate_form_wins_over_a_public_one(self):
        # A state-owned enterprise is still a company.
        assert not self.client.is_public_sector({"Q3918", "Q270791"})

    @pytest.mark.parametrize("classes,expected", [
        # Prague: "big city" plus Czech municipality classes that Wikidata
        # files under "business", which used to cancel the classification.
        ({"Q1549591", "Q5153359", "Q7819319", "Q1200957"}, True),
        # CNRS: research institute + open-access publisher (also under
        # "business" in the closure).
        ({"Q31855", "Q45400320", "Q43229"}, True),
        ({"Q4936585", "Q784271"}, True),        # EU External Action Service
        ({"Q1752939", "Q17505024"}, True),      # NASA
        ({"Q748720", "Q97374157"}, True),       # European Parliament
    ])
    def test_public_bodies_that_the_closure_let_through(self, classes, expected):
        assert self.client.is_public_sector(classes) is expected


@pytest.mark.parametrize("classes,name", [
    ({"Q192350"}, "a ministry"),
    ({"Q35798"}, "an executive branch"),
    ({"Q37726"}, "an army"),
    ({"Q5153359"}, "a Czech municipality"),
])
def test_state_bodies_are_public_sector(classes, name):
    assert WikidataClient.is_public_sector(classes), name
