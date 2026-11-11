# ETL Data Sources Analysis

## Overview

This document captures findings about data sources for the Boyk corporate graph database, focusing on what fields are available, their quality, and how sources link together.

---

## 1. GLEIF (Global Legal Entity Identifier Foundation)

**Source:** https://www.gleif.org/en/lei-data/gleif-golden-copy
**Format:** XML (Golden Copy files)
**Update Frequency:** Daily
**Total Entities:** ~2.4M LEIs issued, ~1.6M active

### What It Is

GLEIF maintains the global LEI system - a 20-character unique identifier required for companies engaging in financial transactions. Think of it as a "social security number" for legal entities.

### Company Fields

| Field           | Description                   | Quality       |
| --------------- | ----------------------------- | ------------- |
| `lei`           | 20-char unique identifier     | Authoritative |
| `legal_name`    | Official registered name      | Authoritative |
| `jurisdiction`  | Country of legal registration | Authoritative |
| `headquarters`  | City, Country of HQ           | Good          |
| `entity_status` | ACTIVE / INACTIVE             | Authoritative |

### Relationship Fields (Level 2 Data)

| Field                 | Description                                                | Quality                  |
| --------------------- | ---------------------------------------------------------- | ------------------------ |
| `child_lei`           | LEI of subsidiary                                          | Authoritative            |
| `parent_lei`          | LEI of parent company                                      | Authoritative            |
| `relationship_type`   | IS_DIRECTLY_CONSOLIDATED_BY, IS_ULTIMATELY_CONSOLIDATED_BY | Authoritative            |
| `percentage`          | Ownership percentage (when disclosed)                      | Optional, ~30% populated |
| `relationship_status` | ACTIVE / INACTIVE                                          | Authoritative            |

### What GLEIF Provides

- **1.59M active companies** (our current load)
- **140K ownership relationships** (Company → Company)
- High accuracy (legally mandated reporting)
- Clean, structured data

### What GLEIF Lacks

- No brands or products
- No people (founders, executives)
- No descriptive metadata (industry, website, logo, description)
- Only companies in the financial system (excludes many private companies)

---

## 2. Wikidata

**Source:** https://query.wikidata.org/
**Format:** SPARQL endpoint (RDF)
**Update Frequency:** Real-time (community edits)
**Coverage:** ~31K companies with ownership data

### What It Is

Wikidata is the structured data backbone of Wikipedia - a community-curated knowledge graph containing entities and their relationships. Quality varies but notable entities are generally accurate.

### Entity Classification

| Type    | Wikidata Class            | Q-ID     |
| ------- | ------------------------- | -------- |
| Brand   | "brand"                   | Q431289  |
| Company | "business" / "enterprise" | Q4830453 |
| Person  | "human"                   | Q5       |

### Company Fields

| Field            | Wikidata Property  | Description                |
| ---------------- | ------------------ | -------------------------- |
| `wikidata_id`    | Q-ID               | Unique Wikidata identifier |
| `name`           | Label              | Display name               |
| `lei`            | P1278              | LEI (when known)           |
| `cik`            | P5531              | SEC CIK number             |
| `website`        | P856               | Official website           |
| `logo_url`       | P154               | Logo image URL             |
| `founded_year`   | P571               | Year of inception          |
| `industry`       | P452               | Industry classification    |
| `description`    | schema:description | Short description          |
| `headquarters`   | P159               | HQ location                |
| `stock_exchange` | P414               | Where publicly traded      |
| `ticker`         | P249               | Stock ticker symbol        |
| `country`        | P17                | Country                    |

### Brand Fields

| Field         | Wikidata Property | Description       |
| ------------- | ----------------- | ----------------- |
| `wikidata_id` | Q-ID              | Unique identifier |
| `name`        | Label             | Brand name        |
| `logo_url`    | P154              | Logo image        |
| `website`     | P856              | Brand website     |
| `owner`       | P127              | Owning company    |

### Relationship Fields

| Relationship | Property | Direction        |
| ------------ | -------- | ---------------- |
| Owned by     | P127     | Child → Parent   |
| Subsidiary   | P355     | Parent → Child   |
| Parent org   | P749     | Child → Parent   |
| Founded by   | P112     | Company → Person |
| CEO          | P169     | Company → Person |
| Board member | P3320    | Company → Person |

### Data Availability (from Wikidata)

| Metric                            | Count      | Notes                        |
| --------------------------------- | ---------- | ---------------------------- |
| Companies with ownership (P127)   | 31,196     | Have at least one owner      |
| Companies with parent org (P749)  | 29,252     | Alternative parent property  |
| Entities with subsidiaries (P355) | 29,366     | Have at least one subsidiary |
| Total P127 relationships          | 1,139,390  | All "owned by" claims        |
| P127 with citation URL            | 70,090     | Have verifiable source       |
| **Entities with LEI (P1278)**     | **52,627** | **Bridge to GLEIF**          |

### What Wikidata Provides

- Brand → Company ownership links
- Company metadata (logos, descriptions, websites)
- People connections (founders, executives, board)
- Cross-references to other identifiers

### What Wikidata Lacks

- Comprehensive coverage (community-curated = notable entities only)
- Consistent data quality (varies by entity)
- Products (has some, but not comprehensive)
- Financial data (revenue, employee counts are sparse)

---

## 3. Linkage Between GLEIF and Wikidata

### Primary Link: LEI (P1278)

```
GLEIF Company ←──── LEI ────→ Wikidata Company
   (lei field)              (P1278 property)
```

- **52,627 Wikidata entities have LEI**
- These can be definitively matched to GLEIF records
- LEI is authoritative (no ambiguity)

### Data Enrichment Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         GLEIF                                    │
│  1.59M Companies with LEI                                        │
│  └── 140K ownership relationships (Company → Company)            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Match on LEI
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Overlap: 52K Companies                        │
│  Have both LEI (authoritative) and Wikidata metadata            │
│  └── Can enrich with: logo, website, description, industry      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ wikidata_id
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Wikidata                                  │
│  31K Companies with ownership data                               │
│  ├── 70K ownership relationships (with citations)                │
│  ├── Brand → Company links                                       │
│  └── Person → Company links (founders, board, CEO)               │
└─────────────────────────────────────────────────────────────────┘
```

### Secondary Links (Future)

| Field | GLEIF      | Wikidata | Notes                                |
| ----- | ---------- | -------- | ------------------------------------ |
| CIK   | —          | P5531    | SEC identifier, links to SEC EDGAR   |
| Name  | legal_name | Label    | Fuzzy match fallback (less reliable) |

---

## 4. Combined Schema (Target)

### Company Node

| Field            | Primary Source | Fallback Source  |
| ---------------- | -------------- | ---------------- |
| `id`             | Generated UUID | —                |
| `lei`            | GLEIF          | Wikidata P1278   |
| `wikidata_id`    | Wikidata       | —                |
| `name`           | Wikidata Label | GLEIF legal_name |
| `legal_name`     | GLEIF          | —                |
| `jurisdiction`   | GLEIF          | Wikidata P17     |
| `headquarters`   | GLEIF          | Wikidata P159    |
| `website`        | Wikidata P856  | —                |
| `logo_url`       | Wikidata P154  | —                |
| `description`    | Wikidata       | —                |
| `industry`       | Wikidata P452  | —                |
| `founded_year`   | Wikidata P571  | —                |
| `stock_exchange` | Wikidata P414  | —                |
| `ticker`         | Wikidata P249  | —                |
| `data_sources`   | Array          | —                |

### Brand Node

| Field          | Source         |
| -------------- | -------------- |
| `id`           | Generated UUID |
| `wikidata_id`  | Wikidata       |
| `name`         | Wikidata Label |
| `logo_url`     | Wikidata P154  |
| `website`      | Wikidata P856  |
| `data_sources` | Array          |

### Relationships

| Relationship   | Source   | Entities          |
| -------------- | -------- | ----------------- |
| `OWNED_BY`     | GLEIF    | Company → Company |
| `OWNED_BY`     | Wikidata | Company → Company |
| `OWNED_BY`     | Wikidata | Brand → Company   |
| `FOUNDER`      | Wikidata | Person → Company  |
| `BOARD_MEMBER` | Wikidata | Person → Company  |
| `CEO`          | Wikidata | Person → Company  |

All relationships require `source_url` for provenance.

---

## 5. Open Questions

1. **Citation requirement:** Currently only loading Wikidata relationships with P854 (citation URL). This gives us 70K of 1.1M. Should we relax this for well-known entities?

2. **Company-Company from Wikidata:** Current loader only gets Brand→Company ownership. Should add Company→Company (P127 where both are Q4830453)?

3. **P355 vs P127:** Wikidata has both "subsidiary" (P355) and "owned by" (P127). Should we query both directions?

4. **Name matching fallback:** For companies without LEI, should we fuzzy-match on name? Risk of false positives.

5. **ETL race condition:** Current bug causes all Wikidata relationships to fail. Need to fix async batch writes.

---

## 6. Current ETL Issues

### Race Condition Bug

- Entity batches (brands, companies) are flushed async
- Relationship batches try to MATCH entities that may not exist yet
- Result: 0 Wikidata relationships created despite entities existing

### Incomplete Wikidata Load

- Query has LIMIT 50000 but only 3,360 companies loaded
- Possible timeout or matching issues
- Should load all 52K companies with LEI

---

_Last updated: 2026-02-05_
