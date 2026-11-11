import SwiftUI

struct MainTabView: View {
    @State private var selectedTab: Tab = .feed
    @AppStorage("boyk_onboarding_complete") private var onboardingComplete: Bool = false
    @State private var showOnboarding = false
    @State private var showCreateBoycott = false
    @State private var showCreatePost = false
    // Bumping these recreates the tab content so newly created entities appear
    // immediately after the global Create flow (the tab views load on .task).
    @State private var feedRefreshID = UUID()
    @State private var profileRefreshID = UUID()
    @EnvironmentObject var deepLinkRouter: DeepLinkRouter
    @EnvironmentObject var authVM: AuthViewModel

    // Five slots matching web's Feed / Check / ⊕ / Explore / Profile bar. The
    // middle slot is a placeholder tab that only exists to reserve centered,
    // correctly hit-tested space in the bar for the Create button drawn on top —
    // selecting it never sticks (onChange bounces back and opens the menu).
    enum Tab: String {
        case feed, check, create, explore, profile
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            TabView(selection: $selectedTab) {
                NavigationStack {
                    FeedView()
                }
                .id(feedRefreshID)
                .tag(Tab.feed)
                .tabItem { Label("Feed", systemImage: "newspaper.fill") }

                NavigationStack {
                    CheckProductView()
                }
                .tag(Tab.check)
                .tabItem { Label("Check", systemImage: "barcode.viewfinder") }

                // Placeholder slot under the Create button — see the Tab enum note.
                Color.clear
                    .tag(Tab.create)
                    .tabItem { Text("") }

                NavigationStack {
                    ExploreView()
                }
                .tag(Tab.explore)
                .tabItem { Label("Explore", systemImage: "magnifyingglass") }

                NavigationStack {
                    ProfileView()
                }
                .id(profileRefreshID)
                .tag(Tab.profile)
                .tabItem { Label("Profile", systemImage: "person.fill") }
            }
            .tint(.accent)

            createButton
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            OfflineBanner()
        }
        .sheet(isPresented: $showCreateBoycott) {
            if let uid = authVM.user?.id {
                BoycottEditorView(existing: nil, currentUserID: uid) { _ in
                    profileRefreshID = UUID()
                    selectedTab = .profile
                }
            }
        }
        .sheet(isPresented: $showCreatePost) {
            ComposePostView(currentUserID: authVM.user?.id) { _ in
                feedRefreshID = UUID()
                selectedTab = .feed
            }
        }
        .task {
            if !onboardingComplete {
                showOnboarding = true
            }
        }
        .sheet(isPresented: $showOnboarding) {
            OnboardingView()
                .interactiveDismissDisabled()
        }
        .onChange(of: deepLinkRouter.pending) { _, link in
            guard let link else { return }
            handleDeepLink(link)
            deepLinkRouter.consume()
        }
        .onChange(of: selectedTab) { oldValue, newValue in
            // The create slot is an action, not a destination — the Menu overlay
            // covers its full hit region, so this bounce is only a safety net.
            if newValue == .create {
                selectedTab = oldValue
            }
        }
    }

    // Circular gradient Create button, docked in the reserved middle tab slot so
    // it reads as part of the bar. A Menu (not a confirmationDialog) so the
    // options spring from the button itself. The label's hit frame spans the
    // whole slot, so taps anywhere in it open the menu rather than falling
    // through to the placeholder tab.
    private var createButton: some View {
        Menu {
            Button { showCreateBoycott = true } label: {
                Label("Boycott", systemImage: "megaphone.fill")
            }
            Button { showCreatePost = true } label: {
                Label("Post", systemImage: "square.and.pencil")
            }
        } label: {
            ZStack {
                Circle()
                    .fill(LinearGradient.boykAccent)
                    .frame(width: 44, height: 44)
                    .shadow(color: Color.accent.opacity(0.4), radius: 8, y: 2)
                Image(systemName: "plus")
                    .font(.system(size: 19, weight: .bold))
                    .foregroundColor(.white)
            }
            .frame(width: 74, height: 62)
            .contentShape(Rectangle())
        }
        .accessibilityLabel("Create")
        // Measured against the iOS 26 tab-bar capsule (y 758–823 on a 390pt-wide
        // device): the 62pt hit frame bottom-aligns with its center at y=779, and
        // +13 lands the circle on the capsule's geometric center (~791), which
        // coincides with the optical mid of the icon+label stacks (~792).
        .offset(y: 13)
        // The button is a ZStack sibling of the TabView rather than a real tab
        // item, so SwiftUI's keyboard avoidance lifts it on its own while the
        // bar underneath stays put. Pin it to the bar; the keyboard covers both.
        .ignoresSafeArea(.keyboard, edges: .bottom)
    }

    private func handleDeepLink(_ link: DeepLink) {
        switch link {
        case .openTab(let tab):
            selectedTab = Tab(rawValue: tab.rawValue) ?? selectedTab
        case .boycott, .post:
            selectedTab = .feed
        case .user:
            selectedTab = .profile
        case .company, .brand:
            selectedTab = .explore
        }
    }
}
