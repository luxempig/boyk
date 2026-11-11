import Foundation

@MainActor
class CheckProductViewModel: ObservableObject {
    struct ConflictResult {
        let hasConflict: Bool
        let conflicts: [Conflict]
    }

    struct Conflict: Identifiable {
        let id = UUID()
        let boycottName: String
        let reason: String
        let companyName: String
    }

    @Published var searchQuery: String = ""
    @Published var searchResults: [Company] = []
    @Published var isSearching: Bool = false
    @Published var selectedCompany: Company?
    @Published var isChecking: Bool = false
    @Published var result: ConflictResult?
    @Published var isLookingUpBarcode: Bool = false
    @Published var barcodeError: String?
    /// Source of the last scanned product ("openfoodfacts" needs ODbL credit).
    @Published var productDataSource: String?

    private var searchTask: Task<Void, Never>?
    /// Company the last scan resolved to. Selecting it sets `searchQuery`, which
    /// re-enters `search(query:)`; that must not drop the scan's attribution.
    private var scannedCompanyName: String?
    private var userBoycotts: [Boycott] = []

    func loadUserBoycotts(userID: UUID) async {
        do {
            async let myBoycotts = SupabaseService.shared.getMyBoycotts(userID: userID)
            async let followedBoycotts = SupabaseService.shared.getFollowedBoycotts(userID: userID)
            let (mine, followed) = try await (myBoycotts, followedBoycotts)
            userBoycotts = mine + followed
        } catch {
            userBoycotts = []
        }
    }

    func search(query: String) {
        if query != scannedCompanyName {
            productDataSource = nil
            scannedCompanyName = nil
        }
        searchQuery = query
        result = nil
        selectedCompany = nil
        barcodeError = nil

        guard query.count >= 2 else {
            searchResults = []
            return
        }

        searchTask?.cancel()
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }

            isSearching = true
            do {
                let results = try await Neo4jService.shared.searchCompanies(query: query)
                guard !Task.isCancelled else { return }
                searchResults = Array(results.prefix(5))
            } catch {
                guard !Task.isCancelled else { return }
                searchResults = []
            }
            isSearching = false
        }
    }

    func selectCompany(_ company: Company) async {
        selectedCompany = company
        searchQuery = company.name
        searchResults = []
        isChecking = true
        result = nil
        barcodeError = nil

        do {
            let companyData = try await Neo4jService.shared.getCompanyWithConnections(id: company.id)
            let conflicts = checkConflicts(companyID: company.id, companyName: company.name, connections: companyData?.connections)
            result = conflicts
        } catch {
            result = ConflictResult(hasConflict: false, conflicts: [])
        }

        isChecking = false
    }

    func lookupBarcode(_ barcode: String) async {
        isLookingUpBarcode = true
        barcodeError = nil
        result = nil
        selectedCompany = nil
        searchResults = []
        searchQuery = ""
        productDataSource = nil
        scannedCompanyName = nil

        do {
            guard let product = try await Neo4jService.shared.lookupProduct(barcode: barcode) else {
                isLookingUpBarcode = false
                barcodeError = "Product not found for barcode \(barcode). Try searching by name instead."
                return
            }

            productDataSource = product.source

            // Linked to a company → check it against the user's boycotts.
            if let companyID = product.companyID, let companyName = product.companyName {
                scannedCompanyName = companyName
                isLookingUpBarcode = false
                await selectCompany(
                    Company(
                        id: companyID, name: companyName, description: nil, website: nil,
                        logoURL: product.companyLogoURL, lei: nil, wikidataID: nil, country: nil,
                        industry: nil, employees: nil, ticker: nil, sanctioned: nil,
                        brandCount: nil, subsidiaryCount: nil
                    )
                )
                return
            }

            // Product found but NO parent company linked. Surface what we know
            // (product + brand) honestly rather than claiming "not found" — and
            // never guess an owner from a name search (that mismatches badly).
            isLookingUpBarcode = false
            let productName = product.name ?? "This product"
            if let brand = product.brandName, !brand.isEmpty {
                barcodeError = "Found \"\(productName)\" by \(brand). No parent company is linked to it yet, so it can't be checked against your boycotts."
            } else {
                barcodeError = "Found \"\(productName)\", but no company is linked to it yet, so it can't be checked against your boycotts."
            }
        } catch {
            isLookingUpBarcode = false
            barcodeError = "Could not look up barcode. Check your connection and try again."
        }
    }

    private func checkConflicts(companyID: String, companyName: String, connections: CompanyConnections?) -> ConflictResult {
        var conflicts: [Conflict] = []

        for boycott in userBoycotts {
            guard let entries = boycott.boycottCompanies else { continue }

            for entry in entries {
                guard let companyRef = entry.companies else { continue }

                // Direct match
                if matches(neo4jID: companyID, name: companyName, ref: companyRef) {
                    conflicts.append(Conflict(
                        boycottName: boycott.name,
                        reason: "Direct target",
                        companyName: companyName
                    ))
                    continue
                }

                // Check ownership connections
                if let ownedBy = connections?.ownedBy {
                    if entry.blockOwnedBy == true {
                        for parent in ownedBy where matches(neo4jID: parent.id, name: parent.name, ref: companyRef) {
                            conflicts.append(Conflict(
                                boycottName: boycott.name,
                                reason: "Owned by \(parent.name)",
                                companyName: companyName
                            ))
                        }
                    }
                }

                if let owns = connections?.owns {
                    if entry.blockOwns == true {
                        for sub in owns where matches(neo4jID: sub.id, name: sub.name, ref: companyRef) {
                            conflicts.append(Conflict(
                                boycottName: boycott.name,
                                reason: "Owns \(sub.name)",
                                companyName: companyName
                            ))
                        }
                    }
                }

                if let suppliers = connections?.suppliers {
                    if entry.blockSuppliers == true {
                        for supplier in suppliers where matches(neo4jID: supplier.id, name: supplier.name, ref: companyRef) {
                            conflicts.append(Conflict(
                                boycottName: boycott.name,
                                reason: "Supplier: \(supplier.name)",
                                companyName: companyName
                            ))
                        }
                    }
                }
            }
        }

        return ConflictResult(hasConflict: !conflicts.isEmpty, conflicts: conflicts)
    }

    // A boycott company ref stores the Supabase UUID in `id`, which never equals
    // a Neo4j node id (LEI/Wikidata). Match on the Neo4j keys the RPC also emits
    // (lei/wikidata_qid) and fall back to a case-insensitive name match — the
    // load-bearing path the web client relies on.
    private func matches(neo4jID: String, name: String, ref: BoycottCompanyRef) -> Bool {
        if let lei = ref.lei, lei == neo4jID { return true }
        if let qid = ref.wikidataQID, qid == neo4jID { return true }
        return ref.name.caseInsensitiveCompare(name) == .orderedSame
    }
}
