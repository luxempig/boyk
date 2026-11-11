import SwiftUI

struct UserRow: View {
    let user: UserProfile

    var body: some View {
        HStack(spacing: 12) {
            BoykImage(urlString: user.profilePictureURL) {
                userInitial
            }
            .aspectRatio(contentMode: .fill)
            .frame(width: 48, height: 48)
            .background(Color.bgDark)
            .clipShape(Circle())
            .overlay(Circle().stroke(Color.border, lineWidth: 1))

            VStack(alignment: .leading, spacing: 2) {
                Text(user.displayName ?? user.username ?? "User")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(.textPrimary)

                HStack(spacing: 8) {
                    if let username = user.username {
                        Text("@\(username)")
                            .font(.system(size: 12))
                            .foregroundColor(.textMuted)
                    }

                    if let count = user.followerCount, count > 0 {
                        Text("\(count) \(count == 1 ? "follower" : "followers")")
                            .font(.system(size: 12))
                            .foregroundColor(.accent)
                    }
                }
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.system(size: 14))
                .foregroundColor(.textMuted)
        }
        .cardStyle()
    }

    private var userInitial: some View {
        Text(String((user.username ?? "U").prefix(1)).uppercased())
            .font(.system(size: 18, weight: .semibold))
            .foregroundColor(.textMuted)
    }
}
