# Boyk Neo4j Knowledge Graph Schema

Complete schema of the Neo4j database as constructed by the ETL pipeline.

---

## Node Labels

### Company

The core entity. Represents corporations, organizations, and legal entities.

| Property                   | Type         | Source Stage(s) | Notes                                                     |
| -------------------------- | ------------ | --------------- | --------------------------------------------------------- |
| `lei`                      | String       | 1, 2            | Legal Entity Identifier (20-char). **Unique constraint**. |
| `wikidata_id`              | String       | 1               | Wikidata QID (e.g. Q312). **Unique constraint**.          |
| `cik`                      | String       | 6, 15           | SEC Central Index Key                                     |
| `name`                     | String       | 1, 2            | Display name. **Range index + fulltext index**.           |
| `legal_name`               | String       | 2               | Official GLEIF legal name                                 |
| `jurisdiction`             | String       | 2               | GLEIF registration jurisdiction                           |
| `country`                  | String       | 14              | ISO country code (from Wikidata)                          |
| `hq_city`                  | String       | 14              | Headquarters city                                         |
| `hq_country`               | String       | 14              | Headquarters country                                      |
| `industry`                 | String       | 14              | Industry classification                                   |
| `website`                  | String       | 14              | Corporate website URL                                     |
| `founded`                  | String       | 14              | Year founded                                              |
| `employees`                | Integer      | 14              | Employee count                                            |
| `revenue`                  | Float        | 14              | Annual revenue                                            |
| `stock_exchange`           | String       | 14              | Stock exchange name                                       |
| `ticker`                   | String       | 14              | Stock ticker symbol                                       |
| `isin`                     | String       | 14              | International Securities Identification Number            |
| `logo_url`                 | String       | 5               | R2 public URL for company logo                            |
| `uk_company_number`        | String       | 24              | UK Companies House number                                 |
| `uk_company_status`        | String       | 24              | Active/dissolved/etc.                                     |
| `uk_company_type`          | String       | 24              | Ltd, PLC, etc.                                            |
| `uk_registered_address`    | String       | 24              | Registered office address                                 |
| `date_of_creation`         | String       | 24              | UK incorporation date                                     |
| `sanctioned`               | Boolean      | 25              | OpenSanctions flag                                        |
| `sanction_details`         | String       | 25              | Sanction description                                      |
| `controversy_score`        | Float        | 26              | GDELT news controversy score                              |
| `total_penalties`          | Float        | 27              | Aggregate penalty total                                   |
| `total_lobbying_spend`     | Float        | 27              | Aggregate lobbying total                                  |
| `total_subsidies_received` | Float        | 27              | Aggregate subsidies total                                 |
| `total_gov_contracts`      | Float        | 27              | Aggregate government contracts total                      |
| `brand_count`              | Integer      | 27              | Number of owned brands                                    |
| `subsidiary_count`         | Integer      | 27              | Number of subsidiaries                                    |
| `data_sources`             | List[String] | \*              | All data sources that contributed                         |
| `sources_json`             | String       | \*              | JSON-encoded provenance details                           |
| `source_count`             | Integer      | \*              | Number of contributing sources                            |
| `last_updated`             | DateTime     | \*              | Last ETL update timestamp                                 |

### Brand

Consumer-facing brand names, linked to owning companies.

| Property       | Type         | Source Stage(s) | Notes                                         |
| -------------- | ------------ | --------------- | --------------------------------------------- |
| `wikidata_id`  | String       | 1               | **Unique constraint**.                        |
| `name`         | String       | 1, 3            | Brand name. **Range index + fulltext index**. |
| `website`      | String       | 1               | Brand website                                 |
| `logo_url`     | String       | 1               | Brand logo URL                                |
| `data_sources` | List[String] | \*              |                                               |
| `sources_json` | String       | \*              |                                               |
| `last_updated` | DateTime     | \*              |                                               |

### Product

Physical products with barcodes, linked to brands.

| Property        | Type         | Source Stage(s) | Notes                                           |
| --------------- | ------------ | --------------- | ----------------------------------------------- |
| `barcode`       | String       | 3               | EAN/UPC barcode. **Unique constraint**.         |
| `name`          | String       | 3, 4            | Product name. **Range index + fulltext index**. |
| `asin`          | String       | 4               | Amazon ASIN. **Range index**.                   |
| `upc`           | String       | 4               | UPC code. **Range index**.                      |
| `category`      | String       | 3               | Product category                                |
| `brand_name`    | String       | 3               | Brand name (denormalized)                       |
| `image_url`     | String       | 3               | Product image URL                               |
| `recalled`      | Boolean      | 21, 22          | FDA/CPSC recall flag                            |
| `recall_reason` | String       | 21, 22          | Recall reason                                   |
| `data_sources`  | List[String] | \*              |                                                 |
| `sources_json`  | String       | \*              |                                                 |
| `last_updated`  | DateTime     | \*              |                                                 |

### Person

Key individuals: executives, founders, board members.

| Property               | Type         | Source Stage(s) | Notes                         |
| ---------------------- | ------------ | --------------- | ----------------------------- |
| `wikidata_id`          | String       | 1               | **Range index**.              |
| `name`                 | String       | 1, 15           | Person name. **Range index**. |
| `role`                 | String       | 1               | Primary role                  |
| `nationality`          | String       | 1               | Country of citizenship        |
| `country_of_residence` | String       | 1               |                               |
| `total_compensation`   | Float        | 15              | SEC proxy total compensation  |
| `base_salary`          | Float        | 15              | SEC proxy base salary         |
| `stock_awards`         | Float        | 15              | SEC proxy stock awards        |
| `comp_fiscal_year`     | String       | 15              | Compensation fiscal year      |
| `data_sources`         | List[String] | \*              |                               |
| `sources_json`         | String       | \*              |                               |
| `last_updated`         | DateTime     | \*              |                               |

### Politician

Politicians who received corporate donations.

| Property       | Type         | Source Stage(s) | Notes                                    |
| -------------- | ------------ | --------------- | ---------------------------------------- |
| `fec_id`       | String       | 7               | FEC candidate ID. **Unique constraint**. |
| `name`         | String       | 7               | Politician name. **Range index**.        |
| `party`        | String       | 7               | Political party                          |
| `state`        | String       | 7               | State                                    |
| `office`       | String       | 7               | Office sought/held                       |
| `data_sources` | List[String] | \*              |                                          |
| `last_updated` | DateTime     | \*              |                                          |

### Violation

Corporate penalties and enforcement actions.

| Property         | Type     | Source Stage(s) | Notes                                          |
| ---------------- | -------- | --------------- | ---------------------------------------------- |
| `case_id`        | String   | 11, 18          | Unique case identifier. **Unique constraint**. |
| `company_name`   | String   | 11, 18          | Company name (denormalized)                    |
| `agency`         | String   | 11, 18          | Enforcement agency                             |
| `offense_type`   | String   | 11, 18          | Type of offense                                |
| `penalty_amount` | Float    | 11, 18          | Penalty dollar amount                          |
| `year`           | Integer  | 11, 18          | Violation year. **Range index**.               |
| `description`    | String   | 11, 18          | Case description                               |
| `source`         | String   | 11, 18          | Data source name                               |
| `last_updated`   | DateTime | \*              |                                                |

### EnvironmentalViolation

EPA environmental compliance records.

| Property            | Type     | Source Stage(s) | Notes                                   |
| ------------------- | -------- | --------------- | --------------------------------------- |
| `facility_id`       | String   | 16              | EPA facility ID. **Unique constraint**. |
| `company_name`      | String   | 16              |                                         |
| `violation_type`    | String   | 16              |                                         |
| `compliance_status` | String   | 16              |                                         |
| `penalty_amount`    | Float    | 16              |                                         |
| `last_inspection`   | String   | 16              |                                         |
| `registry_id`       | String   | 16              | EPA registry ID                         |
| `source`            | String   | 16              |                                         |
| `last_updated`      | DateTime | \*              |                                         |

### ESGScore

Environmental, Social, and Governance ratings.

| Property       | Type     | Source Stage(s) | Notes                                |
| -------------- | -------- | --------------- | ------------------------------------ |
| `company_name` | String   | 12              | Compound key with metric_name + year |
| `metric_name`  | String   | 12              | ESG metric name                      |
| `year`         | Integer  | 12              | Rating year                          |
| `score`        | String   | 12              | ESG score value                      |
| `source`       | String   | 12              |                                      |
| `last_updated` | DateTime | \*              |                                      |

### Facility

Manufacturing/production facilities (Open Supply Hub).

| Property        | Type         | Source Stage(s) | Notes                                      |
| --------------- | ------------ | --------------- | ------------------------------------------ |
| `os_id`         | String       | 13              | Open Supply Hub ID. **Unique constraint**. |
| `name`          | String       | 13              | Facility name                              |
| `country`       | String       | 13              | Country location                           |
| `address`       | String       | 13              | Full address                               |
| `lat`           | Float        | 13              | Latitude                                   |
| `lng`           | Float        | 13              | Longitude                                  |
| `num_workers`   | Integer      | 13              | Worker count                               |
| `product_types` | List[String] | 13              | Products manufactured                      |
| `source`        | String       | 13              |                                            |
| `last_updated`  | DateTime     | \*              |                                            |

### Subsidy

Government subsidies and tax incentives.

| Property       | Type     | Source Stage(s) | Notes                                 |
| -------------- | -------- | --------------- | ------------------------------------- |
| `company_name` | String   | 17              | Compound key with program_name + year |
| `program_name` | String   | 17              | Subsidy program                       |
| `year`         | Integer  | 17              | Subsidy year. **Range index**.        |
| `amount`       | Float    | 17              | Dollar amount                         |
| `agency`       | String   | 17              | Granting agency                       |
| `description`  | String   | 17              |                                       |
| `source`       | String   | 17              |                                       |
| `last_updated` | DateTime | \*              |                                       |

### Recall

Product safety recalls (FDA, CPSC).

| Property         | Type     | Source Stage(s) | Notes                                            |
| ---------------- | -------- | --------------- | ------------------------------------------------ |
| `recall_id`      | String   | 21, 22          | Unique recall identifier. **Unique constraint**. |
| `product_name`   | String   | 21, 22          |                                                  |
| `company_name`   | String   | 21, 22          |                                                  |
| `reason`         | String   | 21, 22          | Recall reason                                    |
| `classification` | String   | 21              | FDA classification (I/II/III)                    |
| `status`         | String   | 21, 22          | Active/terminated                                |
| `date`           | String   | 21, 22          | Recall date. **Range index**.                    |
| `agency`         | String   | 21, 22          | FDA or CPSC                                      |
| `source`         | String   | 21, 22          |                                                  |
| `last_updated`   | DateTime | \*              |                                                  |

### ConsumerComplaint

CFPB consumer financial complaints.

| Property            | Type     | Source Stage(s) | Notes                                     |
| ------------------- | -------- | --------------- | ----------------------------------------- |
| `complaint_id`      | String   | 20              | CFPB complaint ID. **Unique constraint**. |
| `company_name`      | String   | 20              |                                           |
| `product`           | String   | 20              | Financial product type                    |
| `issue`             | String   | 20              | Complaint issue                           |
| `sub_issue`         | String   | 20              |                                           |
| `state`             | String   | 20              | Consumer state                            |
| `date_received`     | String   | 20              | Date received. **Range index**.           |
| `company_response`  | String   | 20              |                                           |
| `timely_response`   | Boolean  | 20              |                                           |
| `consumer_disputed` | Boolean  | 20              |                                           |
| `source`            | String   | 20              |                                           |
| `last_updated`      | DateTime | \*              |                                           |

### GovernmentContract

Federal government contracts (USAspending).

| Property        | Type     | Source Stage(s) | Notes                                     |
| --------------- | -------- | --------------- | ----------------------------------------- |
| `award_id`      | String   | 19              | Contract award ID. **Unique constraint**. |
| `company_name`  | String   | 19              |                                           |
| `agency`        | String   | 19              | Federal agency                            |
| `amount`        | Float    | 19              | Dollar amount                             |
| `description`   | String   | 19              |                                           |
| `naics_code`    | String   | 19              | NAICS industry code                       |
| `start_date`    | String   | 19              |                                           |
| `end_date`      | String   | 19              |                                           |
| `contract_type` | String   | 19              |                                           |
| `source`        | String   | 19              |                                           |
| `last_updated`  | DateTime | \*              |                                           |

### OffshoreEntity

Entities from ICIJ offshore leaks investigations.

| Property             | Type     | Source Stage(s) | Notes                                  |
| -------------------- | -------- | --------------- | -------------------------------------- |
| `icij_id`            | String   | 23              | ICIJ entity ID. **Unique constraint**. |
| `name`               | String   | 23              |                                        |
| `jurisdiction`       | String   | 23              |                                        |
| `incorporation_date` | String   | 23              |                                        |
| `inactivation_date`  | String   | 23              |                                        |
| `status`             | String   | 23              |                                        |
| `investigation`      | String   | 23              | Panama Papers, Paradise Papers, etc.   |
| `source`             | String   | 23              |                                        |
| `last_updated`       | DateTime | \*              |                                        |

### Country

Supporting node for geographic relationships.

| Property   | Type   | Source Stage(s) | Notes                                    |
| ---------- | ------ | --------------- | ---------------------------------------- |
| `iso_code` | String | 1               | ISO country code. **Unique constraint**. |

---

## Relationships

### Provenance Properties (on all relationships)

Every relationship created by the ETL pipeline carries standardized provenance:

| Property              | Type         | Description                                                 |
| --------------------- | ------------ | ----------------------------------------------------------- |
| `source`              | String       | Primary data source (wikidata, gleif, sec_edgar, fec, etc.) |
| `confidence`          | String       | high / medium / low                                         |
| `corroborated_by`     | List[String] | Other sources confirming this relationship                  |
| `evidence_sources`    | List[String] | All contributing sources                                    |
| `evidence_record_ids` | List[String] | Source record identifiers                                   |
| `evidence_urls`       | List[String] | URLs to source evidence                                     |
| `evidence_keys`       | List[String] | Unique evidence identifiers                                 |
| `evidence_count`      | Integer      | Number of evidence items                                    |
| `evidence_json`       | String       | JSON-encoded evidence object                                |
| `matched_by`          | String       | Matching method used (lei, name_match, etc.)                |
| `match_confidence`    | String       | Match quality indicator                                     |
| `first_seen`          | DateTime     | When relationship was first detected                        |
| `last_confirmed`      | DateTime     | Last verification timestamp                                 |
| `provenance_version`  | Integer      | Always 1                                                    |

### Corporate Structure

```
(child:Company)-[:SUBSIDIARY_OF]->(parent:Company)
```

- **Direction**: Child is a subsidiary of parent
- **Sources**: Stage 1 (Wikidata P749), Stage 2 (GLEIF relationship records)
- **Extra properties**: `gleif_relationship_type`, `wikidata_property`

```
(brand:Brand)-[:OWNED_BY]->(company:Company)
```

- **Direction**: Brand is owned by company
- **Sources**: Stage 1 (Wikidata)

### Supply Chain

```
(supplier:Company)-[:SUPPLIES]->(customer:Company)
```

- **Direction**: Supplier provides goods/services to customer
- **Sources**: Stage 6 (SEC EDGAR 10-K filings)
- **Extra properties**: `sec_filing`

### Products

```
(brand:Brand)-[:SELLS]->(product:Product)
```

- **Direction**: Brand sells the product
- **Sources**: Stage 3 (OpenFoodFacts), Stage 4 (Wikidata)

### People & Companies

```
(person:Person)-[:CEO_OF]->(company:Company)
```

- **Sources**: Stage 1 (Wikidata), Stage 15 (SEC proxy)

```
(person:Person)-[:FOUNDED]->(company:Company)
```

- **Sources**: Stage 1 (Wikidata)

```
(person:Person)-[:BOARD_MEMBER_OF]->(company:Company)
```

- **Sources**: Stage 1 (Wikidata)

```
(person:Person)-[:COMPENSATED_BY]->(company:Company)
```

- **Sources**: Stage 15 (SEC proxy statements)
- **Extra properties**: `total_compensation`, `base_salary`, `stock_awards`, `comp_fiscal_year`

```
(person:Person)-[:HAS_SIGNIFICANT_CONTROL_OVER]->(company:Company)
```

- **Sources**: Stage 24 (UK Companies House)
- **Extra properties**: `role`, `natures_of_control`

### Political Donations

```
(company:Company)-[:DONATED_TO]->(politician:Politician)
```

- **Sources**: Stage 7 (FEC)
- **Extra properties**: `amount`, `year`

```
(company:Company)-[:DONATED_TO_STATE]->(politician:Politician)
```

- **Sources**: Stage 10 (FollowTheMoney)
- **Extra properties**: `amount`, `year`

### Violations & Enforcement

```
(company:Company)-[:PENALIZED_FOR]->(violation:Violation)
```

- **Sources**: Stage 11 (Violation Tracker), Stage 18 (OSHA)

```
(company:Company)-[:HAS_EPA_VIOLATION]->(violation:EnvironmentalViolation)
```

- **Sources**: Stage 16 (EPA ECHO)

### ESG & Lobbying

```
(company:Company)-[:HAS_ESG_SCORE]->(score:ESGScore)
```

- **Sources**: Stage 12 (WikiRate)

```
(company:Company)-[:LOBBIED_FOR]->(record:LobbyingRecord)
```

- **Sources**: Stage 10 (FollowTheMoney/OpenSecrets)

### Operations & Supply

```
(company:Company)-[:PRODUCES_AT]->(facility:Facility)
```

- **Sources**: Stage 13 (Open Supply Hub)

```
(company:Company)-[:RECEIVED_SUBSIDY]->(subsidy:Subsidy)
```

- **Sources**: Stage 17 (Subsidy Tracker)

### Consumer Safety

```
(company:Company)-[:RECALLED_PRODUCT]->(recall:Recall)
```

- **Sources**: Stage 21 (FDA), Stage 22 (CPSC)

```
(company:Company)-[:HAS_COMPLAINT]->(complaint:ConsumerComplaint)
```

- **Sources**: Stage 20 (CFPB)

### Government & Offshore

```
(company:Company)-[:AWARDED_CONTRACT]->(contract:GovernmentContract)
```

- **Sources**: Stage 19 (USAspending)

```
(company:Company)-[:LINKED_TO_OFFSHORE]->(entity:OffshoreEntity)
```

- **Sources**: Stage 23 (ICIJ Offshore Leaks)

---

## Indexes Summary

### Unique Constraints

| Label                  | Property     | Constraint Name         |
| ---------------------- | ------------ | ----------------------- |
| Company                | lei          | company_lei             |
| Company                | wikidata_id  | company_wikidata        |
| Brand                  | wikidata_id  | brand_wikidata          |
| Product                | barcode      | product_barcode         |
| Politician             | fec_id       | politician_fec          |
| Violation              | case_id      | violation_caseid_unique |
| EnvironmentalViolation | facility_id  | env_violation_facility  |
| Facility               | os_id        | facility_osid           |
| Recall                 | recall_id    | recall_id               |
| ConsumerComplaint      | complaint_id | complaint_id            |
| GovernmentContract     | award_id     | contract_award          |
| OffshoreEntity         | icij_id      | offshore_icij           |
| Country                | iso_code     | country_iso             |

### Range Indexes

| Label             | Property      | Index Name      |
| ----------------- | ------------- | --------------- |
| Company           | name          | company_name    |
| Brand             | name          | brand_name      |
| Person            | wikidata_id   | person_wikidata |
| Person            | name          | person_name     |
| Politician        | name          | politician_name |
| Product           | name          | product_name    |
| Product           | asin          | product_asin    |
| Product           | upc           | product_upc     |
| Violation         | year          | violation_year  |
| Subsidy           | year          | subsidy_year    |
| Recall            | date          | recall_date     |
| ConsumerComplaint | date_received | complaint_date  |

### Fulltext Indexes

| Index Name       | Label   | Property | Usage                 |
| ---------------- | ------- | -------- | --------------------- |
| company_fulltext | Company | name     | Fuzzy + prefix search |
| brand_fulltext   | Brand   | name     | Fuzzy + prefix search |
| product_fulltext | Product | name     | Fuzzy + prefix search |

---

## ETL Stage Reference

| Stage | Name                           | Node Types               | Relationship Types                                        | Data Source            |
| ----- | ------------------------------ | ------------------------ | --------------------------------------------------------- | ---------------------- |
| 1     | Wikidata Base Entities         | Company, Brand, Person   | SUBSIDIARY_OF, OWNED_BY, CEO_OF, FOUNDED, BOARD_MEMBER_OF | Wikidata SPARQL        |
| 2     | GLEIF Legal Entities           | Company (merge)          | SUBSIDIARY_OF (refined)                                   | GLEIF API              |
| 3     | OpenFoodFacts Products         | Product, Brand           | SELLS                                                     | OpenFoodFacts API      |
| 4     | Wikidata Product IDs           | Product (enrich)         | SELLS (enrich)                                            | Wikidata SPARQL        |
| 5     | Logo.dev Company Logos         | Company (logo_url)       | —                                                         | Logo.dev API → R2      |
| 6     | SEC EDGAR Supply Chain         | Company (cik)            | SUPPLIES                                                  | SEC EDGAR XBRL         |
| 7     | FEC Federal Donations          | Politician               | DONATED_TO                                                | FEC API                |
| 10    | FollowTheMoney State Donations | Politician               | DONATED_TO_STATE                                          | FollowTheMoney API     |
| 11    | Violation Tracker Penalties    | Violation                | PENALIZED_FOR                                             | Violation Tracker      |
| 12    | WikiRate ESG Scores            | ESGScore                 | HAS_ESG_SCORE                                             | WikiRate API           |
| 13    | Open Supply Hub Facilities     | Facility                 | PRODUCES_AT                                               | Open Supply Hub API    |
| 14    | Wikidata Extended Properties   | Company (enrich)         | —                                                         | Wikidata SPARQL        |
| 15    | SEC Proxy Compensation         | Person (enrich)          | COMPENSATED_BY                                            | SEC EDGAR proxy        |
| 16    | EPA ECHO Environmental         | EnvironmentalViolation   | HAS_EPA_VIOLATION                                         | EPA ECHO API           |
| 17    | Subsidy Tracker                | Subsidy                  | RECEIVED_SUBSIDY                                          | Subsidy Tracker        |
| 18    | OSHA Workplace Violations      | Violation                | PENALIZED_FOR                                             | OSHA API               |
| 19    | USAspending Gov Contracts      | GovernmentContract       | AWARDED_CONTRACT                                          | USAspending API        |
| 20    | CFPB Consumer Complaints       | ConsumerComplaint        | HAS_COMPLAINT                                             | CFPB API               |
| 21    | FDA Recalls                    | Recall                   | RECALLED_PRODUCT                                          | openFDA API            |
| 22    | CPSC Product Recalls           | Recall                   | RECALLED_PRODUCT                                          | CPSC API               |
| 23    | ICIJ Offshore Leaks            | OffshoreEntity           | LINKED_TO_OFFSHORE                                        | ICIJ dataset           |
| 24    | UK Companies House             | Company (enrich), Person | HAS_SIGNIFICANT_CONTROL_OVER                              | UK Companies House API |
| 25    | OpenSanctions                  | Company (enrich)         | —                                                         | OpenSanctions API      |
| 26    | GDELT News Monitoring          | Company (enrich)         | —                                                         | GDELT API              |
| 27    | Aggregate Score Computation    | Company (enrich)         | —                                                         | Internal aggregation   |

---

## Database Statistics (approximate)

| Metric              | Count     |
| ------------------- | --------- |
| Companies           | ~55,000   |
| Brands              | ~41,000   |
| Products            | ~75,000   |
| Persons             | ~7,000    |
| Politicians         | ~5,000    |
| Company Logos       | ~21,000   |
| Total Nodes         | ~200,000+ |
| Total Relationships | ~500,000+ |
