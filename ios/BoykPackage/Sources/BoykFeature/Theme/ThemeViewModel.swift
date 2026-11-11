import SwiftUI

@MainActor
public class ThemeViewModel: ObservableObject {
    @Published public var isDarkMode: Bool = true

    public init() {}
}
