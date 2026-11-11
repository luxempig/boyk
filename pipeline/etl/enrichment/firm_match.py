"""
Decide whether a firm name returned by a government API denotes the company
that was queried.

Name searches at EPA ECHO, openFDA and CPSC are fuzzy or substring matches:
querying "Apple" returns Apple Valley Farms, and querying "Ice" returns every
recall with "ice" in its title. Attributing a violation or recall to the wrong
company is a defamation risk, while missing one only costs a record the next
run re-fetches, so these rules err toward rejecting.
"""

import re

# Tokens that can trail a company name without denoting a different company:
# legal suffixes, and the store/plant/unit designators facility registries append.
_BENIGN_TRAILING_TOKENS = {
    # legal form
    "inc", "incorporated", "llc", "l l c", "ltd", "limited", "corp", "corporation",
    "co", "company", "lp", "llp", "plc", "pllc", "gmbh", "ag", "sa", "nv", "bv",
    "pbc", "holdings", "holding", "group", "usa", "us", "america", "american",
    "intl", "international", "the", "and", "of",
    # site designators
    "store", "stores", "plant", "plants", "facility", "facilities", "site", "sites",
    "unit", "units", "terminal", "warehouse", "dc", "branch", "division", "no",
    "number", "shop", "center", "centre",
}

# A single-token company name is a weak prefix: "Ultima" leads ULTIMA GENOMICS,
# ULTIMA MODA and ULTIMA BELLEZA SALON, which are unrelated businesses. A
# multi-token name of reasonable length ("CVS Pharmacy", "Under Armour") is
# distinctive enough that a facility starting with it is almost certainly theirs.
_DISTINCTIVE_MIN_TOKENS = 2
_DISTINCTIVE_MIN_CHARS = 8

_TOKEN_SPLIT_RE = re.compile(r"[^a-z0-9]+")
# "S.A." / "L.L.C." / "N.V." — dotted acronyms, so they survive tokenising whole.
_DOTTED_ACRONYM_RE = re.compile(r"\b(?:[a-z]\.){2,}")
# CPSC writes firms as "Acme Corp., of Dallas, Texas".
_LOCATION_TAIL_RE = re.compile(r",\s*of\s+.*$", re.IGNORECASE)


def _tokens(s: str) -> list:
    s = _DOTTED_ACRONYM_RE.sub(lambda m: m.group(0).replace(".", ""), (s or "").lower())
    return [t for t in _TOKEN_SPLIT_RE.split(s) if t]


# Legal forms only. Words like "american" or "international" are benign after a
# name but meaningful inside one, so they are never stripped for equality.
_LEGAL_FORM_TOKENS = {
    # English
    "inc", "incorporated", "llc", "ltd", "limited", "liability", "corp", "corporation",
    "co", "company", "lp", "llp", "plc", "pllc", "pbc",
    # elsewhere: German, French, Italian, Spanish, Nordic, Dutch, Russian, Asian
    "gmbh", "ag", "kg", "ug", "sarl", "sas", "sa", "spa", "srl", "sl", "nv", "bv",
    "ab", "as", "asa", "oy", "oyj", "aps", "oao", "ooo", "pao", "zao", "ao",
    "jsc", "pjsc", "ojsc", "cjsc", "pte", "pty", "bhd", "kk",
}


def _core(tokens: list) -> list:
    """Tokens without a leading "the" and trailing legal forms ("Tyson Foods, Inc." -> tyson foods)."""
    tokens = tokens[1:] if tokens[:1] == ["the"] else list(tokens)
    while tokens and tokens[-1] in _LEGAL_FORM_TOKENS:
        tokens.pop()
    return tokens


def _prefix_remainder_is_benign(remainder: str) -> bool:
    """True if what follows the company name cannot denote a different company."""
    tokens = _tokens(remainder)
    if not tokens:
        return True  # trailing punctuation only
    # Pure unit numbers ("#11078", "6") never indicate a different company.
    return all(t.isdigit() or t in _BENIGN_TRAILING_TOKENS for t in tokens)


def _prefix_match_is_trustworthy(company_name: str, remainder: str) -> bool:
    """Decide whether a name-prefix match is strong enough to publish."""
    tokens = _tokens(company_name)
    if len(tokens) >= _DISTINCTIVE_MIN_TOKENS and len(company_name) >= _DISTINCTIVE_MIN_CHARS:
        return True
    return _prefix_remainder_is_benign(remainder)


def match_firm(company_name: str, firm_name: str):
    """Return (matched_by, match_confidence) if firm_name is the company, else None.

    Compares on word tokens, so punctuation and case never matter:
      - same tokens, or same tokens once legal suffixes are dropped -> high
      - firm starts with the company's tokens and the rest is benign, or the
        company name is distinctive (see _prefix_match_is_trustworthy) -> medium
      - anything else, including the company appearing mid-name -> None
    """
    firm = _LOCATION_TAIL_RE.sub("", firm_name or "")
    company_tokens = _tokens(company_name)
    firm_tokens = _tokens(firm)
    if not company_tokens or not firm_tokens:
        return None
    if firm_tokens == company_tokens:
        return "firm_name_verified", "high"
    company_core = _core(company_tokens)
    if company_core and _core(firm_tokens) == company_core:
        return "firm_name_verified", "high"

    firm_lead = firm_tokens[1:] if firm_tokens[:1] == ["the"] else firm_tokens
    n = len(company_core)
    if company_core and firm_lead[:n] == company_core:
        remainder = " ".join(firm_lead[n:])
        if _prefix_match_is_trustworthy(" ".join(company_core), remainder):
            return "firm_name_prefix", "medium"
    return None
