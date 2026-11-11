import Foundation

/// A seed company being edited in the boycott editor, with its five block flags.
struct EditorCompany: Identifiable, Equatable {
    let id: String          // Neo4j node id (LEI / Wikidata id)
    let name: String
    let logoURL: String?
    var blocks: BlockSelection
}

/// Drives both creating a new boycott and editing an existing one. Mirrors the
/// web Create/Edit boycott modals: name, description, visibility, and a set of
/// seed companies each carrying the five proxy-block toggles.
@MainActor
final class BoycottEditorViewModel: ObservableObject {
    @Published var name: String
    @Published var description: String
    @Published var isPublic: Bool
    @Published var companies: [EditorCompany]

    @Published var searchQuery = ""
    @Published var searchResults: [Company] = []
    @Published var isSearching = false

    @Published var isSaving = false
    @Published var error: String?

    let existing: Boycott?
    private let currentUserID: UUID
    private let originalCompanies: [EditorCompany]

    var isEditing: Bool { existing != nil }
    var canSave: Bool { !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSaving }

    init(existing: Boycott?, currentUserID: UUID, seed: EditorCompany? = nil) {
        self.existing = existing
        self.currentUserID = currentUserID

        if let existing {
            self.name = existing.name
            self.description = existing.description ?? ""
            self.isPublic = existing.isPublic
            let mapped = (existing.boycottCompanies ?? []).compactMap { entry -> EditorCompany? in
                guard let ref = entry.companies else { return nil }
                return EditorCompany(
                    id: ref.id,
                    name: ref.name,
                    logoURL: ref.logoURL,
                    blocks: BlockSelection(
                        subsidiaries: entry.blockOwns ?? false,
                        parents: entry.blockOwnedBy ?? false,
                        suppliers: entry.blockSuppliers ?? false,
                        brands: entry.blockBrands ?? false,
                        customers: entry.blockCustomers ?? false
                    )
                )
            }
            self.companies = mapped
            self.originalCompanies = mapped
        } else {
            self.name = ""
            self.description = ""
            // Private by default — matches the web editor, the DB column default,
            // and the onboarding copy ("Boycotts you create are private by default").
            self.isPublic = false
            // Pre-seed with a company when launched from a Boyk action.
            self.companies = seed.map { [$0] } ?? []
            self.originalCompanies = []
        }
    }

    // MARK: - Company search

    func search() async {
        let q = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard q.count >= 2 else {
            searchResults = []
            return
        }
        isSearching = true
        defer { isSearching = false }
        do {
            let results = try await Neo4jService.shared.searchCompanies(query: q, limit: 15)
            // Hide companies already added to this boycott.
            let added = Set(companies.map(\.id))
            searchResults = results.filter { !added.contains($0.id) }
        } catch {
            if !(error is CancellationError) {
                searchResults = []
            }
        }
    }

    func addCompany(_ company: Company) {
        guard !companies.contains(where: { $0.id == company.id }) else { return }
        // Default to blocking subsidiaries — the most common intent when adding a
        // parent company. The user can adjust before saving.
        companies.append(
            EditorCompany(
                id: company.id,
                name: company.name,
                logoURL: company.logoURL,
                blocks: BlockSelection(subsidiaries: true)
            )
        )
        searchQuery = ""
        searchResults = []
    }

    func removeCompany(_ id: String) {
        companies.removeAll { $0.id == id }
    }

    // MARK: - Save

    /// Persists the editor state and returns the resulting boycott so callers can
    /// refresh in place. Throws are surfaced via `error`.
    func save() async -> Boycott? {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            error = "Name is required"
            return nil
        }
        isSaving = true
        defer { isSaving = false }
        let trimmedDesc = description.trimmingCharacters(in: .whitespacesAndNewlines)

        do {
            let service = SupabaseService.shared
            let boycottID: UUID

            if let existing {
                boycottID = existing.id
                try await service.updateBoycott(
                    boycottID: boycottID,
                    name: trimmedName,
                    description: trimmedDesc,
                    isPublic: isPublic
                )
                try await reconcileCompanies(boycottID: boycottID)
            } else {
                boycottID = try await service.createBoycott(
                    name: trimmedName,
                    description: trimmedDesc,
                    isPublic: isPublic
                )
                for company in companies {
                    try await service.addCompanyToBoycott(
                        boycottID: boycottID,
                        companyID: company.id,
                        companyName: company.name,
                        companyLogoURL: company.logoURL,
                        blocks: company.blocks
                    )
                }
            }

            return buildResult(id: boycottID, name: trimmedName, description: trimmedDesc)
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    /// Diff the edited company set against the original and apply only the deltas.
    private func reconcileCompanies(boycottID: UUID) async throws {
        let service = SupabaseService.shared
        let originalByID = Dictionary(uniqueKeysWithValues: originalCompanies.map { ($0.id, $0) })
        let currentByID = Dictionary(uniqueKeysWithValues: companies.map { ($0.id, $0) })

        // Removed
        for original in originalCompanies where currentByID[original.id] == nil {
            try await service.removeCompanyFromBoycott(boycottID: boycottID, companyID: original.id)
        }
        // Added or changed
        for company in companies {
            if let original = originalByID[company.id] {
                if original.blocks != company.blocks {
                    try await service.updateBoycottCompany(
                        boycottID: boycottID,
                        companyID: company.id,
                        blocks: company.blocks
                    )
                }
            } else {
                try await service.addCompanyToBoycott(
                    boycottID: boycottID,
                    companyID: company.id,
                    companyName: company.name,
                    companyLogoURL: company.logoURL,
                    blocks: company.blocks
                )
            }
        }
    }

    private func buildResult(id: UUID, name: String, description: String) -> Boycott {
        let entries = companies.map { c in
            BoycottCompanyEntry(
                id: UUID(),
                companies: BoycottCompanyRef(
                    id: c.id,
                    name: c.name,
                    logoURL: c.logoURL,
                    lei: nil,
                    wikidataQID: nil
                ),
                blockOwns: c.blocks.subsidiaries,
                blockOwnedBy: c.blocks.parents,
                blockSuppliers: c.blocks.suppliers,
                blockBrands: c.blocks.brands,
                blockCustomers: c.blocks.customers
            )
        }
        return Boycott(
            id: id,
            name: name,
            description: description.isEmpty ? nil : description,
            isPublic: isPublic,
            creatorID: existing?.creatorID ?? currentUserID,
            createdAt: existing?.createdAt,
            trackerCount: existing?.trackerCount,
            boycottCompanies: entries,
            profiles: existing?.profiles
        )
    }
}
