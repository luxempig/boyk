import Foundation

/// Drives the Feed timeline. Pagination is cursor-based — the cursor is the
/// `created_at` of the last post on the previous page (matches the server's
/// `p_cursor` convention in `get_feed`).
///
/// All mutations apply optimistically and roll back the affected row if the
/// server call fails. The roll-back uses the captured pre-mutation snapshot,
/// not a refetch, so transient errors don't trigger a full feed reload.
@MainActor
class FeedViewModel: ObservableObject {
    enum ViewState: Equatable {
        case idle
        case loading
        case loaded
        case error(String)
    }

    @Published var state: ViewState = .idle
    @Published var posts: [Post] = []
    @Published var isFetchingMore = false
    @Published var hasMore = true

    private let pageSize = 20

    func load() async {
        state = .loading
        do {
            let page = try await PostsService.shared.getFeed(cursor: nil, limit: pageSize)
            self.posts = page
            self.hasMore = page.count == pageSize
            self.state = .loaded
        } catch {
            self.state = .error(error.localizedDescription)
        }
    }

    func refresh() async {
        do {
            let page = try await PostsService.shared.getFeed(cursor: nil, limit: pageSize)
            self.posts = page
            self.hasMore = page.count == pageSize
            self.state = .loaded
        } catch {
            self.state = .error(error.localizedDescription)
        }
    }

    func loadMoreIfNeeded(currentItem: Post) async {
        guard hasMore, !isFetchingMore, let last = posts.last, last.id == currentItem.id else {
            return
        }
        isFetchingMore = true
        defer { isFetchingMore = false }
        do {
            let cursor = last.createdAt
            let page = try await PostsService.shared.getFeed(cursor: cursor, limit: pageSize)
            // Filter out any duplicates (race with refresh).
            let existingIDs = Set(posts.map(\.id))
            let appended = page.filter { !existingIDs.contains($0.id) }
            self.posts.append(contentsOf: appended)
            self.hasMore = page.count == pageSize
        } catch {
            // Quiet failure on pagination — the next scroll triggers another try.
        }
    }

    // MARK: - Mutations (optimistic)

    func toggleLike(post: Post) async {
        guard let idx = posts.firstIndex(where: { $0.id == post.id }) else { return }
        let snapshot = posts[idx]
        let willLike = !snapshot.likedByMe
        posts[idx].likedByMe = willLike
        posts[idx].likeCount = max(0, snapshot.likeCount + (willLike ? 1 : -1))
        do {
            if willLike {
                try await PostsService.shared.likePost(id: post.id)
            } else {
                try await PostsService.shared.unlikePost(id: post.id)
            }
        } catch {
            if let i = posts.firstIndex(where: { $0.id == post.id }) {
                posts[i] = snapshot
            }
        }
    }

    func toggleRepost(post: Post) async {
        let targetID = post.originalPostID ?? post.id
        // Find every row referencing this target (the original + any repost rows).
        let affectedIndices = posts.indices.filter { i in
            let p = posts[i]
            return p.id == targetID || p.originalPostID == targetID
        }
        guard let primary = affectedIndices.first else { return }
        let snapshot = affectedIndices.map { posts[$0] }
        let willRepost = !posts[primary].repostedByMe
        for i in affectedIndices {
            posts[i].repostedByMe = willRepost
            posts[i].repostCount = max(0, posts[i].repostCount + (willRepost ? 1 : -1))
        }
        do {
            if willRepost {
                try await PostsService.shared.repostPost(id: targetID)
            } else {
                try await PostsService.shared.unrepostPost(id: targetID)
            }
        } catch {
            // Roll back affected rows to their snapshots.
            for (offset, i) in affectedIndices.enumerated() where posts.indices.contains(i) {
                posts[i] = snapshot[offset]
            }
        }
    }

    func delete(post: Post) async {
        guard let idx = posts.firstIndex(where: { $0.id == post.id }) else { return }
        let removed = posts.remove(at: idx)
        do {
            try await PostsService.shared.deletePost(id: post.id)
        } catch {
            // Re-insert at the same index.
            let insertAt = min(idx, posts.count)
            posts.insert(removed, at: insertAt)
        }
    }

    /// Called after compose succeeds. Prepends the new post to the feed
    /// without waiting for a refresh round-trip.
    func prepend(post: Post) {
        if !posts.contains(where: { $0.id == post.id }) {
            posts.insert(post, at: 0)
        }
    }

    /// Manual refetch on app return-from-background, etc.
    func markRead() async {
        try? await PostsService.shared.markFeedRead()
    }
}
