import Foundation

/// Lightweight Hashable wrappers used as `NavigationLink(value:)` payloads.
/// We can't conform domain models like Boycott directly because the `boycottCompanies`
/// array contains `BoycottCompanyEntry` which has Bool? fields — Hashable would be
/// derived but introducing it on user-facing models conflates routing with serialisation.
/// Keeping routes as separate types lets us evolve nav payloads (e.g. add tab hints)
/// without leaking those into Codable models.
struct BoycottRoute: Hashable {
    let boycott: Boycott
    let isAdopted: Bool

    static func == (lhs: BoycottRoute, rhs: BoycottRoute) -> Bool {
        lhs.boycott.id == rhs.boycott.id && lhs.isAdopted == rhs.isAdopted
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(boycott.id)
        hasher.combine(isAdopted)
    }
}
