import Foundation

struct FollowRequest: Codable, Identifiable {
    let id: UUID
    let requesterID: UUID
    let requester: RequesterProfile?
    let createdAt: String?

    struct RequesterProfile: Codable {
        let username: String?
        let displayName: String?
        let profilePictureURL: String?

        enum CodingKeys: String, CodingKey {
            case username
            case displayName = "display_name"
            case profilePictureURL = "profile_picture_url"
        }
    }

    enum CodingKeys: String, CodingKey {
        case id
        case requesterID = "requester_id"
        case requester
        case createdAt = "created_at"
    }
}
