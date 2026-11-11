import Foundation
import Network

@MainActor
public final class NetworkMonitor: ObservableObject {
    public enum Status: Sendable, Equatable {
        case unknown
        case online
        case offline
    }

    @Published public private(set) var status: Status = .unknown
    @Published public private(set) var isExpensive: Bool = false

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "org.boyk.network-monitor")
    private var didReceiveFirstUpdate = false

    public var onReconnect: (() -> Void)?

    public init() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor [weak self] in
                self?.apply(path: path)
            }
        }
        monitor.start(queue: queue)
    }

    deinit {
        monitor.cancel()
    }

    private func apply(path: NWPath) {
        let previousStatus = status
        let newStatus: Status = path.status == .satisfied ? .online : .offline

        self.status = newStatus
        self.isExpensive = path.isExpensive

        // Only fire reconnect callback when we transition from a known-offline state to online.
        // Skips the initial .unknown → .online transition on launch.
        if didReceiveFirstUpdate, previousStatus == .offline, newStatus == .online {
            onReconnect?()
        }
        didReceiveFirstUpdate = true
    }
}
