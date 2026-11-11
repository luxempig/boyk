import Foundation

/// Parses incoming Universal Link URLs into typed routes that the app can act on.
/// The AASA at boyk.org maps `/boycott/*`, `/post/*`, `/user/*`, `/company/*`,
/// and `/brand/*` to this app — see public/_worker.js AASA_PAYLOAD.
public enum DeepLink: Sendable, Equatable {
    case boycott(id: String)
    case post(id: String)
    case user(id: String)
    case company(id: String)
    case brand(id: String)
    case openTab(MainTab)

    public enum MainTab: String, Sendable {
        case feed, home, explore, check, profile
    }
}

@MainActor
public final class DeepLinkRouter: ObservableObject {
    @Published public var pending: DeepLink?

    public init() {}

    public func handle(_ url: URL) {
        guard let link = Self.parse(url) else { return }
        self.pending = link
    }

    public func consume() {
        self.pending = nil
    }

    static func parse(_ url: URL) -> DeepLink? {
        guard let host = url.host?.lowercased(),
              host == "boyk.org" || host == "www.boyk.org"
        else { return nil }

        let segments = url.pathComponents.filter { $0 != "/" }
        guard let first = segments.first else { return .openTab(.feed) }

        switch first {
        case "boycott":
            guard segments.count >= 2 else { return nil }
            return .boycott(id: segments[1])
        case "b":
            guard segments.count >= 2 else { return nil }
            return .boycott(id: segments[1])
        case "post":
            guard segments.count >= 2 else { return nil }
            return .post(id: segments[1])
        case "user":
            guard segments.count >= 2 else { return nil }
            return .user(id: segments[1])
        case "company":
            guard segments.count >= 2 else { return nil }
            return .company(id: segments[1])
        case "brand":
            guard segments.count >= 2 else { return nil }
            return .brand(id: segments[1])
        case "feed", "home", "explore", "check", "profile":
            return .openTab(DeepLink.MainTab(rawValue: first) ?? .feed)
        default:
            return nil
        }
    }
}
