import SwiftUI

struct PostDetailView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @Environment(\.dismiss) private var dismiss
    @StateObject private var vm: PostDetailViewModel
    @State private var replyText = ""
    @State private var reportedReply: PostReply?
    @FocusState private var replyFocused: Bool

    init(post: Post) {
        _vm = StateObject(wrappedValue: PostDetailViewModel(post: post))
    }

    var body: some View {
        ZStack {
            Color.bgDark.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 0) {
                    PostCardView(
                        post: $vm.post,
                        variant: .detail,
                        currentUserID: authVM.user?.id,
                        onLikeToggled: { _ in Task { await vm.toggleLike() } },
                        onRepostToggled: { _ in Task { await vm.toggleRepost() } },
                        onDelete: { _ in
                            Task {
                                try? await PostsService.shared.deletePost(id: vm.post.id)
                                dismiss()
                            }
                        },
                        onReplyTapped: { _ in replyFocused = true }
                    )

                    Divider().background(Color.border)

                    repliesSection
                }
            }
        }
        // safeAreaInset (not a ZStack overlay) so the bar is laid out ABOVE the
        // floating tab bar's touch region — inside it, the tab bar wins
        // hit-testing and the send button never receives taps.
        .safeAreaInset(edge: .bottom, spacing: 0) {
            replyBar
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("Post")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.textPrimary)
            }
        }
        .task {
            await vm.loadReplies()
        }
        .sheet(item: $reportedReply) { reply in
            ReportContentSheet(
                contentType: .reply,
                contentID: reply.id,
                contentLabel: "@\(reply.author?.username ?? "user")'s reply"
            )
        }
    }

    // MARK: - Replies

    @ViewBuilder
    private var repliesSection: some View {
        if vm.isLoadingReplies && vm.replies.isEmpty {
            ProgressView()
                .tint(.accent)
                .padding(.vertical, 32)
        } else if vm.replies.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "bubble.right")
                    .font(.system(size: 24, weight: .light))
                    .foregroundColor(.textMuted)
                Text("Be the first to reply")
                    .font(.system(size: 13))
                    .foregroundColor(.textMuted)
            }
            .padding(.vertical, 32)
            .frame(maxWidth: .infinity)
        } else {
            VStack(spacing: 0) {
                ForEach(vm.replies) { reply in
                    replyRow(reply)
                    Divider().background(Color.border).padding(.leading, 56)
                }
            }
        }
    }

    private func replyRow(_ reply: PostReply) -> some View {
        HStack(alignment: .top, spacing: 10) {
            avatar(url: reply.author?.profilePictureURL, name: reply.author?.nameForDisplay, size: 32)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    Text(reply.author?.nameForDisplay ?? "User")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.textPrimary)
                    if let username = reply.author?.username {
                        Text("@\(username)")
                            .font(.system(size: 12))
                            .foregroundColor(.textMuted)
                    }
                    Text("·")
                        .foregroundColor(.textMuted)
                    Text(timeAgoShort(reply.createdAt))
                        .font(.system(size: 12))
                        .foregroundColor(.textMuted)
                    Spacer(minLength: 0)
                }
                Text(reply.content)
                    .font(.system(size: 14))
                    .foregroundColor(.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                Button {
                    Task { await vm.toggleLikeReply(reply) }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: reply.likedByMe ? "heart.fill" : "heart")
                            .font(.system(size: 12))
                            .foregroundColor(reply.likedByMe ? .danger : .textMuted)
                        if reply.likeCount > 0 {
                            Text("\(reply.likeCount)")
                                .font(.system(size: 11))
                                .foregroundColor(.textMuted)
                        }
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(reply.likedByMe ? "Unlike reply" : "Like reply")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
        .contextMenu {
            if let me = authVM.user?.id, reply.authorID != me {
                Button(role: .destructive) {
                    reportedReply = reply
                } label: {
                    Label("Report reply", systemImage: "flag")
                }
            }
        }
    }

    // MARK: - Reply bar

    private var replyBar: some View {
        VStack(spacing: 6) {
            // Surface reply failures — previously they were captured in
            // vm.error and never shown, so a failed send looked like a dead
            // button.
            if let error = vm.error {
                Text(error)
                    .font(.system(size: 12))
                    .foregroundColor(.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
            }
            replyInputRow
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.bgDark.opacity(0.95))
        .overlay(
            Rectangle().fill(Color.border).frame(height: 0.5),
            alignment: .top
        )
    }

    private var replyInputRow: some View {
        HStack(spacing: 10) {
            TextField("Reply…", text: $replyText, axis: .vertical)
                .focused($replyFocused)
                .textFieldStyle(.plain)
                .lineLimit(1...4)
                .font(.system(size: 14))
                .foregroundColor(.textPrimary)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(Color.bgCard)
                .clipShape(RoundedRectangle(cornerRadius: 18))

            Button {
                Task {
                    let ok = await vm.submitReply(content: replyText)
                    if ok {
                        replyText = ""
                        replyFocused = false
                    }
                }
            } label: {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 16))
                    .foregroundColor(replyText.trimmingCharacters(in: .whitespaces).isEmpty ? .textMuted : .accent)
                    // HIG-minimum touch target; the bare glyph is ~20pt.
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .disabled(replyText.trimmingCharacters(in: .whitespaces).isEmpty)
            .accessibilityLabel("Send reply")
        }
    }

    // MARK: - Helpers

    private func avatar(url: String?, name: String?, size: CGFloat) -> some View {
        Group {
            if let url = url.flatMap(URL.init(string:)) {
                BoykImage(url: url) {
                    ZStack {
                        Circle().fill(Color.bgCard)
                        Text(String((name ?? "U").prefix(1)).uppercased())
                            .font(.system(size: size * 0.4, weight: .semibold))
                            .foregroundColor(.textMuted)
                    }
                }
                .aspectRatio(contentMode: .fill)
                .frame(width: size, height: size)
                .clipShape(Circle())
            } else {
                ZStack {
                    Circle().fill(Color.bgCard)
                    Text(String((name ?? "U").prefix(1)).uppercased())
                        .font(.system(size: size * 0.4, weight: .semibold))
                        .foregroundColor(.textMuted)
                }
                .frame(width: size, height: size)
            }
        }
        .overlay(Circle().stroke(Color.border, lineWidth: 1))
    }

    private func timeAgoShort(_ date: Date?) -> String {
        guard let date else { return "" }
        let seconds = Int(Date().timeIntervalSince(date))
        if seconds < 60 { return "now" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h" }
        let days = hours / 24
        return "\(days)d"
    }
}
