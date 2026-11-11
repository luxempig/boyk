# Data pipeline

Builds and maintains the ownership graph from public sources, and builds the barcode index.

| Path                | What it is                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `etl/`              | The nightly pipeline. Ran on AWS Lambda in batches of stages scheduled by EventBridge        |
| `etl/enrichment/`   | One module per source: GLEIF, Wikidata, SEC, EPA, CFPB, FEC, USAspending, recalls and others |
| `etl/tests/`        | 257 unit tests, including the deadline and identity guards described in the main README      |
| `tools/off-ingest/` | Builds the barcode index from Open Food Facts and USDA data, and diffs it before publishing  |
| `tools/rebuild/`    | Resolves identity collisions in the graph and asserts the result                             |
| `tools/identity/`   | Repairs LEI nodes that hold the wrong Wikidata ID                                            |
| `docs/`             | Product data sources and the cutover runbook for the identity rebuild                        |

`etl/README.md` documents the stages and how to run them against a Neo4j instance.

```bash
pip install -r etl/requirements.txt   # Python 3.10 or later
pytest etl/tests -q
```

The pipeline is no longer scheduled: the site now runs from a snapshot of the graph it produced
(see the main README).
