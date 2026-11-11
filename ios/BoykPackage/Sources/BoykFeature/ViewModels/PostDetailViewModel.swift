import Foundation

@MainActor
class PostDetailViewModel: ObservableObject {
    @Published var post: Post
    @Published var replies: [PostReply] = []
    @Published var isLoadingReplies = false
    @Published var error: String?

    init(post: Post) {
        self.post = post
    }

    func refreshPost() async {
        do {
            if let fresh = try await PostsService.shared.getPost(id: post.id) {
                self.post = fresh
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func loadReplies() async {
        isLoadingReplies = true
        defer { isLoadingReplies = false }
        do {
            self.replies = try await PostsService.shared.getReplies(postID: post.id)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func toggleLike() async {
        let snapshot = post
        let willLike = !post.likedByMe
        post.likedByMe = willLike
        post.likeCount = max(0, post.likeCount + (willLike ? 1 : -1))
        do {
            if willLike {
                try await PostsService.shared.likePost(id: snapshot.id)
            } else {
                try await PostsService.shared.unlikePost(id: snapshot.id)
            }
        } catch {
            post = snapshot
        }
    }

    func toggleRepost() async {
        let snapshot = post
        let targetID = post.originalPostID ?? post.id
        let willRepost = !post.repostedByMe
        post.repostedByMe = willRepost
        post.repostCount = max(0, post.repostCount + (willRepost ? 1 : -1))
        do {
            if willRepost {
                try await PostsService.shared.repostPost(id: targetID)
            } else {
                try await PostsService.shared.unrepostPost(id: targetID)
            }
        } catch {
            post = snapshot
        }
    }

    func submitReply(content: String) async -> Bool {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 300 else { return false }
        do {
            _ = try await PostsService.shared.createReply(postID: post.id, content: trimmed)
            // Refresh replies + count
            await loadReplies()
            post.replyCount += 1
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func toggleLikeReply(_ reply: PostReply) async {
        guard let idx = replies.firstIndex(where: { $0.id == reply.id }) else { return }
        let snapshot = replies[idx]
        let willLike = !snapshot.likedByMe
        replies[idx].likedByMe = willLike
        replies[idx].likeCount = max(0, snapshot.likeCount + (willLike ? 1 : -1))
        do {
            if willLike {
                try await PostsService.shared.likeReply(id: reply.id)
            } else {
                try await PostsService.shared.unlikeReply(id: reply.id)
            }
        } catch {
            if let i = replies.firstIndex(where: { $0.id == reply.id }) {
                replies[i] = snapshot
            }
        }
    }
}
