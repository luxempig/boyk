import SwiftUI
import UIKit

// Colors mirror the web app's CSS tokens (src/index.css). Each is a DYNAMIC
// color that resolves light vs dark per the active trait/colorScheme, so the
// app's appearance toggle (.preferredColorScheme at the root) actually retints
// the whole UI — previously every color was a fixed dark hex, so "Light" only
// changed the system chrome and left the app dark-on-light (broken).
extension Color {
    // Backgrounds — dark: near-black charcoal; light: warm cream/white (web)
    static let bgDark = Color(light: "faf9f7", dark: "0a0a0a")
    static let bgCard = Color(light: "ffffff", dark: "141414")
    static let bgCardHover = Color(light: "f5f4f2", dark: "1a1a1a")

    // Text — light tokens clear AA on the cream/white backgrounds
    static let textPrimary = Color(light: "18181b", dark: "e5e5e5")
    static let textSecondary = Color(light: "475569", dark: "b0b0b0")
    static let textMuted = Color(light: "6b7280", dark: "8a8a94")

    // Accent — candy pink (web --highlight family), NOT indigo. The flat
    // indigo accent read as generic "AI purple"; the brand identity is the
    // pink→green candy spectrum, so pink anchors links, tints, and selection.
    // Light mode darkens two stops for AA: #db2777 is 4.60:1 on white but only
    // 4.37:1 on the cream page background, where most accent text sits;
    // #be185d is 6.04:1 / 5.74:1. Matches the web app's light accent.
    static let accent = Color(light: "be185d", dark: "f472b6")
    static let accentSubtle = Color(light: "be185d", dark: "f472b6").opacity(0.08)

    // Candy gradient stops (deep pink → pink → green). Compose via
    // LinearGradient.boykAccent.
    static let logoDeepPink = Color(light: "9d174d", dark: "ec4899")
    static let logoPink = Color(light: "be185d", dark: "f472b6")
    static let logoGreen = Color(light: "047857", dark: "34d399")

    // Borders
    static let border = Color(light: "e4e4e7", dark: "2a2a2a")

    // Status — darkened in light mode so they read on white
    static let danger = Color(light: "dc2626", dark: "ef4444")
    static let success = Color(light: "16a34a", dark: "22c55e")
    static let warning = Color(light: "d97706", dark: "fb923c")
    static let info = Color(light: "0891b2", dark: "06b6d4")
    static let highlight = Color(light: "be185d", dark: "ec4899")

    // Connection type colors — aligned to web's connection palette
    // (owned_by=blue parents, owns=green subsidiaries, suppliers=amber,
    // customers=cyan, brands=purple, people=pink).
    static let connectionParent = Color(light: "2563eb", dark: "3b82f6")
    static let connectionSubsidiary = Color(light: "16a34a", dark: "22c55e")
    static let connectionSupplier = Color(light: "d97706", dark: "f59e0b")
    static let connectionCustomer = Color(light: "0891b2", dark: "06b6d4")
    static let connectionBrand = Color(light: "9333ea", dark: "a855f7")
    static let connectionPeople = Color(light: "db2777", dark: "ec4899")
}

extension LinearGradient {
    /// The Boyk candy gradient (deep pink → pink → green). The indigo stop the
    /// web wordmark carries is deliberately dropped on iOS — flat indigo/purple
    /// is out of the palette. Use as a ShapeStyle on primary CTAs:
    /// `.background(LinearGradient.boykAccent)` / `.fill(...)`.
    /// Stops are weighted rather than evenly spaced. Pink and green are
    /// near-opposite hues at similar darkness, so interpolating between them in
    /// sRGB passes through a desaturated olive — very visible when the gradient
    /// is stretched across a full-width button. Pushing the light pink to 0.62
    /// compresses that band into the trailing edge instead of parking it in the
    /// middle of the control.
    static let boykAccent = LinearGradient(
        stops: [
            .init(color: .logoDeepPink, location: 0.0),
            .init(color: .logoPink, location: 0.62),
            .init(color: .logoGreen, location: 1.0),
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
}

extension Color {
    /// Dynamic color resolving to `light` or `dark` (hex) per the active trait.
    init(light: String, dark: String) {
        self.init(uiColor: UIColor { traits in
            UIColor(Color(hex: traits.userInterfaceStyle == .dark ? dark : light))
        })
    }

    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 6:
            (a, r, g, b) = (255, (int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = ((int >> 24) & 0xFF, (int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}

// Common view modifiers
struct CardModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(16)
            .background(Color.bgCard)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color.border, lineWidth: 1)
            )
    }
}

struct SectionHeaderModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.system(size: 11, weight: .medium))
            .foregroundColor(.textMuted)
            .textCase(.uppercase)
            .tracking(2)
    }
}

extension View {
    func cardStyle() -> some View {
        modifier(CardModifier())
    }

    func sectionHeader() -> some View {
        modifier(SectionHeaderModifier())
    }
}
