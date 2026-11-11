import Foundation

/// Mirrors the JSON row returned by Supabase RPCs `get_feed`, `get_post`, and
/// `get_user_posts`. The server-side RPCs build each row via `row_to_json(t)`
/// over a SELECT that joins posts → profiles (author) → boycotts (optional),
/// so every field is snake_case at the wire and remapped via CodingKeys here.
///
/// Mutating fields (`likedByMe`, `likeCount`, `repostCount`, `replyCount`,
/// `repostedByMe`) are `var` so the FeedViewModel can apply optimistic
/// updates in-place without rebuilding the whole struct.
struct Post: Codable, Identifiable, Sendable, Equatable, Hashable {
    static func == (lhs: Post, rhs: Post) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    let id: UUID
    let authorID: UUID
    let postType: String
    let content: String?
    let boycottID: UUID?
    let originalPostID: UUID?
    let mediaURL: String?
    let mediaType: String?
    let linkURL: String?
    let createdAt: Date?
    let author: PostAuthor?
    let boycott: PostBoycottRef?
    let originalPost: OriginalPost?
    let audience: String?

    var likeCount: Int
    var replyCount: Int
    var repostCount: Int
    var likedByMe: Bool
    var repostedByMe: Bool

    var isRepost: Bool {
        postType == "repost" || postType == "boycott_repost"
    }

    /// For reposts the engagement and content live on the original post; this
    /// helper makes that transparent to call sites.
    var displayPost: Post {
        if isRepost, let original = originalPost?.asPost(authorOverride: nil) {
            return original
        }
        return self
    }

    enum CodingKeys: String, CodingKey {
        case id, content, author, boycott, audience
        case authorID = "author_id"
        case postType = "post_type"
        case boycottID = "boycott_id"
        case originalPostID = "original_post_id"
        case mediaURL = "media_url"
        case mediaType = "media_type"
        case linkURL = "link_url"
        case createdAt = "created_at"
        case originalPost = "original_post"
        case likeCount = "like_count"
        case replyCount = "reply_count"
        case repostCount = "repost_count"
        case likedByMe = "liked_by_me"
        case repostedByMe = "reposted_by_me"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decode(UUID.self, forKey: .id)
        self.authorID = try c.decode(UUID.self, forKey: .authorID)
        self.postType = try c.decodeIfPresent(String.self, forKey: .postType) ?? "text"
        self.content = try c.decodeIfPresent(String.self, forKey: .content)
        self.boycottID = try c.decodeIfPresent(UUID.self, forKey: .boycottID)
        self.originalPostID = try c.decodeIfPresent(UUID.self, forKey: .originalPostID)
        self.mediaURL = try c.decodeIfPresent(String.self, forKey: .mediaURL)
        self.mediaType = try c.decodeIfPresent(String.self, forKey: .mediaType)
        self.linkURL = try c.decodeIfPresent(String.self, forKey: .linkURL)
        self.createdAt = try? c.decodeIfPresent(Date.self, forKey: .createdAt)
        self.author = try c.decodeIfPresent(PostAuthor.self, forKey: .author)
        self.boycott = try c.decodeIfPresent(PostBoycottRef.self, forKey: .boycott)
        self.originalPost = try c.decodeIfPresent(OriginalPost.self, forKey: .originalPost)
        self.audience = try c.decodeIfPresent(String.self, forKey: .audience)
        self.likeCount = try c.decodeIfPresent(Int.self, forKey: .likeCount) ?? 0
        self.replyCount = try c.decodeIfPresent(Int.self, forKey: .replyCount) ?? 0
        self.repostCount = try c.decodeIfPresent(Int.self, forKey: .repostCount) ?? 0
        self.likedByMe = try c.decodeIfPresent(Bool.self, forKey: .likedByMe) ?? false
        self.repostedByMe = try c.decodeIfPresent(Bool.self, forKey: .repostedByMe) ?? false
    }
}

struct PostAuthor: Codable, Sendable, Equatable {
    let id: UUID?
    let username: String?
    let displayName: String?
    let profilePictureURL: String?

    var nameForDisplay: String {
        if let d = displayName, !d.isEmpty { return d }
        if let u = username, !u.isEmpty { return u }
        return "User"
    }

    enum CodingKeys: String, CodingKey {
        case id, username
        case displayName = "display_name"
        case profilePictureURL = "profile_picture_url"
    }
}

struct PostBoycottRef: Codable, Sendable, Equatable {
    let id: UUID?
    let name: String?
    let description: String?
    let creatorID: UUID?

    enum CodingKeys: String, CodingKey {
        case id, name, description
        case creatorID = "creator_id"
    }
}

/// Nested original post on a repost row. Server only sends a subset of fields
/// here (no engagement counts), so we model it loosely and project back to a
/// full Post via `asPost(authorOverride:)` for unified rendering.
struct OriginalPost: Codable, Sendable, Equatable {
    let id: UUID
    let authorID: UUID
    let content: String?
    let mediaURL: String?
    let mediaType: String?
    let linkURL: String?
    let createdAt: Date?
    let author: PostAuthor?
    let boycott: PostBoycottRef?

    enum CodingKeys: String, CodingKey {
        case id, content, author, boycott
        case authorID = "author_id"
        case mediaURL = "media_url"
        case mediaType = "media_type"
        case linkURL = "link_url"
        case createdAt = "created_at"
    }

    /// Hydrate this nested original into a full Post for shared rendering.
    /// Counts stay zero because the server doesn't include them on the nested
    /// payload; the engagement bar in the UI should always read from the
    /// outer (repost) row.
    func asPost(authorOverride: PostAuthor?) -> Post? {
        let json: [String: Any] = [
            "id": id.uuidString,
            "author_id": authorID.uuidString,
            "post_type": "text",
            "content": content as Any,
            "media_url": mediaURL as Any,
            "media_type": mediaType as Any,
            "link_url": linkURL as Any,
            "created_at": (createdAt.map { ISO8601DateFormatter().string(from: $0) }) as Any,
            "author": (authorOverride ?? author).flatMap { authorDict($0) } as Any,
            "boycott": boycott.flatMap { boycottDict($0) } as Any,
            "like_count": 0,
            "reply_count": 0,
            "repost_count": 0,
            "liked_by_me": false,
            "reposted_by_me": false,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: json) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(Post.self, from: data)
    }

    private func authorDict(_ a: PostAuthor) -> [String: Any] {
        [
            "id": (a.id?.uuidString) as Any,
            "username": a.username as Any,
            "display_name": a.displayName as Any,
            "profile_picture_url": a.profilePictureURL as Any,
        ]
    }

    private func boycottDict(_ b: PostBoycottRef) -> [String: Any] {
        [
            "id": (b.id?.uuidString) as Any,
            "name": b.name as Any,
            "description": b.description as Any,
            "creator_id": (b.creatorID?.uuidString) as Any,
        ]
    }
}

struct PostReply: Codable, Identifiable, Sendable, Equatable {
    let id: UUID
    let postID: UUID
    let authorID: UUID
    let content: String
    let createdAt: Date?
    let author: PostAuthor?
    var likeCount: Int
    var likedByMe: Bool

    enum CodingKeys: String, CodingKey {
        case id, content, author
        case postID = "post_id"
        case authorID = "author_id"
        case createdAt = "created_at"
        case likeCount = "like_count"
        case likedByMe = "liked_by_me"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decode(UUID.self, forKey: .id)
        self.postID = try c.decode(UUID.self, forKey: .postID)
        self.authorID = try c.decode(UUID.self, forKey: .authorID)
        self.content = try c.decode(String.self, forKey: .content)
        self.createdAt = try? c.decodeIfPresent(Date.self, forKey: .createdAt)
        self.author = try c.decodeIfPresent(PostAuthor.self, forKey: .author)
        self.likeCount = try c.decodeIfPresent(Int.self, forKey: .likeCount) ?? 0
        self.likedByMe = try c.decodeIfPresent(Bool.self, forKey: .likedByMe) ?? false
    }
}

/// Post audience visibility. Mirrors the `audience` enum on the posts table.
enum PostAudience: String, CaseIterable, Sendable {
    case everyone
    case followers
    case onlyMe = "only_me"

    var label: String {
        switch self {
        case .everyone: return "Everyone"
        case .followers: return "Followers"
        case .onlyMe: return "Only me"
        }
    }

    var systemImage: String {
        switch self {
        case .everyone: return "globe"
        case .followers: return "person.2.fill"
        case .onlyMe: return "lock.fill"
        }
    }
}
