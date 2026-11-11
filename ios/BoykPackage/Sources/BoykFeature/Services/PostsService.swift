import Foundation
import Supabase

/// Wraps the Supabase RPCs that power the feed (`get_feed`, `get_post`,
/// `create_post`, like / repost / reply, etc.). All mutations are server-
/// authoritative — optimistic UI updates happen in the FeedViewModel, not
/// here. Errors propagate; the view layer decides whether to surface them.
///
/// The feed RPCs return Postgres `JSON` (one big `json_agg(...)`), which
/// supabase-swift decodes as a single JSON value. When the aggregate is
/// empty Postgres emits SQL NULL → supabase-swift decodes to Swift `nil`.
/// The optional unwrap (`?? []`) is what keeps us from throwing on an
/// empty feed.
actor PostsService {
    static let shared = PostsService()

    private init() {}

    // MARK: - Feed

    /// Returns the timeline (posts from followed users + own). `cursor` is the
    /// `created_at` of the last item on the previous page; pass nil for the
    /// first page.
    func getFeed(cursor: Date? = nil, limit: Int = 20) async throws -> [Post] {
        let params = FeedParams(p_cursor: cursor.map { $0.formatted(.iso8601) }, p_limit: limit)
        let response: [Post]? = try await supabase
            .rpc("get_feed", params: params)
            .execute()
            .value
        return response ?? []
    }

    func getUserPosts(userID: UUID, cursor: Date? = nil, limit: Int = 20) async throws -> [Post] {
        let params = UserPostsParams(
            p_user_id: userID.uuidString,
            p_cursor: cursor.map { $0.formatted(.iso8601) },
            p_limit: limit
        )
        let response: [Post]? = try await supabase
            .rpc("get_user_posts", params: params)
            .execute()
            .value
        return response ?? []
    }

    func getPost(id: UUID) async throws -> Post? {
        let response: Post? = try await supabase
            .rpc("get_post", params: ["p_post_id": id.uuidString])
            .execute()
            .value
        return response
    }

    // MARK: - Mutations

    @discardableResult
    func createPost(
        content: String?,
        postType: String = "text",
        boycottID: UUID? = nil,
        originalPostID: UUID? = nil,
        mediaURL: String? = nil,
        mediaType: String? = nil,
        linkURL: String? = nil,
        audience: PostAudience = .everyone
    ) async throws -> UUID {
        let params = CreatePostParams(
            p_content: content,
            p_post_type: postType,
            p_boycott_id: boycottID?.uuidString,
            p_original_post_id: originalPostID?.uuidString,
            p_media_url: mediaURL,
            p_media_type: mediaType,
            p_link_url: linkURL,
            p_audience: audience.rawValue
        )
        let response: UUID = try await supabase
            .rpc("create_post", params: params)
            .execute()
            .value
        return response
    }

    func deletePost(id: UUID) async throws {
        try await supabase
            .rpc("delete_post", params: ["p_post_id": id.uuidString])
            .execute()
    }

    /// Runs a small mutation in a detached task so it survives cancellation of
    /// the calling context. Like/repost taps are fired from view-owned tasks;
    /// if the user navigates before the request lands, plain awaits get
    /// cancelled mid-flight and the optimistic UI is left showing state the
    /// server never recorded.
    private func detachedMutation(_ operation: @escaping @Sendable () async throws -> Void) async throws {
        let task = Task.detached(priority: .userInitiated) {
            try await operation()
        }
        try await task.value
    }

    func likePost(id: UUID) async throws {
        try await detachedMutation {
            try await supabase
                .rpc("like_post", params: ["p_post_id": id.uuidString])
                .execute()
        }
    }

    func unlikePost(id: UUID) async throws {
        try await detachedMutation {
            try await supabase
                .rpc("unlike_post", params: ["p_post_id": id.uuidString])
                .execute()
        }
    }

    func repostPost(id: UUID) async throws {
        try await detachedMutation {
            try await supabase
                .rpc("repost_post", params: ["p_post_id": id.uuidString])
                .execute()
        }
    }

    func unrepostPost(id: UUID) async throws {
        try await detachedMutation {
            try await supabase
                .rpc("unrepost_post", params: ["p_post_id": id.uuidString])
                .execute()
        }
    }

    // MARK: - Replies

    func getReplies(postID: UUID, limit: Int = 200) async throws -> [PostReply] {
        let params = RepliesParams(p_post_id: postID.uuidString, p_limit: limit)
        let response: [PostReply]? = try await supabase
            .rpc("get_post_replies", params: params)
            .execute()
            .value
        return response ?? []
    }

    @discardableResult
    func createReply(postID: UUID, content: String, parentReplyID: UUID? = nil) async throws -> UUID {
        let params = CreateReplyParams(
            p_post_id: postID.uuidString,
            p_content: content,
            p_parent_reply_id: parentReplyID?.uuidString
        )
        let response: UUID = try await supabase
            .rpc("create_reply", params: params)
            .execute()
            .value
        return response
    }

    func likeReply(id: UUID) async throws {
        try await detachedMutation {
            try await supabase
                .rpc("like_reply", params: ["p_reply_id": id.uuidString])
                .execute()
        }
    }

    func unlikeReply(id: UUID) async throws {
        try await detachedMutation {
            try await supabase
                .rpc("unlike_reply", params: ["p_reply_id": id.uuidString])
                .execute()
        }
    }

    // MARK: - Feed Read Status

    func markFeedRead() async throws {
        try await supabase.rpc("mark_feed_read").execute()
    }

    func getFeedUnreadCount() async throws -> Int {
        let count: Int = try await supabase.rpc("get_feed_unread_count").execute().value
        return count
    }

}

// MARK: - Typed params

private struct FeedParams: Encodable {
    let p_cursor: String?
    let p_limit: Int
}

private struct UserPostsParams: Encodable {
    let p_user_id: String
    let p_cursor: String?
    let p_limit: Int
}

private struct CreatePostParams: Encodable {
    let p_content: String?
    let p_post_type: String
    let p_boycott_id: String?
    let p_original_post_id: String?
    let p_media_url: String?
    let p_media_type: String?
    let p_link_url: String?
    let p_audience: String
}

private struct RepliesParams: Encodable {
    let p_post_id: String
    let p_limit: Int
}

private struct CreateReplyParams: Encodable {
    let p_post_id: String
    let p_content: String
    let p_parent_reply_id: String?

    // Encode p_parent_reply_id as an explicit JSON null instead of omitting it.
    // Two overloads of create_reply exist in Postgres (with and without the
    // parent argument); a two-key payload matches both and PostgREST rejects
    // the call as ambiguous ("could not choose the best candidate function").
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(p_post_id, forKey: .p_post_id)
        try container.encode(p_content, forKey: .p_content)
        if let p_parent_reply_id {
            try container.encode(p_parent_reply_id, forKey: .p_parent_reply_id)
        } else {
            try container.encodeNil(forKey: .p_parent_reply_id)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case p_post_id, p_content, p_parent_reply_id
    }
}
