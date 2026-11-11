import SwiftUI

struct BoycottCard: View {
    let boycott: Boycott
    var showCreator: Bool = false
    var onTrackToggle: ((Boycott) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(boycott.name)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundColor(.textPrimary)

                        if let count = boycott.trackerCount, count > 0 {
                            Text("\(count) \(count == 1 ? "user" : "users")")
                                .font(.system(size: 11))
                                .foregroundColor(.accent)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 2)
                                .background(Color.accent.opacity(0.1))
                        }
                    }

                    HStack(spacing: 4) {
                        if showCreator, let username = boycott.profiles?.username {
                            Text("by @\(username)")
                                .font(.system(size: 12))
                                .foregroundColor(.accent)

                            Text(" - ")
                                .font(.system(size: 12))
                                .foregroundColor(.textMuted)
                        }

                        let companyCount = boycott.boycottCompanies?.count ?? 0
                        Text("\(companyCount) \(companyCount == 1 ? "company" : "companies")")
                            .font(.system(size: 12))
                            .foregroundColor(.textMuted)
                    }
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 14))
                    .foregroundColor(.textMuted)
            }

            if let description = boycott.description, !description.isEmpty {
                Text(description)
                    .font(.system(size: 12))
                    .foregroundColor(.textMuted)
                    .lineLimit(2)
            }

            // Company tags
            if let companies = boycott.boycottCompanies, !companies.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(companies.prefix(5)) { entry in
                            if let company = entry.companies {
                                HStack(spacing: 4) {
                                    if let logoURL = company.logoURL, let url = URL(string: logoURL) {
                                        BoykImage(url: url) {
                                            // An EmptyView fallback left the white
                                            // tile below showing as a blank square,
                                            // which reads as a broken image. Fall
                                            // back to the company's initial instead,
                                            // matching how avatars degrade.
                                            // The tile is always white, so this uses
                                            // a fixed dark ink rather than a dynamic
                                            // colour that would wash out in dark mode.
                                            Text(String(company.name.prefix(1)).uppercased())
                                                .font(.system(size: 9, weight: .semibold))
                                                .foregroundColor(.black.opacity(0.55))
                                        }
                                        .aspectRatio(contentMode: .fit)
                                        .frame(width: 14, height: 14)
                                        .clipShape(RoundedRectangle(cornerRadius: 2))
                                        .background(RoundedRectangle(cornerRadius: 2).fill(Color.white))
                                    }
                                    Text(company.name)
                                        .font(.system(size: 11))
                                        .foregroundColor(.textSecondary)
                                        .lineLimit(1)
                                        .fixedSize(horizontal: true, vertical: false)
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 4)
                                .background(Color.border)
                            }
                        }

                        if companies.count > 5 {
                            Text("+\(companies.count - 5) more")
                                .font(.system(size: 11))
                                .foregroundColor(.textMuted)
                                .padding(.horizontal, 8)
                        }
                    }
                }
            }
        }
        .cardStyle()
    }
}
