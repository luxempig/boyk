import UIKit
import SwiftUI

/// Bridges UIKit's APNs callbacks into our @MainActor PushNotificationService.
/// SwiftUI's @UIApplicationDelegateAdaptor mounts this; nothing else uses it.
public final class BoykAppDelegate: NSObject, UIApplicationDelegate {
    public func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in
            PushNotificationService.shared.captureDeviceToken(deviceToken)
        }
    }

    public func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Task { @MainActor in
            PushNotificationService.shared.captureRegistrationFailure(error)
        }
    }
}
