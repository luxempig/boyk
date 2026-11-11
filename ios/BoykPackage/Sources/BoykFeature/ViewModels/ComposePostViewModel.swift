import Foundation

@MainActor
class ComposePostViewModel: ObservableObject {
    @Published var content: String = ""
    @Published var audience: PostAudience = .everyone
    @Published var boycottID: UUID?
    @Published var isSubmitting = false
    @Published var error: String?

    /// Mirrors the server's `char_length(p_content) > 300` check. Surfacing
    /// the limit client-side gives the user real-time feedback; the server
    /// keeps the authoritative validation.
    static let maxLength = 300

    var trimmed: String {
        content.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var charactersRemaining: Int {
        Self.maxLength - content.count
    }

    var canSubmit: Bool {
        !isSubmitting && !trimmed.isEmpty && content.count <= Self.maxLength
    }

    /// The current user's boycotts, for the "attach a boycott" picker.
    @Published var myBoycotts: [Boycott] = []

    var selectedBoycott: Boycott? {
        guard let boycottID else { return nil }
        return myBoycotts.first { $0.id == boycottID }
    }

    func loadBoycotts(userID: UUID) async {
        myBoycotts = (try? await SupabaseService.shared.getMyBoycotts(userID: userID)) ?? []
    }

    /// Returns the newly created post on success — the parent prepends it to
    /// the feed for instant UI. Returns nil if creation failed; `error` will
    /// be populated.
    func submit() async -> Post? {
        guard canSubmit else { return nil }
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let postType = boycottID != nil ? "boycott_share" : "text"
            let newID = try await PostsService.shared.createPost(
                content: trimmed,
                postType: postType,
                boycottID: boycottID,
                audience: audience
            )
            // Fetch the freshly-created row so the feed prepends real (not optimistic) data.
            return try await PostsService.shared.getPost(id: newID)
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }
}
