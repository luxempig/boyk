"""
Company identity resolution for enrichment writers (audit 2026-08-29, C2/H8).

Name is not identity — see ``merge_companies``, which refuses merge-by-name.
When N Company nodes share a name, Cypher bound by ``{name: ...}`` binds all N
and writes the enrichment edge N times (the "one contract on 73 companies" bug);
when 0 exist it mints a name-only node. Every enrichment writer must resolve
``company_name`` to exactly one node identity (``lei`` or ``wikidata_id``) BEFORE
Cypher runs; rows resolving to 0 or >1 distinct identities are quarantined and
never written.

Built once per run from the graph's own identity rows. The normalizer is kept
in sync with ``tools/off-ingest/sam_crosswalk.py``.
"""
from __future__ import annotations

import json
import logging
import os
import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Keep in sync with tools/off-ingest/sam_crosswalk.py::norm
_NORM_RE = re.compile(r"[^a-z0-9]+")
_SUFFIX_RE = re.compile(
    r"\b(incorporated|corporation|company|limited|holdings|group|inc|corp"
    r"|llc|llp|ltd|plc|co|sa|ag|nv|bv|gmbh|spa)\b"
)


def normalize_company_name(s: str) -> str:
    s = (s or "").lower()
    s = _SUFFIX_RE.sub(" ", s)
    return _NORM_RE.sub("", s)


@dataclass(frozen=True)
class CompanyRef:
    key_field: str    # 'lei' | 'wikidata_id' — unique-constrained property to MATCH on
    key: str          # the identifier value
    company_id: str   # coalesce(lei, wikidata_id) — the app/Supabase-facing id
    name: str         # graph display name


class CompanyResolver:
    """name -> single graph identity. Built once per run from the graph itself."""

    def __init__(self, identity_rows: List[Dict]):
        self._exact: Dict[str, List[CompanyRef]] = {}
        self._norm: Dict[str, List[CompanyRef]] = {}
        self._unkeyable: set = set()          # names of nodes with neither lei nor qid
        for row in identity_rows:
            name = (row.get("name") or "").strip()
            if not name:
                continue
            lei = (row.get("lei") or "").strip() or None
            qid = (row.get("wikidata_id") or "").strip() or None
            if lei:
                ref = CompanyRef("lei", lei, lei, name)
            elif qid:
                ref = CompanyRef("wikidata_id", qid, qid, name)
            else:
                self._unkeyable.add(name)
                continue
            self._exact.setdefault(name, []).append(ref)
            self._norm.setdefault(normalize_company_name(name), []).append(ref)
        n_ambig = sum(1 for v in self._exact.values() if len({r.company_id for r in v}) > 1)
        logger.info(
            f"CompanyResolver: {len(self._exact)} exact names "
            f"({n_ambig} ambiguous name groups, {len(self._unkeyable)} unkeyable nodes)"
        )

    def resolve(self, name: str) -> Optional[Tuple[CompanyRef, str, str]]:
        """Return (ref, matched_by, match_confidence) or None (quarantine)."""
        refs = self._exact.get((name or "").strip(), [])
        distinct = {r.company_id for r in refs}
        if len(distinct) == 1:
            return refs[0], "company_name_unique", "high"
        if len(distinct) > 1:
            return None                                  # ambiguous — never guess
        refs = self._norm.get(normalize_company_name(name), [])
        distinct = {r.company_id for r in refs}
        if len(distinct) == 1:
            return refs[0], "company_name_normalized", "medium"
        return None                                      # unknown / ambiguous-normalized

    def explain(self, name: str) -> str:
        refs = self._exact.get((name or "").strip(), [])
        distinct = {r.company_id for r in refs}
        if len(distinct) > 1:
            return f"ambiguous_exact({len(distinct)})"
        if (name or "").strip() in self._unkeyable:
            return "node_has_no_identifier"
        nrefs = self._norm.get(normalize_company_name(name), [])
        ndistinct = {r.company_id for r in nrefs}
        if len(ndistinct) > 1:
            return f"ambiguous_normalized({len(ndistinct)})"
        return "unknown_name"

    def candidates(self, name: str) -> List[CompanyRef]:
        return self._exact.get((name or "").strip(), []) or \
               self._norm.get(normalize_company_name(name), [])

    def resolvable_names(self) -> List[str]:
        """Names safe to feed enrichment stages: resolve to exactly one identity."""
        return sorted(n for n, v in self._exact.items()
                      if len({r.company_id for r in v}) == 1)


def partition_rows(rows: List[Dict], resolver: CompanyResolver, *,
                   name_field: str = "company_name", stage: str = "",
                   out_prefix: str = "company_",
                   set_provenance: bool = True) -> Tuple[List[Dict], List[Dict]]:
    """Split rows into (resolved, quarantined) by company identity.

    Resolved rows gain ``{out_prefix}key_field`` / ``{out_prefix}key`` (the
    identifier to MATCH on) and, when ``set_provenance``, a ``matched_by`` that
    preserves any module-supplied value and suffixes the identity key field
    (e.g. ``facility_name_verified+lei``). A module's own ``match_confidence`` is
    never upgraded. Quarantined rows carry a ``_quarantine_reason``.
    """
    resolved: List[Dict] = []
    quarantined: List[Dict] = []
    for row in rows:
        name = row.get(name_field)
        res = resolver.resolve(name)
        if res is None:
            quarantined.append({**row, "_quarantine_reason": resolver.explain(name), "_stage": stage})
            continue
        ref, matched_by, confidence = res
        out = dict(row)
        out[f"{out_prefix}key_field"] = ref.key_field
        out[f"{out_prefix}key"] = ref.key
        if set_provenance:
            base_mb = row.get("matched_by") or matched_by
            out["matched_by"] = f"{base_mb}+{ref.key_field}"
            out["match_confidence"] = row.get("match_confidence") or confidence
        resolved.append(out)
    return resolved, quarantined


def write_quarantine(quarantined: List[Dict], stage: str, config) -> None:
    """Persist quarantined rows (no edge written) as JSONL + a warning counter."""
    if not quarantined:
        return
    qdir = os.path.join(config.cache_dir, "quarantine")
    os.makedirs(qdir, exist_ok=True)
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    path = os.path.join(qdir, f"{stage}-{day}.jsonl")
    with open(path, "a") as f:
        for row in quarantined:
            f.write(json.dumps(row, default=str) + "\n")
    reasons = Counter(r.get("_quarantine_reason", "?") for r in quarantined)
    logger.warning(
        f"Quarantine [{stage}]: {len(quarantined)} rows not written "
        f"(company_name did not resolve to a single identity). Reasons: {dict(reasons)}"
    )
