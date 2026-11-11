import Foundation
import UIKit
import UserNotifications

/// Scaffolded push notifications. Code is fully wired but currently inert
/// because the aps-environment entitlement is commented out (see
/// Config/Boyk.entitlements). Once the Apple Developer team has Push enabled
/// and an APNs key is uploaded:
///
/// 1. Uncomment aps-environment in Boyk.entitlements
/// 2. In Supabase, create a `device_tokens` table or RPC that PushTokenSink writes to
/// 3. Invoke `PushNotificationService.shared.requestAuthorization()` from a UI action
///    (Settings toggle, or in onboarding after a meaningful first action)
@MainActor
public final class PushNotificationService: NSObject, ObservableObject {
    public static let shared = PushNotificationService()

    @Published public private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined
    @Published public private(set) var deviceToken: String?

    private override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
        Task { await refreshAuthorizationStatus() }
    }

    /// Prompt the user. iOS only shows the system dialog the *first* time;
    /// subsequent calls return the cached decision without UI.
    public func requestAuthorization() async -> Bool {
        do {
            let granted = try await UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .sound, .badge])
            await refreshAuthorizationStatus()
            if granted {
                UIApplication.shared.registerForRemoteNotifications()
            }
            return granted
        } catch {
            return false
        }
    }

    public func refreshAuthorizationStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        self.authorizationStatus = settings.authorizationStatus
        if settings.authorizationStatus == .authorized {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    /// Called by AppDelegate adapter when APNs delivers a token.
    public func captureDeviceToken(_ data: Data) {
        let hex = data.map { String(format: "%02x", $0) }.joined()
        self.deviceToken = hex
        // TODO: forward to Supabase once a `device_tokens` table or RPC exists.
        // Pattern (drop in when ready):
        //   try? await supabase.rpc("upsert_device_token", params: ["token": hex, "platform": "ios"]).execute()
        #if DEBUG
        print("[Push] device token captured: \(hex.prefix(8))…\(hex.suffix(8))")
        #endif
    }

    public func captureRegistrationFailure(_ error: Error) {
        #if DEBUG
        print("[Push] registration failed: \(error.localizedDescription)")
        #endif
    }
}

extension PushNotificationService: UNUserNotificationCenterDelegate {
    /// Foreground notification presentation — show as banner with sound.
    nonisolated public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    /// User tapped a notification — placeholder for deep-link handling.
    nonisolated public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        // Future: parse response.notification.request.content.userInfo for a
        // boycott/post/user id and route via DeepLinkRouter.
    }
}
