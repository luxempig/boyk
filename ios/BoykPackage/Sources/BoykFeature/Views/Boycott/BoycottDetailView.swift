import SwiftUI

struct BoycottDetailView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @Environment(\.dismiss) private var dismiss
    @StateObject private var vm: BoycottDetailViewModel
    @State private var showReportSheet = false
    @State private var showEditSheet = false
    @State private var showDeleteConfirm = false

    init(boycott: Boycott, initiallyAdopted: Bool = false) {
        _vm = StateObject(wrappedValue: BoycottDetailViewModel(boycott: boycott, initiallyAdopted: initiallyAdopted))
    }

    private var isOwn: Bool {
        authVM.user?.id == vm.boycott.creatorID
    }

    var body: some View {
        ZStack {
            Color.bgDark.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    description
                    companiesSection
                    creatorRow
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 16)
                .padding(.bottom, 80)
            }
        }
        .task {
            if let userID = authVM.user?.id, !isOwn {
                await vm.refreshAdoptionState(userID: userID)
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("Boycott")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.textPrimary)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    if let shareURL = URL(string: "https://boyk.org/b/\(vm.boycott.id.uuidString)") {
                        ShareLink(item: shareURL, subject: Text(vm.boycott.name)) {
                            Label("Share", systemImage: "square.and.arrow.up")
                        }
                    }
                    if isOwn {
                        Button {
                            showEditSheet = true
                        } label: {
                            Label("Edit boycott", systemImage: "pencil")
                        }
                        Button(role: .destructive) {
                            showDeleteConfirm = true
                        } label: {
                            Label("Delete boycott", systemImage: "trash")
                        }
                    } else {
                        Button(role: .destructive) {
                            showReportSheet = true
                        } label: {
                            Label("Report boycott", systemImage: "flag")
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .foregroundColor(.accent)
                }
                .accessibilityLabel("More actions")
            }
        }
        .sheet(isPresented: $showReportSheet) {
            ReportBoycottSheet(boycottID: vm.boycott.id, boycottName: vm.boycott.name)
        }
        .sheet(isPresented: $showEditSheet) {
            if let userID = authVM.user?.id {
                BoycottEditorView(existing: vm.boycott, currentUserID: userID) { updated in
                    vm.boycott = updated
                }
            }
        }
        .alert("Delete boycott?", isPresented: $showDeleteConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) {
                Task {
                    do {
                        try await SupabaseService.shared.deleteBoycott(boycottID: vm.boycott.id)
                        dismiss()
                    } catch {
                        vm.error = error.localizedDescription
                    }
                }
            }
        } message: {
            Text("This permanently removes \u{201C}\(vm.boycott.name)\u{201D} for you and anyone tracking it.")
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(vm.boycott.name)
                        .font(.system(size: 22, weight: .bold))
                        .foregroundColor(.textPrimary)

                    if let count = vm.boycott.trackerCount, count > 0 {
                        Text("\(count) \(count == 1 ? "tracker" : "trackers")")
                            .font(.system(size: 12))
                            .foregroundColor(.textMuted)
                    }
                }
                Spacer()
                if !isOwn {
                    adoptButton
                }
            }
        }
    }

    private var adoptButton: some View {
        Button {
            Task { await vm.toggleAdopt() }
        } label: {
            HStack(spacing: 6) {
                if vm.isAdopting {
                    ProgressView()
                        .tint(vm.isAdopted ? .textMuted : .white)
                        .scaleEffect(0.7)
                } else {
                    Image(systemName: vm.isAdopted ? "checkmark" : "plus")
                        .font(.system(size: 12, weight: .semibold))
                }
                Text(vm.isAdopted ? "Tracking" : "Track")
                    .font(.system(size: 13, weight: .semibold))
            }
            .foregroundColor(vm.isAdopted ? .textPrimary : .white)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(vm.isAdopted ? AnyShapeStyle(Color.bgCard) : AnyShapeStyle(LinearGradient.boykAccent))
            .overlay(
                Capsule().stroke(vm.isAdopted ? Color.border : Color.clear, lineWidth: 1)
            )
            .clipShape(Capsule())
        }
        .disabled(vm.isAdopting)
    }

    // MARK: - Description

    @ViewBuilder
    private var description: some View {
        if let desc = vm.boycott.description, !desc.isEmpty {
            Text(desc)
                .font(.system(size: 15))
                .foregroundColor(.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Companies

    @ViewBuilder
    private var companiesSection: some View {
        if let entries = vm.boycott.boycottCompanies, !entries.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text("COMPANIES (\(entries.count))")
                    .sectionHeader()

                VStack(spacing: 8) {
                    ForEach(entries) { entry in
                        if let company = entry.companies {
                            companyRow(company: company, entry: entry)
                        }
                    }
                }
            }
            .padding(.top, 8)
        }
    }

    // Links out only when the company carries a graph identity. `company.id` is
    // the Supabase UUID, and the Neo4j lookup behind CompanyDetailView rejects
    // anything that isn't a LEI or a Q-number, so linking on it would land every
    // row on "not found".
    @ViewBuilder
    private func companyRow(company: BoycottCompanyRef, entry: BoycottCompanyEntry) -> some View {
        if let graphID = company.lei ?? company.wikidataQID {
            NavigationLink(destination: CompanyDetailView(companyID: graphID)) {
                companyRowBody(company: company, entry: entry, linked: true)
            }
            .buttonStyle(.plain)
        } else {
            companyRowBody(company: company, entry: entry, linked: false)
        }
    }

    private func companyRowBody(company: BoycottCompanyRef, entry: BoycottCompanyEntry,
                                linked: Bool) -> some View {
        HStack(spacing: 12) {
            if let logoURL = company.logoURL, let url = URL(string: logoURL) {
                BoykImage(url: url) {
                    RoundedRectangle(cornerRadius: 4).fill(Color.bgCard)
                }
                .aspectRatio(contentMode: .fit)
                .padding(4)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 4))
                .frame(width: 36, height: 36)
            } else {
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.bgCard)
                    .frame(width: 36, height: 36)
                    .overlay(
                        Text(String(company.name.prefix(1)))
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.textMuted)
                    )
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(company.name)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(.textPrimary)

                blockChips(entry: entry)
            }

            Spacer()

            if linked {
                Image(systemName: "chevron.right")
                    .font(.system(size: 12))
                    .foregroundColor(.textMuted)
            }
        }
        .cardStyle()
    }

    @ViewBuilder
    private func blockChips(entry: BoycottCompanyEntry) -> some View {
        let chips: [String] = {
            var out: [String] = []
            if entry.blockOwns == true { out.append("subsidiaries") }
            if entry.blockOwnedBy == true { out.append("parents") }
            if entry.blockBrands == true { out.append("brands") }
            if entry.blockSuppliers == true { out.append("suppliers") }
            if entry.blockCustomers == true { out.append("customers") }
            return out
        }()

        if !chips.isEmpty {
            // Whole chips wrap onto a second row; a single overfull HStack
            // squeezes each capsule and breaks the labels mid-word instead.
            let rows = [Array(chips.prefix(3)), Array(chips.dropFirst(3))]
            VStack(alignment: .leading, spacing: 4) {
                ForEach(rows.indices, id: \.self) { rowIndex in
                    if !rows[rowIndex].isEmpty {
                        HStack(spacing: 4) {
                            ForEach(rows[rowIndex], id: \.self) { chip in
                                Text("+ \(chip)")
                                    .font(.system(size: 10))
                                    .lineLimit(1)
                                    .fixedSize()
                                    .foregroundColor(.textMuted)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Color.border.opacity(0.5))
                                    .clipShape(Capsule())
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: - Creator

    @ViewBuilder
    private var creatorRow: some View {
        if let creator = vm.boycott.profiles, !isOwn {
            HStack(spacing: 10) {
                BoykImage(urlString: creator.profilePictureURL) {
                    Text(String((creator.username ?? "U").prefix(1)).uppercased())
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.textMuted)
                }
                .aspectRatio(contentMode: .fill)
                .frame(width: 32, height: 32)
                .background(Color.bgCard)
                .clipShape(Circle())
                .overlay(Circle().stroke(Color.border, lineWidth: 1))

                VStack(alignment: .leading, spacing: 1) {
                    Text("Created by")
                        .font(.system(size: 11))
                        .foregroundColor(.textMuted)
                    Text("@\(creator.username ?? "user")")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.accent)
                }
                Spacer()
            }
            .padding(.top, 8)
        }
    }
}
