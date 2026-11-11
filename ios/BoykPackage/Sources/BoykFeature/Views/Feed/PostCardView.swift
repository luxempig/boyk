import SwiftUI

/// Single post row used by Feed, PostDetail, and Profile.
///
/// State flow:
/// - `post` is a Binding so the parent's source of truth (FeedViewModel,
///   PostDetailViewModel) is mutated in-place for optimistic UI. The actual
///   server call is fire-and-forget — the parent rolls back via Binding if
///   it fails.
/// - `variant` controls layout density. `.feed` truncates long content with a
///   "Show more" tap that navigates to detail. `.detail` shows everything.
///
/// The card itself does not navigate. The parent wraps it in a NavigationLink
/// or .onTapGesture so this view stays composition-friendly.
struct PostCardView: View {
    @Binding var post: Post
    var variant: Variant = .feed
    var currentUserID: UUID?
    var onLikeToggled: ((Post) -> Void)?
    var onRepostToggled: ((Post) -> Void)?
    var onDelete: ((Post) -> Void)?
    var onReplyTapped: ((Post) -> Void)?

    enum Variant {
        case feed
        case detail
    }

    @State private var showReportSheet = false

    private var displayPost: Post { post.displayPost }
    private var displayAuthor: PostAuthor? { displayPost.author }
    private var repostAuthor: PostAuthor? { post.isRepost ? post.author : nil }
    private var isOwn: Bool { currentUserID == post.authorID }
    private var shareURL: URL? { URL(string: "https://boyk.org/post/\(post.id.uuidString)") }

    /// Signed-in users can report any post they didn't author. For reposts the
    /// report targets the displayed (original) content, so the original author
    /// must not be the current user either.
    private var canReport: Bool {
        guard let currentUserID else { return false }
        return post.authorID != currentUserID && displayPost.authorID != currentUserID
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if post.isRepost, let r = repostAuthor {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.2.squarepath")
                        .font(.system(size: 11))
                    Text("@\(r.username ?? "user") reposted")
                        .font(.system(size: 12))
                }
                .foregroundColor(.textMuted)
            }

            authorRow
            content
            mediaSection
            boycottEmbed
            engagementBar
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.bgDark)
        .overlay(
            Rectangle().fill(Color.border).frame(height: 0.5),
            alignment: .bottom
        )
        .contextMenu {
            if let url = shareURL {
                ShareLink(item: url) {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
            }
            if canReport {
                Button(role: .destructive) {
                    showReportSheet = true
                } label: {
                    Label("Report post", systemImage: "flag")
                }
            }
            if isOwn {
                Button(role: .destructive) {
                    onDelete?(post)
                } label: {
                    Label("Delete post", systemImage: "trash")
                }
            }
        }
        .sheet(isPresented: $showReportSheet) {
            ReportContentSheet(
                contentType: .post,
                contentID: displayPost.id,
                contentLabel: "@\(displayAuthor?.username ?? "user")'s post"
            )
        }
        .sensoryFeedback(.impact(weight: .light), trigger: post.likedByMe)
        .sensoryFeedback(.impact(weight: .medium), trigger: post.repostedByMe)
    }

    // MARK: - Author row

    private var authorRow: some View {
        HStack(spacing: 10) {
            avatar(url: displayAuthor?.profilePictureURL, name: displayAuthor?.nameForDisplay, size: 36)

            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Text(displayAuthor?.nameForDisplay ?? "User")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.textPrimary)
                    if let username = displayAuthor?.username {
                        Text("@\(username)")
                            .font(.system(size: 13))
                            .foregroundColor(.textMuted)
                    }
                    Text("·")
                        .foregroundColor(.textMuted)
                    Text(timeAgo(displayPost.createdAt ?? post.createdAt))
                        .font(.system(size: 13))
                        .foregroundColor(.textMuted)
                    Spacer(minLength: 0)
                }
            }
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if let text = displayPost.content, !text.isEmpty {
            Text(attributed(text))
                .font(.system(size: 15))
                .foregroundColor(.textPrimary)
                .lineLimit(variant == .feed ? 8 : nil)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
        }
    }

    /// Renders @mentions and #hashtags as colored runs. Tap-to-navigate is
    /// deferred — Phase 2 — because routing to /user/:id would require a
    /// router. For now, visual treatment only.
    private func attributed(_ text: String) -> AttributedString {
        var result = AttributedString(text)
        let nsText = text as NSString
        let pattern = "([@#][A-Za-z0-9_]+)"
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return result }
        let range = NSRange(location: 0, length: nsText.length)
        regex.enumerateMatches(in: text, range: range) { match, _, _ in
            guard let match = match,
                  let range = Range(match.range, in: text),
                  let attrRange = result.range(of: String(text[range]))
            else { return }
            let token = String(text[range])
            if token.first == "@" {
                result[attrRange].foregroundColor = .accent
                result[attrRange].font = .system(size: 15, weight: .medium)
            } else {
                result[attrRange].foregroundColor = .highlight
                result[attrRange].font = .system(size: 15, weight: .medium)
            }
        }
        return result
    }

    // MARK: - Media

    @ViewBuilder
    private var mediaSection: some View {
        if let urlString = displayPost.mediaURL, let url = URL(string: urlString) {
            BoykImage(url: url) {
                mediaUnavailable
            }
            .aspectRatio(contentMode: .fill)
            .frame(maxWidth: .infinity)
            .frame(maxHeight: variant == .feed ? 320 : 480)
            .clipped()
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .padding(.top, 4)
        }
    }

    /// Shown when post media can't be rendered — most often an SVG, which
    /// renders fine on web but has no decoder on iOS.
    ///
    /// This has to explain itself. The previous fallback was an unlabelled filled
    /// rectangle, which looked identical to a layout bug and exposed *nothing* to
    /// VoiceOver, so the failure was invisible to sighted and assistive users alike.
    private var mediaUnavailable: some View {
        ZStack {
            Rectangle().fill(Color.bgCard)
            VStack(spacing: 6) {
                Image(systemName: "photo.badge.exclamationmark")
                    .font(.system(size: 22))
                Text("Image unavailable")
                    .font(.system(size: 12))
            }
            .foregroundColor(.textMuted)
        }
        .frame(height: 160)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Image unavailable")
    }

    // MARK: - Boycott embed

    @ViewBuilder
    private var boycottEmbed: some View {
        if let boycott = displayPost.boycott, let name = boycott.name {
            HStack(spacing: 8) {
                Image(systemName: "megaphone.fill")
                    .font(.system(size: 12))
                    .foregroundColor(.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text(name)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.textPrimary)
                        .lineLimit(1)
                    if let desc = boycott.description, !desc.isEmpty {
                        Text(desc)
                            .font(.system(size: 12))
                            .foregroundColor(.textMuted)
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(10)
            .background(Color.accentSubtle)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.border, lineWidth: 0.5)
            )
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }

    // MARK: - Engagement bar

    private var engagementBar: some View {
        HStack(spacing: 4) {
            engagementButton(
                icon: post.likedByMe ? "heart.fill" : "heart",
                count: post.likeCount,
                tint: post.likedByMe ? .danger : .textMuted
            ) {
                onLikeToggled?(post)
            }
            .accessibilityLabel(post.likedByMe ? "Unlike" : "Like")

            engagementButton(
                icon: "bubble.right",
                count: post.replyCount,
                tint: .textMuted
            ) {
                onReplyTapped?(post)
            }
            .accessibilityLabel("Reply")

            engagementButton(
                icon: "arrow.2.squarepath",
                count: post.repostCount,
                tint: post.repostedByMe ? .success : .textMuted
            ) {
                onRepostToggled?(post)
            }
            .accessibilityLabel(post.repostedByMe ? "Undo repost" : "Repost")

            Spacer(minLength: 0)

            if let url = shareURL {
                ShareLink(item: url) {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 14))
                        .foregroundColor(.textMuted)
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Share")
            }
        }
        .padding(.top, 4)
    }

    private func engagementButton(
        icon: String,
        count: Int,
        tint: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 14))
                    .accessibilityHidden(true)
                if count > 0 {
                    Text(formatCount(count))
                        .font(.system(size: 12))
                }
            }
            .foregroundColor(tint)
            .frame(minHeight: 32)
            .padding(.horizontal, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Avatar

    private func avatar(url: String?, name: String?, size: CGFloat) -> some View {
        BoykImage(urlString: url) {
            avatarFallback(name: name, size: size)
        }
        .aspectRatio(contentMode: .fill)
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().stroke(Color.border, lineWidth: 1))
    }

    private func avatarFallback(name: String?, size: CGFloat) -> some View {
        ZStack {
            Circle().fill(Color.bgCard)
            Text(String((name ?? "U").prefix(1)).uppercased())
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundColor(.textMuted)
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Helpers

private func timeAgo(_ date: Date?) -> String {
    guard let date else { return "" }
    let seconds = Int(Date().timeIntervalSince(date))
    if seconds < 60 { return "now" }
    let minutes = seconds / 60
    if minutes < 60 { return "\(minutes)m" }
    let hours = minutes / 60
    if hours < 24 { return "\(hours)h" }
    let days = hours / 24
    if days < 7 { return "\(days)d" }
    let weeks = days / 7
    if weeks < 4 { return "\(weeks)w" }
    let f = DateFormatter()
    f.dateFormat = "MMM d"
    return f.string(from: date)
}

private func formatCount(_ n: Int) -> String {
    if n < 1000 { return "\(n)" }
    if n < 10_000 { return String(format: "%.1fk", Double(n) / 1000) }
    if n < 1_000_000 { return "\(n / 1000)k" }
    return String(format: "%.1fM", Double(n) / 1_000_000)
}
