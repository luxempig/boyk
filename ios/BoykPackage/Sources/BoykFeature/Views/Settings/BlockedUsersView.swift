import SwiftUI

/// Settings → Blocked Users. Lists everyone the current user has blocked
/// (via the `get_blocked_users` RPC) with an inline Unblock action.
struct BlockedUsersView: View {
    @State private var users: [UserProfile] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var unblockingIDs: Set<UUID> = []

    var body: some View {
        ZStack {
            Color.bgDark.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 12) {
                    if isLoading {
                        ProgressView()
                            .tint(.accent)
                            .padding(48)
                    } else if let errorMessage {
                        VStack(spacing: 12) {
                            Text(errorMessage)
                                .font(.system(size: 13))
                                .foregroundColor(.danger)
                                .multilineTextAlignment(.center)
                            Button("Retry") {
                                Task { await load() }
                            }
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(.accent)
                        }
                        .padding(32)
                    } else if users.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: "person.crop.circle.badge.checkmark")
                                .font(.system(size: 28, weight: .light))
                                .foregroundColor(.textMuted)
                            Text("You haven't blocked anyone.")
                                .font(.system(size: 14))
                                .foregroundColor(.textMuted)
                        }
                        .padding(48)
                    } else {
                        ForEach(users) { user in
                            blockedRow(user)
                        }
                    }
                }
                .padding()
                .padding(.bottom, 80)
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("Blocked Users")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.textPrimary)
            }
        }
        .task {
            await load()
        }
    }

    private func blockedRow(_ user: UserProfile) -> some View {
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

            Button {
                Task { await unblock(user) }
            } label: {
                if unblockingIDs.contains(user.id) {
                    ProgressView()
                        .tint(.textMuted)
                        .scaleEffect(0.7)
                } else {
                    Text("Unblock")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.textPrimary)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .background(Color.bgDark)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(Color.border, lineWidth: 1)
                        )
                        .cornerRadius(8)
                }
            }
            .disabled(unblockingIDs.contains(user.id))
            .accessibilityLabel("Unblock \(user.username ?? "user")")
        }
        .padding(16)
        .background(Color.bgCard)
        .overlay(Rectangle().stroke(Color.border, lineWidth: 1))
    }

    private func userInitial(_ user: UserProfile) -> some View {
        Text(String((user.username ?? "U").prefix(1)).uppercased())
            .font(.system(size: 16, weight: .semibold))
            .foregroundColor(.textMuted)
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            users = try await SupabaseService.shared.getBlockedUsers()
        } catch {
            errorMessage = "Couldn't load your blocked users. Please try again."
        }
        isLoading = false
    }

    private func unblock(_ user: UserProfile) async {
        unblockingIDs.insert(user.id)
        defer { unblockingIDs.remove(user.id) }
        do {
            try await SupabaseService.shared.unblockUser(userID: user.id)
            users.removeAll { $0.id == user.id }
        } catch {
            errorMessage = "Couldn't unblock @\(user.username ?? "user"). Please try again."
        }
    }
}
