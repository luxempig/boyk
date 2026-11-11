import SwiftUI

struct FeedView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @EnvironmentObject var networkMonitor: NetworkMonitor
    @StateObject private var vm = FeedViewModel()
    @State private var showCompose = false
    @State private var showMessages = false
    @State private var selectedPost: Post?
    @State private var wasOffline = false

    var body: some View {
        ZStack {
            Color.bgDark.ignoresSafeArea()
            content
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("Feed")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.textPrimary)
            }
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    showMessages = true
                } label: {
                    Image(systemName: "bubble.left.and.bubble.right")
                        .foregroundColor(.accent)
                }
                .accessibilityLabel("Messages")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showCompose = true
                } label: {
                    Image(systemName: "square.and.pencil")
                        .foregroundColor(.accent)
                }
                .accessibilityLabel("Compose post")
            }
        }
        .sheet(isPresented: $showMessages) {
            MessagesView()
        }
        .task {
            if case .idle = vm.state {
                await vm.load()
                await vm.markRead()
            }
        }
        .refreshable {
            await vm.refresh()
        }
        .onChange(of: networkMonitor.status) { _, newStatus in
            switch newStatus {
            case .offline:
                wasOffline = true
            case .online where wasOffline:
                wasOffline = false
                Task { await vm.refresh() }
            default:
                break
            }
        }
        .sheet(isPresented: $showCompose) {
            ComposePostView(currentUserID: authVM.user?.id) { newPost in
                vm.prepend(post: newPost)
            }
        }
        .navigationDestination(item: $selectedPost) { post in
            PostDetailView(post: post)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch vm.state {
        case .idle:
            loadingView
        case .loading where vm.posts.isEmpty:
            loadingView
        case .error(let message) where vm.posts.isEmpty:
            errorView(message)
        case .loaded where vm.posts.isEmpty:
            emptyView
        default:
            postList
        }
    }

    private var postList: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach($vm.posts) { $post in
                    Button {
                        selectedPost = post
                    } label: {
                        PostCardView(
                            post: $post,
                            variant: .feed,
                            currentUserID: authVM.user?.id,
                            onLikeToggled: { p in Task { await vm.toggleLike(post: p) } },
                            onRepostToggled: { p in Task { await vm.toggleRepost(post: p) } },
                            onDelete: { p in Task { await vm.delete(post: p) } },
                            onReplyTapped: { p in selectedPost = p }
                        )
                    }
                    .buttonStyle(.plain)
                    .task {
                        await vm.loadMoreIfNeeded(currentItem: post)
                    }
                }

                if vm.isFetchingMore {
                    ProgressView()
                        .tint(.accent)
                        .padding(.vertical, 24)
                }

                if !vm.hasMore && !vm.posts.isEmpty {
                    Text("You're caught up")
                        .font(.system(size: 12))
                        .foregroundColor(.textMuted)
                        .padding(.vertical, 24)
                }
            }
            .padding(.bottom, 64)
        }
    }

    private var emptyView: some View {
        VStack(spacing: 16) {
            Image(systemName: "newspaper")
                .font(.system(size: 40, weight: .light))
                .foregroundColor(.textMuted)
            Text("Your feed is empty")
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(.textPrimary)
            Text("Follow some people from Explore, or post the first thing yourself.")
                .font(.system(size: 14))
                .foregroundColor(.textMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button {
                showCompose = true
            } label: {
                Text("Create a Post")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)
                    .background(LinearGradient.boykAccent)
                    .clipShape(Capsule())
            }
            .padding(.top, 8)
        }
        .padding(.top, 80)
        .frame(maxWidth: .infinity)
    }

    private var loadingView: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(0..<6, id: \.self) { _ in
                    PostSkeleton()
                }
            }
        }
        .disabled(true)
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 32, weight: .light))
                .foregroundColor(.danger)
            Text(message)
                .font(.system(size: 13))
                .foregroundColor(.textMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button {
                Task { await vm.load() }
            } label: {
                Text("Try again")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(.accent)
            }
        }
        .padding(.top, 80)
        .frame(maxWidth: .infinity)
    }
}
