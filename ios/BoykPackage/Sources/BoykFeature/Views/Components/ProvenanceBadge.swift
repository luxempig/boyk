import SwiftUI

/// The sourced-claim stamp, mirroring the web ProvenanceBadge: a mono source
/// tag that links to the original record (or the source's site) when
/// resolvable, a confidence dot, and a corroboration count. Renders nothing
/// when there's no source.
struct ProvenanceBadge: View {
    let source: String?
    var confidence: String? = nil
    var sourceURLString: String? = nil
    var entityID: String? = nil
    var corroboratedCount: Int = 0

    var body: some View {
        if let source, !source.isEmpty {
            HStack(spacing: 4) {
                tag(source)
                if let confidence, !confidence.isEmpty {
                    ConfidenceDot(level: confidence)
                }
                if corroboratedCount > 0 {
                    Text("+\(corroboratedCount)")
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundColor(.info)
                }
            }
        }
    }

    @ViewBuilder
    private func tag(_ source: String) -> some View {
        let label = Provenance.label(source)
        if let url = Provenance.sourceURL(source: source, id: entityID, sourceURLString: sourceURLString) {
            Link(destination: url) {
                tagLabel(label)
            }
            .buttonStyle(.plain)
        } else {
            tagLabel(label)
        }
    }

    private func tagLabel(_ label: String) -> some View {
        Text(label.uppercased())
            .font(.system(size: 9, weight: .medium, design: .monospaced))
            .tracking(0.5)
            .foregroundColor(.textMuted)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(Color.bgDark)
            .clipShape(RoundedRectangle(cornerRadius: 3))
    }
}

/// Small confidence indicator dot (green/amber/red), matching the web
/// ConfidenceDot semantics: high = verified, medium = corroboration pending,
/// low = single unverified source.
struct ConfidenceDot: View {
    let level: String
    var size: CGFloat = 7

    private var color: Color {
        switch level.lowercased() {
        case "high": return .success
        case "medium": return .warning
        case "low": return .danger
        default: return .textMuted
        }
    }

    private var help: String {
        switch level.lowercased() {
        case "high": return "High confidence — verified by authoritative source"
        case "medium": return "Medium confidence — corroboration pending"
        case "low": return "Low confidence — single unverified source"
        default: return "\(level) confidence"
        }
    }

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: size, height: size)
            .help(help)
            .accessibilityLabel(help)
    }
}
