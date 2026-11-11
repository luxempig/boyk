import PhotosUI
import SwiftUI

struct ProfileView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @State private var showEditSheet = false

    var body: some View {
        ZStack {
            Color.bgDark.ignoresSafeArea()

            if let userID = authVM.user?.id {
                UserProfileView(userID: userID, isOwnProfile: true, showEditSheet: $showEditSheet)
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("Profile")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.textPrimary)
            }
            ToolbarItem(placement: .navigationBarLeading) {
                Button {
                    showEditSheet = true
                } label: {
                    Image(systemName: "pencil")
                        .foregroundColor(.textMuted)
                }
                .accessibilityLabel("Edit profile")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                NavigationLink(destination: SettingsView()) {
                    Image(systemName: "gearshape")
                        .foregroundColor(.textMuted)
                }
                .accessibilityLabel("Settings")
            }
        }
    }
}

struct UserProfileView: View {
    let userID: UUID
    var isOwnProfile: Bool = false
    @Binding var showEditSheet: Bool

    @EnvironmentObject var authVM: AuthViewModel
    @Environment(\.dismiss) private var dismiss
    @StateObject private var vm = ProfileViewModel()
    @State private var showFollowersSheet = false
    @State private var showFollowingSheet = false
    @State private var showReportSheet = false
    @State private var showBlockConfirmation = false
    @State private var ownTab: OwnTab = .boycotts
    @State private var chatConversationID: UUID?
    @State private var openingChat = false

    /// Own-profile sub-sections, folded in from the former Home tab.
    enum OwnTab: String, CaseIterable {
        case boycotts = "Boycotts"
        case tracking = "Tracking"
        case requests = "Requests"
    }

    /// Moderation actions only make sense on someone else's profile while
    /// signed in.
    private var canModerate: Bool {
        !isOwnProfile && authVM.user?.id != nil && authVM.user?.id != userID
    }

    init(userID: UUID, isOwnProfile: Bool = false, showEditSheet: Binding<Bool> = .constant(false)) {
        self.userID = userID
        self.isOwnProfile = isOwnProfile
        self._showEditSheet = showEditSheet
    }

    var body: some View {
        ZStack {
            Color.bgDark.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 16) {
                    switch vm.state {
                    case .loading:
                        ProgressView()
                            .tint(.accent)
                            .padding(48)
                    case .loaded:
                        profileContent
                    case .notFound:
                        notFoundView
                    case .error(let message):
                        VStack(spacing: 12) {
                            Image(systemName: "wifi.slash")
                                .font(.system(size: 32))
                                .foregroundColor(.textMuted)
                            Text(message)
                                .font(.system(size: 13))
                                .foregroundColor(.danger)
                                .multilineTextAlignment(.center)
                            Button("Retry") {
                                Task { await vm.load(userID: userID) }
                            }
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(.accent)
                        }
                        .padding()
                    case .idle:
                        EmptyView()
                    }
                }
                .padding(.bottom, 100)
            }
            .refreshable {
                await vm.load(userID: userID)
            }
        }
        .task {
            await vm.load(userID: userID, isOwnProfile: isOwnProfile)
            if !isOwnProfile, let me = authVM.user?.id, me != userID {
                await vm.loadFollowState(currentUserID: me, targetID: userID)
                await vm.loadBlockState(targetID: userID)
            }
        }
        .toolbar {
            if canModerate {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button(role: .destructive) {
                            showReportSheet = true
                        } label: {
                            Label("Report user", systemImage: "flag")
                        }
                        if vm.isBlocked {
                            Button {
                                showBlockConfirmation = true
                            } label: {
                                Label("Unblock user", systemImage: "person.crop.circle.badge.checkmark")
                            }
                        } else {
                            Button(role: .destructive) {
                                showBlockConfirmation = true
                            } label: {
                                Label("Block user", systemImage: "person.crop.circle.badge.xmark")
                            }
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                            .foregroundColor(.textMuted)
                    }
                    .accessibilityLabel("More actions")
                }
            }
        }
        .sheet(isPresented: $showReportSheet) {
            ReportContentSheet(
                contentType: .user,
                contentID: userID,
                contentLabel: "@\(vm.profile?.username ?? "user")"
            )
        }
        .alert(
            vm.isBlocked
                ? "Unblock @\(vm.profile?.username ?? "user")?"
                : "Block @\(vm.profile?.username ?? "user")?",
            isPresented: $showBlockConfirmation
        ) {
            Button("Cancel", role: .cancel) {}
            if vm.isBlocked {
                Button("Unblock") {
                    Task { await vm.toggleBlock(targetID: userID) }
                }
            } else {
                Button("Block", role: .destructive) {
                    Task {
                        if await vm.toggleBlock(targetID: userID) {
                            dismiss()
                        }
                    }
                }
            }
        } message: {
            Text(
                vm.isBlocked
                    ? "They'll appear in your feed and search again."
                    : "You won't see each other's posts, replies, or search results. They won't be notified."
            )
        }
        .sheet(isPresented: $showEditSheet) {
            if isOwnProfile, let profile = vm.profile {
                EditProfileView(profile: profile) {
                    Task { await vm.load(userID: userID) }
                }
            }
        }
        .sheet(isPresented: $showFollowersSheet) {
            UserListSheet(
                title: "Followers",
                users: vm.followers,
                emptyMessage: "No followers yet"
            )
        }
        .sheet(isPresented: $showFollowingSheet) {
            UserListSheet(
                title: "Following",
                users: vm.following,
                emptyMessage: "Not following anyone yet"
            )
        }
        .sheet(isPresented: Binding(
            get: { chatConversationID != nil },
            set: { if !$0 { chatConversationID = nil } }
        )) {
            if let convoID = chatConversationID, let me = authVM.user?.id {
                NavigationStack {
                    ChatView(
                        conversationID: convoID,
                        currentUserID: me,
                        title: vm.profile?.displayName ?? vm.profile?.username ?? "Chat"
                    )
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button("Done") { chatConversationID = nil }
                                .foregroundColor(.textSecondary)
                        }
                    }
                }
            }
        }
    }

    private var profileContent: some View {
        VStack(spacing: 20) {
            BoykImage(urlString: vm.profile?.profilePictureURL) {
                profileInitial
            }
            .aspectRatio(contentMode: .fill)
            .frame(width: 80, height: 80)
            .background(Color.bgCard)
            .clipShape(Circle())
            .overlay(Circle().stroke(Color.border, lineWidth: 1))

            // Name
            VStack(spacing: 4) {
                Text(vm.profile?.displayName ?? vm.profile?.username ?? "User")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundColor(.textPrimary)

                if let username = vm.profile?.username {
                    Text("@\(username)")
                        .font(.system(size: 13))
                        .foregroundColor(.textMuted)
                }
            }

            // Follow / Unfollow + Message — other users only, when signed in
            if !isOwnProfile, let me = authVM.user?.id, me != userID {
                HStack(spacing: 10) {
                    Button {
                        Task { await vm.toggleFollow(targetID: userID) }
                    } label: {
                        Text(vm.isFollowing ? "Following" : "Follow")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(vm.isFollowing ? .textPrimary : .white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(vm.isFollowing ? AnyShapeStyle(Color.bgCard) : AnyShapeStyle(LinearGradient.boykAccent))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .overlay(
                                RoundedRectangle(cornerRadius: 10)
                                    .stroke(Color.border, lineWidth: vm.isFollowing ? 1 : 0)
                            )
                    }

                    Button {
                        Task {
                            openingChat = true
                            chatConversationID = try? await SupabaseService.shared
                                .getOrCreateConversation(otherUserID: userID)
                            openingChat = false
                        }
                    } label: {
                        HStack(spacing: 6) {
                            if openingChat {
                                ProgressView().tint(.textPrimary).scaleEffect(0.7)
                            } else {
                                Image(systemName: "bubble.left")
                            }
                            Text("Message")
                        }
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.textPrimary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(Color.bgCard)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.border, lineWidth: 1))
                    }
                    .disabled(openingChat)
                }
                .padding(.horizontal, 32)
            }

            // Bio
            if let bio = vm.profile?.bio, !bio.isEmpty {
                Text(bio)
                    .font(.system(size: 14))
                    .foregroundColor(.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            // Join date
            if let joined = vm.profile?.joinedLabel {
                HStack(spacing: 4) {
                    Image(systemName: "calendar").font(.system(size: 11))
                    Text(joined).font(.system(size: 12))
                }
                .foregroundColor(.textMuted)
            }

            // Stats
            HStack(spacing: 0) {
                Button {
                    Task { await vm.loadFollowers(userID: userID) }
                    showFollowersSheet = true
                } label: {
                    VStack(spacing: 4) {
                        Text("\(vm.followerCount)")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundColor(.textPrimary)
                        Text("followers")
                            .font(.system(size: 11))
                            .foregroundColor(.textMuted)
                    }
                    .frame(maxWidth: .infinity)
                }

                Button {
                    Task { await vm.loadFollowing(userID: userID) }
                    showFollowingSheet = true
                } label: {
                    VStack(spacing: 4) {
                        Text("\(vm.followingCount)")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundColor(.textPrimary)
                        Text("following")
                            .font(.system(size: 11))
                            .foregroundColor(.textMuted)
                    }
                    .frame(maxWidth: .infinity)
                }

                statItem(value: vm.boycotts.count, label: "boycotts", accent: true)
            }

            // Boycotts — own profile gets the Boycotts/Tracking/Requests
            // segmented control (folded in from the former Home tab); other
            // users show a simple recent-boycotts list.
            if isOwnProfile {
                ownSections
            } else if !vm.boycotts.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Recent Boycotts")
                        .sectionHeader()
                        .padding(.horizontal)

                    ForEach(vm.boycotts.prefix(5)) { boycott in
                        NavigationLink(destination: BoycottDetailView(boycott: boycott)) {
                            BoycottCard(boycott: boycott)
                        }
                        .buttonStyle(.plain)
                        .padding(.horizontal)
                    }
                }
            } else {
                Text("No public boycotts yet.")
                    .font(.system(size: 14))
                    .foregroundColor(.textMuted)
                    .padding(32)
            }
        }
        .padding(.top, 24)
    }

    @ViewBuilder
    private var ownSections: some View {
        Picker("Section", selection: $ownTab) {
            ForEach(OwnTab.allCases, id: \.self) { tab in
                Text(tab == .requests && !vm.followRequests.isEmpty
                    ? "Requests (\(vm.followRequests.count))"
                    : tab.rawValue).tag(tab)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal)

        switch ownTab {
        case .boycotts:
            boycottList(vm.boycotts, empty: "You haven't created any boycotts yet.")
        case .tracking:
            boycottList(vm.followedBoycotts, empty: "You're not tracking any boycotts yet.")
        case .requests:
            requestList
        }
    }

    @ViewBuilder
    private func boycottList(_ list: [Boycott], empty: String) -> some View {
        if list.isEmpty {
            Text(empty)
                .font(.system(size: 14))
                .foregroundColor(.textMuted)
                .padding(32)
        } else {
            ForEach(list) { boycott in
                NavigationLink(destination: BoycottDetailView(boycott: boycott)) {
                    BoycottCard(boycott: boycott)
                }
                .buttonStyle(.plain)
                .padding(.horizontal)
            }
        }
    }

    @ViewBuilder
    private var requestList: some View {
        if vm.followRequests.isEmpty {
            Text("No pending follow requests.")
                .font(.system(size: 14))
                .foregroundColor(.textMuted)
                .padding(32)
        } else {
            ForEach(vm.followRequests) { req in
                HStack(spacing: 12) {
                    Text("@\(req.requester?.username ?? "user")")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.textPrimary)
                    Spacer()
                    Button("Accept") {
                        Task { await vm.acceptRequest(requesterID: req.requesterID) }
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(LinearGradient.boykAccent)
                    .clipShape(Capsule())

                    Button("Decline") {
                        Task { await vm.rejectRequest(requesterID: req.requesterID) }
                    }
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(.textSecondary)
                }
                .padding(.horizontal)
            }
        }
    }

    private var profileInitial: some View {
        Text(String((vm.profile?.username ?? "U").prefix(1)).uppercased())
            .font(.system(size: 28, weight: .semibold))
            .foregroundColor(.textMuted)
    }

    private func statItem(value: Int, label: String, accent: Bool = false) -> some View {
        VStack(spacing: 4) {
            Text("\(value)")
                .font(.system(size: 18, weight: .semibold))
                .foregroundColor(accent ? .accent : .textPrimary)
            Text(label)
                .font(.system(size: 11))
                .foregroundColor(.textMuted)
        }
        .frame(maxWidth: .infinity)
    }

    private var notFoundView: some View {
        VStack(spacing: 16) {
            Text("User not found")
                .font(.system(size: 14))
                .foregroundColor(.textMuted)
        }
        .padding(48)
    }
}

// MARK: - Edit Profile

@MainActor
struct EditProfileView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var username: String
    @State private var displayName: String
    @State private var bio: String
    @State private var isSaving = false
    @State private var error: String?
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var selectedImageData: Data?
    @State private var profilePictureURL: String?

    let onSave: () -> Void

    init(profile: UserProfile, onSave: @escaping () -> Void) {
        _username = State(initialValue: profile.username ?? "")
        _displayName = State(initialValue: profile.displayName ?? "")
        _bio = State(initialValue: profile.bio ?? "")
        _profilePictureURL = State(initialValue: profile.profilePictureURL)
        self.onSave = onSave
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.bgDark.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 20) {
                        // Profile Picture
                        VStack(spacing: 12) {
                            ZStack(alignment: .bottomTrailing) {
                                avatarPreview

                                PhotosPicker(selection: $selectedPhoto, matching: .images) {
                                    Image(systemName: "camera.fill")
                                        .font(.system(size: 12))
                                        .foregroundColor(.white)
                                        .padding(6)
                                        .background(Color.accent)
                                        .clipShape(Circle())
                                }
                            }

                            Text("Change Photo")
                                .font(.system(size: 13))
                                .foregroundColor(.accent)
                        }

                        VStack(alignment: .leading, spacing: 8) {
                            Text("USERNAME")
                                .sectionHeader()
                            TextField("Username", text: $username)
                                .foregroundColor(.textPrimary)
                                .padding(14)
                                .background(Color.bgCard)
                                .overlay(Rectangle().stroke(Color.border, lineWidth: 1))
                                .autocapitalization(.none)
                                .disableAutocorrection(true)
                        }

                        VStack(alignment: .leading, spacing: 8) {
                            Text("DISPLAY NAME")
                                .sectionHeader()
                            TextField("Display Name", text: $displayName)
                                .foregroundColor(.textPrimary)
                                .padding(14)
                                .background(Color.bgCard)
                                .overlay(Rectangle().stroke(Color.border, lineWidth: 1))
                        }

                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text("BIO")
                                    .sectionHeader()
                                Spacer()
                                Text("\(bio.count)/500")
                                    .font(.system(size: 11))
                                    .foregroundColor(bio.count > 500 ? .danger : .textMuted)
                            }
                            TextEditor(text: $bio)
                                .foregroundColor(.textPrimary)
                                .scrollContentBackground(.hidden)
                                .frame(minHeight: 100)
                                .padding(14)
                                .background(Color.bgCard)
                                .overlay(Rectangle().stroke(Color.border, lineWidth: 1))
                                .onChange(of: bio) { _, newValue in
                                    if newValue.count > 500 {
                                        bio = String(newValue.prefix(500))
                                    }
                                }
                        }

                        if let error {
                            Text(error)
                                .font(.system(size: 13))
                                .foregroundColor(.danger)
                                .padding(12)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color.danger.opacity(0.1))
                        }
                    }
                    .padding()
                }
            }
            .navigationTitle("Edit Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .foregroundColor(.textMuted)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task { await save() }
                    }
                    .foregroundColor(.accent)
                    .disabled(isSaving || username.count < 3 || bio.count > 500)
                }
            }
            .onChange(of: selectedPhoto) { _, newItem in
                Task {
                    if let data = try? await newItem?.loadTransferable(type: Data.self) {
                        selectedImageData = data
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var avatarPreview: some View {
        if let imageData = selectedImageData,
           let uiImage = UIImage(data: imageData) {
            Image(uiImage: uiImage)
                .resizable()
                .scaledToFill()
                .frame(width: 80, height: 80)
                .clipShape(Circle())
                .overlay(Circle().stroke(Color.border, lineWidth: 1))
        } else if let url = profilePictureURL,
                  let imageURL = URL(string: url) {
            BoykImage(url: imageURL) {
                photoPlaceholder
            }
            .aspectRatio(contentMode: .fill)
            .frame(width: 80, height: 80)
            .clipShape(Circle())
            .overlay(Circle().stroke(Color.border, lineWidth: 1))
        } else {
            photoPlaceholder
        }
    }

    private var photoPlaceholder: some View {
        Circle()
            .fill(Color.bgCard)
            .frame(width: 80, height: 80)
            .overlay(
                Image(systemName: "person.fill")
                    .font(.system(size: 28))
                    .foregroundColor(.textMuted)
            )
            .overlay(Circle().stroke(Color.border, lineWidth: 1))
    }

    private func save() async {
        isSaving = true
        error = nil

        do {
            var pictureURL = profilePictureURL

            // Upload new photo if selected
            if let imageData = selectedImageData {
                // Downscale before upload — avatars render at ≤100pt, and a
                // full-resolution camera photo is several MB that every feed
                // cell would otherwise re-download.
                if let uiImage = UIImage(data: imageData),
                   let jpegData = uiImage.resizedToFit(maxDimension: 512).jpegData(compressionQuality: 0.8) {
                    pictureURL = try await SupabaseService.shared.uploadProfilePicture(data: jpegData)
                }
            }

            try await SupabaseService.shared.updateProfile(
                username: username.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
                displayName: displayName.trimmingCharacters(in: .whitespacesAndNewlines),
                bio: bio.trimmingCharacters(in: .whitespacesAndNewlines),
                pictureURL: pictureURL
            )
            onSave()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }

        isSaving = false
    }
}
