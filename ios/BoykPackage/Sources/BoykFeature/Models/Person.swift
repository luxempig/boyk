import Foundation

/// Wikidata-sourced person (CEOs, founders, board members). Returned by
/// `/api/persons/:id` and shown inline on Company detail.
public struct Person: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String?
    public let description: String?
    public let imageURL: String?
    public let dateOfBirth: String?
    public let nationality: String?
    public let countryOfResidence: String?
    public let companies: [PersonCompanyLink]?

    enum CodingKeys: String, CodingKey {
        case id, name, description, nationality, companies
        case imageURL = "image_url"
        case dateOfBirth = "date_of_birth"
        case countryOfResidence = "country_of_residence"
    }
}

public struct PersonCompanyLink: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String?
    public let logoURL: String?
    public let role: String?

    enum CodingKeys: String, CodingKey {
        case id, name, role
        case logoURL = "logo_url"
    }

    public var displayRole: String {
        switch role {
        case "CEO_OF": return "CEO"
        case "FOUNDED": return "Founder"
        case "BOARD_MEMBER_OF": return "Board Member"
        case "COMPENSATED_BY": return "Compensated By"
        case "SIGNIFICANT_CONTROL": return "Significant Control"
        default: return role ?? "Affiliated"
        }
    }
}

/// Inline reference used inside CompanyWithConnections.people — the API returns
/// this same shape as a flattened person + rel block.
public struct KeyPerson: Codable, Identifiable, Hashable, Sendable {
    public let wikidataID: String
    public let name: String?
    public let imageURL: String?
    public let nationality: String?
    public let countryOfResidence: String?
    public let rel: KeyPersonRel?

    public var id: String { wikidataID }

    enum CodingKeys: String, CodingKey {
        case id
        case wikidataID = "wikidata_id"
        case name, nationality, rel
        case imageURL = "image_url"
        case countryOfResidence = "country_of_residence"
    }

    // The company `people` endpoint sends the person identity under `id`; other
    // contexts use `wikidata_id`. Accept either (with a fallback) so a missing
    // key never throws and aborts the whole company-detail decode.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let idValue = try c.decodeIfPresent(String.self, forKey: .id)
        let legacyValue = try c.decodeIfPresent(String.self, forKey: .wikidataID)
        wikidataID = idValue ?? legacyValue ?? UUID().uuidString
        name = try c.decodeIfPresent(String.self, forKey: .name)
        imageURL = try c.decodeIfPresent(String.self, forKey: .imageURL)
        nationality = try c.decodeIfPresent(String.self, forKey: .nationality)
        countryOfResidence = try c.decodeIfPresent(String.self, forKey: .countryOfResidence)
        rel = try c.decodeIfPresent(KeyPersonRel.self, forKey: .rel)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(wikidataID, forKey: .wikidataID)
        try c.encodeIfPresent(name, forKey: .name)
        try c.encodeIfPresent(imageURL, forKey: .imageURL)
        try c.encodeIfPresent(nationality, forKey: .nationality)
        try c.encodeIfPresent(countryOfResidence, forKey: .countryOfResidence)
        try c.encodeIfPresent(rel, forKey: .rel)
    }

    public var displayRole: String {
        rel?.displayRole ?? "Key Person"
    }
}

public struct KeyPersonRel: Codable, Hashable, Sendable {
    public let type: String?
    public let role: String?

    public var displayRole: String {
        let raw = role ?? type ?? ""
        switch raw {
        case "CEO_OF": return "CEO"
        case "FOUNDED": return "Founder"
        case "BOARD_MEMBER_OF": return "Board Member"
        case "COMPENSATED_BY": return "Compensated By"
        case "SIGNIFICANT_CONTROL": return "Significant Control"
        default: return raw.isEmpty ? "Key Person" : raw
        }
    }
}
