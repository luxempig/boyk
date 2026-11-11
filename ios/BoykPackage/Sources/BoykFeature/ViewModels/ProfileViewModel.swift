import Foundation

@MainActor
class ProfileViewModel: ObservableObject {
    enum ViewState {
        case idle
        case loading
        case loaded
        case notFound
        case error(String)
    }

    @Published var state: ViewState = .idle
    @Published var profile: UserProfile?
    @Published var boycotts: [Boycott] = []
    @Published var followedBoycotts: [Boycott] = []
    @Published var followRequests: [FollowRequest] = []
    @Published var followerCount: Int = 0
    @Published var followingCount: Int = 0
    @Published var followers: [UserProfile] = []
    @Published var following: [UserProfile] = []
    @Published var isFollowing = false
    @Published var isBlocked = false

    /// Loads a profile. For the signed-in user's OWN profile, pass
    /// `isOwnProfile: true` so private boycotts (blacklists) are kept and the
    /// tracked-boycotts + follow-requests sections (folded in from the former
    /// Home tab) are populated. Each sub-fetch is independent so one bad
    /// response degrades only its section, not the whole profile.
    func load(userID: UUID, isOwnProfile: Bool = false) async {
        state = .loading

        let fetched: UserProfile?
        do {
            fetched = try await SupabaseService.shared.getProfile(userID: userID)
        } catch is CancellationError {
            // The view went away mid-flight (tab switch). Leave the state alone
            // so the next .task re-runs the load instead of showing a failure.
            return
        } catch let error as URLError where error.code == .cancelled {
            return
        } catch {
            // A failed request is NOT a missing user — surface it so the
            // .error case can offer Retry.
            state = .error(error.localizedDescription)
            return
        }

        // Only a successful response with no row means the user truly is absent.
        guard let profile = fetched else {
            state = .notFound
            return
        }
        self.profile = profile

        async let boycottsResult = SupabaseService.shared.getMyBoycotts(userID: userID)
        async let followerResult = SupabaseService.shared.getFollowerCount(userID: userID)
        async let followingResult = SupabaseService.shared.getFollowingCount(userID: userID)

        let allBoycotts = (try? await boycottsResult) ?? []
        // Other people's profiles only show public boycotts; your own shows all.
        self.boycotts = isOwnProfile ? allBoycotts : allBoycotts.filter { $0.isPublic }
        self.followerCount = (try? await followerResult) ?? 0
        self.followingCount = (try? await followingResult) ?? 0

        if isOwnProfile {
            self.followedBoycotts = (try? await SupabaseService.shared.getFollowedBoycotts(userID: userID)) ?? []
            self.followRequests = (try? await SupabaseService.shared.getIncomingFollowRequests(userID: userID)) ?? []
        }

        self.state = .loaded
    }

    func acceptRequest(requesterID: UUID) async {
        try? await SupabaseService.shared.acceptFollowRequest(requesterID: requesterID)
        followRequests.removeAll { $0.requesterID == requesterID }
    }

    func rejectRequest(requesterID: UUID) async {
        try? await SupabaseService.shared.rejectFollowRequest(requesterID: requesterID)
        followRequests.removeAll { $0.requesterID == requesterID }
    }

    // Determine whether the current user already follows the viewed profile by
    // checking the current user's following list (mirrors the web's
    // `following.some(f => f.id === userId)`).
    func loadFollowState(currentUserID: UUID, targetID: UUID) async {
        guard currentUserID != targetID else { return }
        do {
            let list = try await SupabaseService.shared.getFollowing(userID: currentUserID)
            isFollowing = list.contains { $0.id == targetID }
        } catch {
            // Leave isFollowing as-is on failure.
        }
    }

    func toggleFollow(targetID: UUID) async {
        let wasFollowing = isFollowing
        // Optimistic update with rollback on failure.
        do {
            if wasFollowing {
                try await SupabaseService.shared.unfollowUser(targetID: targetID)
                isFollowing = false
                followerCount = max(0, followerCount - 1)
            } else {
                try await SupabaseService.shared.followUser(targetID: targetID)
                isFollowing = true
                followerCount += 1
            }
        } catch {
            isFollowing = wasFollowing
        }
    }

    // MARK: - Blocking

    func loadBlockState(targetID: UUID) async {
        do {
            isBlocked = try await SupabaseService.shared.isBlocked(userID: targetID)
        } catch {
            // Leave isBlocked as-is on failure.
        }
    }

    /// Returns true on success so the view can pop back after a block.
    @discardableResult
    func toggleBlock(targetID: UUID) async -> Bool {
        do {
            if isBlocked {
                try await SupabaseService.shared.unblockUser(userID: targetID)
                isBlocked = false
            } else {
                try await SupabaseService.shared.blockUser(userID: targetID)
                isBlocked = true
            }
            return true
        } catch {
            return false
        }
    }

    func loadFollowers(userID: UUID) async {
        do {
            followers = try await SupabaseService.shared.getFollowers(userID: userID)
        } catch {
            followers = []
        }
    }

    func loadFollowing(userID: UUID) async {
        do {
            following = try await SupabaseService.shared.getFollowing(userID: userID)
        } catch {
            following = []
        }
    }
}
