import SwiftUI

/// The Messages inbox — a list of 1:1 conversations. Presented as a sheet from
/// the Feed toolbar's message icon.
struct MessagesView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @Environment(\.dismiss) private var dismiss
    @StateObject private var vm = MessagesViewModel()

    var body: some View {
        NavigationStack {
            ZStack {
                Color.bgDark.ignoresSafeArea()

                if vm.isLoading && vm.conversations.isEmpty {
                    ProgressView().tint(.accent)
                } else if vm.conversations.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "bubble.left.and.bubble.right")
                            .font(.system(size: 36))
                            .foregroundColor(.textMuted)
                        Text("No messages yet")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundColor(.textSecondary)
                        Text("Open someone's profile and tap Message to start a conversation.")
                            .font(.system(size: 13))
                            .foregroundColor(.textMuted)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 40)
                    }
                } else {
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(vm.conversations) { convo in
                                NavigationLink {
                                    if let uid = authVM.user?.id {
                                        ChatView(
                                            conversationID: convo.conversationID,
                                            currentUserID: uid,
                                            title: convo.displayName
                                        )
                                    }
                                } label: {
                                    ConversationRow(convo: convo)
                                }
                                .buttonStyle(.plain)
                                Divider().background(Color.border)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Messages")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") { dismiss() }.foregroundColor(.textSecondary)
                }
            }
            .task { await vm.load() }
            .refreshable { await vm.load() }
        }
    }
}

private struct ConversationRow: View {
    let convo: Conversation

    var body: some View {
        HStack(spacing: 12) {
            BoykImage(urlString: convo.otherProfilePictureURL) {
                Text(String(convo.displayName.prefix(1)).uppercased())
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.textMuted)
            }
            .aspectRatio(contentMode: .fill)
            .frame(width: 48, height: 48)
            .background(Color.bgCard)
            .clipShape(Circle())
            .overlay(Circle().stroke(Color.border, lineWidth: 1))

            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(convo.displayName)
                        .font(.system(size: 15, weight: convo.unreadCount > 0 ? .semibold : .medium))
                        .foregroundColor(.textPrimary)
                    Spacer()
                    Text(shortTimeLabel(convo.lastMessageAt))
                        .font(.system(size: 12))
                        .foregroundColor(.textMuted)
                }
                HStack {
                    Text(convo.lastMessageContent ?? "No messages yet")
                        .font(.system(size: 13))
                        .foregroundColor(convo.unreadCount > 0 ? .textPrimary : .textMuted)
                        .lineLimit(1)
                    Spacer()
                    if convo.unreadCount > 0 {
                        Text("\(convo.unreadCount)")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background(LinearGradient.boykAccent)
                            .clipShape(Capsule())
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }
}

/// A single 1:1 chat thread with bubbles and a composer.
struct ChatView: View {
    @StateObject private var vm: ChatViewModel
    let title: String

    init(conversationID: UUID, currentUserID: UUID, title: String) {
        _vm = StateObject(wrappedValue: ChatViewModel(
            conversationID: conversationID, currentUserID: currentUserID
        ))
        self.title = title
    }

    var body: some View {
        ZStack {
            Color.bgDark.ignoresSafeArea()

            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 8) {
                            ForEach(vm.messages) { message in
                                MessageBubble(
                                    message: message,
                                    isOwn: message.senderID == vm.currentUserID
                                )
                                .id(message.id)
                            }
                        }
                        .padding(16)
                    }
                    .onChange(of: vm.messages.count) { _, _ in
                        if let last = vm.messages.last {
                            withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                        }
                    }
                }

                composer
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.load() }
    }

    private var composer: some View {
        HStack(spacing: 10) {
            TextField("Message…", text: $vm.draft, axis: .vertical)
                .textFieldStyle(.plain)
                .foregroundColor(.textPrimary)
                .lineLimit(1...5)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Color.bgCard)
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.border, lineWidth: 1))

            Button {
                Task { await vm.send() }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(.white)
                    .frame(width: 36, height: 36)
                    .background(vm.canSend ? AnyShapeStyle(LinearGradient.boykAccent) : AnyShapeStyle(Color.bgCardHover))
                    .clipShape(Circle())
            }
            .disabled(!vm.canSend)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial)
    }
}

private struct MessageBubble: View {
    let message: Message
    let isOwn: Bool

    var body: some View {
        HStack {
            if isOwn { Spacer(minLength: 40) }
            VStack(alignment: isOwn ? .trailing : .leading, spacing: 2) {
                Text(message.content)
                    .font(.system(size: 15))
                    .foregroundColor(isOwn ? .white : .textPrimary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(
                        isOwn
                            ? AnyShapeStyle(LinearGradient.boykAccent)
                            : AnyShapeStyle(Color.bgCard)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                Text(shortTimeLabel(message.createdAt))
                    .font(.system(size: 10))
                    .foregroundColor(.textMuted)
            }
            if !isOwn { Spacer(minLength: 40) }
        }
    }
}
