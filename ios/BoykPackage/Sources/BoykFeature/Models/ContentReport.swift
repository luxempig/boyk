import Foundation

/// Mirrors the `content_type` check on the `content_reports` table. The
/// `report_content` RPC validates the same set server-side, so a stale client
/// can never insert an unknown type.
enum ReportableContentType: String, Sendable {
    case post
    case reply
    case user

    /// Noun used in sheet copy ("Report post", "Report user", …).
    var noun: String { rawValue }
}

extension BoycottReportReason {
    /// Labels for generic content reports (posts, replies, users). Same enum
    /// and raw values as boycott reports — only the two boycott-specific
    /// phrasings are reworded so they read naturally for feed content.
    var contentLabel: String {
        switch self {
        case .offTopic:  return "Off-topic or irrelevant"
        case .duplicate: return "Duplicate or repeated content"
        default:         return label
        }
    }
}
