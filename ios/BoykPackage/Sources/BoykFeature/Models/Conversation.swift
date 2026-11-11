import Foundation

/// One row from get_conversations — a 1:1 thread plus its other participant and
/// last-message preview. Timestamps are kept as String (not Date) so an
/// unexpected format can never throw and blank the whole list.
struct Conversation: Codable, Identifiable {
    let conversationID: UUID
    let otherUserID: UUID
    let otherUsername: String?
    let otherDisplayName: String?
    let otherProfilePictureURL: String?
    let lastMessageContent: String?
    let lastMessageAt: String?
    let lastMessageSenderID: UUID?
    let unreadCount: Int
    let updatedAt: String?

    var id: UUID { conversationID }

    var displayName: String { otherDisplayName ?? otherUsername ?? "User" }

    enum CodingKeys: String, CodingKey {
        case conversationID = "conversation_id"
        case otherUserID = "other_user_id"
        case otherUsername = "other_username"
        case otherDisplayName = "other_display_name"
        case otherProfilePictureURL = "other_profile_picture_url"
        case lastMessageContent = "last_message_content"
        case lastMessageAt = "last_message_at"
        case lastMessageSenderID = "last_message_sender_id"
        case unreadCount = "unread_count"
        case updatedAt = "updated_at"
    }
}

/// One row from get_messages.
struct Message: Codable, Identifiable {
    let id: UUID
    let conversationID: UUID
    let senderID: UUID
    let content: String
    let createdAt: String?
    let readAt: String?
    let senderUsername: String?
    let senderDisplayName: String?
    let senderProfilePictureURL: String?

    enum CodingKeys: String, CodingKey {
        case id
        case conversationID = "conversation_id"
        case senderID = "sender_id"
        case content
        case createdAt = "created_at"
        case readAt = "read_at"
        case senderUsername = "sender_username"
        case senderDisplayName = "sender_display_name"
        case senderProfilePictureURL = "sender_profile_picture_url"
    }
}

/// Short "h:mm a" / "MMM d" label for a message/conversation ISO timestamp.
func shortTimeLabel(_ iso: String?) -> String {
    guard let iso else { return "" }
    let parser = ISO8601DateFormatter()
    parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = parser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    guard let date else { return "" }
    let out = DateFormatter()
    if Calendar.current.isDateInToday(date) {
        out.dateFormat = "h:mm a"
    } else {
        out.dateFormat = "MMM d"
    }
    return out.string(from: date)
}
