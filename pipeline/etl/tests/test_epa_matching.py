"""EPA ECHO facility-name matching.

ECHO's p_fn is a fuzzy search: querying "Mesa" returns thousands of unrelated
facilities. Every case below was observed in real ECHO responses during the
2026-08-29 audit follow-up, including the ULTIMA family, which is what motivated
rejecting weak single-token prefixes.
"""
import pytest

from enrichment.epa_echo import _process_facility, _prefix_match_is_trustworthy


def _facility(name, **extra):
    base = {
        "RegistryID": extra.pop("registry_id", name.replace(" ", "-")),
        "FacName": name,
        "FacComplianceStatus": "Violation Identified",
        "FacQtrsWithNC": "3",
        "AIRFlag": "Y",
    }
    base.update(extra)
    return base


class TestPrefixTrust:
    @pytest.mark.parametrize("company,remainder", [
        # Multi-token, distinctive: any facility leading with it is theirs.
        ("cvs pharmacy", " #11078"),
        ("under armour", ", sparrows point odh"),
        ("ultralife corporation", " previously called electrochem"),
        ("ufp technologies", " main building"),
        # Single-token, but the remainder cannot name a different company.
        ("unicon", " llc"),
        ("ultima", " inc"),
        ("dow", " company"),
        ("ugc", " #4"),
        ("acme", ""),
    ])
    def test_trusted(self, company, remainder):
        assert _prefix_match_is_trustworthy(company, remainder)

    @pytest.mark.parametrize("company,remainder", [
        # Real ULTIMA collisions — all distinct businesses sharing one word.
        ("ultima", " genomics"),
        ("ultima", " belleza salon"),
        ("ultima", " automotive & towing, inc."),
        ("ultima", " moda"),
        ("ultima", " nashua industrial corp"),
        # Short single tokens leading an unrelated business noun.
        ("ugc", " midstream"),
        ("dow", " jones"),
        ("ufa", " water supply wells rwm pipeline"),
    ])
    def test_rejected(self, company, remainder):
        assert not _prefix_match_is_trustworthy(company, remainder)


class TestProcessFacility:
    def test_exact_name_is_high_confidence(self):
        out = _process_facility(_facility("CVS PHARMACY"), "CVS Pharmacy", set())
        assert out["matched_by"] == "facility_name_verified"
        assert out["match_confidence"] == "high"

    def test_distinctive_prefix_is_medium_confidence(self):
        out = _process_facility(_facility("CVS PHARMACY #11078"), "CVS Pharmacy", set())
        assert out["matched_by"] == "facility_name_prefix"
        assert out["match_confidence"] == "medium"
        assert out["facility_name"] == "CVS PHARMACY #11078"

    def test_weak_prefix_is_dropped_and_counted(self):
        stats = {}
        assert _process_facility(_facility("ULTIMA GENOMICS"), "Ultima", set(), stats) is None
        assert stats["weak_prefix_rejected"] == 1

    def test_unrelated_facility_is_dropped(self):
        # The audit's headline case: a fuzzy hit that shares no prefix at all.
        assert _process_facility(_facility("SMITHFIELD PACKAGED MEATS"), "Mesa", set()) is None

    def test_substring_that_is_not_a_prefix_is_dropped(self):
        assert _process_facility(_facility("NEW CVS PHARMACY"), "CVS Pharmacy", set()) is None

    def test_word_boundary_is_required(self):
        # "DOWNTOWN" starts with "DOW" but 'n' is alphanumeric, so it is not a
        # word-boundary prefix and must never match.
        assert _process_facility(_facility("DOWNTOWN AUTO"), "Dow", set()) is None

    def test_seen_facility_is_not_duplicated(self):
        seen = set()
        first = _process_facility(_facility("CVS PHARMACY", registry_id="R1"), "CVS Pharmacy", seen)
        assert first is not None
        again = _process_facility(_facility("CVS PHARMACY", registry_id="R1"), "CVS Pharmacy", seen)
        assert again is None

    def test_facility_with_no_compliance_signal_is_dropped(self):
        bare = {"RegistryID": "R9", "FacName": "CVS PHARMACY", "FacComplianceStatus": "",
                "FacQtrsWithNC": "0"}
        assert _process_facility(bare, "CVS Pharmacy", set()) is None


class TestViolationStatus:
    """ECHO returns every name-matched facility; most are compliant.

    Before 2026-09, 80,707 of 98,700 published HAS_EPA_VIOLATION edges pointed
    at facilities whose status was "No Violation Identified".
    """

    def test_compliant_facility_without_penalty_is_skipped(self):
        stats = {}
        fac = _facility("CVS PHARMACY", FacComplianceStatus="No Violation Identified",
                        CAAComplianceStatus="No Violation Identified")
        assert _process_facility(fac, "CVS Pharmacy", set(), stats) is None
        assert stats["no_violation_skipped"] == 1

    @pytest.mark.parametrize("status", ["Unknown", "Inactive", "", None])
    def test_non_violation_statuses_are_skipped(self, status):
        fac = _facility("CVS PHARMACY", FacComplianceStatus=status)
        assert _process_facility(fac, "CVS Pharmacy", set()) is None

    @pytest.mark.parametrize("status", ["Violation Identified", "Significant Violation", "Violation"])
    def test_violation_statuses_are_kept(self, status):
        fac = _facility("CVS PHARMACY", FacComplianceStatus=status)
        assert _process_facility(fac, "CVS Pharmacy", set()) is not None

    def test_penalized_facility_is_kept_even_if_now_compliant(self):
        fac = _facility("CVS PHARMACY", FacComplianceStatus="No Violation Identified",
                        CAALastPenaltyAmt="$12,500")
        out = _process_facility(fac, "CVS Pharmacy", set())
        assert out["penalty_amount"] == 12500.0
        assert out["violation_type"] == "CAA"

    def test_air_permit_alone_is_not_a_clean_air_act_violation(self):
        # AIRFlag=Y only means the facility holds an air permit.
        fac = _facility("CVS PHARMACY", FacComplianceStatus="Violation Identified",
                        AIRFlag="Y", CAAComplianceStatus="No Violation Identified",
                        CWAComplianceStatus="Significant Violation")
        assert _process_facility(fac, "CVS Pharmacy", set())["violation_type"] == "CWA"
