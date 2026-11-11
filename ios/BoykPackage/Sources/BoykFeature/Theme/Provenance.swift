import Foundation

/// Source-attribution helpers — the Swift mirror of the web app's
/// src/lib/provenance.js. One place for source display labels and the
/// deep-link / landing-page URL each source resolves to, so sourced claims
/// look and link the same everywhere on iOS.
enum Provenance {
    /// Display label for a source key (e.g. "gleif" → "GLEIF").
    static func label(_ source: String) -> String {
        labels[source.lowercased()] ?? source
    }

    /// The most specific URL we can build for a claim's source:
    ///   1. an explicit source_url from the data, else
    ///   2. a record-level deep link from the source + an available identifier
    ///      (the connected entity's id, which on Neo4j is a LEI or a Wikidata
    ///      Q-id), else
    ///   3. the source's landing/search page, else
    ///   4. nil (only for user/manual or unknown sources).
    static func sourceURL(source: String?, id: String? = nil, sourceURLString: String? = nil) -> URL? {
        if let explicit = sourceURLString, let u = URL(string: explicit) { return u }
        guard let source = source?.lowercased() else { return nil }

        switch source {
        case "wikidata":
            if let qid = wikidataID(from: id) {
                return URL(string: "https://www.wikidata.org/wiki/\(qid)")
            }
        case "gleif":
            if let lei = leiID(from: id) {
                return URL(string: "https://search.gleif.org/#/record/\(lei)")
            }
        case "opencorporates":
            if let id { return URL(string: "https://opencorporates.com/companies/\(id)") }
        case "fec":
            if let id { return URL(string: "https://www.fec.gov/data/committee/\(id)") }
        case "uk_companies_house":
            if let id {
                return URL(string: "https://find-and-update.company-information.service.gov.uk/company/\(id)")
            }
        default:
            break
        }
        // Fall back to the source's landing/search page so a known source's tag
        // is never a dead label.
        if let home = homes[source] { return URL(string: home) }
        return nil
    }

    private static func wikidataID(from id: String?) -> String? {
        guard let id, id.hasPrefix("Q") else { return nil }
        return id
    }

    private static func leiID(from id: String?) -> String? {
        guard let id, id.count == 20, !id.hasPrefix("Q") else { return nil }
        return id
    }

    static let labels: [String: String] = [
        "gleif": "GLEIF",
        "wikidata": "Wikidata",
        "sec_edgar": "SEC",
        "fec": "FEC",
        "opencorporates": "OpenCorp",
        "violation_tracker": "ViolTracker",
        "osha": "OSHA",
        "epa_echo": "EPA ECHO",
        "wikirate": "WikiRate",
        "open_supply_hub": "OpenSupplyHub",
        "subsidy_tracker": "SubsidyTracker",
        "opensecrets": "OpenSecrets",
        "cfpb": "CFPB",
        "usaspending": "USAspending",
        "icij": "ICIJ",
        "fda": "FDA",
        "cpsc": "CPSC",
        "gdelt": "GDELT",
        "openfoodfacts": "OpenFoodFacts",
        "usda_fdc": "USDA FoodData Central",
        "uk_companies_house": "UK CompHouse",
        "user": "User",
        "manual": "Manual",
    ]

    // Landing/search page per source. `user` and `manual` are intentionally
    // absent — user-contributed claims have no external record to point at.
    static let homes: [String: String] = [
        "gleif": "https://search.gleif.org",
        "wikidata": "https://www.wikidata.org",
        "sec_edgar": "https://www.sec.gov/cgi-bin/browse-edgar",
        "fec": "https://www.fec.gov/data/",
        "opencorporates": "https://opencorporates.com",
        "uk_companies_house": "https://find-and-update.company-information.service.gov.uk",
        "violation_tracker": "https://violationtracker.goodjobsfirst.org",
        "osha": "https://www.osha.gov",
        "epa_echo": "https://echo.epa.gov",
        "wikirate": "https://wikirate.org",
        "open_supply_hub": "https://opensupplyhub.org",
        "subsidy_tracker": "https://subsidytracker.goodjobsfirst.org",
        "opensecrets": "https://www.opensecrets.org",
        "cfpb": "https://www.consumerfinance.gov/data-research/consumer-complaints/",
        "usaspending": "https://www.usaspending.gov",
        "icij": "https://offshoreleaks.icij.org",
        "fda": "https://www.fda.gov",
        "cpsc": "https://www.cpsc.gov/Recalls",
        "gdelt": "https://www.gdeltproject.org",
        "openfoodfacts": "https://world.openfoodfacts.org",
        "usda_fdc": "https://fdc.nal.usda.gov",
    ]
}
