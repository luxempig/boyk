import Foundation

/// Conversation list (the Messages inbox).
@MainActor
final class MessagesViewModel: ObservableObject {
    @Published var conversations: [Conversation] = []
    @Published var isLoading = false
    @Published var error: String?

    var totalUnread: Int { conversations.reduce(0) { $0 + $1.unreadCount } }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            conversations = try await SupabaseService.shared.getConversations()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// A single 1:1 chat thread.
@MainActor
final class ChatViewModel: ObservableObject {
    @Published var messages: [Message] = []   // oldest → newest for display
    @Published var draft: String = ""
    @Published var isLoading = false
    @Published var isSending = false
    @Published var error: String?

    let conversationID: UUID
    let currentUserID: UUID

    /// Mirrors the server's 2000-char message cap (send_message).
    static let maxLength = 2000

    var canSend: Bool {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && trimmed.count <= Self.maxLength && !isSending
    }

    init(conversationID: UUID, currentUserID: UUID) {
        self.conversationID = conversationID
        self.currentUserID = currentUserID
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            // RPC returns newest-first; reverse so the thread reads top→bottom.
            let fetched = try await SupabaseService.shared.getMessages(conversationID: conversationID)
            messages = fetched.reversed()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func send() async {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= Self.maxLength else { return }
        isSending = true
        draft = ""
        do {
            try await SupabaseService.shared.sendMessage(conversationID: conversationID, content: trimmed)
            await load()
        } catch {
            self.error = error.localizedDescription
            draft = trimmed   // restore so the user doesn't lose their text
        }
        isSending = false
    }
}
