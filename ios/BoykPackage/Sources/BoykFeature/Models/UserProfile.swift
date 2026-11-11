import Foundation

struct UserProfile: Codable, Identifiable {
    let id: UUID
    let username: String?
    let displayName: String?
    let bio: String?
    let profilePictureURL: String?
    let followerCount: Int?
    // Kept as String (not Date) so an unexpected timestamp format can never throw
    // and blank the profile — it just yields no join label.
    let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id, username, bio
        case displayName = "display_name"
        case profilePictureURL = "profile_picture_url"
        case followerCount = "follower_count"
        case createdAt = "created_at"
    }

    /// "Joined June 2026" — nil when the timestamp is absent or unparseable.
    var joinedLabel: String? {
        guard let createdAt else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = iso.date(from: createdAt)
            ?? ISO8601DateFormatter().date(from: createdAt)
            ?? {
                // Postgres "2026-01-15 21:55:06.06+00" style fallback.
                let f = DateFormatter()
                f.dateFormat = "yyyy-MM-dd HH:mm:ssZ"
                return f.date(from: String(createdAt.prefix(19)) + "+0000")
            }()
        guard let date else { return nil }
        let out = DateFormatter()
        out.dateFormat = "MMMM yyyy"
        return "Joined \(out.string(from: date))"
    }
}

struct DBStats: Codable {
    let companies: Int?
    let brands: Int?
    let products: Int?
    let persons: Int?

    // /api/stats returns capitalized singular keys (Company/Brand/Product/Person);
    // without this mapping every field decoded to nil and the stats banner never
    // rendered.
    enum CodingKeys: String, CodingKey {
        case companies = "Company"
        case brands = "Brand"
        case products = "Product"
        case persons = "Person"
    }
}
