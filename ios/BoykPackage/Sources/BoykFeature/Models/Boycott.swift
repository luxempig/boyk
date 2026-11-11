import Foundation

struct Boycott: Codable, Identifiable {
    let id: UUID
    let name: String
    let description: String?
    let isPublic: Bool
    let creatorID: UUID
    let createdAt: Date?
    let trackerCount: Int?
    let boycottCompanies: [BoycottCompanyEntry]?
    var profiles: UserProfile?

    enum CodingKeys: String, CodingKey {
        case id, name, description, profiles
        case isPublic = "is_public"
        case creatorID = "creator_id"
        case createdAt = "created_at"
        case trackerCount = "tracker_count"
        case boycottCompanies = "boycott_companies"
    }
}

struct BoycottCompanyEntry: Codable, Identifiable {
    let id: UUID?
    let companies: BoycottCompanyRef?
    let blockOwns: Bool?
    let blockOwnedBy: Bool?
    let blockSuppliers: Bool?
    let blockBrands: Bool?
    let blockCustomers: Bool?

    enum CodingKeys: String, CodingKey {
        case id, companies
        case blockOwns = "block_owns"
        case blockOwnedBy = "block_owned_by"
        case blockSuppliers = "block_suppliers"
        case blockBrands = "block_brands"
        case blockCustomers = "block_customers"
    }
}

struct BoycottCompanyRef: Codable, Identifiable {
    let id: String
    let name: String
    let logoURL: String?
    // The id above is the Supabase UUID; lei/wikidataQID are the Neo4j keys the
    // RPCs also emit. Conflict matching needs these to compare against Neo4j
    // node ids (a UUID can never equal a LEI/Wikidata id).
    let lei: String?
    let wikidataQID: String?

    enum CodingKeys: String, CodingKey {
        case id, name, lei
        case logoURL = "logo_url"
        case wikidataQID = "wikidata_qid"
    }
}
