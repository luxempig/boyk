import SwiftUI

struct UserListSheet: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let users: [UserProfile]
    var emptyMessage: String = "No users"

    var body: some View {
        NavigationStack {
            ZStack {
                Color.bgDark.ignoresSafeArea()

                if users.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "person.2")
                            .font(.system(size: 32))
                            .foregroundColor(.textMuted)
                        Text(emptyMessage)
                            .font(.system(size: 14))
                            .foregroundColor(.textMuted)
                    }
                } else {
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(users) { user in
                                NavigationLink(destination: UserProfileView(userID: user.id)) {
                                    userRow(user)
                                }
                            }
                        }
                        .padding(.bottom, 32)
                    }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                        .foregroundColor(.accent)
                }
            }
        }
    }

    private func userRow(_ user: UserProfile) -> some View {
        HStack(spacing: 12) {
            BoykImage(urlString: user.profilePictureURL) {
                userInitial(user)
            }
            .aspectRatio(contentMode: .fill)
            .frame(width: 44, height: 44)
            .background(Color.bgDark)
            .clipShape(Circle())
            .overlay(Circle().stroke(Color.border, lineWidth: 1))

            VStack(alignment: .leading, spacing: 2) {
                Text(user.displayName ?? user.username ?? "User")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(.textPrimary)

                if let username = user.username {
                    Text("@\(username)")
                        .font(.system(size: 12))
                        .foregroundColor(.textMuted)
                }
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.system(size: 12))
                .foregroundColor(.textMuted)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .overlay(
            Rectangle()
                .fill(Color.border)
                .frame(height: 1),
            alignment: .bottom
        )
    }

    private func userInitial(_ user: UserProfile) -> some View {
        Text(String((user.username ?? "U").prefix(1)).uppercased())
            .font(.system(size: 16, weight: .semibold))
            .foregroundColor(.textMuted)
    }
}
