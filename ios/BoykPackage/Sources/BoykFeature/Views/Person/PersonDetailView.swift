import SwiftUI

struct PersonDetailView: View {
    let personID: String
    var initialName: String?

    @State private var person: Person?
    @State private var isLoading = true
    @State private var loadError: String?

    var body: some View {
        ZStack {
            Color.bgDark.ignoresSafeArea()

            ScrollView {
                if isLoading {
                    ProgressView()
                        .tint(.accent)
                        .padding(.top, 80)
                } else if let person {
                    content(person)
                } else if let loadError {
                    errorState(loadError)
                } else {
                    notFoundState
                }
            }
        }
        .navigationTitle(person?.name ?? initialName ?? "Person")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: personID) {
            await load()
        }
    }

    @ViewBuilder
    private func content(_ person: Person) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            header(person)

            if let description = person.description, !description.isEmpty {
                Text(description)
                    .font(.system(size: 14))
                    .foregroundColor(.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            metadata(person)

            if let companies = person.companies, !companies.isEmpty {
                affiliatedCompaniesSection(companies)
            }
        }
        .padding(16)
    }

    private func header(_ person: Person) -> some View {
        HStack(spacing: 16) {
            BoykImage(urlString: person.imageURL) {
                Circle()
                    .fill(Color.bgCard)
                    .overlay(
                        Image(systemName: "person.fill")
                            .font(.system(size: 28))
                            .foregroundColor(.textMuted)
                    )
            }
            .aspectRatio(contentMode: .fill)
            .frame(width: 72, height: 72)
            .clipShape(Circle())
            .overlay(Circle().stroke(Color.border, lineWidth: 1))
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text(person.name ?? "Unnamed person")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundColor(.textPrimary)
                if let nationality = person.nationality {
                    Text(nationality)
                        .font(.system(size: 13))
                        .foregroundColor(.textMuted)
                }
            }

            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private func metadata(_ person: Person) -> some View {
        let rows: [(String, String)] = [
            person.dateOfBirth.map { ("Born", $0) },
            person.countryOfResidence.map { ("Resides in", $0) },
        ].compactMap { $0 }

        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(rows, id: \.0) { row in
                    HStack(alignment: .top, spacing: 8) {
                        Text(row.0)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.textMuted)
                            .frame(width: 100, alignment: .leading)
                        Text(row.1)
                            .font(.system(size: 13))
                            .foregroundColor(.textPrimary)
                    }
                }
            }
            .padding(12)
            .background(Color.bgCard)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }

    private func affiliatedCompaniesSection(_ companies: [PersonCompanyLink]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Affiliated companies")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(.textMuted)
                .textCase(.uppercase)
                .tracking(1)

            ForEach(companies) { company in
                NavigationLink(destination: CompanyDetailView(companyID: company.id)) {
                    HStack(spacing: 12) {
                        BoykImage(urlString: company.logoURL) {
                            RoundedRectangle(cornerRadius: 6)
                                .fill(Color.bgCard)
                                .overlay(
                                    Text(String((company.name ?? "C").prefix(1)).uppercased())
                                        .font(.system(size: 14, weight: .semibold))
                                        .foregroundColor(.textMuted)
                                )
                        }
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 36, height: 36)
                        .background(RoundedRectangle(cornerRadius: 6).fill(Color.white))
                        .clipShape(RoundedRectangle(cornerRadius: 6))

                        VStack(alignment: .leading, spacing: 2) {
                            Text(company.name ?? "Company")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(.textPrimary)
                            Text(company.displayRole)
                                .font(.system(size: 11))
                                .foregroundColor(.accent)
                        }

                        Spacer()

                        Image(systemName: "chevron.right")
                            .font(.system(size: 12))
                            .foregroundColor(.textMuted)
                            .accessibilityHidden(true)
                    }
                    .padding(12)
                    .background(Color.bgCard)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var notFoundState: some View {
        VStack(spacing: 12) {
            Image(systemName: "person.crop.circle.badge.questionmark")
                .font(.system(size: 36))
                .foregroundColor(.textMuted)
            Text("Person not found")
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(.textPrimary)
        }
        .padding(.top, 80)
        .frame(maxWidth: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 32))
                .foregroundColor(.danger)
            Text(message)
                .font(.system(size: 13))
                .foregroundColor(.textMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button("Retry") {
                Task { await load() }
            }
            .foregroundColor(.accent)
        }
        .padding(.top, 80)
        .frame(maxWidth: .infinity)
    }

    private func load() async {
        isLoading = true
        loadError = nil
        do {
            person = try await Neo4jService.shared.getPersonById(id: personID)
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }
}
