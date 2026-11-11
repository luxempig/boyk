import SwiftUI

struct CompanyDetailView: View {
    let companyID: String
    @StateObject private var vm = CompanyViewModel()
    @EnvironmentObject var authVM: AuthViewModel
    @State private var showBoykDialog = false
    @State private var showNewBoycott = false
    @State private var myBoycotts: [Boycott] = []
    @State private var boykedMessage: String?
    @State private var pendingSeed: EditorCompany?

    var body: some View {
        ZStack {
            Color.bgDark.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 24) {
                    switch vm.state {
                    case .loading:
                        ProgressView()
                            .tint(.accent)
                            .padding(48)
                    case .loaded(let company):
                        companyContent(company)
                    case .notFound:
                        notFoundView
                    case .error(let message):
                        VStack(spacing: 12) {
                            Image(systemName: "wifi.slash")
                                .font(.system(size: 32))
                                .foregroundColor(.textMuted)
                            Text(message)
                                .font(.system(size: 13))
                                .foregroundColor(.danger)
                                .multilineTextAlignment(.center)
                            Button("Retry") {
                                Task { await vm.load(companyID: companyID) }
                            }
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(.accent)
                        }
                        .padding()
                    case .idle:
                        EmptyView()
                    }
                }
                .padding(.bottom, 100)
            }
            .refreshable {
                await vm.load(companyID: companyID)
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("Company")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.textPrimary)
            }
        }
        .task {
            await vm.load(companyID: companyID)
        }
    }

    // MARK: - Company Content

    private func companyContent(_ company: CompanyWithConnections) -> some View {
        VStack(spacing: 24) {
            companyHeader(company)

            // Graph summary
            if let graph = vm.graphData, !graph.nodes.isEmpty {
                graphSummary(graph)
            }

            // Corporate Intelligence summary
            corporateIntelSection(company)

            if let connections = company.connections {
                connectionsSection(connections)
            }
        }
    }

    @ViewBuilder
    private func companyLogo(_ company: CompanyWithConnections) -> some View {
        if let logoURL = company.logoURL, let url = URL(string: logoURL) {
            BoykImage(url: url) {
                companyInitialBadge(company.name, size: 64)
            }
            .aspectRatio(contentMode: .fit)
            .frame(width: 64, height: 64)
            .background(RoundedRectangle(cornerRadius: 8).fill(Color.white))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        } else {
            companyInitialBadge(company.name, size: 64)
        }
    }

    @ViewBuilder
    private func sanctionedBadge() -> some View {
        // Name the source: the flag comes from the US Treasury's OFAC lists.
        Text("OFAC SANCTIONED")
            .font(.system(size: 10, weight: .bold))
            .foregroundColor(.danger)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color.danger.opacity(0.15))
            .cornerRadius(4)
    }

    @ViewBuilder
    private func metadataLine(_ company: CompanyWithConnections) -> some View {
        let parts: [String] = [
            company.country,
            company.industry,
            company.employees.map { "\($0.formatted()) employees" },
            company.foundedYear.map { "Founded \($0)" },
            company.ticker.map { ticker -> String in
                if let exchange = company.stockExchange { return "\(exchange): \(ticker)" }
                return ticker
            },
        ].compactMap { $0 }
        if !parts.isEmpty {
            Text(parts.joined(separator: " · "))
                .font(.system(size: 12))
                .foregroundColor(.textMuted)
        }
    }

    private func scoreColor(_ score: Int, neutral: Color) -> Color {
        if score >= 70 { return .danger }
        if score >= 40 { return .orange }
        return neutral
    }

    @ViewBuilder
    private func scoresRow(_ company: CompanyWithConnections) -> some View {
        HStack(spacing: 8) {
            if let score = company.aggregateScore {
                let c = scoreColor(score, neutral: .green)
                Text("Risk: \(score)")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(c)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(c.opacity(0.1))
                    .cornerRadius(4)
            }
        }
    }

    @ViewBuilder
    private func companyInfoColumn(_ company: CompanyWithConnections) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(company.name)
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundColor(.textPrimary)
                if company.sanctioned == true {
                    sanctionedBadge()
                }
            }

            if let description = company.description {
                Text(description)
                    .font(.system(size: 14))
                    .foregroundColor(.textMuted)
                    .lineLimit(3)
            }

            if let website = company.website {
                Text(website.replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: ""))
                    .font(.system(size: 13))
                    .foregroundColor(.accent)
            }

            metadataLine(company)
            scoresRow(company)

            if let revenue = company.revenue {
                Text("Revenue: $\(String(format: "%.1f", revenue / 1_000_000_000))B")
                    .font(.system(size: 12))
                    .foregroundColor(.textMuted)
            }
        }
    }

    private func companyHeader(_ company: CompanyWithConnections) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 16) {
                companyLogo(company)
                companyInfoColumn(company)
            }
            headerStatsRow(company)
            if authVM.user != nil {
                boykButton(company)
            }
        }
        .padding(24)
        .background(Color.bgCard)
        .overlay(Rectangle().stroke(Color.border, lineWidth: 1))
        .padding(.horizontal)
    }

    // The core "act on this company" CTA — mirrors web's Boyk button. Presents
    // the user's boycotts to add this company to, plus "Start a new boycott".
    @ViewBuilder
    private func boykButton(_ company: CompanyWithConnections) -> some View {
        Button {
            Task {
                if let uid = authVM.user?.id, myBoycotts.isEmpty {
                    myBoycotts = (try? await SupabaseService.shared.getMyBoycotts(userID: uid)) ?? []
                }
                showBoykDialog = true
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "megaphone.fill").font(.system(size: 13))
                Text(boykedMessage ?? "Boyk this company")
                    .font(.system(size: 14, weight: .semibold))
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(LinearGradient.boykAccent)
            .clipShape(Capsule())
        }
        .confirmationDialog("Add to a boycott", isPresented: $showBoykDialog, titleVisibility: .visible) {
            ForEach(myBoycotts) { boycott in
                Button(boycott.name) {
                    Task { await addToBoycott(boycott, company: company) }
                }
            }
            Button("Start a new boycott") {
                pendingSeed = EditorCompany(
                    id: company.id,
                    name: company.name,
                    logoURL: company.logoURL,
                    blocks: BlockSelection(subsidiaries: true)
                )
                showNewBoycott = true
            }
            Button("Cancel", role: .cancel) {}
        }
        .sheet(isPresented: $showNewBoycott) {
            if let uid = authVM.user?.id {
                BoycottEditorView(existing: nil, currentUserID: uid, seed: pendingSeed) { _ in
                    boykedMessage = "Boyked ✓"
                }
            }
        }
    }

    private func addToBoycott(_ boycott: Boycott, company: CompanyWithConnections) async {
        do {
            try await SupabaseService.shared.addCompanyToBoycott(
                boycottID: boycott.id,
                companyID: company.id,
                companyName: company.name,
                companyLogoURL: company.logoURL,
                blocks: BlockSelection(subsidiaries: true)
            )
            boykedMessage = "Added to \(boycott.name) ✓"
        } catch {
            boykedMessage = "Couldn't add — try again"
        }
    }

    private func totalConnections(_ company: CompanyWithConnections) -> Int {
        let c = company.connections
        let owns: Int = c?.owns?.count ?? 0
        let ownedBy: Int = c?.ownedBy?.count ?? 0
        let suppliers: Int = c?.suppliers?.count ?? 0
        let customers: Int = c?.customers?.count ?? 0
        let brands: Int = c?.brands?.count ?? 0
        return owns + ownedBy + suppliers + customers + brands
    }

    private func headerStatsRow(_ company: CompanyWithConnections) -> some View {
        HStack(spacing: 24) {
            statPair(value: totalConnections(company), label: "connections")
            if let graph = vm.graphData {
                statPair(value: graph.nodes.count, label: "graph nodes")
            }
        }
        .padding(.top, 8)
    }

    private func statPair(value: Int, label: String) -> some View {
        HStack(spacing: 6) {
            Text("\(value)")
                .font(.system(size: 20, weight: .semibold))
                .foregroundColor(.textPrimary)
            Text(label)
                .font(.system(size: 13))
                .foregroundColor(.textMuted)
        }
    }

    // MARK: - Graph Summary

    private func graphSummary(_ graph: GraphData) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("NETWORK OVERVIEW")
                .sectionHeader()

            let nodeTypes = Dictionary(grouping: graph.nodes, by: { $0.type ?? "unknown" })
            let linkTypes = Dictionary(grouping: graph.links, by: { $0.type ?? "unknown" })

            HStack(spacing: 12) {
                ForEach(Array(nodeTypes.keys.sorted()), id: \.self) { type in
                    HStack(spacing: 4) {
                        Circle()
                            .fill(colorForNodeType(type))
                            .frame(width: 8, height: 8)
                        Text("\(nodeTypes[type]?.count ?? 0) \(type)")
                            .font(.system(size: 12))
                            .foregroundColor(.textSecondary)
                    }
                }
            }

            if !linkTypes.isEmpty {
                HStack(spacing: 12) {
                    ForEach(Array(linkTypes.keys.sorted()), id: \.self) { type in
                        Text("\(linkTypes[type]?.count ?? 0) \(type.lowercased().replacingOccurrences(of: "_", with: " "))")
                            .font(.system(size: 11))
                            .foregroundColor(.textMuted)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.border)
                    }
                }
            }
        }
        .padding(16)
        .background(Color.bgCard)
        .overlay(Rectangle().stroke(Color.border, lineWidth: 1))
        .padding(.horizontal)
    }

    private func colorForNodeType(_ type: String) -> Color {
        switch type.lowercased() {
        case "company": return .connectionParent
        case "brand": return .connectionSubsidiary
        case "person": return .connectionSupplier
        default: return .textMuted
        }
    }

    // MARK: - Connections Section

    private func connectionsSection(_ connections: CompanyConnections) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Corporate Connections")
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(.textSecondary)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(
                    Rectangle()
                        .fill(Color.border)
                        .frame(height: 1),
                    alignment: .bottom
                )

            VStack(spacing: 24) {
                if let parents = connections.ownedBy, !parents.isEmpty {
                    connectionGroup(
                        title: "Parent Companies",
                        count: parents.count,
                        color: .connectionParent,
                        companies: parents
                    )
                }

                if let subs = connections.owns, !subs.isEmpty {
                    connectionGroup(
                        title: "Subsidiaries",
                        count: subs.count,
                        color: .connectionSubsidiary,
                        companies: subs
                    )
                }

                if let suppliers = connections.suppliers, !suppliers.isEmpty {
                    connectionGroup(
                        title: "Suppliers & Partners",
                        count: suppliers.count,
                        color: .connectionSupplier,
                        companies: suppliers
                    )
                }

                if let customers = connections.customers, !customers.isEmpty {
                    connectionGroup(
                        title: "Customers",
                        count: customers.count,
                        color: .cyan,
                        companies: customers
                    )
                }

                if let brands = connections.brands, !brands.isEmpty {
                    connectionGroup(
                        title: "Brands",
                        count: brands.count,
                        color: .purple,
                        companies: brands,
                        isBrand: true
                    )
                }

                if let people = connections.people, !people.isEmpty {
                    keyPeopleGroup(people)
                }

                if (connections.owns?.isEmpty ?? true) &&
                   (connections.ownedBy?.isEmpty ?? true) &&
                   (connections.suppliers?.isEmpty ?? true) &&
                   (connections.customers?.isEmpty ?? true) &&
                   (connections.brands?.isEmpty ?? true) &&
                   (connections.people?.isEmpty ?? true) {
                    Text("No known corporate connections")
                        .font(.system(size: 14))
                        .foregroundColor(.textMuted)
                        .padding()
                }
            }
            .padding(20)
        }
        .background(Color.bgDark)
        .overlay(
            Rectangle()
                .stroke(Color.border, lineWidth: 1)
        )
        .padding(.horizontal)
    }

    private func keyPeopleGroup(_ people: [KeyPerson]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Circle()
                    .fill(Color.orange)
                    .frame(width: 8, height: 8)

                Text("Key People (\(people.count))")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.textSecondary)
            }

            ForEach(people) { person in
                NavigationLink(destination: PersonDetailView(personID: person.wikidataID, initialName: person.name)) {
                    HStack(spacing: 12) {
                        BoykImage(urlString: person.imageURL) {
                            Circle()
                                .fill(Color.bgCard)
                                .overlay(
                                    Image(systemName: "person.fill")
                                        .font(.system(size: 14))
                                        .foregroundColor(.textMuted)
                                )
                        }
                        .aspectRatio(contentMode: .fill)
                        .frame(width: 32, height: 32)
                        .clipShape(Circle())
                        .accessibilityHidden(true)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(person.name ?? "Unnamed person")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(.textPrimary)
                            Text(person.displayRole)
                                .font(.system(size: 11))
                                .foregroundColor(.accent)
                        }

                        Spacer()

                        Image(systemName: "chevron.right")
                            .font(.system(size: 12))
                            .foregroundColor(.textMuted)
                            .accessibilityHidden(true)
                    }
                    .padding(.vertical, 4)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func connectionGroup(title: String, count: Int, color: Color, companies: [ConnectedCompany], isBrand: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Circle()
                    .fill(color)
                    .frame(width: 8, height: 8)

                Text("\(title) (\(count))")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.textSecondary)
            }

            ForEach(companies) { company in
                NavigationLink(destination: Group {
                    if isBrand {
                        BrandDetailView(brandID: company.id)
                    } else {
                        CompanyDetailView(companyID: company.id)
                    }
                }) {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            if let logoURL = company.logoURL, let url = URL(string: logoURL) {
                                BoykImage(url: url) {
                                    EmptyView()
                                }
                                .aspectRatio(contentMode: .fit)
                                .frame(width: 20, height: 20)
                                .background(RoundedRectangle(cornerRadius: 3).fill(Color.white))
                                .clipShape(RoundedRectangle(cornerRadius: 3))
                            } else {
                                // Monogram placeholder keeps names aligned when
                                // a connection has no logo.
                                RoundedRectangle(cornerRadius: 3)
                                    .fill(Color.bgCard)
                                    .frame(width: 20, height: 20)
                                    .overlay(
                                        Text(String(company.name.prefix(1)))
                                            .font(.system(size: 11, weight: .semibold))
                                            .foregroundColor(.textMuted)
                                    )
                            }

                            Text(company.name)
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(.textPrimary)

                            if let pct = company.ownershipPercentage {
                                Text("\(Int(pct))%")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundColor(.white)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(color)
                                    .cornerRadius(4)
                            }

                            Spacer()

                            Image(systemName: "chevron.right")
                                .font(.system(size: 12))
                                .foregroundColor(.textMuted)
                        }

                        if let primarySource = company.source ?? company.sources?.first {
                            ProvenanceBadge(
                                source: primarySource,
                                confidence: company.confidence,
                                sourceURLString: company.sourceURL,
                                entityID: company.id,
                                corroboratedCount: company.corroboratedBy?.count
                                    ?? max(0, company.allSources.count - 1)
                            )
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color.bgCard)
                    .overlay(
                        Rectangle()
                            .stroke(Color.border, lineWidth: 1)
                    )
                    .cornerRadius(4)
                }
            }
        }
    }

    // MARK: - Corporate Intelligence

    private struct IntelItem: Identifiable {
        let label: String
        let count: Int
        let color: Color
        var id: String { label }
    }

    private func corporateIntelItems(_ company: CompanyWithConnections) -> [IntelItem] {
        let all: [IntelItem] = [
            IntelItem(label: "Violations", count: company.violations?.count ?? 0, color: .danger),
            IntelItem(label: "EPA Violations", count: company.environmentalViolations?.count ?? 0, color: .orange),
            IntelItem(label: "Lobbying Records", count: company.lobbying?.count ?? 0, color: .connectionSupplier),
            IntelItem(label: "Gov Contracts", count: company.governmentContracts?.count ?? 0, color: .connectionParent),
            IntelItem(label: "Recalls", count: company.recalls?.count ?? 0, color: .danger),
            IntelItem(label: "Offshore Entities", count: company.offshoreEntities?.count ?? 0, color: .textMuted),
            IntelItem(label: "ESG Scores", count: company.esgScores?.count ?? 0, color: .connectionSubsidiary),
        ]
        return all.filter { $0.count > 0 }
    }

    private func corporateIntelSection(_ company: CompanyWithConnections) -> some View {
        let items = corporateIntelItems(company)

        return Group {
            if !items.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Corporate Intelligence")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.textSecondary)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .overlay(
                            Rectangle().fill(Color.border).frame(height: 1),
                            alignment: .bottom
                        )

                    LazyVGrid(columns: [
                        GridItem(.flexible()),
                        GridItem(.flexible()),
                    ], spacing: 12) {
                        ForEach(items) { item in
                            intelTile(item)
                        }
                    }
                    .padding(16)
                }
                .background(Color.bgDark)
                .overlay(Rectangle().stroke(Color.border, lineWidth: 1))
                .padding(.horizontal)
            }
        }
    }

    private func intelTile(_ item: IntelItem) -> some View {
        HStack(spacing: 8) {
            Text("\(item.count)")
                .font(.system(size: 18, weight: .semibold))
                .foregroundColor(item.color)
            Text(item.label)
                .font(.system(size: 12))
                .foregroundColor(.textMuted)
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color.bgCard)
        .overlay(Rectangle().stroke(Color.border, lineWidth: 1))
        .cornerRadius(4)
    }

    private func companyInitialBadge(_ name: String, size: CGFloat) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.bgDark)
                .frame(width: size, height: size)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.border, lineWidth: 1)
                )

            Text(String(name.prefix(1)).uppercased())
                .font(.system(size: size * 0.375, weight: .bold))
                .foregroundColor(.textMuted)
        }
    }

    private var notFoundView: some View {
        VStack(spacing: 16) {
            Text("Company not found")
                .font(.system(size: 14))
                .foregroundColor(.textMuted)
        }
        .padding(48)
    }
}
