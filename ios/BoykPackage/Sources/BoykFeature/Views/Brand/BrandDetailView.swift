import SwiftUI

struct BrandDetailView: View {
    let brandID: String

    @State private var state: ViewState = .loading
    private let neo4j = Neo4jService.shared

    enum ViewState {
        case loading
        case loaded(BrandDetail)
        case notFound
        case error(String)
    }

    var body: some View {
        ZStack {
            Color.bgDark.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 24) {
                    switch state {
                    case .loading:
                        ProgressView()
                            .tint(.accent)
                            .padding(48)
                    case .loaded(let brand):
                        brandContent(brand)
                    case .notFound:
                        VStack(spacing: 12) {
                            Image(systemName: "tag.slash")
                                .font(.system(size: 32))
                                .foregroundColor(.textMuted)
                            Text("Brand not found")
                                .font(.system(size: 14))
                                .foregroundColor(.textMuted)
                        }
                        .padding(48)
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
                                Task { await load() }
                            }
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(.accent)
                        }
                        .padding()
                    }
                }
                .padding(.bottom, 100)
            }
            .refreshable {
                await load()
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("Brand")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.textPrimary)
            }
        }
        .task {
            await load()
        }
    }

    private func load() async {
        do {
            if let brand = try await neo4j.getBrandById(id: brandID) {
                state = .loaded(brand)
            } else {
                state = .notFound
            }
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    // MARK: - Content

    @ViewBuilder
    private func brandContent(_ brand: BrandDetail) -> some View {
        // Header
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 16) {
                brandLogo(brand)
                VStack(alignment: .leading, spacing: 8) {
                    Text(brand.name)
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundColor(.textPrimary)

                    if let description = brand.description {
                        Text(description)
                            .font(.system(size: 14))
                            .foregroundColor(.textMuted)
                    }

                    Text("Brand")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.purple)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Color.purple.opacity(0.1))
                        .cornerRadius(4)
                }
                Spacer()
            }
            .padding(24)

            // Stats
            Divider()
                .background(Color.border)
            HStack(spacing: 24) {
                HStack(spacing: 6) {
                    Text("\(brand.products.count)")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundColor(.textPrimary)
                    Text(brand.products.count == 1 ? "product" : "products")
                        .font(.system(size: 13))
                        .foregroundColor(.textMuted)
                }
                Spacer()
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 20)
        }
        .background(Color.bgCard)
        .overlay(
            Rectangle()
                .stroke(Color.border, lineWidth: 1)
        )
        .padding(.horizontal)

        // Owner Company
        if let company = brand.company {
            ownerSection(company)
        }

        // Products
        productsSection(brand.products)
    }

    @ViewBuilder
    private func brandLogo(_ brand: BrandDetail) -> some View {
        if let logoURL = brand.logoURL, let url = URL(string: logoURL) {
            BoykImage(url: url) {
                brandInitial(brand.name)
            }
            .aspectRatio(contentMode: .fit)
            .frame(width: 64, height: 64)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.border, lineWidth: 1)
            )
        } else {
            brandInitial(brand.name)
        }
    }

    private func brandInitial(_ name: String) -> some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(Color.accent)
            .frame(width: 64, height: 64)
            .overlay(
                Text(String(name.prefix(1)).uppercased())
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(.white)
            )
    }

    // MARK: - Owner Section

    private func ownerSection(_ company: BrandOwner) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Owned by")
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

            NavigationLink(destination: CompanyDetailView(companyID: company.id)) {
                HStack(spacing: 12) {
                    if let logoURL = company.logoURL, let url = URL(string: logoURL) {
                        BoykImage(url: url) {
                            companyInitial(company.name, size: 32)
                        }
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 32, height: 32)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                    } else {
                        companyInitial(company.name, size: 32)
                    }

                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(company.name)
                                .font(.system(size: 15, weight: .medium))
                                .foregroundColor(.textPrimary)

                            ProvenanceBadge(
                                source: company.source,
                                confidence: company.confidence,
                                sourceURLString: company.sourceURL,
                                entityID: company.id
                            )
                        }

                        Text("View company profile")
                            .font(.system(size: 11))
                            .foregroundColor(.accent)
                    }

                    Spacer()

                    Image(systemName: "chevron.right")
                        .font(.system(size: 12))
                        .foregroundColor(.textMuted)
                }
                .padding(16)
                .background(Color.bgCard)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.border, lineWidth: 1)
                )
                .cornerRadius(8)
            }
            .padding(16)
        }
        .background(Color.bgDark)
        .overlay(
            Rectangle()
                .stroke(Color.border, lineWidth: 1)
        )
        .padding(.horizontal)
    }

    private func companyInitial(_ name: String, size: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(Color.bgDark)
            .frame(width: size, height: size)
            .overlay(
                Text(String(name.prefix(1)).uppercased())
                    .font(.system(size: size * 0.4, weight: .semibold))
                    .foregroundColor(.textMuted)
            )
    }

    // MARK: - Products Section

    private func productsSection(_ products: [BrandProduct]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Products (\(products.count))")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.textMuted)
                .textCase(.uppercase)
                .tracking(2)
                .padding(.horizontal)

            if products.isEmpty {
                VStack(spacing: 8) {
                    Text("No products found for this brand")
                        .font(.system(size: 14))
                        .foregroundColor(.textMuted)
                }
                .frame(maxWidth: .infinity)
                .padding(24)
                .background(Color.bgCard)
                .overlay(
                    Rectangle()
                        .stroke(Color.border, lineWidth: 1)
                )
                .padding(.horizontal)
            } else {
                VStack(spacing: 8) {
                    ForEach(products) { product in
                        productRow(product)
                    }
                }
                .padding(.horizontal)
            }
        }
        .padding(.bottom, 24)
    }

    private func productRow(_ product: BrandProduct) -> some View {
        HStack(spacing: 12) {
            if let imageURL = product.imageURL, let url = URL(string: imageURL) {
                BoykImage(url: url) {
                    productPlaceholder
                }
                .aspectRatio(contentMode: .fit)
                .frame(width: 40, height: 40)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 4))
            } else {
                productPlaceholder
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(product.name ?? "Unnamed product")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(.textPrimary)
                    .lineLimit(1)

                HStack(spacing: 4) {
                    if !product.barcode.isEmpty {
                        Text(product.barcode)
                            .font(.system(size: 12))
                            .foregroundColor(.textMuted)
                    }
                    if let category = product.category {
                        if !product.barcode.isEmpty {
                            Text("·")
                                .foregroundColor(.textMuted)
                        }
                        Text(category)
                            .font(.system(size: 12))
                            .foregroundColor(.textMuted)
                    }
                }
            }

            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Color.bgCard)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.border, lineWidth: 1)
        )
        .cornerRadius(8)
    }

    private var productPlaceholder: some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(Color.bgDark)
            .frame(width: 40, height: 40)
            .overlay(
                Text("P")
                    .font(.system(size: 16))
                    .foregroundColor(.textMuted)
            )
    }

}
