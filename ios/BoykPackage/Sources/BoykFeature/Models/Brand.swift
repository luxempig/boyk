import Foundation

struct BrandDetail: Codable {
    let id: String
    let name: String
    let description: String?
    let logoURL: String?
    let wikidataID: String?
    let company: BrandOwner?
    let products: [BrandProduct]

    enum CodingKeys: String, CodingKey {
        case id, name, description, company, products
        case logoURL = "logo_url"
        case wikidataID = "wikidata_id"
    }
}

struct BrandOwner: Codable {
    let id: String
    let name: String
    let logoURL: String?
    let source: String?
    let confidence: String?
    let sourceURL: String?

    enum CodingKeys: String, CodingKey {
        case id, name, source, confidence
        case logoURL = "logo_url"
        case sourceURL = "source_url"
    }
}

struct BrandProduct: Codable, Identifiable {
    let barcode: String
    let name: String?
    let category: String?
    let imageURL: String?

    var id: String { barcode }

    enum CodingKeys: String, CodingKey {
        case barcode, name, category
        case imageURL = "image_url"
    }
}
