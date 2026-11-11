import SwiftUI

public struct RootView: View {
    @EnvironmentObject var authVM: AuthViewModel
    // Drives the whole app's light/dark appearance from the Settings toggle.
    // Applied once here (the single top-level view) so it covers both the auth
    // screens and the main tab bar. Default dark, matching the web brand.
    @AppStorage("colorScheme") private var colorScheme: String = "dark"

    public init() {}

    public var body: some View {
        Group {
            switch authVM.state {
            case .loading:
                LoadingView()
            case .unauthenticated:
                AuthView()
            case .authenticated:
                MainTabView()
            }
        }
        .preferredColorScheme(colorScheme == "light" ? .light : .dark)
        .task {
            await authVM.restoreSession()
        }
        // Layouts use fixed font sizes; clamp the Dynamic Type range so users on
        // very-large accessibility sizes still get readable content without
        // unbounded layout explosions. Full semantic-font migration is future work.
        .dynamicTypeSize(.xSmall ... .accessibility1)
    }
}

private struct LoadingView: View {
    var body: some View {
        ZStack {
            Color.bgDark.ignoresSafeArea()
            ProgressView()
                .tint(.accent)
        }
    }
}
