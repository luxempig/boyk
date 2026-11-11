# Product Data Sources for ETL Pipeline

## Current Sources (Phase 4)

| Source            | Products | Categories          | License               |
| ----------------- | -------- | ------------------- | --------------------- |
| OpenFoodFacts     | ~3M      | Food & beverages    | Open Database License |
| OpenBeautyFacts   | ~200K    | Cosmetics, skincare | Open Database License |
| OpenProductsFacts | ~50K     | Pet food, cleaning  | Open Database License |

## Recommended Additional Sources

### 1. UPCitemdb (Recommended)

**URL:** https://www.upcitemdb.com/

- **Coverage:** 500M+ products across all categories
- **Data:** Barcode, name, brand, category, images
- **API:** REST API with free tier (100 calls/day)
- **License:** Commercial (paid plans available)
- **Schema Fit:** Direct mapping to Product/Brand

```python
# Example loader pattern
class UPCitemdbLoader(BaseLoader):
    SOURCE_NAME = "upcitemdb"
    # Requires API key, batch lookup available
```

### 2. Dataweave Product Database

**URL:** https://dataweave.com/

- **Coverage:** Retail product data from major retailers
- **Data:** Products, prices, brands, categories
- **API:** Enterprise API
- **License:** Commercial
- **Schema Fit:** Excellent - includes brand ownership

### 3. Diffbot Knowledge Graph

**URL:** https://www.diffbot.com/products/knowledge-graph/

- **Coverage:** 10B+ entities including products
- **Data:** Products, organizations, brand relationships
- **API:** REST + GraphQL
- **License:** Commercial (free tier available)
- **Schema Fit:** Excellent - has Company->Brand->Product relationships

### 4. Wikidata Products (Free)

**URL:** https://www.wikidata.org/

- **Coverage:** ~500K products with brand/manufacturer data
- **Data:** Product names, brands, manufacturers (Wikidata IDs)
- **API:** SPARQL endpoint (free)
- **License:** CC0
- **Schema Fit:** Good - links to existing Wikidata company IDs

```sparql
# SPARQL query for products with brands
SELECT ?product ?productLabel ?brand ?brandLabel ?manufacturer ?manufacturerLabel
WHERE {
  ?product wdt:P31 wd:Q2424752 .  # instance of product
  OPTIONAL { ?product wdt:P176 ?brand }
  OPTIONAL { ?product wdt:P178 ?manufacturer }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
}
```

### 5. GS1 GDSN (Enterprise)

**URL:** https://www.gs1.org/services/gdsn

- **Coverage:** Official global barcode registry
- **Data:** Complete product data from manufacturers
- **API:** B2B data sync network
- **License:** Enterprise membership required
- **Schema Fit:** Authoritative source for barcode data

### 6. Open Icecat

**URL:** https://icecat.biz/

- **Coverage:** 15M+ electronics/tech products
- **Data:** Rich specs, images, brand, category
- **API:** REST API (free for open content)
- **License:** Mixed (open + premium)
- **Schema Fit:** Good for electronics vertical

### 7. Brandbank (Nielsen)

**URL:** https://www.brandbank.com/

- **Coverage:** Grocery/CPG products (major brands)
- **Data:** Product data, images, nutritional info
- **API:** Enterprise API
- **License:** Commercial
- **Schema Fit:** Excellent for grocery vertical

## Free/Open Sources Priority List

For immediate implementation without cost:

1. **Wikidata Products** - Free, links to existing company data
2. **Open Icecat (basic)** - Free tier covers electronics
3. **Barcode Spider** - Community-contributed barcodes

## Schema Compatibility

All sources should map to existing schema:

```
Product {
  name: string,        # Required
  barcode: string,     # Required (UPC/EAN)
  image_url?: string,
  data_sources: string[]
}

Brand {
  name: string,
  wikidata_id?: string,
  openfoodfacts_id?: string,
  # Can add: upcitemdb_id, icecat_id, etc.
}

Relationships:
  (Product)-[:SOLD_UNDER]->(Brand)
  (Brand)-[:OWNED_BY]->(Company)
```

## Implementation Priority

### Phase 1: Wikidata Products (Free)

Add to existing WikidataLoader to also fetch products linked to brands.

### Phase 2: Open Icecat (Electronics)

New loader for tech products - fills major gap in current coverage.

### Phase 3: UPCitemdb (Paid API)

Adds millions of products across all categories. Good ROI for comprehensive coverage.

## Barcode Format Support

Current loaders should handle:

- EAN-13 (International)
- EAN-8 (Compact international)
- UPC-A (US/Canada)
- UPC-E (Compact US)
- Code 128 (Variable length)
- Code 39 (Alphanumeric)

The barcode lookup function handles EAN-13 <-> UPC-A conversion automatically.
