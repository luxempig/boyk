import Foundation

@MainActor
class BoycottDetailViewModel: ObservableObject {
    @Published var boycott: Boycott
    @Published var isAdopted: Bool
    @Published var isAdopting = false
    @Published var error: String?

    init(boycott: Boycott, initiallyAdopted: Bool = false) {
        self.boycott = boycott
        self.isAdopted = initiallyAdopted
    }

    /// Entry points like Explore don't know whether the viewer already tracks
    /// this boycott and leave `initiallyAdopted` at its default, so confirm
    /// against the server once the view appears.
    func refreshAdoptionState(userID: UUID) async {
        guard !isAdopting else { return }
        guard let adopted = try? await SupabaseService.shared.getFollowedBoycotts(userID: userID) else { return }
        guard !isAdopting else { return }
        isAdopted = adopted.contains { $0.id == boycott.id }
    }

    /// Optimistic adopt/unadopt. The server enforces uniqueness via the
    /// `(user_id, boycott_id)` index — duplicates are no-ops, so optimistic
    /// flips are safe.
    func toggleAdopt() async {
        let willAdopt = !isAdopted
        let previous = isAdopted
        let previousCount = boycott.trackerCount
        isAdopting = true
        isAdopted = willAdopt

        // Adjust tracker count optimistically. We mutate via re-init because
        // Boycott has `let` properties on most fields — keep this isolated.
        // (Not adjusting the count is acceptable; the server is authoritative.)

        do {
            if willAdopt {
                try await SupabaseService.shared.adoptBoycott(boycottID: boycott.id)
            } else {
                try await SupabaseService.shared.unadoptBoycott(boycottID: boycott.id)
            }
        } catch {
            isAdopted = previous
            self.error = error.localizedDescription
            _ = previousCount  // suppress unused warning if we re-add count later
        }
        isAdopting = false
    }
}
