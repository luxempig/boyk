import Foundation
import Sentry

public enum SentryService {
    public static func start(dsn: String) {
        guard !dsn.isEmpty else { return }

        SentrySDK.start { options in
            options.dsn = dsn
            options.releaseName = bundleRelease()
            options.environment = environmentName()

            // Crashes + unhandled errors only — no performance traces by default.
            options.tracesSampleRate = 0.0

            options.enableAutoBreadcrumbTracking = true
            options.enableNetworkBreadcrumbs = true

            // No IP address or other personal data; setUser sends only the
            // opaque user ID, enough to tell one user's crash from a widespread one.
            options.sendDefaultPii = false

            options.attachStacktrace = true
            options.enableAutoSessionTracking = true
        }
    }

    public static func setUser(id: String) {
        guard !Config.sentryDSN.isEmpty else { return }
        SentrySDK.setUser(User(userId: id))
    }

    public static func clearUser() {
        guard !Config.sentryDSN.isEmpty else { return }
        SentrySDK.setUser(nil)
    }

    public static func capture(_ error: Error, message: String? = nil) {
        guard !Config.sentryDSN.isEmpty else { return }
        if let message {
            SentrySDK.capture(message: message) { scope in
                scope.setExtra(value: String(describing: error), key: "underlying_error")
            }
        } else {
            SentrySDK.capture(error: error)
        }
    }

    private static func bundleRelease() -> String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0"
        return "org.boyk.app@\(version)+\(build)"
    }

    private static func environmentName() -> String {
        #if DEBUG
        return "debug"
        #else
        return "production"
        #endif
    }
}
