// Single source of truth for data-source attribution: display labels, the
// deep-link / landing-page URL for each source, and the resolver every
// ProvenanceBadge uses. Keeping this in one place is what makes sourced claims
// look — and link — the same everywhere they appear.

export const SOURCE_LABELS = {
  gleif: 'GLEIF',
  wikidata: 'Wikidata',
  sec_edgar: 'SEC',
  fec: 'FEC',
  opencorporates: 'OpenCorp',
  violation_tracker: 'ViolTracker',
  osha: 'OSHA',
  epa_echo: 'EPA ECHO',
  wikirate: 'WikiRate',
  open_supply_hub: 'OpenSupplyHub',
  subsidy_tracker: 'SubsidyTracker',
  opensecrets: 'OpenSecrets',
  cfpb: 'CFPB',
  usaspending: 'USAspending',
  icij: 'ICIJ',
  fda: 'FDA',
  cpsc: 'CPSC',
  gdelt: 'GDELT',
  openfoodfacts: 'OpenFoodFacts',
  usda_fdc: 'USDA FoodData Central',
  uk_companies_house: 'UK CompHouse',
  user: 'User',
  manual: 'Manual',
}

// Landing / search page for each source — used when we have no record-level
// identifier to deep-link to, so a known source's tag is never a dead label.
// `user` and `manual` are intentionally absent: they're user-contributed
// claims with no external record to point at.
export const SOURCE_HOMES = {
  gleif: 'https://search.gleif.org',
  wikidata: 'https://www.wikidata.org',
  sec_edgar: 'https://www.sec.gov/cgi-bin/browse-edgar',
  fec: 'https://www.fec.gov/data/',
  opencorporates: 'https://opencorporates.com',
  uk_companies_house: 'https://find-and-update.company-information.service.gov.uk',
  violation_tracker: 'https://violationtracker.goodjobsfirst.org',
  osha: 'https://www.osha.gov',
  epa_echo: 'https://echo.epa.gov',
  wikirate: 'https://wikirate.org',
  open_supply_hub: 'https://opensupplyhub.org',
  subsidy_tracker: 'https://subsidytracker.goodjobsfirst.org',
  opensecrets: 'https://www.opensecrets.org',
  cfpb: 'https://www.consumerfinance.gov/data-research/consumer-complaints/',
  usaspending: 'https://www.usaspending.gov',
  icij: 'https://offshoreleaks.icij.org',
  fda: 'https://www.fda.gov',
  cpsc: 'https://www.cpsc.gov/Recalls',
  gdelt: 'https://www.gdeltproject.org',
  openfoodfacts: 'https://world.openfoodfacts.org',
  usda_fdc: 'https://fdc.nal.usda.gov',
}

export function sourceLabel(source) {
  return SOURCE_LABELS[source] || source
}

// Builds the most specific URL we can for a claim's source:
//   1. an explicit source_url from the data, else
//   2. a record-level deep link from the source + an available identifier
//      (lei / wikidata_id / sec_filing / barcode / id), else
//   3. the source's landing/search page, else
//   4. null (only for user/manual or unknown sources).
export function getSourceUrl(item) {
  if (!item) return null
  if (item.source_url) return item.source_url

  const source = item.source
  if (!source) return null

  switch (source) {
    case 'wikidata': {
      const wid = item.wikidata_id || (item.id?.startsWith?.('Q') ? item.id : null)
      if (wid) return `https://www.wikidata.org/wiki/${wid}`
      break
    }
    case 'gleif': {
      const lei =
        item.lei || (item.id?.length === 20 && !item.id.startsWith?.('Q') ? item.id : null)
      if (lei) return `https://search.gleif.org/#/record/${lei}`
      break
    }
    case 'sec_edgar':
      if (item.sec_filing) return item.sec_filing
      break
    case 'fec':
      if (item.id) return `https://www.fec.gov/data/committee/${item.id}`
      break
    case 'opencorporates':
      if (item.id) return `https://opencorporates.com/companies/${item.id}`
      break
    case 'uk_companies_house':
      if (item.id)
        return `https://find-and-update.company-information.service.gov.uk/company/${item.id}`
      break
    case 'openfoodfacts': {
      const code = item.barcode || item.id
      if (code) return `https://world.openfoodfacts.org/product/${code}`
      break
    }
    default:
      break
  }

  // Fall back to the source's landing/search page so the tag always links
  // somewhere useful for a known source.
  return SOURCE_HOMES[source] || null
}
