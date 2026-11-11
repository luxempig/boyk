import Foundation
import Supabase

actor SupabaseService {
    static let shared = SupabaseService()

    private init() {}

    // MARK: - Profile

    func getProfile(userID: UUID) async throws -> UserProfile? {
        let response: [UserProfile] = try await supabase
            .rpc("get_profile", params: ["p_user_id": userID.uuidString])
            .execute()
            .value
        return response.first
    }

    func updateProfile(username: String, displayName: String?, bio: String?, pictureURL: String?) async throws {
        try await supabase
            .rpc("update_full_profile", params: [
                "p_username": username,
                "p_display_name": displayName ?? "",
                "p_bio": bio ?? "",
                "p_profile_picture_url": pictureURL ?? "",
            ])
            .execute()
    }

    // MARK: - Boycotts

    func getMyBoycotts(userID: UUID) async throws -> [Boycott] {
        let response: [Boycott] = try await supabase
            .rpc("get_my_boycotts", params: ["p_user_id": userID.uuidString])
            .execute()
            .value
        return response
    }

    func getFollowedBoycotts(userID: UUID) async throws -> [Boycott] {
        let response: [Boycott] = try await supabase
            .rpc("get_followed_boycotts", params: ["p_user_id": userID.uuidString])
            .execute()
            .value
        return response
    }

    func getPublicBoycotts() async throws -> [Boycott] {
        let response: [Boycott] = try await supabase
            .rpc("get_public_boycotts")
            .execute()
            .value
        return response
    }

    // MARK: - Follow

    func getFollowerCount(userID: UUID) async throws -> Int {
        let count: Int = try await supabase
            .rpc("get_follower_count", params: ["p_user_id": userID.uuidString])
            .execute()
            .value
        return count
    }

    func getFollowingCount(userID: UUID) async throws -> Int {
        let count: Int = try await supabase
            .rpc("get_following_count", params: ["p_user_id": userID.uuidString])
            .execute()
            .value
        return count
    }

    // MARK: - Follow Requests

    func getIncomingFollowRequests(userID: UUID) async throws -> [FollowRequest] {
        // The RPC is a stub that can emit a `[null]` row. Decoding that directly
        // into [FollowRequest] throws (valueNotFound) and, because Home loads all
        // its data as one atomic tuple, would blank the entire screen. Decode the
        // elements as optional and drop nulls so a stub row degrades gracefully.
        let response: [FollowRequest?] = try await supabase
            .rpc("get_incoming_follow_requests", params: ["p_user_id": userID.uuidString])
            .execute()
            .value
        return response.compactMap { $0 }
    }

    func acceptFollowRequest(requesterID: UUID) async throws {
        try await supabase
            .rpc("accept_follow_request", params: ["p_requester_id": requesterID.uuidString])
            .execute()
    }

    func rejectFollowRequest(requesterID: UUID) async throws {
        try await supabase
            .rpc("reject_follow_request", params: ["p_requester_id": requesterID.uuidString])
            .execute()
    }

    // Direct follow model (matches the web client). The *_follow_request RPCs
    // are stubs; follow_user/unfollow_user are the real ones.
    func followUser(targetID: UUID) async throws {
        try await supabase
            .rpc("follow_user", params: ["p_following_id": targetID.uuidString])
            .execute()
    }

    func unfollowUser(targetID: UUID) async throws {
        try await supabase
            .rpc("unfollow_user", params: ["p_following_id": targetID.uuidString])
            .execute()
    }

    // MARK: - Followers & Following

    func getFollowers(userID: UUID) async throws -> [UserProfile] {
        let response: [UserProfile] = try await supabase
            .rpc("get_followers", params: ["p_user_id": userID.uuidString])
            .execute()
            .value
        return response
    }

    func getFollowing(userID: UUID) async throws -> [UserProfile] {
        let response: [UserProfile] = try await supabase
            .rpc("get_following_with_profiles", params: ["p_user_id": userID.uuidString])
            .execute()
            .value
        return response
    }

    // MARK: - Profile Picture

    /// Uploads an avatar to R2 and returns its public URL.
    ///
    /// Goes through the `upload-url` edge function rather than Supabase Storage —
    /// this project provisions no storage buckets, so the previous
    /// `storage.from("profile-pictures")` call failed at runtime every time.
    /// The uploading user is derived server-side from the session JWT.
    func uploadProfilePicture(data: Data) async throws -> String {
        try await MediaUploadService.shared.upload(
            imageData: data,
            fileName: "avatar.jpg",
            contentType: "image/jpeg",
            purpose: .profile
        )
    }

    // MARK: - Boycott Adoption

    func adoptBoycott(boycottID: UUID) async throws {
        try await supabase
            .rpc("adopt_boycott", params: ["p_boycott_id": boycottID.uuidString])
            .execute()
    }

    func unadoptBoycott(boycottID: UUID) async throws {
        try await supabase
            .rpc("unadopt_boycott", params: ["p_boycott_id": boycottID.uuidString])
            .execute()
    }

    // MARK: - Boycott Reports

    func reportBoycott(
        boycottID: UUID,
        reason: BoycottReportReason,
        details: String?
    ) async throws {
        let trimmed = details?.trimmingCharacters(in: .whitespacesAndNewlines)
        let params = ReportBoycottParams(
            p_boycott_id: boycottID.uuidString,
            p_reason: reason.rawValue,
            p_details: (trimmed?.isEmpty ?? true) ? nil : trimmed
        )
        try await supabase.rpc("report_boycott", params: params).execute()
    }

    // MARK: - Content Reports

    func reportContent(
        type: ReportableContentType,
        id: UUID,
        reason: BoycottReportReason,
        details: String?
    ) async throws {
        let trimmed = details?.trimmingCharacters(in: .whitespacesAndNewlines)
        let params = ReportContentParams(
            p_content_type: type.rawValue,
            p_content_id: id.uuidString,
            p_reason: reason.rawValue,
            p_details: (trimmed?.isEmpty ?? true) ? nil : trimmed
        )
        try await supabase.rpc("report_content", params: params).execute()
    }

    // MARK: - User Blocking

    func blockUser(userID: UUID) async throws {
        try await supabase
            .rpc("block_user", params: ["p_user_id": userID.uuidString])
            .execute()
    }

    func unblockUser(userID: UUID) async throws {
        try await supabase
            .rpc("unblock_user", params: ["p_user_id": userID.uuidString])
            .execute()
    }

    func isBlocked(userID: UUID) async throws -> Bool {
        let blocked: Bool = try await supabase
            .rpc("is_blocked", params: ["p_user_id": userID.uuidString])
            .execute()
            .value
        return blocked
    }

    func getBlockedUsers() async throws -> [UserProfile] {
        let response: [UserProfile] = try await supabase
            .rpc("get_blocked_users")
            .execute()
            .value
        return response
    }

    // MARK: - Users

    func searchUsers(query: String, limit: Int = 20) async throws -> [UserProfile] {
        let params = SearchUsersParams(p_query: query, p_limit: limit)
        let response: [UserProfile] = try await supabase
            .rpc("search_users", params: params)
            .execute()
            .value
        return response
    }

    func getUsersByFollowers() async throws -> [UserProfile] {
        let response: [UserProfile] = try await supabase
            .rpc("get_users_by_followers")
            .execute()
            .value
        return response
    }

    // MARK: - Boycott Management (create / edit / delete)

    /// Creates a boycott and returns its new id. Mirrors the web create_boycott
    /// RPC, which returns a jsonb object containing the generated id.
    func createBoycott(
        name: String,
        description: String,
        isPublic: Bool,
        sourceLinks: [String] = []
    ) async throws -> UUID {
        let params = CreateBoycottParams(
            p_name: name,
            p_description: description,
            p_is_public: isPublic,
            p_source_links: sourceLinks
        )
        let created: CreatedBoycott = try await supabase
            .rpc("create_boycott", params: params)
            .execute()
            .value
        return created.id
    }

    func updateBoycott(
        boycottID: UUID,
        name: String,
        description: String,
        isPublic: Bool
    ) async throws {
        let params = UpdateBoycottParams(
            p_boycott_id: boycottID.uuidString,
            p_name: name,
            p_description: description,
            p_is_public: isPublic,
            p_source_links: nil
        )
        try await supabase.rpc("update_boycott", params: params).execute()
    }

    func deleteBoycott(boycottID: UUID) async throws {
        try await supabase
            .rpc("delete_boycott", params: ["p_boycott_id": boycottID.uuidString])
            .execute()
    }

    /// Adds a seed company with its five block-type flags. companyID is the Neo4j
    /// node id (LEI / Wikidata id), passed as a string like the web client.
    func addCompanyToBoycott(
        boycottID: UUID,
        companyID: String,
        companyName: String?,
        companyLogoURL: String?,
        blocks: BlockSelection
    ) async throws {
        let params = AddCompanyParams(
            p_boycott_id: boycottID.uuidString,
            p_company_id: companyID,
            p_company_name: companyName,
            p_company_logo_url: companyLogoURL,
            p_block_owns: blocks.subsidiaries,
            p_block_owned_by: blocks.parents,
            p_block_suppliers: blocks.suppliers,
            p_block_brands: blocks.brands,
            p_block_customers: blocks.customers
        )
        try await supabase.rpc("add_company_to_boycott", params: params).execute()
    }

    func updateBoycottCompany(
        boycottID: UUID,
        companyID: String,
        blocks: BlockSelection
    ) async throws {
        let params = UpdateCompanyParams(
            p_boycott_id: boycottID.uuidString,
            p_company_id: companyID,
            p_block_owns: blocks.subsidiaries,
            p_block_owned_by: blocks.parents,
            p_block_suppliers: blocks.suppliers,
            p_block_brands: blocks.brands,
            p_block_customers: blocks.customers
        )
        try await supabase.rpc("update_boycott_company", params: params).execute()
    }

    func removeCompanyFromBoycott(boycottID: UUID, companyID: String) async throws {
        let params = RemoveCompanyParams(
            p_boycott_id: boycottID.uuidString,
            p_company_id: companyID
        )
        try await supabase.rpc("remove_company_from_boycott", params: params).execute()
    }

    // MARK: - Direct Messages

    func getConversations() async throws -> [Conversation] {
        try await supabase.rpc("get_conversations").execute().value
    }

    /// Returns the existing 1:1 conversation id with another user, creating it
    /// if needed. Used to open a chat from a profile's Message button.
    func getOrCreateConversation(otherUserID: UUID) async throws -> UUID {
        try await supabase
            .rpc("get_or_create_conversation", params: ["p_other_user_id": otherUserID.uuidString])
            .execute()
            .value
    }

    /// Fetches a conversation's messages (newest-first from the RPC) and marks
    /// the other party's messages as read as a side effect.
    func getMessages(conversationID: UUID, limit: Int = 50) async throws -> [Message] {
        let params = GetMessagesParams(p_conversation_id: conversationID.uuidString, p_limit: limit)
        return try await supabase.rpc("get_messages", params: params).execute().value
    }

    @discardableResult
    func sendMessage(conversationID: UUID, content: String) async throws -> UUID {
        let params = SendMessageParams(p_conversation_id: conversationID.uuidString, p_content: content)
        return try await supabase.rpc("send_message", params: params).execute().value
    }
}

// Typed params struct for RPC calls with mixed types
private struct SearchUsersParams: Encodable {
    let p_query: String
    let p_limit: Int
}

private struct ReportBoycottParams: Encodable {
    let p_boycott_id: String
    let p_reason: String
    let p_details: String?
}

private struct ReportContentParams: Encodable {
    let p_content_type: String
    let p_content_id: String
    let p_reason: String
    let p_details: String?
}

/// The five proxy-block flags carried by every seed company in a boycott.
/// Names map to the RPC params: subsidiaries→block_owns, parents→block_owned_by.
struct BlockSelection: Equatable {
    var subsidiaries = false
    var parents = false
    var suppliers = false
    var brands = false
    var customers = false
}

private struct CreatedBoycott: Decodable {
    let id: UUID
}

private struct CreateBoycottParams: Encodable {
    let p_name: String
    let p_description: String
    let p_is_public: Bool
    let p_source_links: [String]
}

private struct UpdateBoycottParams: Encodable {
    let p_boycott_id: String
    let p_name: String
    let p_description: String
    let p_is_public: Bool
    let p_source_links: [String]?
}

private struct AddCompanyParams: Encodable {
    let p_boycott_id: String
    let p_company_id: String
    let p_company_name: String?
    let p_company_logo_url: String?
    let p_block_owns: Bool
    let p_block_owned_by: Bool
    let p_block_suppliers: Bool
    let p_block_brands: Bool
    let p_block_customers: Bool
}

private struct UpdateCompanyParams: Encodable {
    let p_boycott_id: String
    let p_company_id: String
    let p_block_owns: Bool
    let p_block_owned_by: Bool
    let p_block_suppliers: Bool
    let p_block_brands: Bool
    let p_block_customers: Bool
}

private struct RemoveCompanyParams: Encodable {
    let p_boycott_id: String
    let p_company_id: String
}

private struct GetMessagesParams: Encodable {
    let p_conversation_id: String
    let p_limit: Int
}

private struct SendMessageParams: Encodable {
    let p_conversation_id: String
    let p_content: String
}
