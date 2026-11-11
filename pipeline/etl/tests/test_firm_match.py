"""Firm-name verification for recall and violation attribution.

The rejected cases are real misattributions found in the graph during the
2026-09 data-source review: openFDA's phrase search and CPSC's title search
returned records for unrelated firms that shared a word with the company.
"""
import pytest

from enrichment.firm_match import match_firm


@pytest.mark.parametrize("company,firm,expected", [
    ("Tyson Foods", "Tyson Foods, Inc.", "high"),
    ("Tyson Foods, Inc.", "TYSON FOODS INC", "high"),
    ("The Kroger Co.", "Kroger Co", "high"),
    ("Walmart", "Walmart Inc., of Bentonville, Arkansas", "high"),
    ("Kraft Heinz", "Kraft Heinz Foods Company", "medium"),
    ("Tyson Foods Inc", "Tyson Foods Plant 5", "medium"),
    ("Dole", "Dole Inc.", "high"),
])
def test_accepts_the_same_firm(company, firm, expected):
    match = match_firm(company, firm)
    assert match is not None
    assert match[1] == expected


@pytest.mark.parametrize("company,firm", [
    ("Apple", "Apple Valley Farms LLC"),          # openFDA phrase match
    ("ICA", "Medica Corp"),                        # substring, not a word
    ("Ice", "Cool Co. Ltd., of China"),            # title hit, different maker
    ("Dow", "Dow Jones & Company"),               # shared first word
    ("American Express", "Express, Inc."),         # dropping a leading word is not a match
    ("International Paper", "Paper Co"),
    ("Kroger", "Fred Meyer (a Kroger company)"),   # company named mid-string
    ("", "Anything Inc"),
    ("Acme", ""),
])
def test_rejects_a_different_firm(company, firm):
    assert match_firm(company, firm) is None
