# Boyk ETL Pipeline v2

17-stage enrichment pipeline that builds a Neo4j knowledge graph of companies, brands, products, political connections, violations, ESG scores, and supply chain data.

## Quick Start

```bash
pip install -r requirements.txt

# Set environment variables
export NEO4J_URI="bolt://localhost:7687"
export NEO4J_PASSWORD="your_password"

# Run all stages
python run_etl.py --run

# Run specific stages
python run_etl.py --run --stages 1,2,11,7

# Check database
python run_etl.py --stats
```

## Stages

| #   | Source                          | Data                                          | Cost                |
| --- | ------------------------------- | --------------------------------------------- | ------------------- |
| 1   | Wikidata SPARQL                 | Companies, brands, people, subsidiaries       | Free                |
| 2   | GLEIF API                       | LEI enrichment, parent-child relationships    | Free                |
| 3   | Open Food/Beauty/Products Facts | Products with barcodes                        | Free                |
| 4   | Wikidata                        | ASIN, UPC codes                               | Free                |
| 5   | Clearbit                        | Company logos                                 | Free                |
| 6   | SEC EDGAR 10-K                  | Supplier/customer relationships, subsidiaries | Free                |
| 7   | FEC API                         | Federal political donations                   | Free                |
| 9   | OpenSecrets API                 | Lobbying expenditures                         | Free (key required) |
| 10  | FollowTheMoney                  | State-level political donations               | Free (key required) |
| 11  | Violation Tracker               | Corporate penalties (env, wage, safety, etc.) | Free                |
| 12  | WikiRate                        | ESG scores, supply chain metrics              | Free                |
| 13  | Open Supply Hub                 | Factory/facility locations                    | Free (5K limit)     |
| 14  | Wikidata Extended               | Country, industry, HQ, employees, revenue     | Free                |
| 15  | SEC EDGAR Proxy                 | Executive compensation                        | Free                |
| 16  | EPA ECHO                        | Environmental compliance violations           | Free                |
| 17  | Subsidy Tracker                 | Corporate tax breaks and subsidies            | Free                |

## Environment Variables

Required:

- `NEO4J_URI` — bolt:// connection string
- `NEO4J_USER` — default: neo4j
- `NEO4J_PASSWORD`

Optional API keys:

- `OPENSECRETS_API_KEY` — for Stage 9
- `FOLLOWTHEMONEY_API_KEY` — for Stage 10
- `OPEN_SUPPLY_HUB_API_KEY` — for Stage 13

## File Structure

```
etl/
├── run_etl.py              # Main orchestrator
├── config.py               # All configuration
├── models.py               # Data models with provenance
├── wikidata_client.py      # Stages 1, 4, 14
├── gleif_client.py         # Stage 2
├── neo4j_writer.py         # All database operations
├── lambda_handler.py       # AWS Lambda entry point
├── setup_infra.sh          # AWS infrastructure setup
├── requirements.txt
├── README.md
└── enrichment/
    ├── __init__.py          # Shared HTTP helpers
    ├── openfoodfacts.py     # Stage 3
    ├── wikidata_product_ids.py  # Stage 4
    ├── clearbit_logos.py    # Stage 5
    ├── sec_edgar.py         # Stage 6
    ├── fec_donations.py     # Stage 7
    ├── opensecrets.py       # Stage 9
    ├── followthemoney.py    # Stage 10
    ├── violation_tracker.py # Stage 11
    ├── wikirate.py          # Stage 12
    ├── open_supply_hub.py   # Stage 13
    ├── wikidata_extended.py # Stage 14
    ├── sec_proxy.py         # Stage 15
    ├── epa_echo.py          # Stage 16
    └── subsidy_tracker.py   # Stage 17
```

## Multi-Source Provenance

Every node stores:

- `data_sources` — list of all sources that contributed (e.g., `["wikidata", "gleif", "sec_edgar"]`)
- `sources_json` — detailed JSON with per-field source tracking
- `source_count` — number of independent sources
- `last_updated` — timestamp of most recent update

Every relationship stores:

- `source` — primary source that created the relationship
- `corroborated_by` — list of additional sources that confirm it
- `confidence` — "high" or "medium"
- `last_confirmed` — timestamp

## AWS Deployment

```bash
chmod +x setup_infra.sh
./setup_infra.sh
```

This creates:

- S3 bucket for staged caches
- Lambda function (15 min timeout, 1GB RAM)
- EventBridge daily schedule (3 AM UTC)
- IAM role with minimal permissions
- Secrets Manager entries for credentials

Estimated monthly cost: $17-39 (free tier DB) or $82-104 (AuraDB Professional)

<!-- deploy roundtrip check 2026-04-22 -->
