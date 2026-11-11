import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @AppStorage("colorScheme") private var colorScheme: String = "dark"
    @State private var showDeleteConfirmation = false
    @State private var isDeletingAccount = false
    @State private var deleteError: String?
    @State private var showChangePassword = false
    @State private var showChangeEmail = false
    @State private var profile: UserProfile?

    var body: some View {
        ZStack {
            Color.bgDark.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 24) {
                    accountSection
                    securitySection
                    privacySection
                    appearanceSection
                    supportSection
                    legalSection
                    signOutSection
                    deleteAccountSection
                    appInfo
                }
                .padding()
                .padding(.bottom, 100)
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await loadProfile()
        }
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("Settings")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.textPrimary)
            }
        }
        .alert("Delete Account?", isPresented: $showDeleteConfirmation) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) {
                Task { await deleteAccount() }
            }
        } message: {
            Text(
                "This permanently deletes your account, posts, messages, and connected data. Public boycotts you created stay available to their followers under \"[Deleted User]\". This cannot be undone."
            )
        }
        .alert("Couldn't Delete Account", isPresented: .init(
            get: { deleteError != nil },
            set: { if !$0 { deleteError = nil } }
        )) {
            Button("OK", role: .cancel) { deleteError = nil }
        } message: {
            Text(deleteError ?? "Something went wrong. Please try again or contact support@boyk.org.")
        }
        .sheet(isPresented: $showChangePassword) {
            ChangePasswordSheet()
        }
        .sheet(isPresented: $showChangeEmail) {
            ChangeEmailSheet()
        }
    }

    // MARK: - Security

    private var securitySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("SECURITY")
                .sectionHeader()

            VStack(spacing: 0) {
                securityRow(icon: "lock", title: "Change Password") {
                    showChangePassword = true
                }
                Rectangle().fill(Color.border).frame(height: 1)
                securityRow(icon: "envelope", title: "Change Email") {
                    showChangeEmail = true
                }
            }
            .background(Color.bgCard)
            .overlay(Rectangle().stroke(Color.border, lineWidth: 1))
        }
    }

    private func securityRow(icon: String, title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color.bgDark)
                        .frame(width: 40, height: 40)
                    Image(systemName: icon)
                        .font(.system(size: 18))
                        .foregroundColor(.textSecondary)
                }
                Text(title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(.textPrimary)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 13))
                    .foregroundColor(.textMuted)
            }
            .padding(16)
        }
    }

    private func deleteAccount() async {
        isDeletingAccount = true
        defer { isDeletingAccount = false }
        do {
            try await authVM.deleteAccount()
        } catch {
            deleteError = "Something went wrong. Please try again or contact support@boyk.org."
        }
    }

    // MARK: - Account

    private var accountSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("ACCOUNT")
                .sectionHeader()

            VStack(spacing: 0) {
                // Profile row — mirrors the Profile tab's identity (real display
                // name, @username and avatar) instead of deriving a name from the
                // email local part, which showed "Ddfreymann" next to a monogram
                // while the Profile tab showed "Daniel Freymann" and a photo.
                HStack(spacing: 12) {
                    BoykImage(urlString: profile?.profilePictureURL) {
                        Circle()
                            .fill(Color.accent)
                            .overlay(
                                Text(profileInitial)
                                    .font(.system(size: 18, weight: .semibold))
                                    .foregroundColor(.white)
                            )
                    }
                    .aspectRatio(contentMode: .fill)
                    .frame(width: 48, height: 48)
                    .clipShape(Circle())

                    VStack(alignment: .leading, spacing: 2) {
                        Text(profileDisplayName)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.textPrimary)

                        Text(profileSubtitle)
                            .font(.system(size: 13))
                            .foregroundColor(.textMuted)
                    }

                    Spacer()
                }
                .padding(16)

                Rectangle()
                    .fill(Color.border)
                    .frame(height: 1)

                // Email row
                VStack(alignment: .leading, spacing: 2) {
                    Text("Email")
                        .font(.system(size: 13))
                        .foregroundColor(.textMuted)

                    Text(authVM.user?.email ?? "Not set")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(.textPrimary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
            }
            .background(Color.bgCard)
            .overlay(Rectangle().stroke(Color.border, lineWidth: 1))
        }
    }

    // MARK: - Privacy

    private var privacySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("PRIVACY")
                .sectionHeader()

            NavigationLink(destination: BlockedUsersView()) {
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color.bgDark)
                            .frame(width: 40, height: 40)
                        Image(systemName: "person.crop.circle.badge.xmark")
                            .font(.system(size: 18))
                            .foregroundColor(.textSecondary)
                    }

                    VStack(alignment: .leading, spacing: 2) {
                        Text("Blocked Users")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundColor(.textPrimary)
                        Text("Manage who you've blocked")
                            .font(.system(size: 13))
                            .foregroundColor(.textMuted)
                    }

                    Spacer()

                    Image(systemName: "chevron.right")
                        .font(.system(size: 14))
                        .foregroundColor(.textMuted)
                }
                .padding(16)
                .background(Color.bgCard)
                .overlay(Rectangle().stroke(Color.border, lineWidth: 1))
            }
        }
    }

    // MARK: - Appearance

    private var appearanceSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("APPEARANCE")
                .sectionHeader()

            VStack(alignment: .leading, spacing: 12) {
                Text("Theme")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(.textPrimary)

                HStack(spacing: 8) {
                    themeButton(label: "Light", icon: "sun.max.fill", isSelected: colorScheme == "light") {
                        colorScheme = "light"
                    }

                    themeButton(label: "Dark", icon: "moon.fill", isSelected: colorScheme == "dark") {
                        colorScheme = "dark"
                    }
                }
            }
            .padding(16)
            .background(Color.bgCard)
            .overlay(Rectangle().stroke(Color.border, lineWidth: 1))
        }
    }

    private func themeButton(label: String, icon: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 24))
                Text(label)
                    .font(.system(size: 13, weight: .medium))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .foregroundColor(isSelected ? .white : .textSecondary)
            .background(isSelected ? Color.accent : Color.bgDark)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isSelected ? Color.accent : Color.border, lineWidth: isSelected ? 2 : 1)
            )
            .cornerRadius(12)
        }
    }

    // MARK: - Support

    private var supportSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("SUPPORT")
                .sectionHeader()

            if let url = URL(string: "mailto:support@boyk.org") {
                Link(destination: url) {
                    HStack(spacing: 12) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 12)
                                .fill(Color.bgDark)
                                .frame(width: 40, height: 40)
                            Image(systemName: "envelope.fill")
                                .font(.system(size: 18))
                                .foregroundColor(.textSecondary)
                        }

                        VStack(alignment: .leading, spacing: 2) {
                            Text("Report an Issue")
                                .font(.system(size: 15, weight: .medium))
                                .foregroundColor(.textPrimary)
                            Text("Send feedback or report bugs")
                                .font(.system(size: 13))
                                .foregroundColor(.textMuted)
                        }

                        Spacer()

                        Image(systemName: "chevron.right")
                            .font(.system(size: 14))
                            .foregroundColor(.textMuted)
                    }
                    .padding(16)
                    .background(Color.bgCard)
                    .overlay(Rectangle().stroke(Color.border, lineWidth: 1))
                }
            }
        }
    }

    // MARK: - Sign Out

    private var signOutSection: some View {
        Button {
            Task { await authVM.signOut() }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "rectangle.portrait.and.arrow.right")
                    .font(.system(size: 16))
                Text("Sign Out")
                    .font(.system(size: 15, weight: .medium))
            }
            .foregroundColor(.accent)
            .frame(maxWidth: .infinity)
            .padding(16)
            .overlay(Rectangle().stroke(Color.border, lineWidth: 1))
        }
    }

    // MARK: - Legal

    private var legalSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("LEGAL")
                .sectionHeader()

            VStack(spacing: 0) {
                legalLink(title: "Privacy Policy", url: "https://boyk.org/privacy")
                Divider().background(Color.border)
                legalLink(title: "Terms of Service", url: "https://boyk.org/terms")
                Divider().background(Color.border)
                // Required by logo.dev's free plan, which company logos are hotlinked from.
                legalLink(title: "Logos provided by Logo.dev", url: "https://logo.dev")
            }
            .background(Color.bgCard)
            .overlay(Rectangle().stroke(Color.border, lineWidth: 1))
        }
    }

    private func legalLink(title: String, url: String) -> some View {
        Group {
            if let destination = URL(string: url) {
                Link(destination: destination) {
                    HStack {
                        Text(title)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundColor(.textPrimary)
                        Spacer()
                        Image(systemName: "arrow.up.right")
                            .font(.system(size: 13))
                            .foregroundColor(.textMuted)
                    }
                    .padding(16)
                }
            }
        }
    }

    // MARK: - Delete Account

    private var deleteAccountSection: some View {
        Button {
            showDeleteConfirmation = true
        } label: {
            HStack(spacing: 8) {
                if isDeletingAccount {
                    ProgressView()
                        .tint(.red)
                } else {
                    Image(systemName: "trash")
                        .font(.system(size: 16))
                }
                Text(isDeletingAccount ? "Deleting…" : "Delete Account")
                    .font(.system(size: 15, weight: .medium))
            }
            .foregroundColor(.red)
            .frame(maxWidth: .infinity)
            .padding(16)
            .overlay(Rectangle().stroke(Color.red.opacity(0.4), lineWidth: 1))
        }
        .disabled(isDeletingAccount)
    }

    // MARK: - App Info

    private var appInfo: some View {
        Text("Boyk v1.0.0")
            .font(.system(size: 12))
            .foregroundColor(.textMuted)
            .padding(.top, 8)
    }

    // MARK: - Helpers

    /// Fetches the profile backing the identity row. Failure is deliberately
    /// silent here — every helper below degrades to an email-derived value, so
    /// there is no broken state to report, only a less specific one.
    private func loadProfile() async {
        guard let uid = authVM.user?.id else { return }
        profile = try? await SupabaseService.shared.getProfile(userID: uid)
    }

    private var profileInitial: String {
        let source = profile?.displayName
            ?? profile?.username
            ?? authVM.user?.email
            ?? "U"
        return String(source.prefix(1)).uppercased()
    }

    private var profileDisplayName: String {
        profile?.displayName
            ?? profile?.username
            ?? authVM.user?.email?.components(separatedBy: "@").first?.capitalized
            ?? "Your Profile"
    }

    /// The email already has its own labelled row directly below, so showing it
    /// here too was pure duplication. Prefer the @username.
    private var profileSubtitle: String {
        if let username = profile?.username { return "@\(username)" }
        return authVM.user?.email ?? ""
    }
}
