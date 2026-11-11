import Foundation

@MainActor
class ExploreViewModel: ObservableObject {
    enum SearchMode: String, CaseIterable {
        case boycotts = "Boycotts"
        case companies = "Companies"
        case users = "Users"
    }

    enum ViewState {
        case idle
        case loading
        case loaded
        case error(String)
    }

    @Published var searchMode: SearchMode = .boycotts
    @Published var searchQuery: String = ""
    @Published var boycotts: [Boycott] = []
    @Published var companies: [Company] = []
    @Published var users: [UserProfile] = []
    @Published var state: ViewState = .idle
    @Published var dbStats: DBStats?

    private var searchTask: Task<Void, Never>?
    private var allBoycotts: [Boycott] = []

    func load() async {
        state = .loading
        // Stats come from the Neo4j API, which can be cold or unreachable while the
        // Supabase lists are fine — a stats failure must never blank the whole tab.
        async let stats = Neo4jService.shared.getStats()
        do {
            async let publicBoycotts = SupabaseService.shared.getPublicBoycotts()
            async let allUsers = SupabaseService.shared.getUsersByFollowers()

            let (boycottsResult, usersResult) = try await (publicBoycotts, allUsers)
            // Most-followed first, so the "most followed" subtitle is truthful.
            let sorted = boycottsResult.sorted { ($0.trackerCount ?? 0) > ($1.trackerCount ?? 0) }
            allBoycotts = sorted
            boycotts = sorted
            users = usersResult
            state = .loaded
        } catch {
            state = .error(error.localizedDescription)
        }
        dbStats = try? await stats
    }

    func search() {
        searchTask?.cancel()

        guard searchQuery.count >= 2 else {
            boycotts = allBoycotts
            companies = []
            Task { await load() }
            return
        }

        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }

            state = .loading

            do {
                switch searchMode {
                case .boycotts:
                    let query = searchQuery.lowercased()
                    boycotts = allBoycotts.filter { b in
                        b.name.lowercased().contains(query) ||
                        (b.description?.lowercased().contains(query) ?? false) ||
                        (b.profiles?.username?.lowercased().contains(query) ?? false)
                    }
                case .companies:
                    let results = try await Neo4jService.shared.searchCompanies(query: searchQuery)
                    guard !Task.isCancelled else { return }
                    companies = results
                case .users:
                    let results = try await SupabaseService.shared.searchUsers(query: searchQuery)
                    guard !Task.isCancelled else { return }
                    users = results
                }
                state = .loaded
            } catch {
                guard !Task.isCancelled else { return }
                state = .error(error.localizedDescription)
            }
        }
    }

    var filteredBoycotts: [Boycott] {
        guard searchMode == .boycotts, searchQuery.count >= 2 else { return boycotts }
        let query = searchQuery.lowercased()
        return boycotts.filter { b in
            b.name.lowercased().contains(query) ||
            (b.description?.lowercased().contains(query) ?? false)
        }
    }
}
