import SwiftUI

struct CheckProductView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var vm = CheckProductViewModel()
    @State private var showScanner = false
    @State private var scannerError: String?
    // Stashed until the scanner sheet finishes dismissing — presenting an
    // alert while the sheet is still animating away gets silently dropped.
    @State private var pendingScannerError: String?

    var body: some View {
        ZStack {
            Color.bgDark.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 16) {
                    // Title
                    VStack(spacing: 4) {
                        Text("Check a Product")
                            .font(.system(size: 24, weight: .semibold))
                            .foregroundColor(.textPrimary)

                        Text("See if a brand conflicts with your boycotts")
                            .font(.system(size: 14))
                            .foregroundColor(.textMuted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal)

                    // Scan Button
                    Button {
                        showScanner = true
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "barcode.viewfinder")
                                .font(.system(size: 18))
                            Text("Scan Product Barcode")
                                .font(.system(size: 13))
                        }
                        .foregroundColor(.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(14)
                        .background(Color.bgCard)
                        .overlay(
                            Rectangle()
                                .stroke(Color.border, lineWidth: 1)
                        )
                    }
                    .padding(.horizontal)

                    // Search
                    SearchBar(text: $vm.searchQuery, placeholder: "Search product or brand...")
                        .padding(.horizontal)
                        .onChange(of: vm.searchQuery) { _, newValue in
                            vm.search(query: newValue)
                        }

                    // Barcode scanning result
                    if vm.isLookingUpBarcode {
                        VStack(spacing: 12) {
                            ProgressView()
                                .tint(.accent)
                            Text("Looking up barcode...")
                                .font(.system(size: 14))
                                .foregroundColor(.textSecondary)
                        }
                        .padding(32)
                    }

                    if let error = vm.barcodeError {
                        VStack(spacing: 8) {
                            Image(systemName: "barcode")
                                .font(.system(size: 32))
                                .foregroundColor(.textMuted)
                            Text(error)
                                .font(.system(size: 14))
                                .foregroundColor(.textMuted)
                                .multilineTextAlignment(.center)
                        }
                        .padding(24)
                        .frame(maxWidth: .infinity)
                        .background(Color.bgCard)
                        .overlay(Rectangle().stroke(Color.border, lineWidth: 1))
                        .padding(.horizontal)
                    }

                    // Search Results
                    if !vm.searchResults.isEmpty && vm.selectedCompany == nil {
                        searchResultsList
                    }

                    // Loading
                    if vm.isSearching {
                        ProgressView()
                            .tint(.accent)
                            .padding(20)
                    }

                    // Checking
                    if vm.isChecking {
                        VStack(spacing: 16) {
                            ProgressView()
                                .tint(.accent)
                            Text("Checking...")
                                .font(.system(size: 18))
                                .foregroundColor(.textSecondary)
                        }
                        .padding(48)
                    }

                    // Result with company detail link
                    if let company = vm.selectedCompany, let result = vm.result, !vm.isChecking {
                        resultView(result, company: company)
                    }

                    if vm.productDataSource == "openfoodfacts",
                       vm.result != nil || vm.barcodeError != nil,
                       !vm.isChecking, !vm.isLookingUpBarcode {
                        openFoodFactsAttribution
                    } else if vm.productDataSource == "usda_fdc",
                              vm.result != nil || vm.barcodeError != nil,
                              !vm.isChecking, !vm.isLookingUpBarcode {
                        usdaAttribution
                    }

                    // Empty State
                    if vm.searchQuery.isEmpty && vm.result == nil && !vm.isLookingUpBarcode && vm.barcodeError == nil {
                        emptyState
                    }
                }
                .padding(.bottom, 100)
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("Check")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.textPrimary)
            }
        }
        .alert("Camera Unavailable", isPresented: Binding(
            get: { scannerError != nil },
            set: { if !$0 { scannerError = nil } }
        )) {
            Button("OK", role: .cancel) { scannerError = nil }
        } message: {
            Text(scannerError ?? "")
        }
        .sheet(isPresented: $showScanner, onDismiss: {
            if let pending = pendingScannerError {
                pendingScannerError = nil
                scannerError = pending
            }
        }) {
            ZStack {
                BarcodeScannerView(
                    onBarcodeScanned: { barcode in
                        showScanner = false
                        Task { await vm.lookupBarcode(barcode) }
                    },
                    onDismiss: { showScanner = false },
                    onError: { _ in
                        pendingScannerError = "Boyk can't access the camera on this device. You can still search for a product or brand by name."
                        showScanner = false
                    }
                )
                .edgesIgnoringSafeArea(.all)

                // Close button overlay
                VStack {
                    HStack {
                        Spacer()
                        Button {
                            showScanner = false
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 32))
                                .foregroundColor(.white.opacity(0.8))
                                .shadow(radius: 4)
                        }
                        .accessibilityLabel("Close scanner")
                        .padding()
                    }
                    Spacer()

                    // Scanning guide
                    Text("Point camera at barcode")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.white)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 12)
                        .background(.ultraThinMaterial)
                        .cornerRadius(20)
                        .padding(.bottom, 60)
                }
            }
        }
        .task {
            if let userID = authVM.user?.id {
                await vm.loadUserBoycotts(userID: userID)
            }
        }
    }

    // MARK: - Search Results

    private var searchResultsList: some View {
        VStack(spacing: 0) {
            ForEach(Array(vm.searchResults.enumerated()), id: \.element.id) { index, company in
                Button {
                    Task { await vm.selectCompany(company) }
                } label: {
                    HStack(spacing: 12) {
                        if let logoURL = company.logoURL, let url = URL(string: logoURL) {
                            BoykImage(url: url) {
                                checkProductInitialBadge(company.name)
                            }
                            .aspectRatio(contentMode: .fit)
                            .frame(width: 32, height: 32)
                            .background(RoundedRectangle(cornerRadius: 6).fill(Color.white))
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                        } else {
                            checkProductInitialBadge(company.name)
                        }

                        Text(company.name)
                            .font(.system(size: 14))
                            .foregroundColor(.textSecondary)
                            .lineLimit(1)

                        Spacer()

                        if index == 0 {
                            Text("Tap to check")
                                .font(.system(size: 11))
                                .foregroundColor(.accent)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 14)
                    .background(index == 0 ? Color.bgCardHover : Color.bgCard)
                    .overlay(
                        Rectangle()
                            .fill(index == 0 ? Color.accent : Color.clear)
                            .frame(width: 3),
                        alignment: .leading
                    )
                }

                if index < vm.searchResults.count - 1 {
                    Divider().background(Color.border)
                }
            }
        }
        .overlay(
            Rectangle()
                .stroke(Color.border, lineWidth: 1)
        )
        .padding(.horizontal)
    }

    // MARK: - Result View

    private func resultView(_ result: CheckProductViewModel.ConflictResult, company: Company) -> some View {
        VStack(spacing: 16) {
            if result.hasConflict {
                VStack(spacing: 12) {
                    if let logoURL = company.logoURL, let url = URL(string: logoURL) {
                        BoykImage(url: url) {
                            Text("X")
                                .font(.system(size: 32, weight: .bold))
                                .foregroundColor(.danger)
                        }
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 48, height: 48)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.white))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    } else {
                        Text("X")
                            .font(.system(size: 32, weight: .bold))
                            .foregroundColor(.danger)
                    }

                    Text("Conflict Found")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundColor(.textPrimary)

                    Text("\(company.name) conflicts with your boycotts.")
                        .font(.system(size: 14))
                        .foregroundColor(.textMuted)

                    ForEach(result.conflicts) { conflict in
                        HStack {
                            Text(conflict.boycottName)
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(.accent)

                            Spacer()

                            Text("(\(conflict.reason))")
                                .font(.system(size: 11))
                                .foregroundColor(.textMuted)
                        }
                        .padding(.vertical, 10)
                    }
                }
                .padding(24)
                .background(Color.danger.opacity(0.05))
                .overlay(
                    Rectangle()
                        .stroke(Color.danger.opacity(0.2), lineWidth: 1)
                )
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 48))
                        .foregroundColor(.success)

                    Text("No Conflicts Found")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundColor(.textPrimary)

                    Text("This brand doesn't conflict with any of your active boycotts.")
                        .font(.system(size: 14))
                        .foregroundColor(.textMuted)
                        .multilineTextAlignment(.center)
                }
                .padding(24)
                .background(Color.success.opacity(0.05))
                .overlay(
                    Rectangle()
                        .stroke(Color.success.opacity(0.2), lineWidth: 1)
                )
            }

            // Link to company detail
            NavigationLink(destination: CompanyDetailView(companyID: company.id)) {
                HStack(spacing: 8) {
                    Text("View \(company.name) Details")
                        .font(.system(size: 13, weight: .medium))
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12))
                }
                .foregroundColor(.accent)
                .frame(maxWidth: .infinity)
                .padding(14)
                .background(Color.bgCard)
                .overlay(Rectangle().stroke(Color.border, lineWidth: 1))
            }
        }
        .padding(.horizontal)
    }

    // MARK: - Attribution

    /// ODbL 1.0 credit for Open Food Facts, shown with any scan result built
    /// from its data. The extract link is the share-alike offer; the web app
    /// shows the same line.
    private var openFoodFactsAttribution: some View {
        Text("Product data from [Open Food Facts](https://world.openfoodfacts.org) ([ODbL](https://opendatacommons.org/licenses/odbl/1-0/)) · [open extract](https://cdn.boyk.org/datasets/boyk-off-brand-extract.csv.gz)")
            .font(.system(size: 12))
            .foregroundColor(.textMuted)
            .tint(.textSecondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.horizontal)
            .accessibilityIdentifier("offAttribution")
    }

    /// USDA FoodData Central is public domain, so no license applies, but the
    /// product data is theirs rather than Open Food Facts'.
    private var usdaAttribution: some View {
        Text("Product data from [USDA FoodData Central](https://fdc.nal.usda.gov)")
            .font(.system(size: 12))
            .foregroundColor(.textMuted)
            .tint(.textSecondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.horizontal)
            .accessibilityIdentifier("usdaAttribution")
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 16) {
            Text("Search for a company or brand, or scan a barcode to check if it conflicts with your boycotts.")
                .font(.system(size: 14))
                .foregroundColor(.textMuted)
                .multilineTextAlignment(.center)
        }
        .padding(48)
    }

    private func checkProductInitialBadge(_ name: String) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6)
                .fill(Color.accent)
                .frame(width: 32, height: 32)
            Text(String(name.prefix(1)).uppercased())
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(.white)
        }
    }
}
