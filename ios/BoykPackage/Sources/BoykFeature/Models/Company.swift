import Foundation

struct Company: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let description: String?
    let website: String?
    let logoURL: String?
    let lei: String?
    let wikidataID: String?
    let country: String?
    let industry: String?
    let employees: Int?
    let ticker: String?
    let sanctioned: Bool?
    let brandCount: Int?
    let subsidiaryCount: Int?

    enum CodingKeys: String, CodingKey {
        case id, name, description, website, country, lei, industry, employees, ticker, sanctioned
        case logoURL = "logo_url"
        case wikidataID = "wikidata_id"
        case brandCount = "brand_count"
        case subsidiaryCount = "subsidiary_count"
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: Company, rhs: Company) -> Bool {
        lhs.id == rhs.id
    }
}

/// Shape of GET /api/products/barcode/:barcode. The endpoint returns a product
/// object (no top-level `id`), so decoding it as `Company` always threw. All
/// fields are optional because the brand/company joins use OPTIONAL MATCH.
struct ProductLookup: Codable {
    let barcode: String?
    let name: String?
    let category: String?
    let imageURL: String?
    let brandName: String?
    let brandID: String?
    let companyID: String?
    let companyName: String?
    let companyLogoURL: String?
    /// "openfoodfacts" when the lookup came from the Open Food Facts index,
    /// whose ODbL license requires attribution wherever the data is shown.
    let source: String?

    enum CodingKeys: String, CodingKey {
        case barcode, name, category, source
        case imageURL = "image_url"
        case brandName = "brand_name"
        case brandID = "brand_id"
        case companyID = "company_id"
        case companyName = "company_name"
        case companyLogoURL = "company_logo"
    }
}

struct CompanyWithConnections: Codable {
    let id: String
    let name: String
    let description: String?
    let website: String?
    let logoURL: String?
    let country: String?
    let industry: String?
    let employees: Int?
    let founded: String?
    let ticker: String?
    let stockExchange: String?
    let sanctioned: Bool?
    let aggregateScore: Int?
    let revenue: Double?
    let connections: CompanyConnections?
    let violations: [[String: AnyCodableValue]]?
    let environmentalViolations: [[String: AnyCodableValue]]?
    let esgScores: [[String: AnyCodableValue]]?
    let lobbying: [[String: AnyCodableValue]]?
    let governmentContracts: [[String: AnyCodableValue]]?
    let recalls: [[String: AnyCodableValue]]?
    let offshoreEntities: [[String: AnyCodableValue]]?

    /// Extract just the year from the founded date (which may be a full ISO timestamp)
    var foundedYear: String? {
        guard let founded else { return nil }
        return String(founded.prefix(4))
    }

    enum CodingKeys: String, CodingKey {
        case id, name, description, website, country, industry, employees, founded, ticker, connections
        case logoURL = "logo_url"
        case stockExchange = "stock_exchange"
        case sanctioned
        case aggregateScore = "aggregate_score"
        case revenue
        case violations
        case environmentalViolations = "environmental_violations"
        case esgScores = "esg_scores"
        case lobbying
        case governmentContracts = "government_contracts"
        case recalls
        case offshoreEntities = "offshore_entities"
    }
}

/// Type-erased Codable value for flexible JSON decoding
enum AnyCodableValue: Codable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let v = try? container.decode(Bool.self) { self = .bool(v) }
        else if let v = try? container.decode(Int.self) { self = .int(v) }
        else if let v = try? container.decode(Double.self) { self = .double(v) }
        else if let v = try? container.decode(String.self) { self = .string(v) }
        else { self = .null }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let v): try container.encode(v)
        case .int(let v): try container.encode(v)
        case .double(let v): try container.encode(v)
        case .bool(let v): try container.encode(v)
        case .null: try container.encodeNil()
        }
    }

    var stringValue: String? {
        if case .string(let v) = self { return v }
        return nil
    }

    var intValue: Int? {
        if case .int(let v) = self { return v }
        return nil
    }

    var doubleValue: Double? {
        switch self {
        case .double(let v): return v
        case .int(let v): return Double(v)
        default: return nil
        }
    }
}

struct CompanyConnections: Codable {
    let owns: [ConnectedCompany]?
    let ownedBy: [ConnectedCompany]?
    let suppliers: [ConnectedCompany]?
    let customers: [ConnectedCompany]?
    let brands: [ConnectedCompany]?
    let people: [KeyPerson]?

    enum CodingKeys: String, CodingKey {
        case owns, suppliers, customers, brands, people
        case ownedBy = "owned_by"
    }
}

struct ConnectedCompany: Codable, Identifiable {
    let id: String
    let name: String
    let logoURL: String?
    let ownershipPercentage: Double?
    let sourceCount: Int?
    let connectionID: String?
    let sources: [String]?
    let source: String?
    let confidence: String?
    // The API sends these on connection rows; decoding them is what lets the
    // source tag deep-link to the original record / corroboration count.
    let sourceURL: String?
    let corroboratedBy: [String]?

    enum CodingKeys: String, CodingKey {
        case id, name, sources, source, confidence
        case logoURL = "logo_url"
        case ownershipPercentage = "ownership_percentage"
        case sourceCount = "source_count"
        case connectionID = "connection_id"
        case sourceURL = "source_url"
        case corroboratedBy = "corroborated_by"
    }

    /// All source labels for display (combines `sources` array with singular `source`)
    var allSources: [String] {
        var result = sources ?? []
        if let source, !result.contains(source) {
            result.insert(source, at: 0)
        }
        return result
    }
}

struct GraphData: Codable {
    let nodes: [GraphNode]
    let links: [GraphLink]
}

struct GraphNode: Codable, Identifiable {
    let id: String
    let name: String
    let type: String?
}

struct GraphLink: Codable {
    let source: String
    let target: String
    let type: String?
}
