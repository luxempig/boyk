import SwiftUI
import BoykFeature

@main
struct BoykApp: App {
    @UIApplicationDelegateAdaptor(BoykAppDelegate.self) var appDelegate
    @StateObject private var authVM = AuthViewModel()
    @StateObject private var themeVM = ThemeViewModel()
    @StateObject private var networkMonitor = NetworkMonitor()
    @StateObject private var deepLinkRouter = DeepLinkRouter()

    init() {
        SentryService.start(dsn: Config.sentryDSN)
        ImagePipelineConfig.configure()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(authVM)
                .environmentObject(themeVM)
                .environmentObject(networkMonitor)
                .environmentObject(deepLinkRouter)
                .onOpenURL { url in
                    deepLinkRouter.handle(url)
                }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL {
                        deepLinkRouter.handle(url)
                    }
                }
        }
    }
}
