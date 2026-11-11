import SwiftUI

struct ComposePostView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var vm = ComposePostViewModel()
    @FocusState private var contentFocused: Bool
    @State private var publishedCount = 0
    var currentUserID: UUID?
    let onPublished: (Post) -> Void

    var body: some View {
        NavigationStack {
            ZStack {
                Color.bgDark.ignoresSafeArea()

                VStack(alignment: .leading, spacing: 0) {
                    TextField("What's happening?", text: $vm.content, axis: .vertical)
                        .focused($contentFocused)
                        .textFieldStyle(.plain)
                        .font(.system(size: 17))
                        .foregroundColor(.textPrimary)
                        .padding(.horizontal, 16)
                        .padding(.top, 12)
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                        .lineLimit(3...12)

                    Spacer()

                    HStack(spacing: 12) {
                        audienceMenu

                        if !vm.myBoycotts.isEmpty {
                            boycottMenu
                        }

                        Spacer()

                        Text("\(vm.charactersRemaining)")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(charCountColor)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .overlay(
                        Rectangle().fill(Color.border).frame(height: 0.5),
                        alignment: .top
                    )
                }
            }
            .navigationTitle("New Post")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                        .foregroundColor(.textMuted)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task {
                            if let newPost = await vm.submit() {
                                publishedCount += 1
                                onPublished(newPost)
                                dismiss()
                            }
                        }
                    } label: {
                        if vm.isSubmitting {
                            ProgressView().tint(.accent)
                        } else {
                            Text("Post")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundColor(vm.canSubmit ? .accent : .textMuted)
                        }
                    }
                    .disabled(!vm.canSubmit)
                }
            }
            .task {
                contentFocused = true
                if let currentUserID {
                    await vm.loadBoycotts(userID: currentUserID)
                }
            }
            .alert("Couldn't post", isPresented: .constant(vm.error != nil), actions: {
                Button("OK") { vm.error = nil }
            }, message: {
                Text(vm.error ?? "")
            })
            .sensoryFeedback(.success, trigger: publishedCount)
        }
    }

    private var audienceMenu: some View {
        Menu {
            ForEach(PostAudience.allCases, id: \.rawValue) { option in
                Button {
                    vm.audience = option
                } label: {
                    Label(option.label, systemImage: option.systemImage)
                }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: vm.audience.systemImage)
                    .font(.system(size: 12))
                Text(vm.audience.label)
                    .font(.system(size: 13, weight: .medium))
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .semibold))
            }
            .foregroundColor(.accent)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .overlay(
                Capsule().stroke(Color.accent.opacity(0.5), lineWidth: 1)
            )
        }
    }

    private var boycottMenu: some View {
        Menu {
            Button {
                vm.boycottID = nil
            } label: {
                Label("None", systemImage: vm.boycottID == nil ? "checkmark" : "")
            }
            ForEach(vm.myBoycotts) { boycott in
                Button {
                    vm.boycottID = boycott.id
                } label: {
                    Label(boycott.name, systemImage: vm.boycottID == boycott.id ? "checkmark" : "megaphone")
                }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "megaphone")
                    .font(.system(size: 12))
                Text(vm.selectedBoycott?.name ?? "Boycott")
                    .font(.system(size: 13, weight: .medium))
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .semibold))
            }
            .foregroundColor(vm.boycottID != nil ? .white : .accent)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                vm.boycottID != nil ? AnyShapeStyle(LinearGradient.boykAccent) : AnyShapeStyle(Color.clear)
            )
            .overlay(
                Capsule().stroke(Color.accent.opacity(vm.boycottID != nil ? 0 : 0.5), lineWidth: 1)
            )
            .clipShape(Capsule())
        }
    }

    private var charCountColor: Color {
        let remaining = vm.charactersRemaining
        if remaining < 0 { return .danger }
        if remaining < 20 { return .warning }
        return .textMuted
    }
}
