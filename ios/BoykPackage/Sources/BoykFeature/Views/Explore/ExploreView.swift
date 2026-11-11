import SwiftUI

struct ExploreView: View {
    @StateObject private var vm = ExploreViewModel()

    var body: some View {
        ZStack {
            Color.bgDark.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 16) {
                    // DB Stats banner
                    if let stats = vm.dbStats {
                        statsBar(stats)
                    }

                    // Mode Toggle
                    modeToggle

                    // Search
                    SearchBar(
                        text: $vm.searchQuery,
                        placeholder: searchPlaceholder
                    )
                    .onChange(of: vm.searchQuery) { _, _ in
                        vm.search()
                    }

                    // Results
                    switch vm.searchMode {
                    case .boycotts:
                        boycottResults
                    case .companies:
                        companyResults
                    case .users:
                        userResults
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 100)
            }
            .refreshable {
                await vm.load()
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("Explore")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.textPrimary)
            }
        }
        .task {
            await vm.load()
        }
    }

    private var searchPlaceholder: String {
        switch vm.searchMode {
        case .boycotts: return "Search boycotts..."
        case .companies: return "Search companies..."
        case .users: return "Search users..."
        }
    }

    // MARK: - Stats Bar

    private func statsBar(_ stats: DBStats) -> some View {
        HStack(spacing: 16) {
            if let c = stats.companies {
                statPill(value: c, label: "companies")
            }
            if let b = stats.brands {
                statPill(value: b, label: "brands")
            }
            if let p = stats.products {
                statPill(value: p, label: "products")
            }
            if let people = stats.persons {
                statPill(value: people, label: "people")
            }
        }
        .padding(.vertical, 8)
    }

    private func statPill(value: Int, label: String) -> some View {
        HStack(spacing: 4) {
            Text(formatNumber(value))
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(.accent)
            Text(label)
                .font(.system(size: 11))
                .foregroundColor(.textMuted)
        }
        // Four pills share the width, which is tight enough that "companies" and
        // "products" wrapped mid-word and stranded a lone "s" on a second line.
        // Keep each pill on one line and let the label shrink instead.
        .lineLimit(1)
        .minimumScaleFactor(0.75)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }

    private func formatNumber(_ n: Int) -> String {
        if n >= 1000 {
            return String(format: "%.1fK", Double(n) / 1000.0)
        }
        return "\(n)"
    }

    // MARK: - Mode Toggle

    private var modeToggle: some View {
        HStack(spacing: 0) {
            ForEach(ExploreViewModel.SearchMode.allCases, id: \.self) { mode in
                Button {
                    vm.searchMode = mode
                    vm.searchQuery = ""
                } label: {
                    Text(mode.rawValue)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(vm.searchMode == mode ? .white : .textMuted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(vm.searchMode == mode ? Color.accent : Color.clear)
                }
            }
        }
        .overlay(
            Rectangle()
                .stroke(Color.border, lineWidth: 1)
        )
    }

    // MARK: - Boycott Results

    private var boycottResults: some View {
        VStack(spacing: 8) {
            resultHeader(
                title: vm.searchQuery.isEmpty
                    ? "All Public Boycotts (\(vm.filteredBoycotts.count))"
                    : "Results for \"\(vm.searchQuery)\" (\(vm.filteredBoycotts.count))",
                subtitle: "Sorted by users"
            )

            if case .loading = vm.state {
                VStack(spacing: 8) {
                    ForEach(0..<3, id: \.self) { _ in BoycottCardSkeleton() }
                }
            } else if vm.filteredBoycotts.isEmpty {
                emptyResults("No boycotts found")
            } else {
                ForEach(vm.filteredBoycotts) { boycott in
                    NavigationLink(destination: BoycottDetailView(boycott: boycott)) {
                        BoycottCard(boycott: boycott, showCreator: true)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: - Company Results

    private var companyResults: some View {
        VStack(spacing: 8) {
            if vm.searchQuery.count < 2 {
                VStack(spacing: 12) {
                    Image(systemName: "building.2")
                        .font(.system(size: 32))
                        .foregroundColor(.textMuted)
                    Text("Search for companies in our knowledge graph")
                        .font(.system(size: 14))
                        .foregroundColor(.textMuted)
                        .multilineTextAlignment(.center)
                }
                .padding(32)
            } else if case .loading = vm.state {
                VStack(spacing: 8) {
                    ForEach(0..<3, id: \.self) { _ in BoycottCardSkeleton() }
                }
            } else if vm.companies.isEmpty {
                emptyResults("No companies found")
            } else {
                resultHeader(
                    title: "Results for \"\(vm.searchQuery)\" (\(vm.companies.count))",
                    subtitle: nil
                )

                ForEach(vm.companies) { company in
                    NavigationLink(destination: CompanyDetailView(companyID: company.id)) {
                        companyRow(company)
                    }
                }
            }
        }
    }

    private func companyRow(_ company: Company) -> some View {
        HStack(spacing: 12) {
            if let logoURL = company.logoURL, let url = URL(string: logoURL) {
                BoykImage(url: url) {
                    companyInitialIcon(company.name)
                }
                .aspectRatio(contentMode: .fit)
                .frame(width: 40, height: 40)
                .background(RoundedRectangle(cornerRadius: 6).fill(Color.white))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            } else {
                companyInitialIcon(company.name)
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(company.name)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(.textPrimary)
                        .lineLimit(1)

                    if company.sanctioned == true {
                        Text("SANCTIONED")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundColor(.danger)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .background(Color.danger.opacity(0.15))
                            .cornerRadius(3)
                    }
                }

                let meta: [String] = [company.industry, company.country].compactMap { $0 }
                if !meta.isEmpty {
                    Text(meta.joined(separator: " · "))
                        .font(.system(size: 12))
                        .foregroundColor(.textMuted)
                        .lineLimit(1)
                }

                HStack(spacing: 6) {
                    if let subs = company.subsidiaryCount, subs > 0 {
                        Text("\(subs) subs")
                            .font(.system(size: 10))
                            .foregroundColor(.connectionSubsidiary)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.connectionSubsidiary.opacity(0.1))
                            .cornerRadius(4)
                    }
                    if let brands = company.brandCount, brands > 0 {
                        Text("\(brands) brands")
                            .font(.system(size: 10))
                            .foregroundColor(.purple)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.purple.opacity(0.1))
                            .cornerRadius(4)
                    }
                }
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.system(size: 14))
                .foregroundColor(.textMuted)
        }
        .cardStyle()
    }

    // MARK: - User Results

    private var userResults: some View {
        VStack(spacing: 8) {
            resultHeader(
                title: vm.searchQuery.isEmpty
                    ? "All Users (\(vm.users.count))"
                    : "Results for \"\(vm.searchQuery)\"",
                subtitle: vm.searchQuery.isEmpty ? "Sorted by followers" : nil
            )

            if case .loading = vm.state {
                VStack(spacing: 8) {
                    ForEach(0..<3, id: \.self) { _ in BoycottCardSkeleton() }
                }
            } else if vm.users.isEmpty {
                emptyResults("No users found")
            } else {
                ForEach(vm.users) { user in
                    NavigationLink(destination: UserProfileView(userID: user.id)) {
                        UserRow(user: user)
                    }
                }
            }
        }
    }

    private func companyInitialIcon(_ name: String) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6)
                .fill(Color.accent)
                .frame(width: 40, height: 40)

            Text(String(name.prefix(1)).uppercased())
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(.white)
        }
    }

    // MARK: - Helpers

    private func resultHeader(title: String, subtitle: String?) -> some View {
        HStack {
            Text(title)
                .sectionHeader()
            Spacer()
            if let subtitle {
                Text(subtitle)
                    .font(.system(size: 11))
                    .foregroundColor(.textMuted)
            }
        }
    }

    private func emptyResults(_ message: String) -> some View {
        Text(message)
            .font(.system(size: 14))
            .foregroundColor(.textMuted)
            .padding(32)
            .frame(maxWidth: .infinity)
    }
}
