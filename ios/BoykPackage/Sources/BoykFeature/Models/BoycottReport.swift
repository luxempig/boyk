import Foundation

/// Mirrors the `boycott_report_reason` Postgres enum.
/// Server-side validation enforces that `details` is non-empty when
/// the reason is `.other`; the UI mirrors that rule so submit stays
/// disabled until the user has typed something.
enum BoycottReportReason: String, CaseIterable, Sendable, Identifiable {
    case spam
    case misinformation
    case harassment
    case offTopic = "off_topic"
    case duplicate
    case illegal
    case inappropriate
    case other

    var id: String { rawValue }

    var label: String {
        switch self {
        case .spam:           return "Spam or promotional content"
        case .misinformation: return "False or misleading claims"
        case .harassment:     return "Harassment, hate speech, or targeting"
        case .offTopic:       return "Not a real boycott"
        case .duplicate:      return "Duplicate of an existing boycott"
        case .illegal:        return "Illegal activity, doxxing, or threats"
        case .inappropriate:  return "NSFW or gratuitous violence"
        case .other:          return "Something else"
        }
    }

    /// Whether the free-text "details" field is required for this reason.
    var requiresDetails: Bool { self == .other }
}
