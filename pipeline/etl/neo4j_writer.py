"""
Neo4j Writer — Stage 8 + all writes
Handles all database operations with batching, concurrent writes, and provenance.
"""

import json
import logging
import time
from typing import List, Dict, Any, Optional, Set

from neo4j import GraphDatabase

from config import Config
from company_resolver import CompanyResolver, partition_rows, write_quarantine
from models import now_iso

logger = logging.getLogger(__name__)


class Neo4jWriter:
    def __init__(self, config: Config):
        self.config = config
        self.driver = GraphDatabase.driver(
            config.neo4j_uri,
            auth=(config.neo4j_user, config.neo4j_password),
            max_connection_pool_size=config.neo4j_pool_size,
        )

    def health_check(self) -> bool:
        """Verify Neo4j connection is alive. Call before running stages."""
        try:
            with self.driver.session() as session:
                session.run("RETURN 1").single()
            logger.info("Neo4j health check passed")
            return True
        except Exception as e:
            logger.error(f"Neo4j health check failed: {e}")
            return False

    def close(self):
        self.driver.close()

    # ── Schema Setup ──────────────────────────────────────────

    def setup_constraints_and_indexes(self):
        """Create all constraints and indexes. Idempotent."""
        constraints = [
            "CREATE CONSTRAINT company_lei IF NOT EXISTS FOR (c:Company) REQUIRE c.lei IS UNIQUE",
            "CREATE CONSTRAINT company_wikidata IF NOT EXISTS FOR (c:Company) REQUIRE c.wikidata_id IS UNIQUE",
            "CREATE CONSTRAINT brand_wikidata IF NOT EXISTS FOR (b:Brand) REQUIRE b.wikidata_id IS UNIQUE",
            "CREATE CONSTRAINT product_barcode IF NOT EXISTS FOR (p:Product) REQUIRE p.barcode IS UNIQUE",
            "CREATE CONSTRAINT politician_fec IF NOT EXISTS FOR (p:Politician) REQUIRE p.fec_id IS UNIQUE",
            "CREATE CONSTRAINT facility_osid IF NOT EXISTS FOR (f:Facility) REQUIRE f.os_id IS UNIQUE",
            "CREATE CONSTRAINT country_iso IF NOT EXISTS FOR (c:Country) REQUIRE c.iso_code IS UNIQUE",
            # New constraints for v2 node types
            "CREATE CONSTRAINT recall_id IF NOT EXISTS FOR (r:Recall) REQUIRE r.recall_id IS UNIQUE",
            "CREATE CONSTRAINT complaint_id IF NOT EXISTS FOR (cc:ConsumerComplaint) REQUIRE cc.complaint_id IS UNIQUE",
            # award_id alone is a per-agency PIID fragment ('0006', '1008' etc.
            # recur across agencies), so the old single-property constraint forced
            # unrelated awards to collapse into one node — one contract ended up
            # attached to 73 companies. The key is (award_id, agency); see
            # _migrate_superseded_constraints for the swap off the old one.
            "CREATE CONSTRAINT contract_award_agency IF NOT EXISTS FOR (gc:GovernmentContract) "
            "REQUIRE (gc.award_id, gc.agency) IS UNIQUE",
            "CREATE CONSTRAINT offshore_icij IF NOT EXISTS FOR (oe:OffshoreEntity) REQUIRE oe.icij_id IS UNIQUE",
            "CREATE CONSTRAINT violation_caseid_unique IF NOT EXISTS FOR (v:Violation) REQUIRE v.case_id IS UNIQUE",
            "CREATE CONSTRAINT person_wikidata_unique IF NOT EXISTS FOR (p:Person) REQUIRE p.wikidata_id IS UNIQUE",
        ]
        indexes = [
            "CREATE INDEX company_name IF NOT EXISTS FOR (c:Company) ON (c.name)",
            "CREATE INDEX brand_name IF NOT EXISTS FOR (b:Brand) ON (b.name)",
            "CREATE INDEX person_name IF NOT EXISTS FOR (p:Person) ON (p.name)",
            "CREATE INDEX violation_year IF NOT EXISTS FOR (v:Violation) ON (v.year)",
            "CREATE INDEX subsidy_year IF NOT EXISTS FOR (s:Subsidy) ON (s.year)",
            "CREATE INDEX product_asin IF NOT EXISTS FOR (p:Product) ON (p.asin)",
            "CREATE INDEX product_name IF NOT EXISTS FOR (p:Product) ON (p.name)",
            "CREATE INDEX politician_name IF NOT EXISTS FOR (p:Politician) ON (p.name)",
            # Date indexes for API ORDER BY clauses
            "CREATE INDEX recall_date IF NOT EXISTS FOR (r:Recall) ON (r.date)",
            "CREATE INDEX complaint_date IF NOT EXISTS FOR (cc:ConsumerComplaint) ON (cc.date_received)",
            "CREATE INDEX product_upc IF NOT EXISTS FOR (p:Product) ON (p.upc)",
            # Relationship property indexes
            "CREATE INDEX invested_in_by_source IF NOT EXISTS FOR ()-[r:INVESTED_IN_BY]-() ON (r.source)",
        ]
        fulltext_indexes = [
            "CREATE FULLTEXT INDEX company_fulltext IF NOT EXISTS FOR (n:Company) ON EACH [n.name]",
            "CREATE FULLTEXT INDEX brand_fulltext IF NOT EXISTS FOR (n:Brand) ON EACH [n.name]",
            "CREATE FULLTEXT INDEX product_fulltext IF NOT EXISTS FOR (n:Product) ON EACH [n.name]",
        ]
        failed = []
        with self.driver.session(database=self.config.neo4j_database) as session:
            for stmt in constraints + indexes + fulltext_indexes:
                try:
                    session.run(stmt)
                except Exception as e:
                    msg = str(e)
                    # "already exists"/equivalent-schema errors are benign idempotency
                    # noise. Anything else — especially a UNIQUE constraint failing
                    # because the data violates it — is silent-corruption-in-waiting
                    # and must be loud. (The company_wikidata constraint failed at
                    # debug level for months while QID collisions accumulated.)
                    if "already exists" in msg or "equivalent" in msg.lower():
                        logger.debug(f"Schema statement skipped: {e}")
                    else:
                        failed.append(stmt.split(" IF NOT EXISTS")[0])
                        logger.warning(f"SCHEMA STATEMENT FAILED: {stmt.strip()} -> {e}")
        if failed:
            logger.warning(
                f"{len(failed)} schema statement(s) failed — declared invariants are NOT "
                f"being enforced: {failed}"
            )
        self._migrate_superseded_constraints(failed)
        logger.info("Schema constraints and indexes created")

    # Constraints replaced by a wider key. Each entry names the old constraint and
    # the replacement that must be confirmed present before the old one is dropped.
    SUPERSEDED_CONSTRAINTS = {
        "contract_award": "contract_award_agency",
    }

    def _migrate_superseded_constraints(self, failed_statements: List[str]):
        """Drop constraints whose replacement is already in place.

        Ordering matters: the replacement is created above, and only dropped-from
        here once it is confirmed live. A failed CREATE therefore leaves the old
        (narrower but real) constraint enforcing, rather than leaving the label
        with no uniqueness guarantee at all.
        """
        with self.driver.session(database=self.config.neo4j_database) as session:
            try:
                live = {r["name"] for r in session.run("SHOW CONSTRAINTS YIELD name RETURN name")}
            except Exception as e:
                logger.warning(f"Could not enumerate constraints, skipping migration: {e}")
                return
            for old, replacement in self.SUPERSEDED_CONSTRAINTS.items():
                if old not in live:
                    continue
                if replacement not in live:
                    logger.warning(
                        f"Constraint '{old}' NOT dropped: replacement '{replacement}' is "
                        f"absent (its CREATE failed). The old key stays enforced."
                    )
                    continue
                try:
                    session.run(f"DROP CONSTRAINT {old} IF EXISTS")
                    logger.info(f"Dropped superseded constraint '{old}' (replaced by '{replacement}')")
                except Exception as e:
                    logger.warning(f"Failed to drop superseded constraint '{old}': {e}")

    # ── Batch Write Helpers ───────────────────────────────────

    def _run_batch(self, query: str, batch: List[Dict], batch_label: str = ""):
        """Run a Cypher query with UNWIND on a batch of dicts inside a transaction."""
        if not batch:
            return
        now_value = now_iso()
        
        def _do_write(tx):
            tx.run(query, rows=batch, now=now_value)
            
        with self.driver.session(database=self.config.neo4j_database) as session:
            try:
                session.execute_write(_do_write)
            except Exception as e:
                logger.error(f"Batch write failed ({batch_label}, {len(batch)} rows): {e}")
                raise
        if batch_label:
            logger.debug(f"Wrote {len(batch)} {batch_label}")

    def _run_chunked(self, query: str, data: List[Dict], label: str = ""):
        """Split data into chunks and write each sequentially to avoid deadlocks.
        On chunk failure, retries row-by-row to isolate and skip bad rows."""
        if not data:
            return
        bs = self.config.batch_size
        chunks = [data[i:i + bs] for i in range(0, len(data), bs)]
        skipped = 0

        for i, chunk in enumerate(chunks):
            try:
                self._run_batch(query, chunk, label)
            except Exception:
                logger.warning(f"  {label}: chunk {i+1}/{len(chunks)} failed, retrying row-by-row")
                for row in chunk:
                    try:
                        self._run_batch(query, [row], label)
                    except Exception as row_err:
                        skipped += 1
                        logger.warning(f"  {label}: skipped bad row: {row_err}")
            if len(chunks) > 5 and (i + 1) % 5 == 0:
                logger.info(f"  {label}: {i + 1}/{len(chunks)} chunks written")

        if skipped:
            logger.warning(f"Wrote {len(data) - skipped} {label} ({skipped} rows skipped)")
        else:
            logger.info(f"Wrote {len(data)} {label}")

    # Placeholder token in a writer query where the company binding goes; replaced
    # per identity partition by _run_identity_partitioned.
    COMPANY_MATCH_TOKEN = "__COMPANY_MATCH__"

    def _run_identity_partitioned(self, query_template: str, rows: List[Dict],
                                  label: str, prefix: str = "company_"):
        """Run a writer query once per identity partition (lei, then wikidata_id).

        ``query_template`` contains ``COMPANY_MATCH_TOKEN`` where the company
        binding goes; ``rows`` carry ``{prefix}key_field`` / ``{prefix}key`` from
        company_resolver.partition_rows. Uses MATCH (never MERGE): both lei and
        wikidata_id are UNIQUE-constrained, so each bind is a single-node index
        seek that can never mint a Company. Partitioning by key field (rather than
        an OR over both) keeps the planner on the index instead of a label scan.
        """
        for key_field in ("lei", "wikidata_id"):
            part = [r for r in rows if r.get(f"{prefix}key_field") == key_field]
            if not part:
                continue
            clause = f"MATCH (c:Company {{{key_field}: row.{prefix}key}})"
            self._run_chunked(query_template.replace(self.COMPANY_MATCH_TOKEN, clause),
                              part, f"{label} [{key_field}]")

    @staticmethod
    def _rel_list_add_unique_expr(list_expr: str, value_expr: str) -> str:
        """Return a Cypher CASE expression that appends a scalar to a list only if non-empty and unique."""
        return (
            "CASE "
            f"WHEN {value_expr} IS NULL OR trim(toString({value_expr})) = '' THEN coalesce({list_expr}, []) "
            f"WHEN {value_expr} IN coalesce({list_expr}, []) THEN coalesce({list_expr}, []) "
            f"ELSE coalesce({list_expr}, []) + {value_expr} END"
        )

    def _relationship_provenance_set_clause(
        self,
        rel_var: str = "r",
        source_expr: str = "row.source",
        record_id_expr: str = "row.source_record_id",
        source_url_expr: str = "row.source_url",
        evidence_key_expr: str = "row.evidence_key",
        evidence_json_expr: str = "row.evidence_json",
        matched_by_expr: str = "row.matched_by",
        match_confidence_expr: str = "row.match_confidence",
        confirmed_expr: str = "row.last_updated",
        now_expr: str = "$now",
    ) -> str:
        """Reusable Cypher snippet to enforce standardized relationship provenance properties."""
        effective_source_expr = f"coalesce({rel_var}.source, {source_expr})"
        evidence_sources_expr = self._rel_list_add_unique_expr(f"{rel_var}.evidence_sources", source_expr)
        evidence_record_ids_expr = self._rel_list_add_unique_expr(
            f"{rel_var}.evidence_record_ids", f"toString({record_id_expr})"
        )
        evidence_urls_expr = self._rel_list_add_unique_expr(f"{rel_var}.evidence_urls", source_url_expr)
        evidence_keys_expr = self._rel_list_add_unique_expr(f"{rel_var}.evidence_keys", evidence_key_expr)
        return f"""
        SET {rel_var}.source = {effective_source_expr},
            {rel_var}.corroborated_by = CASE
                WHEN {source_expr} IS NULL OR trim(toString({source_expr})) = '' THEN coalesce({rel_var}.corroborated_by, [])
                WHEN {effective_source_expr} = {source_expr} THEN coalesce({rel_var}.corroborated_by, [])
                WHEN {source_expr} IN coalesce({rel_var}.corroborated_by, []) THEN coalesce({rel_var}.corroborated_by, [])
                ELSE coalesce({rel_var}.corroborated_by, []) + {source_expr}
            END,
            {rel_var}.evidence_sources = {evidence_sources_expr},
            {rel_var}.evidence_record_ids = {evidence_record_ids_expr},
            {rel_var}.evidence_urls = {evidence_urls_expr},
            {rel_var}.evidence_keys = {evidence_keys_expr},
            {rel_var}.evidence_count = size({evidence_keys_expr}),
            {rel_var}.evidence_json = coalesce({rel_var}.evidence_json, {evidence_json_expr}),
            {rel_var}.matched_by = coalesce({rel_var}.matched_by, {matched_by_expr}),
            {rel_var}.match_confidence = coalesce({rel_var}.match_confidence, {match_confidence_expr}, "high"),
            {rel_var}.confidence = coalesce({rel_var}.confidence, {match_confidence_expr}, {rel_var}.confidence, "high"),
            {rel_var}.first_seen = coalesce({rel_var}.first_seen, {now_expr}),
            {rel_var}.last_confirmed = coalesce({confirmed_expr}, {rel_var}.last_confirmed, {now_expr}),
            {rel_var}.provenance_version = 1
        """

    @staticmethod
    def _prepare_relationship_rows(
        rows: List[Dict],
        default_source: Optional[str] = None,
        record_id_fields: Optional[List[str]] = None,
        source_url_fields: Optional[List[str]] = None,
        matched_by: Optional[str] = None,
        match_confidence: Optional[str] = None,
    ) -> List[Dict]:
        """Normalize row-level relationship provenance so Cypher writers can share one schema."""
        if not rows:
            return rows
        record_id_fields = record_id_fields or []
        source_url_fields = source_url_fields or ["source_url"]
        prepared: List[Dict] = []
        for raw in rows:
            row = dict(raw)
            if default_source and not row.get("source"):
                row["source"] = default_source
            if matched_by and not row.get("matched_by"):
                row["matched_by"] = matched_by
            if match_confidence and not row.get("match_confidence"):
                row["match_confidence"] = match_confidence

            if not row.get("source_record_id"):
                for key in record_id_fields:
                    val = row.get(key)
                    if val is not None and str(val).strip() != "":
                        row["source_record_id"] = str(val)
                        break

            if not row.get("source_url"):
                for key in source_url_fields:
                    val = row.get(key)
                    if val is not None and str(val).strip() != "":
                        row["source_url"] = str(val)
                        break

            if not row.get("evidence_key"):
                key_parts = []
                for key in ("source", "source_record_id", "source_url"):
                    val = row.get(key)
                    if val is None:
                        continue
                    val_str = str(val).strip()
                    if val_str:
                        key_parts.append(val_str)
                if key_parts:
                    row["evidence_key"] = "|".join(key_parts)

            if not row.get("evidence_json"):
                evidence = {}
                for key in ("source", "source_record_id", "source_url", "matched_by", "match_confidence"):
                    val = row.get(key)
                    if val is None:
                        continue
                    if isinstance(val, str) and not val.strip():
                        continue
                    evidence[key] = val
                if evidence:
                    row["evidence_json"] = json.dumps(evidence, separators=(",", ":"), sort_keys=True)

            prepared.append(row)
        return prepared

    # ── Company Writes ────────────────────────────────────────

    def merge_companies(self, companies: List[Dict], merge_field: str = "lei"):
        """Merge Company nodes. merge_field is the unique key for MERGE."""
        if merge_field == "lei":
            query = """
            UNWIND $rows AS row
            MERGE (c:Company {lei: row.lei})
            SET c.name = coalesce(row.name, c.name),
                // A QID may belong to exactly one node. Only stamp it if this node
                // doesn't already have one AND no other node owns it — otherwise
                // name-matched enrichment silently splits one company's identity
                // across multiple nodes (the 309-collision pathology, 2026-06-10).
                c.wikidata_id = CASE
                    WHEN row.wikidata_id IS NULL THEN c.wikidata_id
                    WHEN c.wikidata_id IS NOT NULL THEN c.wikidata_id
                    WHEN EXISTS { MATCH (o:Company {wikidata_id: row.wikidata_id}) WHERE o <> c } THEN c.wikidata_id
                    ELSE row.wikidata_id
                END,
                c.cik = coalesce(row.cik, c.cik),
                c.legal_name = coalesce(row.legal_name, c.legal_name),
                c.jurisdiction = coalesce(row.jurisdiction, c.jurisdiction),
                c.country = coalesce(row.country, c.country),
                c.industry = coalesce(row.industry, c.industry),
                c.hq_city = coalesce(row.hq_city, c.hq_city),
                c.hq_country = coalesce(row.hq_country, c.hq_country),
                c.website = coalesce(row.website, c.website),
                c.logo_url = coalesce(row.logo_url, c.logo_url),
                c.founded = coalesce(row.founded, c.founded),
                c.employees = coalesce(row.employees, c.employees),
                c.revenue = coalesce(row.revenue, c.revenue),
                c.stock_exchange = coalesce(row.stock_exchange, c.stock_exchange),
                c.ticker = coalesce(row.ticker, c.ticker),
                c.isin = coalesce(row.isin, c.isin),
                c.sources_json = coalesce(row.sources_json, c.sources_json),
                c.data_sources = REDUCE(acc = coalesce(c.data_sources, []), src IN coalesce(row.data_sources, []) |
                    CASE WHEN src IN acc THEN acc ELSE acc + src END),
                c.source_count = size(REDUCE(acc = coalesce(c.data_sources, []), src IN coalesce(row.data_sources, []) |
                    CASE WHEN src IN acc THEN acc ELSE acc + src END)),
                c.last_updated = row.last_updated
            """
        elif merge_field == "wikidata_id":
            query = """
            UNWIND $rows AS row
            MERGE (c:Company {wikidata_id: row.wikidata_id})
            SET c.name = coalesce(row.name, c.name),
                // Mirror of the QID guard: an LEI may belong to exactly one node.
                c.lei = CASE
                    WHEN row.lei IS NULL THEN c.lei
                    WHEN c.lei IS NOT NULL THEN c.lei
                    WHEN EXISTS { MATCH (o:Company {lei: row.lei}) WHERE o <> c } THEN c.lei
                    ELSE row.lei
                END,
                c.website = coalesce(row.website, c.website),
                c.data_sources = REDUCE(acc = coalesce(c.data_sources, []), src IN coalesce(row.data_sources, []) |
                    CASE WHEN src IN acc THEN acc ELSE acc + src END),
                c.sources_json = coalesce(row.sources_json, c.sources_json),
                c.last_updated = row.last_updated
            """
        else:
            # Name is not an identity. MERGE-by-name mints a new node for every
            # name variant and was the root cause of the duplicate/orphan pollution.
            raise ValueError(
                f"merge_companies: merge_field must be 'lei' or 'wikidata_id', got {merge_field!r}. "
                "Companies may only be created under a stable external identifier."
            )
        self._run_chunked(query, companies, "companies")

    def update_uk_company_registrations(self, companies: List[Dict], resolver: CompanyResolver):
        """Update existing Company nodes with UK Companies House registration fields."""
        keyed, quarantined = partition_rows(companies, resolver, name_field="name",
                                            stage="uk_registrations", set_provenance=False)
        write_quarantine(quarantined, "uk_registrations", self.config)
        query = f"""
        UNWIND $rows AS row
        {self.COMPANY_MATCH_TOKEN}
        SET c.uk_company_number = coalesce(row.uk_company_number, c.uk_company_number),
            c.uk_company_status = coalesce(row.uk_company_status, c.uk_company_status),
            c.uk_company_type = coalesce(row.uk_company_type, c.uk_company_type),
            c.uk_registered_address = coalesce(row.uk_registered_address, c.uk_registered_address),
            c.date_of_creation = coalesce(row.date_of_creation, c.date_of_creation),
            c.data_sources = REDUCE(acc = coalesce(c.data_sources, []), src IN coalesce(row.data_sources, []) |
                CASE WHEN src IN acc THEN acc ELSE acc + src END),
            c.source_count = size(REDUCE(acc = coalesce(c.data_sources, []), src IN coalesce(row.data_sources, []) |
                CASE WHEN src IN acc THEN acc ELSE acc + src END)),
            c.last_updated = coalesce(row.last_updated, c.last_updated)
        """
        self._run_identity_partitioned(query, keyed, "uk company registrations")

    # ── Brand Writes ──────────────────────────────────────────

    def merge_brands(self, brands: List[Dict]):
        query = """
        UNWIND $rows AS row
        MERGE (b:Brand {wikidata_id: row.wikidata_id})
        SET b.name = coalesce(row.name, b.name),
            b.website = coalesce(row.website, b.website),
            b.logo_url = coalesce(row.logo_url, b.logo_url),
            b.data_sources = coalesce(row.data_sources, b.data_sources),
            b.sources_json = coalesce(row.sources_json, b.sources_json),
            b.last_updated = row.last_updated
        """
        self._run_chunked(query, brands, "brands")

    # ── Person Writes ─────────────────────────────────────────

    def merge_persons(self, persons: List[Dict]):
        query = """
        UNWIND $rows AS row
        MERGE (p:Person {wikidata_id: row.wikidata_id})
        SET p.name = coalesce(row.name, p.name),
            p.role = coalesce(row.role, p.role),
            p.total_compensation = coalesce(row.total_compensation, p.total_compensation),
            p.base_salary = coalesce(row.base_salary, p.base_salary),
            p.stock_awards = coalesce(row.stock_awards, p.stock_awards),
            p.comp_fiscal_year = coalesce(row.comp_fiscal_year, p.comp_fiscal_year),
            p.data_sources = coalesce(row.data_sources, p.data_sources),
            p.sources_json = coalesce(row.sources_json, p.sources_json),
            p.last_updated = row.last_updated
        """
        self._run_chunked(query, persons, "persons")

    def merge_uk_psc_relationships(self, persons: List[Dict], resolver: CompanyResolver):
        """Merge UK Companies House PSC people and link them to existing Company nodes."""
        keyed, quarantined = partition_rows(persons, resolver, stage="uk_psc")
        write_quarantine(quarantined, "uk_psc", self.config)
        rows = self._prepare_relationship_rows(
            keyed,
            default_source="uk_companies_house",
            matched_by="company_name_unique",
            match_confidence="medium",
        )
        query = f"""
        UNWIND $rows AS row
        {self.COMPANY_MATCH_TOKEN}
        MERGE (p:Person {{name: row.person_name}})
        SET p.nationality = coalesce(row.nationality, p.nationality),
            p.country_of_residence = coalesce(row.country_of_residence, p.country_of_residence),
            p.data_sources = REDUCE(acc = coalesce(p.data_sources, []), src IN ["uk_companies_house"] |
                CASE WHEN src IN acc THEN acc ELSE acc + src END),
            p.last_updated = coalesce(row.last_updated, p.last_updated)
        MERGE (p)-[r:HAS_SIGNIFICANT_CONTROL_OVER]->(c)
        {self._relationship_provenance_set_clause(
            rel_var="r",
            source_expr='coalesce(row.source, "uk_companies_house")',
            record_id_expr='coalesce(row.source_record_id, row.company_name + "|" + row.person_name)',
            matched_by_expr='coalesce(row.matched_by, "company_name_exact")',
            match_confidence_expr='coalesce(row.match_confidence, "medium")',
            confirmed_expr='coalesce(row.last_updated, $now)',
        )}
        SET
            r.role = coalesce(row.role, "significant_control"),
            r.natures_of_control = coalesce(row.natures_of_control, []),
            r.last_confirmed = coalesce(row.last_updated, r.last_confirmed, $now)
        """
        self._run_identity_partitioned(query, rows, "uk psc relationships")

    # ── Product Writes ────────────────────────────────────────

    def merge_products(self, products: List[Dict]):
        query = """
        UNWIND $rows AS row
        MERGE (p:Product {barcode: row.barcode})
        SET p.name = coalesce(row.name, p.name),
            p.asin = coalesce(row.asin, p.asin),
            p.upc = coalesce(row.upc, p.upc),
            p.category = coalesce(row.category, p.category),
            p.brand_name = coalesce(row.brand_name, p.brand_name),
            p.data_sources = coalesce(row.data_sources, p.data_sources),
            p.sources_json = coalesce(row.sources_json, p.sources_json),
            p.last_updated = row.last_updated
        """
        self._run_chunked(query, products, "products")

    def merge_products_by_asin(self, products: List[Dict]):
        query = """
        UNWIND $rows AS row
        MERGE (p:Product {asin: row.asin})
        SET p.name = coalesce(row.name, p.name),
            p.upc = coalesce(row.upc, p.upc),
            p.brand_name = coalesce(row.brand_name, p.brand_name),
            p.data_sources = coalesce(row.data_sources, p.data_sources),
            p.sources_json = coalesce(row.sources_json, p.sources_json),
            p.last_updated = row.last_updated
        """
        self._run_chunked(query, products, "products (by ASIN)")

    # ── Politician Writes ─────────────────────────────────────

    def merge_politicians(self, politicians: List[Dict]):
        query = """
        UNWIND $rows AS row
        MERGE (p:Politician {fec_id: row.fec_id})
        SET p.name = coalesce(row.name, p.name),
            p.party = coalesce(row.party, p.party),
            p.state = coalesce(row.state, p.state),
            p.office = coalesce(row.office, p.office),
            p.data_sources = coalesce(row.data_sources, p.data_sources),
            p.last_updated = row.last_updated
        """
        self._run_chunked(query, politicians, "politicians")

    # ── Enrichment Node Writes ────────────────────────────────

    def merge_violations(self, violations: List[Dict], resolver: CompanyResolver):
        keyed, quarantined = partition_rows(violations, resolver, stage="violations")
        write_quarantine(quarantined, "violations", self.config)
        rows = self._prepare_relationship_rows(
            keyed,
            default_source="violation_tracker",
            record_id_fields=["case_id"],
            matched_by="company_name_unique",
            match_confidence="medium",
        )
        query = f"""
        UNWIND $rows AS row
        MERGE (v:Violation {{case_id: row.case_id}})
        SET v.company_name = row.company_name,
            v.agency = row.agency,
            v.offense_type = row.offense_type,
            v.penalty_amount = row.penalty_amount,
            v.year = row.year,
            v.description = row.description,
            v.source = row.source,
            v.last_updated = row.last_updated
        WITH v, row
        {self.COMPANY_MATCH_TOKEN}
        MERGE (c)-[r:PENALIZED_FOR]->(v)
        {self._relationship_provenance_set_clause(
            rel_var="r",
            source_expr='coalesce(row.source, "violation_tracker")',
            record_id_expr='coalesce(row.source_record_id, row.case_id)',
            matched_by_expr='coalesce(row.matched_by, "company_name_exact")',
            match_confidence_expr='coalesce(row.match_confidence, "medium")',
        )}
        """
        self._run_identity_partitioned(query, rows, "violations")

    @staticmethod
    def _clear_superseded_dispute(rel_var: str, reason: str) -> str:
        """Cypher that un-disputes an edge the writer has just re-verified.

        The 2026-09 repair disputed edges the old stages wrote without a check
        that these stages now make before writing (reason epa_no_violation or
        recall_firm_mismatch), and legacy edges that carried no evidence and no
        confirmation date (legacy_unverified). Writing one again means it now
        passes, so that dispute no longer applies. Other reasons are kept.
        """
        return (
            f"FOREACH (_ IN CASE WHEN {rel_var}.disputed_reason = '{reason}' THEN [1] ELSE [] END |\n"
            f"            REMOVE {rel_var}.disputed, {rel_var}.disputed_reason, "
            f"{rel_var}.disputed_by, {rel_var}.disputed_at)"
        )

    def merge_environmental_violations(self, violations: List[Dict], resolver: CompanyResolver):
        keyed, quarantined = partition_rows(violations, resolver, stage="epa_echo")
        write_quarantine(quarantined, "epa_echo", self.config)
        rows = self._prepare_relationship_rows(
            keyed,
            default_source="epa_echo",
            record_id_fields=["facility_id", "registry_id"],
            matched_by="company_name_unique",
            match_confidence="medium",
        )
        query = f"""
        UNWIND $rows AS row
        MERGE (v:EnvironmentalViolation {{facility_id: row.facility_id}})
        SET v.company_name = row.company_name,
            v.facility_name = coalesce(row.facility_name, v.facility_name),
            v.violation_type = row.violation_type,
            v.compliance_status = row.compliance_status,
            v.penalty_amount = row.penalty_amount,
            v.last_inspection = row.last_inspection,
            v.registry_id = row.registry_id,
            v.source = row.source,
            v.last_updated = row.last_updated
        WITH v, row
        {self.COMPANY_MATCH_TOKEN}
        MERGE (c)-[r:HAS_EPA_VIOLATION]->(v)
        {self._relationship_provenance_set_clause(
            rel_var="r",
            source_expr='coalesce(row.source, "epa_echo")',
            record_id_expr='coalesce(row.source_record_id, row.facility_id, row.registry_id)',
            matched_by_expr='coalesce(row.matched_by, "company_name_exact")',
            match_confidence_expr='coalesce(row.match_confidence, "medium")',
        )}
        {self._clear_superseded_dispute("r", "epa_no_violation")}
        {self._clear_superseded_dispute("r", "legacy_unverified")}
        """
        self._run_identity_partitioned(query, rows, "environmental violations")

    def merge_lobbying_records(self, records: List[Dict], resolver: CompanyResolver):
        keyed, quarantined = partition_rows(records, resolver, stage="lobbying")
        write_quarantine(quarantined, "lobbying", self.config)
        prepared = []
        for row in keyed:
            item = dict(row)
            item.setdefault("source_record_id", f"{item.get('company_name','')}|{item.get('year','')}")
            prepared.append(item)
        rows = self._prepare_relationship_rows(
            prepared,
            default_source="opensecrets",
            matched_by="company_name_unique",
            match_confidence="medium",
        )
        query = f"""
        UNWIND $rows AS row
        MERGE (l:LobbyingRecord {{company_name: row.company_name, year: row.year}})
        SET l.total_spent = row.total_spent,
            l.issues = row.issues,
            l.num_lobbyists = row.num_lobbyists,
            l.source = row.source,
            l.last_updated = row.last_updated
        WITH l, row
        {self.COMPANY_MATCH_TOKEN}
        MERGE (c)-[r:LOBBIED_FOR]->(l)
        {self._relationship_provenance_set_clause(
            rel_var="r",
            source_expr='coalesce(row.source, "opensecrets")',
            record_id_expr='coalesce(row.source_record_id, row.company_name + "|" + toString(row.year))',
            matched_by_expr='coalesce(row.matched_by, "company_name_exact")',
            match_confidence_expr='coalesce(row.match_confidence, "medium")',
        )}
        SET r.year = row.year
        """
        self._run_identity_partitioned(query, rows, "lobbying records")

    def merge_esg_scores(self, scores: List[Dict], resolver: CompanyResolver):
        keyed, quarantined = partition_rows(scores, resolver, stage="esg")
        write_quarantine(quarantined, "esg", self.config)
        prepared = []
        for row in keyed:
            item = dict(row)
            item.setdefault(
                "source_record_id",
                f"{item.get('company_name','')}|{item.get('metric_name','')}|{item.get('year','')}"
            )
            prepared.append(item)
        rows = self._prepare_relationship_rows(
            prepared,
            default_source="wikirate",
            matched_by="company_name_unique",
            match_confidence="medium",
        )
        query = f"""
        UNWIND $rows AS row
        MERGE (e:ESGScore {{company_name: row.company_name, metric_name: row.metric_name, year: row.year}})
        SET e.value = row.value,
            e.designer = row.designer,
            e.methodology = row.methodology,
            e.source = row.source,
            e.last_updated = row.last_updated
        WITH e, row
        {self.COMPANY_MATCH_TOKEN}
        MERGE (c)-[r:HAS_ESG_SCORE]->(e)
        {self._relationship_provenance_set_clause(
            rel_var="r",
            source_expr='coalesce(row.source, "wikirate")',
            record_id_expr='coalesce(row.source_record_id, row.company_name + "|" + row.metric_name + "|" + toString(row.year))',
            matched_by_expr='coalesce(row.matched_by, "company_name_exact")',
            match_confidence_expr='coalesce(row.match_confidence, "medium")',
        )}
        """
        self._run_identity_partitioned(query, rows, "ESG scores")

    def merge_facilities(self, facilities: List[Dict], resolver: CompanyResolver):
        keyed, quarantined = partition_rows(facilities, resolver, stage="facilities")
        write_quarantine(quarantined, "facilities", self.config)
        rows = self._prepare_relationship_rows(
            keyed,
            default_source="open_supply_hub",
            record_id_fields=["os_id"],
            matched_by="company_name_unique",
            match_confidence="low",
        )
        query = f"""
        UNWIND $rows AS row
        MERGE (f:Facility {{os_id: row.os_id}})
        SET f.name = row.name,
            f.country = row.country,
            f.address = row.address,
            f.lat = row.lat,
            f.lng = row.lng,
            f.num_workers = row.num_workers,
            f.product_types = row.product_types,
            f.source = row.source,
            f.last_updated = row.last_updated
        WITH f, row
        WHERE row.company_name IS NOT NULL
        {self.COMPANY_MATCH_TOKEN}
        MERGE (c)-[r:PRODUCES_AT]->(f)
        {self._relationship_provenance_set_clause(
            rel_var="r",
            source_expr='coalesce(row.source, "open_supply_hub")',
            record_id_expr='coalesce(row.source_record_id, row.os_id)',
            matched_by_expr='coalesce(row.matched_by, "company_name_exact")',
            match_confidence_expr='coalesce(row.match_confidence, "low")',
        )}
        """
        self._run_identity_partitioned(query, rows, "facilities")

    def merge_subsidies(self, subsidies: List[Dict], resolver: CompanyResolver):
        keyed, quarantined = partition_rows(subsidies, resolver, stage="subsidies")
        write_quarantine(quarantined, "subsidies", self.config)
        prepared = []
        for row in keyed:
            item = dict(row)
            item.setdefault(
                "source_record_id",
                f"{item.get('company_name','')}|{item.get('program_name','')}|{item.get('year','')}"
            )
            prepared.append(item)
        rows = self._prepare_relationship_rows(
            prepared,
            default_source="subsidy_tracker",
            matched_by="company_name_unique",
            match_confidence="medium",
        )
        query = f"""
        UNWIND $rows AS row
        MERGE (s:Subsidy {{
            company_name: row.company_name,
            program_name: row.program_name,
            year: row.year
        }})
        SET s.subsidy_type = row.subsidy_type,
            s.amount = row.amount,
            s.state = row.state,
            s.awarding_agency = row.awarding_agency,
            s.source = row.source,
            s.last_updated = row.last_updated
        WITH s, row
        {self.COMPANY_MATCH_TOKEN}
        MERGE (c)-[r:RECEIVED_SUBSIDY]->(s)
        {self._relationship_provenance_set_clause(
            rel_var="r",
            source_expr='coalesce(row.source, "subsidy_tracker")',
            record_id_expr='coalesce(row.source_record_id, row.company_name + "|" + row.program_name + "|" + toString(row.year))',
            matched_by_expr='coalesce(row.matched_by, "company_name_exact")',
            match_confidence_expr='coalesce(row.match_confidence, "medium")',
        )}
        """
        self._run_identity_partitioned(query, rows, "subsidies")

    # ── New Node Type Writes (v2) ──────────────────────────────

    def merge_recalls(self, recalls: List[Dict], resolver: CompanyResolver):
        """Merge Recall nodes and link to companies."""
        keyed, quarantined = partition_rows(recalls, resolver, stage="recalls")
        write_quarantine(quarantined, "recalls", self.config)
        rows = self._prepare_relationship_rows(
            keyed,
            record_id_fields=["recall_id"],
            matched_by="company_name_unique",
            match_confidence="medium",
        )
        query = f"""
        UNWIND $rows AS row
        MERGE (r:Recall {{recall_id: row.recall_id}})
        SET r.product_name = row.product_name,
            r.company_name = row.company_name,
            r.reason = row.reason,
            r.classification = row.classification,
            r.status = row.status,
            r.date = row.date,
            r.agency = row.agency,
            r.firm_name = row.firm_name,
            r.firm_role = row.firm_role,
            r.source = row.source,
            r.last_updated = row.last_updated
        WITH r AS recall, row
        {self.COMPANY_MATCH_TOKEN}
        MERGE (c)-[rel:RECALLED_PRODUCT]->(recall)
        {self._relationship_provenance_set_clause(
            rel_var="rel",
            source_expr="row.source",
            record_id_expr='coalesce(row.source_record_id, row.recall_id)',
            matched_by_expr='coalesce(row.matched_by, "company_name_exact")',
            match_confidence_expr='coalesce(row.match_confidence, "medium")',
        )}
        {self._clear_superseded_dispute("rel", "recall_firm_mismatch")}
        {self._clear_superseded_dispute("rel", "legacy_unverified")}
        """
        self._run_identity_partitioned(query, rows, "recalls")

    def merge_consumer_complaints(self, complaints: List[Dict], resolver: CompanyResolver):
        """Merge ConsumerComplaint nodes and link to companies."""
        keyed, quarantined = partition_rows(complaints, resolver, stage="cfpb")
        write_quarantine(quarantined, "cfpb", self.config)
        rows = self._prepare_relationship_rows(
            keyed,
            default_source="cfpb",
            record_id_fields=["complaint_id"],
            matched_by="company_name_unique",
            match_confidence="medium",
        )
        query = f"""
        UNWIND $rows AS row
        MERGE (cc:ConsumerComplaint {{complaint_id: row.complaint_id}})
        SET cc.company_name = row.company_name,
            cc.product = row.product,
            cc.issue = row.issue,
            cc.sub_issue = row.sub_issue,
            cc.state = row.state,
            cc.date_received = row.date_received,
            cc.company_response = row.company_response,
            cc.timely_response = row.timely_response,
            cc.consumer_disputed = row.consumer_disputed,
            cc.source = row.source,
            cc.last_updated = row.last_updated
        WITH cc, row
        {self.COMPANY_MATCH_TOKEN}
        MERGE (c)-[r:HAS_COMPLAINT]->(cc)
        {self._relationship_provenance_set_clause(
            rel_var="r",
            source_expr='coalesce(row.source, "cfpb")',
            record_id_expr='coalesce(row.source_record_id, row.complaint_id)',
            matched_by_expr='coalesce(row.matched_by, "company_name_exact")',
            match_confidence_expr='coalesce(row.match_confidence, "medium")',
        )}
        """
        self._run_identity_partitioned(query, rows, "consumer complaints")

    def merge_government_contracts(self, contracts: List[Dict], resolver: CompanyResolver):
        """Merge GovernmentContract nodes and link to companies."""
        keyed, quarantined = partition_rows(contracts, resolver, stage="usaspending")
        write_quarantine(quarantined, "usaspending", self.config)
        rows = self._prepare_relationship_rows(
            keyed,
            default_source="usaspending",
            record_id_fields=["award_id"],
            matched_by="company_name_unique",
            match_confidence="medium",
        )
        query = f"""
        UNWIND $rows AS row
        MERGE (gc:GovernmentContract {{award_id: row.award_id, agency: row.agency}})
        SET gc.company_name = row.company_name,
            gc.recipient_name = row.recipient_name,
            gc.recipient_uei = row.recipient_uei,
            gc.amount = row.amount,
            gc.description = row.description,
            gc.naics_code = row.naics_code,
            gc.start_date = row.start_date,
            gc.end_date = row.end_date,
            gc.contract_type = row.contract_type,
            gc.source = row.source,
            gc.last_updated = row.last_updated
        WITH gc, row
        {self.COMPANY_MATCH_TOKEN}
        MERGE (c)-[r:AWARDED_CONTRACT]->(gc)
        {self._relationship_provenance_set_clause(
            rel_var="r",
            source_expr='coalesce(row.source, "usaspending")',
            record_id_expr='coalesce(row.source_record_id, row.award_id)',
            matched_by_expr='coalesce(row.matched_by, "company_name_exact")',
            match_confidence_expr='coalesce(row.match_confidence, "medium")',
        )}
        {self._clear_superseded_dispute("r", "legacy_unverified")}
        """
        self._run_identity_partitioned(query, rows, "government contracts")

    def merge_offshore_entities(self, entities: List[Dict], resolver: CompanyResolver):
        """Merge OffshoreEntity nodes and link to companies."""
        keyed, quarantined = partition_rows(entities, resolver, stage="icij_offshore")
        write_quarantine(quarantined, "icij_offshore", self.config)
        rows = self._prepare_relationship_rows(
            keyed,
            default_source="icij",
            record_id_fields=["icij_id"],
            matched_by="company_name_unique",
            match_confidence="medium",
        )
        query = f"""
        UNWIND $rows AS row
        MERGE (oe:OffshoreEntity {{icij_id: row.icij_id}})
        SET oe.name = row.name,
            oe.jurisdiction = row.jurisdiction,
            oe.incorporation_date = row.incorporation_date,
            oe.inactivation_date = row.inactivation_date,
            oe.status = row.status,
            oe.investigation = row.investigation,
            oe.source = row.source,
            oe.last_updated = row.last_updated
        WITH oe, row
        WHERE row.company_name IS NOT NULL
        {self.COMPANY_MATCH_TOKEN}
        MERGE (c)-[r:LINKED_TO_OFFSHORE]->(oe)
        {self._relationship_provenance_set_clause(
            rel_var="r",
            source_expr='coalesce(row.source, "icij")',
            record_id_expr='coalesce(row.source_record_id, row.icij_id)',
            matched_by_expr='coalesce(row.matched_by, "company_name_exact")',
            match_confidence_expr='coalesce(row.match_confidence, "medium")',
        )}
        """
        self._run_identity_partitioned(query, rows, "offshore entities")

    # Stage 27 aggregates: (property, per-company value expression). Every
    # company is recomputed, so a company whose last child/brand/record went
    # away drops back to 0 instead of keeping a stale total (the old
    # MATCH-then-SET form only ever touched companies that still had a match).
    # Disputed edges are excluded to agree with the API's read-time filter.
    _AGGREGATES = [
        ("total_penalties", """
            reduce(t = 0.0, x IN COLLECT {
                MATCH (c)-[r:PENALIZED_FOR]->(v:Violation)
                WHERE NOT coalesce(r.disputed, false) RETURN coalesce(v.penalty_amount, 0)
            } + COLLECT {
                MATCH (c)-[r:HAS_EPA_VIOLATION]->(v:EnvironmentalViolation)
                WHERE NOT coalesce(r.disputed, false) RETURN coalesce(v.penalty_amount, 0)
            } | t + x)"""),
        ("total_lobbying_spend", """
            reduce(t = 0.0, x IN COLLECT {
                MATCH (c)-[r:LOBBIED_FOR]->(l:LobbyingRecord)
                WHERE NOT coalesce(r.disputed, false) RETURN coalesce(l.total_spent, 0)
            } | t + x)"""),
        ("total_subsidies_received", """
            reduce(t = 0.0, x IN COLLECT {
                MATCH (c)-[r:RECEIVED_SUBSIDY]->(s:Subsidy)
                WHERE NOT coalesce(r.disputed, false) RETURN coalesce(s.amount, 0)
            } | t + x)"""),
        ("total_gov_contracts", """
            reduce(t = 0.0, x IN COLLECT {
                MATCH (c)-[r:AWARDED_CONTRACT]->(gc:GovernmentContract)
                WHERE NOT coalesce(r.disputed, false) RETURN coalesce(gc.amount, 0)
            } | t + x)"""),
        ("brand_count", "COUNT { (c)<-[:OWNED_BY]-(:Brand) }"),
        ("subsidiary_count", "COUNT { (c)<-[:SUBSIDIARY_OF]-(:Company) }"),
    ]

    def update_aggregate_scores(self):
        """Stage 27: Compute aggregate scores on Company nodes from enrichment data."""
        # Only write where the value changed, so a nightly run stays a small
        # transaction instead of rewriting ~75K nodes per aggregate.
        queries = [
            f"""
            MATCH (c:Company)
            WITH c, {expr} AS v
            WHERE coalesce(c.{prop}, 0) <> v
            SET c.{prop} = v
            """
            for prop, expr in self._AGGREGATES
        ]
        with self.driver.session(database=self.config.neo4j_database) as session:
            for i, q in enumerate(queries):
                try:
                    result = session.run(q)
                    summary = result.consume()
                    logger.debug(f"Aggregate query {i+1}/{len(queries)} updated {summary.counters.properties_set} properties")
                except Exception as e:
                    logger.warning(f"Aggregate query {i+1} failed: {e}")
        logger.info("Computed aggregate scores on Company nodes")

    def _update_companies_by_identity(self, query_template: str, data: List[Dict],
                                      resolver: CompanyResolver, stage: str, label: str):
        """Shared runner for property-stamping writers that used to MATCH by name.

        Name-MATCH stamped the property on every same-name twin (e.g. sanctioned=true
        landed on both Teslas). Resolve to a single identity; ambiguous names are
        quarantined and stamp nothing.
        """
        keyed, quarantined = partition_rows(data, resolver, stage=stage, set_provenance=False)
        write_quarantine(quarantined, stage, self.config)
        for key_field in ("lei", "wikidata_id"):
            part = [r for r in keyed if r.get("company_key_field") == key_field]
            if not part:
                continue
            q = query_template.replace(
                self.COMPANY_MATCH_TOKEN,
                f"MATCH (c:Company {{{key_field}: row.company_key}})",
            )
            with self.driver.session(database=self.config.neo4j_database) as session:
                bs = self.config.batch_size
                for i in range(0, len(part), bs):
                    session.run(q, rows=part[i:i + bs], now=now_iso())
        logger.info(f"Updated {len(keyed)} companies with {label} ({len(quarantined)} quarantined)")

    def update_company_sanctions(self, data: List[Dict], resolver: CompanyResolver):
        """Update Company nodes with sanctions info from OpenSanctions."""
        query = f"""
        UNWIND $rows AS row
        {self.COMPANY_MATCH_TOKEN}
        SET c.sanctioned = row.sanctioned,
            c.sanction_details = row.sanction_details,
            c.data_sources = REDUCE(acc = coalesce(c.data_sources, []), src IN ["opensanctions"] |
                CASE WHEN src IN acc THEN acc ELSE acc + src END),
            c.last_updated = $now
        """
        self._update_companies_by_identity(query, data, resolver, "opensanctions", "sanctions data")

    def create_subsidiary_rels(self, rels: List[Dict], source: str = "gleif"):
        """Create SUBSIDIARY_OF relationships between companies."""
        normalized = []
        for rel in rels:
            item = dict(rel)
            if source == "gleif":
                item.setdefault("source_record_id", f"{item.get('child_lei','')}|{item.get('parent_lei','')}")
                item.setdefault("matched_by", "lei")
            else:
                item.setdefault(
                    "source_record_id",
                    f"{item.get('child_wikidata_id','')}|{item.get('parent_wikidata_id','')}"
                )
                item.setdefault("matched_by", "wikidata_id")
            item.setdefault("match_confidence", "high")
            normalized.append(item)
        rows = self._prepare_relationship_rows(normalized, default_source=source)
        if source == "gleif":
            query = f"""
            UNWIND $rows AS row
            MATCH (child:Company {{lei: row.child_lei}})
            MATCH (parent:Company {{lei: row.parent_lei}})
            MERGE (child)-[r:SUBSIDIARY_OF]->(parent)
            {self._relationship_provenance_set_clause(
                rel_var="r",
                source_expr="$source",
                record_id_expr='coalesce(row.source_record_id, row.child_lei + "|" + row.parent_lei)',
                matched_by_expr='coalesce(row.matched_by, "lei")',
                match_confidence_expr='coalesce(row.match_confidence, "high")',
            )}
            SET
                r.gleif_relationship_type = row.relationship_type,
                r.last_confirmed = $now
            """
        else:
            # Link companies already in the graph. Wikidata has ~190K
            # business-to-business P749 pairs; ~22K join two known companies,
            # and the rest would add ~160K mostly obscure Company nodes, which
            # is a product decision rather than something a nightly run should
            # do by default. (Earlier side-effect creates carry
            # created_via = 'subsidiary_side_effect'.)
            query = f"""
            UNWIND $rows AS row
            MATCH (child:Company {{wikidata_id: row.child_wikidata_id}})
            MATCH (parent:Company {{wikidata_id: row.parent_wikidata_id}})
            MERGE (child)-[r:SUBSIDIARY_OF]->(parent)
            {self._relationship_provenance_set_clause(
                rel_var="r",
                source_expr="$source",
                record_id_expr='coalesce(row.source_record_id, row.child_wikidata_id + "|" + row.parent_wikidata_id)',
                matched_by_expr='coalesce(row.matched_by, "wikidata_id")',
                match_confidence_expr='coalesce(row.match_confidence, "high")',
            )}
            SET
                r.wikidata_property = "P749",
                r.source_url = row.source_url,
                r.ownership_percentage = row.ownership_percentage,
                r.last_confirmed = $now
            """
        with self.driver.session(database=self.config.neo4j_database) as session:
            bs = self.config.batch_size
            for i in range(0, len(rels), bs):
                chunk = rows[i:i + bs]
                session.run(query, rows=chunk, source=source, now=now_iso())
        logger.info(f"Wrote {len(rels)} SUBSIDIARY_OF rels (source={source})")

    def create_investor_rels(self, rels: List[Dict], source: str = "wikidata"):
        """Create INVESTED_IN_BY relationships between companies."""
        normalized = []
        for rel in rels:
            item = dict(rel)
            item.setdefault(
                "source_record_id",
                f"{item.get('company_wikidata_id', '')}|{item.get('investor_wikidata_id', '')}"
            )
            item.setdefault("matched_by", "wikidata_id")
            item.setdefault("match_confidence", "medium")
            normalized.append(item)
        rows = self._prepare_relationship_rows(normalized, default_source=source)
        query = f"""
        UNWIND $rows AS row
        MATCH (company:Company {{wikidata_id: row.company_wikidata_id}})
        MATCH (investor:Company {{wikidata_id: row.investor_wikidata_id}})
        MERGE (company)-[r:INVESTED_IN_BY]->(investor)
        {self._relationship_provenance_set_clause(
            rel_var="r",
            source_expr="$source",
            record_id_expr='coalesce(row.source_record_id, row.company_wikidata_id + "|" + row.investor_wikidata_id)',
            matched_by_expr='coalesce(row.matched_by, "wikidata_id")',
            match_confidence_expr='coalesce(row.match_confidence, "medium")',
        )}
        SET
            r.ownership_percentage = row.ownership_percentage,
            r.source_url = row.source_url,
            r.wikidata_property = coalesce(row.wikidata_property, "P749"),
            r.last_confirmed = $now
        """
        with self.driver.session(database=self.config.neo4j_database) as session:
            bs = self.config.batch_size
            for i in range(0, len(rels), bs):
                chunk = rows[i:i + bs]
                session.run(query, rows=chunk, source=source, now=now_iso())
        logger.info(f"Wrote {len(rels)} INVESTED_IN_BY rels (source={source})")

    def retract_stale_ownership_rels(self, fresh_keys: set, source: str, rel_type: str = "SUBSIDIARY_OF"):
        """Delete ownership relationships that no longer exist in fresh source data.

        Args:
            fresh_keys: set of 'child_id|parent_id' keys from current source data
            source: the source tag to filter on (e.g. 'wikidata', 'gleif')
            rel_type: SUBSIDIARY_OF or INVESTED_IN_BY
        """
        # Use the same identifier field as the fresh keys
        # GLEIF keys use LEI, Wikidata keys use wikidata_id
        if source == "gleif":
            child_field = "child.lei"
            parent_field = "parent.lei"
        else:
            child_field = "child.wikidata_id"
            parent_field = "parent.wikidata_id"

        # Safety: never retract with empty fresh set (would delete everything)
        if not fresh_keys:
            logger.warning(f"Retraction: skipping {rel_type} (source={source}) — fresh_keys is empty")
            return 0

        query = f"""
        MATCH (child)-[r:{rel_type} {{source: $source}}]->(parent)
        RETURN
            {child_field} AS child_id,
            {parent_field} AS parent_id,
            elementId(r) AS rel_id
        """
        stale_ids = []
        standing = 0
        with self.driver.session(database=self.config.neo4j_database) as session:
            result = session.run(query, source=source)
            for record in result:
                standing += 1
                key = f"{record['child_id']}|{record['parent_id']}"
                if key not in fresh_keys:
                    stale_ids.append(record["rel_id"])

        if not stale_ids:
            logger.info(f"Retraction: no stale {rel_type} rels for source={source}")
            return 0

        # Safety guard against partial-fetch mass deletion.
        #
        # A partial upstream fetch (GLEIF 429 storm, WDQS timeout/parse failure)
        # returns a small fresh_keys set that is indistinguishable from a
        # legitimate mass retraction, so the naive "delete everything not in
        # fresh_keys" logic wiped ~900 valid SUBSIDIARY_OF edges every night and
        # recreated them the next day. A real day of ownership retirements is a
        # trickle, never a large fraction of the standing edges. Refuse any
        # deletion that exceeds the ratio (above a small absolute floor so tiny
        # sources can still retract), and log loudly so the alarm path catches
        # it. The next run with a complete fetch will retract legitimately.
        RETRACT_MAX_RATIO = 0.10
        RETRACT_MIN_ABS = 20
        if (
            standing > 0
            and len(stale_ids) > RETRACT_MIN_ABS
            and len(stale_ids) > RETRACT_MAX_RATIO * standing
        ):
            logger.error(
                f"Retraction ABORTED for {rel_type} (source={source}): would delete "
                f"{len(stale_ids)}/{standing} edges ({len(stale_ids) / standing:.0%}) — exceeds "
                f"{RETRACT_MAX_RATIO:.0%} guard. Almost certainly a partial/failed upstream "
                f"fetch; skipping to protect valid ownership data."
            )
            return 0

        # Delete stale relationships in batches
        delete_query = """
        UNWIND $ids AS rid
        MATCH ()-[r]->() WHERE elementId(r) = rid
        DELETE r
        """
        bs = self.config.batch_size
        with self.driver.session(database=self.config.neo4j_database) as session:
            for i in range(0, len(stale_ids), bs):
                session.run(delete_query, ids=stale_ids[i:i + bs])

        logger.info(f"Retraction: deleted {len(stale_ids)} stale {rel_type} rels (source={source})")
        return len(stale_ids)

    def corroborate_ownership_rels(self, gleif_keys: set):
        """Mark Wikidata SUBSIDIARY_OF rels corroborated by GLEIF."""
        query = """
        MATCH (child:Company)-[r:SUBSIDIARY_OF {source: 'wikidata'}]->(parent:Company)
        WHERE child.lei IS NOT NULL AND parent.lei IS NOT NULL
          AND (child.lei + '|' + parent.lei) IN $keys
        SET r.confidence = 'high',
            r.corroborated_by = CASE
                WHEN r.corroborated_by IS NULL THEN ['gleif']
                WHEN NOT 'gleif' IN r.corroborated_by THEN r.corroborated_by + 'gleif'
                ELSE r.corroborated_by
            END,
            r.last_confirmed = $now
        """
        with self.driver.session(database=self.config.neo4j_database) as session:
            session.run(query, keys=list(gleif_keys), now=now_iso())
        logger.info(f"Corroborated Wikidata rels with {len(gleif_keys)} GLEIF keys")

    def get_brand_owner_pairs(self, source: str = "wikidata") -> set:
        """(brand QID, owner QID) for every brand OWNED_BY edge from `source`."""
        query = """
        MATCH (b:Brand)-[r:OWNED_BY {source: $source}]->(c:Company)
        WHERE b.wikidata_id IS NOT NULL AND c.wikidata_id IS NOT NULL
        RETURN b.wikidata_id AS b, c.wikidata_id AS o
        """
        # A managed read: stage 1 calls this around long WDQS waits, and only
        # transaction functions retry on a connection that went stale meanwhile.
        with self.driver.session(database=self.config.neo4j_database) as session:
            return session.execute_read(
                lambda tx: {(r["b"], r["o"]) for r in tx.run(query, source=source)})

    def retract_brand_owners(self, pairs: set, source: str = "wikidata") -> int:
        """Delete brand OWNED_BY edges from `source` for (brand QID, owner QID) pairs.

        Callers pass only pairs the source positively marks as not owning the
        brand (an ended or minority P127 statement), never "whatever is missing
        from this run", so a partial fetch cannot wipe valid edges.
        """
        rows = [{"b": b, "o": o} for b, o in pairs]
        query = """
        UNWIND $rows AS row
        MATCH (:Brand {wikidata_id: row.b})-[r:OWNED_BY {source: $source}]->(:Company {wikidata_id: row.o})
        DELETE r
        RETURN count(r) AS n
        """
        deleted = 0
        with self.driver.session(database=self.config.neo4j_database) as session:
            bs = self.config.batch_size
            for i in range(0, len(rows), bs):
                batch = rows[i:i + bs]
                deleted += session.execute_write(
                    lambda tx: tx.run(query, rows=batch, source=source).single()["n"])
        logger.info(f"Retraction: deleted {deleted} brand OWNED_BY rels ({source}) that are "
                    f"ended, minority stakes or self-ownership")
        return deleted

    def create_brand_ownership_rels(self, rels: List[Dict]):
        normalized = []
        for rel in rels:
            item = dict(rel)
            item.setdefault("source_record_id", f"{item.get('brand_wikidata_id','')}|{item.get('owner_wikidata_id','')}")
            item.setdefault("matched_by", "wikidata_id")
            item.setdefault("match_confidence", "high")
            normalized.append(item)
        rows = self._prepare_relationship_rows(normalized, default_source="wikidata")
        query = f"""
        UNWIND $rows AS row
        MATCH (b:Brand {{wikidata_id: row.brand_wikidata_id}})
        MATCH (c:Company {{wikidata_id: row.owner_wikidata_id}})
        MERGE (b)-[r:OWNED_BY]->(c)
        {self._relationship_provenance_set_clause(
            rel_var="r",
            source_expr='coalesce(row.source, "wikidata")',
            record_id_expr='coalesce(row.source_record_id, row.brand_wikidata_id + "|" + row.owner_wikidata_id)',
            matched_by_expr='coalesce(row.matched_by, "wikidata_id")',
            match_confidence_expr='coalesce(row.match_confidence, "high")',
        )}
        SET
            r.last_confirmed = $now
        """
        with self.driver.session(database=self.config.neo4j_database) as session:
            bs = self.config.batch_size
            for i in range(0, len(rows), bs):
                session.run(query, rows=rows[i:i + bs], now=now_iso())
        logger.info(f"Wrote {len(rels)} OWNED_BY rels")

    def create_person_rels(self, rels: List[Dict]):
        """Create CEO_OF, FOUNDED, BOARD_MEMBER_OF relationships."""
        role_to_type = {
            "ceo": "CEO_OF",
            "founder": "FOUNDED",
            "board_member": "BOARD_MEMBER_OF",
        }
        for role, rel_type in role_to_type.items():
            role_rels = []
            for rel in rels:
                if rel.get("role") != role:
                    continue
                item = dict(rel)
                item.setdefault(
                    "source_record_id",
                    f"{item.get('person_wikidata_id','')}|{item.get('company_wikidata_id','')}|{role}"
                )
                item.setdefault("matched_by", "wikidata_id")
                item.setdefault("match_confidence", "high")
                role_rels.append(item)
            if not role_rels:
                continue
            role_rels = self._prepare_relationship_rows(role_rels, default_source="wikidata")
            query = f"""
            UNWIND $rows AS row
            MATCH (p:Person {{wikidata_id: row.person_wikidata_id}})
            MATCH (c:Company {{wikidata_id: row.company_wikidata_id}})
            MERGE (p)-[r:{rel_type}]->(c)
            {self._relationship_provenance_set_clause(
                rel_var="r",
                source_expr='coalesce(row.source, "wikidata")',
                record_id_expr='coalesce(row.source_record_id, row.person_wikidata_id + "|" + row.company_wikidata_id + "|" + row.role)',
                matched_by_expr='coalesce(row.matched_by, "wikidata_id")',
                match_confidence_expr='coalesce(row.match_confidence, "high")',
            )}
            SET r.last_confirmed = $now
            """
            with self.driver.session(database=self.config.neo4j_database) as session:
                bs = self.config.batch_size
                for i in range(0, len(role_rels), bs):
                    session.run(query, rows=role_rels[i:i + bs], now=now_iso())
            logger.info(f"Wrote {len(role_rels)} {rel_type} rels")

    def create_donation_rels(self, donations: List[Dict], resolver: CompanyResolver, source: str = "fec"):
        """Create DONATED_TO relationships between companies and politicians."""
        rel_type = "DONATED_TO" if source in ("fec", "fec_pac") else "DONATED_TO_STATE"
        # PAC giving gets its own edge. Merging on the pair alone would land on
        # the disputed employee-donation edge for the same company and candidate
        # (stage 7's old source) and inherit its dispute, hiding it.
        rel_identity = " {source: $source}" if source == "fec_pac" else ""
        keyed, quarantined = partition_rows(donations, resolver, stage=f"donations_{source}")
        write_quarantine(quarantined, f"donations_{source}", self.config)
        normalized = []
        for donation in keyed:
            item = dict(donation)
            item.setdefault(
                "source_record_id",
                "|".join(
                    str(item.get(k, "") or "")
                    for k in ("company_name", "fec_id", "year", "amount")
                ),
            )
            item.setdefault("matched_by", "company_name+fec_id")
            item.setdefault("match_confidence", "medium")
            normalized.append(item)
        rows = self._prepare_relationship_rows(normalized, default_source=source)
        query = f"""
        UNWIND $rows AS row
        {self.COMPANY_MATCH_TOKEN}
        MERGE (p:Politician {{fec_id: row.fec_id}})
        SET p.name = CASE WHEN coalesce(p.name, '') = '' THEN row.politician_name ELSE p.name END,
            p.party = CASE WHEN coalesce(p.party, '') = '' THEN row.party ELSE p.party END,
            p.state = CASE WHEN coalesce(p.state, '') = '' THEN row.state ELSE p.state END,
            p.office = CASE WHEN coalesce(p.office, '') = '' THEN row.office ELSE p.office END
        MERGE (c)-[r:{rel_type}{rel_identity}]->(p)
        {self._relationship_provenance_set_clause(
            rel_var="r",
            source_expr="$source",
            record_id_expr='coalesce(row.source_record_id, row.company_name + "|" + row.fec_id + "|" + toString(row.year) + "|" + toString(row.amount))',
            matched_by_expr='coalesce(row.matched_by, "company_name+fec_id")',
            match_confidence_expr='coalesce(row.match_confidence, "medium")',
        )}
        SET r.amount = row.amount,
            r.year = row.year,
            r.confidence = "high",
            r.last_confirmed = $now
        """
        # Partition by identity key field (MATCH on lei / wikidata_id — never
        # MERGE Company by name); this writer keeps its own session loop because
        # it passes $source / $now that _run_identity_partitioned doesn't.
        written = 0
        for key_field in ("lei", "wikidata_id"):
            part = [r for r in rows if r.get("company_key_field") == key_field]
            if not part:
                continue
            q = query.replace(
                self.COMPANY_MATCH_TOKEN,
                f"MATCH (c:Company {{{key_field}: row.company_key}})",
            )
            with self.driver.session(database=self.config.neo4j_database) as session:
                bs = self.config.batch_size
                for i in range(0, len(part), bs):
                    session.run(q, rows=part[i:i + bs], source=source, now=now_iso())
                    written += len(part[i:i + bs])
        logger.info(f"Wrote {written} {rel_type} rels (source={source})")

    SUPPLIER_MATCH_TOKEN = "__SUPPLIER_MATCH__"
    CUSTOMER_MATCH_TOKEN = "__CUSTOMER_MATCH__"

    def create_supply_rels(self, rels: List[Dict], resolver: CompanyResolver):
        # Both endpoints are regex-mined names: resolve each to a single identity
        # BEFORE Cypher (name-MATCH bound every same-name twin, cross-multiplying
        # SUPPLIES over supplier x customer twins). Rows with either endpoint
        # ambiguous/unknown are quarantined.
        keyed, q_sup = partition_rows(rels, resolver, name_field="supplier_name",
                                      stage="supplies", out_prefix="supplier_",
                                      set_provenance=False)
        keyed, q_cus = partition_rows(keyed, resolver, name_field="customer_name",
                                      stage="supplies", out_prefix="customer_",
                                      set_provenance=False)
        write_quarantine(q_sup + q_cus, "supplies", self.config)
        normalized = []
        for rel in keyed:
            item = dict(rel)
            item.setdefault(
                "source_record_id",
                "|".join(
                    str(item.get(k, "") or "")
                    for k in ("supplier_name", "customer_name", "filing_type")
                ),
            )
            item.setdefault("matched_by", "company_name_unique")
            item.setdefault("match_confidence", str(item.get("confidence") or "medium"))
            normalized.append(item)
        rows = self._prepare_relationship_rows(normalized, default_source="sec_edgar")
        query = f"""
        UNWIND $rows AS row
        {self.SUPPLIER_MATCH_TOKEN}
        {self.CUSTOMER_MATCH_TOKEN}
        MERGE (supplier)-[r:SUPPLIES]->(customer)
        {self._relationship_provenance_set_clause(
            rel_var="r",
            source_expr='coalesce(row.source, "sec_edgar")',
            record_id_expr='coalesce(row.source_record_id, row.supplier_name + "|" + row.customer_name + "|" + coalesce(row.filing_type, ""))',
            matched_by_expr='coalesce(row.matched_by, "company_name_unique")',
            match_confidence_expr='coalesce(row.match_confidence, row.confidence, "medium")',
        )}
        SET r.confidence = row.confidence,
            r.sec_filing = row.filing_type,
            r.last_confirmed = $now
        """
        written = 0
        for skf in ("lei", "wikidata_id"):
            for ckf in ("lei", "wikidata_id"):
                part = [r for r in rows
                        if r.get("supplier_key_field") == skf and r.get("customer_key_field") == ckf]
                if not part:
                    continue
                q = query.replace(
                    self.SUPPLIER_MATCH_TOKEN,
                    f"MATCH (supplier:Company {{{skf}: row.supplier_key}})",
                ).replace(
                    self.CUSTOMER_MATCH_TOKEN,
                    f"MATCH (customer:Company {{{ckf}: row.customer_key}})",
                )
                with self.driver.session(database=self.config.neo4j_database) as session:
                    bs = self.config.batch_size
                    for i in range(0, len(part), bs):
                        session.run(q, rows=part[i:i + bs], now=now_iso())
                        written += len(part[i:i + bs])
        logger.info(f"Wrote {written} SUPPLIES rels ({len(q_sup) + len(q_cus)} rows quarantined)")

    def create_product_brand_rels(self, rels: List[Dict]):
        # Separate rels that have brand_name vs only brand_wikidata_id
        by_name = []
        by_wikidata_id = []
        for rel in rels:
            item = dict(rel)
            item.setdefault(
                "source_record_id",
                "|".join(
                    str(item.get(k, "") or "")
                    for k in ("barcode", "asin", "brand_name", "brand_wikidata_id", "source")
                ),
            )
            if item.get("brand_name"):
                item.setdefault("matched_by", "barcode_or_asin+brand_name")
                item.setdefault("match_confidence", "medium")
                by_name.append(item)
            elif item.get("brand_wikidata_id"):
                item.setdefault("matched_by", "barcode_or_asin+brand_wikidata_id")
                item.setdefault("match_confidence", "high")
                by_wikidata_id.append(item)

        # Match brands by name
        if by_name:
            rows = self._prepare_relationship_rows(by_name)
            query = f"""
            UNWIND $rows AS row
            // One product per row. A LIMIT on the outer stream capped the whole
            // UNWIND batch instead, so each 5,000-row batch wrote a single edge.
            CALL (row) {{
                MATCH (p:Product)
                WHERE (row.barcode IS NOT NULL AND p.barcode = row.barcode)
                   OR (row.asin IS NOT NULL AND p.asin = row.asin)
                RETURN p LIMIT 1
            }}
            MATCH (b:Brand {{name: row.brand_name}})
            MERGE (b)-[r:SELLS]->(p)
            {self._relationship_provenance_set_clause(
                rel_var="r",
                source_expr="row.source",
                record_id_expr='coalesce(row.source_record_id, coalesce(row.barcode, row.asin) + "|" + row.brand_name + "|" + coalesce(row.source, ""))',
                matched_by_expr='coalesce(row.matched_by, "barcode_or_asin+brand_name")',
                match_confidence_expr='coalesce(row.match_confidence, "medium")',
            )}
            SET r.last_confirmed = $now
            """
            with self.driver.session(database=self.config.neo4j_database) as session:
                bs = self.config.batch_size
                for i in range(0, len(rows), bs):
                    session.run(query, rows=rows[i:i + bs], now=now_iso())
            logger.info(f"Wrote {len(by_name)} SELLS rels by brand name")

        # Match brands by wikidata_id (for products whose brand had no English name)
        if by_wikidata_id:
            rows = self._prepare_relationship_rows(by_wikidata_id)
            query_wid = f"""
            UNWIND $rows AS row
            // One product per row. A LIMIT on the outer stream capped the whole
            // UNWIND batch instead, so each 5,000-row batch wrote a single edge.
            CALL (row) {{
                MATCH (p:Product)
                WHERE (row.barcode IS NOT NULL AND p.barcode = row.barcode)
                   OR (row.asin IS NOT NULL AND p.asin = row.asin)
                RETURN p LIMIT 1
            }}
            MATCH (b:Brand {{wikidata_id: row.brand_wikidata_id}})
            MERGE (b)-[r:SELLS]->(p)
            {self._relationship_provenance_set_clause(
                rel_var="r",
                source_expr="row.source",
                record_id_expr='coalesce(row.source_record_id, coalesce(row.barcode, row.asin) + "|" + row.brand_wikidata_id + "|" + coalesce(row.source, ""))',
                matched_by_expr='coalesce(row.matched_by, "barcode_or_asin+brand_wikidata_id")',
                match_confidence_expr='coalesce(row.match_confidence, "high")',
            )}
            SET r.last_confirmed = $now
            """
            with self.driver.session(database=self.config.neo4j_database) as session:
                bs = self.config.batch_size
                for i in range(0, len(rows), bs):
                    session.run(query_wid, rows=rows[i:i + bs], now=now_iso())
            logger.info(f"Wrote {len(by_wikidata_id)} SELLS rels by brand wikidata_id")

        logger.info(f"Wrote {len(rels)} SELLS rels total ({len(by_name)} by name, {len(by_wikidata_id)} by wikidata_id)")

    def update_logos(self, logos: List[Dict]):
        """Set logo_url by element id, only where the node still has no logo."""
        query = """
        UNWIND $rows AS row
        MATCH (n) WHERE elementId(n) = row.eid
          AND (n.logo_url IS NULL OR trim(n.logo_url) = "")
        SET n.logo_url = row.logo_url, n.logo_source = "logo.dev"
        """
        self._run_chunked(query, logos, "logo updates")

    def update_company_extended(self, data: List[Dict]):
        """Update companies with extended Wikidata properties (Stage 14)."""
        query = """
        UNWIND $rows AS row
        MATCH (c:Company {lei: row.lei})
        SET c.country = coalesce(row.country, c.country),
            c.industry = coalesce(row.industry, c.industry),
            c.hq_city = coalesce(row.hq_city, c.hq_city),
            c.hq_country = coalesce(row.hq_country, c.hq_country),
            c.website = coalesce(row.website, c.website),
            c.founded = coalesce(row.founded, c.founded),
            c.employees = coalesce(row.employees, c.employees),
            c.revenue = coalesce(row.revenue, c.revenue),
            c.stock_exchange = coalesce(row.stock_exchange, c.stock_exchange),
            c.ticker = coalesce(row.ticker, c.ticker),
            c.isin = coalesce(row.isin, c.isin),
            c.last_updated = $now
        """
        with self.driver.session(database=self.config.neo4j_database) as session:
            bs = self.config.batch_size
            for i in range(0, len(data), bs):
                session.run(query, rows=data[i:i + bs], now=now_iso())
        logger.info(f"Updated {len(data)} companies with extended properties")

    def update_exec_compensation(self, data: List[Dict]):
        """Update Person nodes with executive compensation from SEC proxy."""
        normalized = []
        for row in data:
            item = dict(row)
            item.setdefault(
                "source_record_id",
                "|".join(
                    str(item.get(k, "") or "")
                    for k in ("person_name", "cik", "fiscal_year")
                ),
            )
            item.setdefault("matched_by", "cik+person_name")
            item.setdefault("match_confidence", "medium")
            normalized.append(item)
        rows = self._prepare_relationship_rows(normalized, default_source="sec_edgar")
        query = f"""
        UNWIND $rows AS row
        MERGE (p:Person {{name: row.person_name}})
        ON CREATE SET p.data_sources = ["sec_edgar"]
        SET p.total_compensation = coalesce(row.total_compensation, p.total_compensation),
            p.base_salary = coalesce(row.base_salary, p.base_salary),
            p.stock_awards = coalesce(row.stock_awards, p.stock_awards),
            p.comp_fiscal_year = coalesce(row.fiscal_year, p.comp_fiscal_year),
            p.last_updated = $now
        WITH p, row
        // MATCH, not MERGE: cik has no uniqueness constraint, and MERGE minted a
        // bare-cik Company node whenever the cik wasn't already in the graph.
        // Rows whose cik doesn't resolve are dropped (cik backfill is separate).
        MATCH (c:Company {{cik: row.cik}})
        MERGE (p)-[r:COMPENSATED_BY]->(c)
        {self._relationship_provenance_set_clause(
            rel_var="r",
            source_expr='coalesce(row.source, "sec_edgar")',
            record_id_expr='coalesce(row.source_record_id, row.person_name + "|" + row.cik + "|" + toString(row.fiscal_year))',
            matched_by_expr='coalesce(row.matched_by, "cik+person_name")',
            match_confidence_expr='coalesce(row.match_confidence, "medium")',
        )}
        SET r.total_compensation = row.total_compensation,
            r.fiscal_year = row.fiscal_year,
            r.last_confirmed = $now
        """
        with self.driver.session(database=self.config.neo4j_database) as session:
            bs = self.config.batch_size
            for i in range(0, len(rows), bs):
                session.run(query, rows=rows[i:i + bs], now=now_iso())
        logger.info(f"Updated {len(data)} exec compensation records")

    # ── Provenance Append ─────────────────────────────────────

    def append_data_source(self, label: str, match_field: str, match_value: str, source: str):
        """Add a source to a node's data_sources list if not already present."""
        query = f"""
        MATCH (n:{label} {{{match_field}: $val}})
        WHERE NOT $source IN coalesce(n.data_sources, [])
        SET n.data_sources = coalesce(n.data_sources, []) + $source
        """
        with self.driver.session(database=self.config.neo4j_database) as session:
            session.run(query, val=match_value, source=source)

    # ── Utility ───────────────────────────────────────────────

    def get_all_company_names(self) -> List[str]:
        """Return all company names in the database."""
        query = """
        MATCH (c:Company)
        WHERE c.name IS NOT NULL AND trim(c.name) <> ""
        RETURN DISTINCT c.name AS name
        ORDER BY toLower(c.name), c.name
        """
        with self.driver.session(database=self.config.neo4j_database) as session:
            result = session.run(query)
            return [r["name"] for r in result]

    def get_company_identity_rows(self) -> List[Dict]:
        """name / lei / wikidata_id for every named company — feeds CompanyResolver.

        ~75K rows of short strings (a few MB); a single streamed read is safe on
        the 1GB Aura instance.
        """
        query = """
        MATCH (c:Company)
        WHERE c.name IS NOT NULL AND trim(c.name) <> ""
        RETURN c.name AS name, c.lei AS lei, c.wikidata_id AS wikidata_id
        """
        with self.driver.session(database=self.config.neo4j_database) as session:
            return [dict(r) for r in session.run(query)]

    def get_all_company_leis(self) -> List[str]:
        query = """
        MATCH (c:Company)
        WHERE c.lei IS NOT NULL AND trim(c.lei) <> ""
        RETURN DISTINCT c.lei AS lei
        ORDER BY c.lei
        """
        with self.driver.session(database=self.config.neo4j_database) as session:
            result = session.run(query)
            return [r["lei"] for r in result]

    def get_companies_with_cik(self) -> List[Dict]:
        query = """
        MATCH (c:Company)
        WHERE c.name IS NOT NULL AND trim(c.name) <> "" AND c.cik IS NOT NULL AND trim(c.cik) <> ""
        RETURN DISTINCT c.name AS name, c.cik AS cik
        ORDER BY toLower(c.name), c.name, c.cik
        """
        with self.driver.session(database=self.config.neo4j_database) as session:
            result = session.run(query)
            return [dict(r) for r in result]

    def get_companies_with_websites(self) -> List[Dict]:
        query = """
        MATCH (c:Company)
        WHERE c.name IS NOT NULL AND trim(c.name) <> "" AND c.website IS NOT NULL AND trim(c.website) <> ""
        RETURN DISTINCT c.name AS name, c.website AS website
        ORDER BY toLower(c.name), c.name
        """
        with self.driver.session(database=self.config.neo4j_database) as session:
            result = session.run(query)
            return [dict(r) for r in result]

    def get_entities_without_logos(self, label: str) -> List[Dict]:
        """Companies or brands with a website and no logo_url — for gap-fill."""
        assert label in ("Company", "Brand")
        query = f"""
        MATCH (n:{label})
        WHERE n.name IS NOT NULL AND trim(n.name) <> ""
          AND n.website IS NOT NULL AND trim(n.website) <> ""
          AND (n.logo_url IS NULL OR trim(n.logo_url) = "")
        RETURN elementId(n) AS eid, n.name AS name, n.website AS website
        """
        with self.driver.session(database=self.config.neo4j_database) as session:
            return [dict(r) for r in session.run(query)]

    def get_company_wikidata_ids(self) -> Set[str]:
        """Every Wikidata QID already on a Company node."""
        query = "MATCH (c:Company) WHERE c.wikidata_id IS NOT NULL RETURN c.wikidata_id AS q"
        with self.driver.session(database=self.config.neo4j_database) as session:
            return {r["q"] for r in session.run(query)}

    def get_company_countries(self, keys: List[tuple]) -> Dict[tuple, Optional[str]]:
        """{(key_field, key): country} for companies identified by lei or wikidata_id."""
        out: Dict[tuple, Optional[str]] = {}
        with self.driver.session(database=self.config.neo4j_database) as session:
            for field in ("lei", "wikidata_id"):
                ids = [k for f, k in keys if f == field]
                if not ids:
                    continue
                for r in session.execute_read(lambda tx: list(tx.run(
                        f"MATCH (c:Company) WHERE c.{field} IN $ids RETURN c.{field} AS k, c.country AS country",
                        ids=ids))):
                    out[(field, r["k"])] = r["country"]
        return out

    def find_lei_qid_disagreements(self, rows: List[Dict]) -> List[Dict]:
        """Company nodes whose wikidata_id differs from the item Wikidata gives their LEI.

        merge_companies only fills a missing wikidata_id, so a wrong one is never
        revisited: the Huawei LEI node carried Lenovo's QID for months, and
        Lenovo's brands (attached by QID) showed Huawei as their owner. Fixing
        one means moving edges written for the wrong QID and merging ghosts, so
        this only reports; tools/identity/repair_lei_qid.py does the repair.
        """
        # Wikidata puts some LEIs on several items (Delta Air Lines' is on two),
        # and any of them is a valid QID for the node, so compare against all.
        query = """
        UNWIND $rows AS row
        MATCH (c:Company {lei: row.lei})
        WHERE c.wikidata_id IS NOT NULL AND NOT c.wikidata_id IN row.qids
        RETURN c.lei AS lei, c.name AS name, c.wikidata_id AS graph_qid, row.qids AS wikidata_qids
        """
        by_lei: Dict[str, set] = {}
        for r in rows:
            if r.get("lei") and r.get("wikidata_id"):
                by_lei.setdefault(r["lei"], set()).add(r["wikidata_id"])
        rows = [{"lei": lei, "qids": sorted(qids)} for lei, qids in by_lei.items()]
        found: List[Dict] = []
        with self.driver.session(database=self.config.neo4j_database) as session:
            bs = self.config.batch_size
            for i in range(0, len(rows), bs):
                found += session.execute_read(
                    lambda tx: [dict(r) for r in tx.run(query, rows=rows[i:i + bs])])
        return found

    def create_companies_from_wikidata(self, rows: List[Dict], created_via: str):
        """Create Company nodes for Wikidata items (by QID) that aren't in the graph."""
        query = """
        UNWIND $rows AS row
        MERGE (c:Company {wikidata_id: row.wikidata_id})
          ON CREATE SET c.name = row.name,
                        c.data_sources = ['wikidata'],
                        c.created_via = $created_via,
                        c.first_seen = $now,
                        c.last_updated = $now
        """
        with self.driver.session(database=self.config.neo4j_database) as session:
            bs = self.config.batch_size
            for i in range(0, len(rows), bs):
                session.run(query, rows=rows[i:i + bs], created_via=created_via, now=now_iso())
        logger.info(f"Ensured {len(rows)} Company nodes from Wikidata (created_via={created_via})")

    def set_company_business_flags(self, rows: List[Dict]):
        """Set non_business on companies by QID, writing only where it changed."""
        query = """
        UNWIND $rows AS row
        MATCH (c:Company {wikidata_id: row.wikidata_id})
        WITH c, row WHERE coalesce(c.non_business, false) <> row.non_business
        SET c.non_business = row.non_business
        """
        self._run_chunked(query, rows, "business flags")

    def get_companies_for_screening(self) -> List[Dict]:
        """Name, country and identity key of every company, for list screening."""
        query = """
        MATCH (c:Company) WHERE c.name IS NOT NULL AND (c.lei IS NOT NULL OR c.wikidata_id IS NOT NULL)
        RETURN CASE WHEN c.lei IS NOT NULL THEN 'lei' ELSE 'wikidata_id' END AS key_field,
               coalesce(c.lei, c.wikidata_id) AS key,
               c.name AS name, c.country AS country, c.hq_country AS hq_country
        """
        with self.driver.session(database=self.config.neo4j_database) as session:
            return [dict(r) for r in session.run(query)]

    def set_ofac_sanctions(self, rows: List[Dict]):
        """Replace all OFAC sanction flags with this run's matches.

        Companies flagged by an earlier run but absent now (delisted, or no
        longer matched) lose the flag, so the badge follows the current lists.
        """
        keep = {(r["key_field"], r["key"]) for r in rows}
        with self.driver.session(database=self.config.neo4j_database) as session:
            stale = [
                r["eid"] for r in session.run(
                    "MATCH (c:Company {sanction_source: 'OFAC'}) "
                    "RETURN elementId(c) AS eid, c.lei AS lei, c.wikidata_id AS qid")
                if ("lei", r["lei"]) not in keep and ("wikidata_id", r["qid"]) not in keep
            ]
            session.run("""
                UNWIND $eids AS eid MATCH (c) WHERE elementId(c) = eid
                REMOVE c.sanctioned, c.sanction_source, c.sanction_lists,
                       c.sanction_programs, c.sanction_entry
                """, eids=stale)
            for key_field in ("lei", "wikidata_id"):
                part = [r for r in rows if r["key_field"] == key_field]
                session.run(f"""
                    UNWIND $rows AS row
                    MATCH (c:Company {{{key_field}: row.key}})
                    SET c.sanctioned = true,
                        c.sanction_source = 'OFAC',
                        c.sanction_lists = row.sanction_lists,
                        c.sanction_programs = row.sanction_programs,
                        c.sanction_entry = row.sanction_entry,
                        c.last_updated = $now
                    """, rows=part, now=now_iso())
        logger.info(f"OFAC: {len(rows)} companies flagged, {len(stale)} stale flags removed")

    def get_companies_with_ciks_and_tickers(self) -> List[Dict]:
        """Return companies that have CIKs or tickers — for SEC 13F lookups."""
        query = """
        MATCH (c:Company)
        WHERE c.name IS NOT NULL AND trim(c.name) <> ""
          AND (c.cik IS NOT NULL OR c.ticker IS NOT NULL)
        RETURN DISTINCT c.name AS name,
               c.cik AS cik,
               c.ticker AS ticker,
               c.wikidata_id AS wikidata_id
        ORDER BY toLower(c.name)
        """
        with self.driver.session(database=self.config.neo4j_database) as session:
            result = session.run(query)
            return [dict(r) for r in result]

    def backfill_relationship_provenance(self) -> Dict[str, int]:
        """Backfill/flag legacy relationships that predate standardized provenance fields."""
        query = """
        MATCH ()-[r]->()
        WITH r,
             CASE WHEN r.source IS NULL OR trim(toString(r.source)) = "" THEN 1 ELSE 0 END AS missing_source
        SET r.source = CASE WHEN missing_source = 1 THEN "legacy_unknown" ELSE r.source END,
            r.provenance_needs_review = CASE
                WHEN missing_source = 1 THEN true
                ELSE coalesce(r.provenance_needs_review, false)
            END,
            r.provenance_backfilled = true,
            r.provenance_version = coalesce(r.provenance_version, 1),
            r.evidence_sources = CASE
                WHEN r.source IS NULL OR trim(toString(r.source)) = "" THEN coalesce(r.evidence_sources, [])
                WHEN r.source IN coalesce(r.evidence_sources, []) THEN coalesce(r.evidence_sources, [])
                ELSE coalesce(r.evidence_sources, []) + r.source
            END,
            r.evidence_record_ids = coalesce(r.evidence_record_ids, []),
            r.evidence_urls = coalesce(r.evidence_urls, []),
            r.evidence_keys = CASE
                WHEN size(coalesce(r.evidence_keys, [])) > 0 THEN coalesce(r.evidence_keys, [])
                WHEN r.source IS NULL OR trim(toString(r.source)) = "" THEN coalesce(r.evidence_keys, [])
                ELSE coalesce(r.evidence_keys, []) + ("legacy|" + r.source + "|" + type(r))
            END,
            r.evidence_count = CASE
                WHEN coalesce(r.evidence_count, 0) > 0 THEN r.evidence_count
                WHEN size(coalesce(r.evidence_keys, [])) > 0 THEN size(coalesce(r.evidence_keys, []))
                WHEN r.source IS NULL OR trim(toString(r.source)) = "" THEN 0
                ELSE 1
            END,
            r.match_confidence = coalesce(r.match_confidence, r.confidence, "unknown"),
            r.confidence = coalesce(r.confidence, r.match_confidence, "unknown"),
            r.first_seen = coalesce(r.first_seen, r.last_confirmed, $now),
            r.last_confirmed = coalesce(r.last_confirmed, $now)
        RETURN count(r) AS total_rels,
               sum(missing_source) AS flagged_missing_source
        """
        with self.driver.session(database=self.config.neo4j_database) as session:
            record = session.run(query, now=now_iso()).single()
        result = {
            "total_rels": int(record["total_rels"]) if record and record["total_rels"] is not None else 0,
            "flagged_missing_source": int(record["flagged_missing_source"])
            if record and record["flagged_missing_source"] is not None else 0,
        }
        logger.info(
            "Relationship provenance backfill complete: %s rels scanned, %s flagged for source review",
            result["total_rels"],
            result["flagged_missing_source"],
        )
        return result

    def audit_relationship_provenance(self, sample_limit: int = 20) -> Dict[str, Any]:
        """Audit graph edges for required provenance fields and return a summary + sample failures."""
        missing_evidence_predicate = """
            coalesce(r.evidence_count, 0) = 0
            AND size(coalesce(r.evidence_keys, [])) = 0
            AND size(coalesce(r.evidence_record_ids, [])) = 0
            AND size(coalesce(r.evidence_urls, [])) = 0
            AND size(coalesce(r.evidence_sources, [])) = 0
            AND (r.evidence_json IS NULL OR trim(toString(r.evidence_json)) = "")
        """
        # Disputed edges are hidden from the app and kept only so a repair can
        # be reversed; they assert nothing, so they are counted, not audited.
        summary_query = f"""
        MATCH ()-[r]->()
        WHERE NOT coalesce(r.disputed, false)
        WITH type(r) AS rel_type,
             count(r) AS total,
             sum(CASE WHEN r.source IS NULL OR trim(toString(r.source)) = "" THEN 1 ELSE 0 END) AS missing_source,
             sum(CASE WHEN r.last_confirmed IS NULL THEN 1 ELSE 0 END) AS missing_last_confirmed,
             sum(CASE WHEN {missing_evidence_predicate} THEN 1 ELSE 0 END) AS missing_evidence
        RETURN rel_type, total, missing_source, missing_last_confirmed, missing_evidence
        ORDER BY missing_source DESC, missing_evidence DESC, missing_last_confirmed DESC, rel_type
        """
        sample_query = f"""
        MATCH (a)-[r]->(b)
        WHERE NOT coalesce(r.disputed, false)
          AND (r.source IS NULL
           OR trim(toString(r.source)) = ""
           OR r.last_confirmed IS NULL
           OR ({missing_evidence_predicate}))
        RETURN type(r) AS rel_type,
               labels(a) AS from_labels,
               labels(b) AS to_labels,
               properties(r) AS rel_properties
        ORDER BY rel_type
        LIMIT $limit
        """
        with self.driver.session(database=self.config.neo4j_database) as session:
            summary_rows = [dict(r) for r in session.run(summary_query)]
            sample_rows = [dict(r) for r in session.run(sample_query, limit=sample_limit)]
            disputed = session.run(
                "MATCH ()-[r]->() WHERE r.disputed = true RETURN count(r) AS n").single()["n"]

        totals = {
            "relationships": sum(int(r.get("total", 0) or 0) for r in summary_rows),
            "missing_source": sum(int(r.get("missing_source", 0) or 0) for r in summary_rows),
            "missing_last_confirmed": sum(int(r.get("missing_last_confirmed", 0) or 0) for r in summary_rows),
            "missing_evidence": sum(int(r.get("missing_evidence", 0) or 0) for r in summary_rows),
            "disputed_excluded": int(disputed or 0),
        }
        result: Dict[str, Any] = {
            "ok": totals["missing_source"] == 0 and totals["missing_last_confirmed"] == 0 and totals["missing_evidence"] == 0,
            "totals": totals,
            "by_relationship_type": summary_rows,
            "samples": sample_rows,
        }
        if result["ok"]:
            logger.info("Relationship provenance audit passed for %s relationships", totals["relationships"])
        else:
            logger.warning(
                "Relationship provenance audit found gaps: missing_source=%s, missing_last_confirmed=%s, missing_evidence=%s",
                totals["missing_source"],
                totals["missing_last_confirmed"],
                totals["missing_evidence"],
            )
        return result

    def get_stats(self) -> Dict[str, int]:
        query = """
        CALL {
            MATCH (c:Company) RETURN 'Company' AS label, count(c) AS cnt
            UNION ALL MATCH (b:Brand) RETURN 'Brand' AS label, count(b) AS cnt
            UNION ALL MATCH (p:Product) RETURN 'Product' AS label, count(p) AS cnt
            UNION ALL MATCH (p:Person) RETURN 'Person' AS label, count(p) AS cnt
            UNION ALL MATCH (p:Politician) RETURN 'Politician' AS label, count(p) AS cnt
            UNION ALL MATCH (v:Violation) RETURN 'Violation' AS label, count(v) AS cnt
            UNION ALL MATCH (v:EnvironmentalViolation) RETURN 'EnvironmentalViolation' AS label, count(v) AS cnt
            UNION ALL MATCH (l:LobbyingRecord) RETURN 'LobbyingRecord' AS label, count(l) AS cnt
            UNION ALL MATCH (e:ESGScore) RETURN 'ESGScore' AS label, count(e) AS cnt
            UNION ALL MATCH (f:Facility) RETURN 'Facility' AS label, count(f) AS cnt
            UNION ALL MATCH (s:Subsidy) RETURN 'Subsidy' AS label, count(s) AS cnt
            UNION ALL MATCH (r:Recall) RETURN 'Recall' AS label, count(r) AS cnt
            UNION ALL MATCH (cc:ConsumerComplaint) RETURN 'ConsumerComplaint' AS label, count(cc) AS cnt
            UNION ALL MATCH (gc:GovernmentContract) RETURN 'GovernmentContract' AS label, count(gc) AS cnt
            UNION ALL MATCH (oe:OffshoreEntity) RETURN 'OffshoreEntity' AS label, count(oe) AS cnt
            UNION ALL MATCH ()-[r]->() RETURN type(r) AS label, count(r) AS cnt
        }
        RETURN label, cnt
        """
        with self.driver.session(database=self.config.neo4j_database) as session:
            result = session.run(query)
            return {r["label"]: r["cnt"] for r in result}

    def clear_database(self):
        with self.driver.session(database=self.config.neo4j_database) as session:
            session.run("MATCH (n) DETACH DELETE n")
        logger.warning("Database cleared")
