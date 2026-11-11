import SwiftUI

struct OfflineBanner: View {
    @EnvironmentObject var monitor: NetworkMonitor
    @State private var showReconnectedToast = false
    @State private var reconnectTask: Task<Void, Never>?

    var body: some View {
        Group {
            switch displayState {
            case .hidden:
                EmptyView()
            case .offline:
                banner(
                    text: "You're offline",
                    icon: "wifi.slash",
                    background: Color.danger.opacity(0.95),
                    foreground: .white
                )
                .transition(.move(edge: .top).combined(with: .opacity))
            case .reconnected:
                banner(
                    text: "Back online",
                    icon: "checkmark.circle.fill",
                    background: Color.green.opacity(0.92),
                    foreground: .white
                )
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.25), value: displayState)
        .sensoryFeedback(.warning, trigger: monitor.status == .offline)
        .sensoryFeedback(.success, trigger: showReconnectedToast)
        .onChange(of: monitor.status) { _, newStatus in
            if newStatus == .online {
                reconnectTask?.cancel()
                showReconnectedToast = true
                reconnectTask = Task {
                    try? await Task.sleep(for: .seconds(2))
                    if !Task.isCancelled {
                        await MainActor.run { showReconnectedToast = false }
                    }
                }
            } else {
                showReconnectedToast = false
            }
        }
        .accessibilityElement(children: .combine)
    }

    private enum DisplayState: Equatable {
        case hidden, offline, reconnected
    }

    private var displayState: DisplayState {
        switch monitor.status {
        case .offline:
            return .offline
        case .online:
            return showReconnectedToast ? .reconnected : .hidden
        case .unknown:
            return .hidden
        }
    }

    private func banner(text: String, icon: String, background: Color, foreground: Color) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
            Text(text)
                .font(.system(size: 13, weight: .semibold))
            Spacer()
        }
        .foregroundColor(foreground)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .background(background)
        .accessibilityLabel(text)
    }
}
