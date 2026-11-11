import SwiftUI

/// Create or edit a boycott: name, description, visibility, and seed companies
/// with their five proxy-block toggles. Presented as a sheet from Home (create)
/// and the boycott detail view (edit). Calls `onSaved` with the resulting
/// boycott so the caller can refresh in place.
struct BoycottEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var vm: BoycottEditorViewModel
    let onSaved: (Boycott) -> Void

    init(
        existing: Boycott?,
        currentUserID: UUID,
        seed: EditorCompany? = nil,
        onSaved: @escaping (Boycott) -> Void
    ) {
        _vm = StateObject(wrappedValue: BoycottEditorViewModel(
            existing: existing, currentUserID: currentUserID, seed: seed
        ))
        self.onSaved = onSaved
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.bgDark.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        nameField
                        descriptionField
                        visibilityField
                        companiesSection
                    }
                    .padding(16)
                    .padding(.bottom, 96)
                }

                if let error = vm.error {
                    errorToast(error)
                }
            }
            .navigationTitle(vm.isEditing ? "Edit Boycott" : "New Boycott")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                        .foregroundColor(.textSecondary)
                }
            }
            .safeAreaInset(edge: .bottom) { saveBar }
        }
    }

    // MARK: - Fields

    private var nameField: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("NAME").sectionHeader()
            TextField("e.g. Fast fashion giants", text: $vm.name)
                .textFieldStyle(.plain)
                .foregroundColor(.textPrimary)
                .padding(12)
                .background(Color.bgCard)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.border, lineWidth: 1))
        }
    }

    private var descriptionField: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("DESCRIPTION").sectionHeader()
            TextField("Why this boycott matters (optional)", text: $vm.description, axis: .vertical)
                .lineLimit(2...5)
                .textFieldStyle(.plain)
                .foregroundColor(.textPrimary)
                .padding(12)
                .background(Color.bgCard)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.border, lineWidth: 1))
        }
    }

    private var visibilityField: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("VISIBILITY").sectionHeader()
            Picker("Visibility", selection: $vm.isPublic) {
                Text("Public").tag(true)
                Text("Private").tag(false)
            }
            .pickerStyle(.segmented)
            Text(vm.isPublic
                ? "Anyone can find and track this boycott."
                : "Only you can see this — a private blacklist.")
                .font(.system(size: 11))
                .foregroundColor(.textMuted)
        }
    }

    // MARK: - Companies

    private var companiesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("COMPANIES (\(vm.companies.count))").sectionHeader()

            companySearch

            ForEach($vm.companies) { $company in
                CompanyEditRow(company: $company) { vm.removeCompany(company.id) }
            }

            if vm.companies.isEmpty {
                Text("Search above to add the companies this boycott targets.")
                    .font(.system(size: 12))
                    .foregroundColor(.textMuted)
                    .padding(.vertical, 4)
            }
        }
    }

    private var companySearch: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(.textMuted)
                    .font(.system(size: 13))
                TextField("Search companies…", text: $vm.searchQuery)
                    .textFieldStyle(.plain)
                    .foregroundColor(.textPrimary)
                    .autocorrectionDisabled()
                if vm.isSearching {
                    ProgressView().scaleEffect(0.7).tint(.textMuted)
                }
            }
            .padding(12)
            .background(Color.bgCard)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.border, lineWidth: 1))

            if !vm.searchResults.isEmpty {
                VStack(spacing: 0) {
                    ForEach(vm.searchResults) { company in
                        Button {
                            vm.addCompany(company)
                        } label: {
                            HStack(spacing: 10) {
                                companyLogo(company.logoURL, name: company.name)
                                Text(company.name)
                                    .font(.system(size: 13))
                                    .foregroundColor(.textPrimary)
                                    .lineLimit(1)
                                Spacer()
                                Image(systemName: "plus.circle.fill")
                                    .foregroundColor(.accent)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                        }
                        Divider().background(Color.border)
                    }
                }
                .background(Color.bgCard)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.border, lineWidth: 1))
                .padding(.top, 4)
            }
        }
        .task(id: vm.searchQuery) {
            try? await Task.sleep(for: .milliseconds(300))
            if !Task.isCancelled { await vm.search() }
        }
    }

    @ViewBuilder
    private func companyLogo(_ logoURL: String?, name: String) -> some View {
        if let logoURL, let url = URL(string: logoURL) {
            BoykImage(url: url) {
                RoundedRectangle(cornerRadius: 4).fill(Color.bgCardHover)
            }
            .aspectRatio(contentMode: .fit)
            .padding(3)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 4))
            .frame(width: 28, height: 28)
        } else {
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.bgCardHover)
                .frame(width: 28, height: 28)
                .overlay(
                    Text(String(name.prefix(1)))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.textMuted)
                )
        }
    }

    // MARK: - Save

    private var saveBar: some View {
        Button {
            Task {
                if let result = await vm.save() {
                    onSaved(result)
                    dismiss()
                }
            }
        } label: {
            HStack {
                if vm.isSaving {
                    ProgressView().tint(.white).scaleEffect(0.8)
                }
                Text(vm.isEditing ? "Save Changes" : "Create Boycott")
                    .font(.system(size: 16, weight: .semibold))
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .padding(16)
            .background(vm.canSave ? AnyShapeStyle(LinearGradient.boykAccent) : AnyShapeStyle(Color.bgCardHover))
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .disabled(!vm.canSave)
        .padding(16)
        .background(.ultraThinMaterial)
    }

    private func errorToast(_ message: String) -> some View {
        VStack {
            Spacer()
            Text(message)
                .font(.system(size: 13))
                .foregroundColor(.white)
                .padding(12)
                .background(Color.danger)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .padding(.bottom, 90)
                .onAppear {
                    Task {
                        try? await Task.sleep(for: .seconds(3))
                        vm.error = nil
                    }
                }
        }
    }
}

/// One seed company in the editor, with tappable block-type chips.
private struct CompanyEditRow: View {
    @Binding var company: EditorCompany
    let onRemove: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Text(company.name)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(.textPrimary)
                    .lineLimit(1)
                Spacer()
                Button(action: onRemove) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.textMuted)
                }
            }

            Text("ALSO BLOCK")
                .font(.system(size: 9, weight: .medium))
                .foregroundColor(.textMuted)
                .tracking(1)

            // Wrapping rows of block-type chips.
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    chip("Subsidiaries", color: Color(hex: "22c55e"), isOn: $company.blocks.subsidiaries)
                    chip("Parents", color: Color(hex: "3b82f6"), isOn: $company.blocks.parents)
                }
                HStack(spacing: 6) {
                    chip("Brands", color: Color(hex: "a855f7"), isOn: $company.blocks.brands)
                    chip("Suppliers", color: Color(hex: "f59e0b"), isOn: $company.blocks.suppliers)
                    chip("Customers", color: Color(hex: "06b6d4"), isOn: $company.blocks.customers)
                }
            }
        }
        .padding(12)
        .background(Color.bgCard)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.border, lineWidth: 1))
    }

    private func chip(_ label: String, color: Color, isOn: Binding<Bool>) -> some View {
        Button {
            isOn.wrappedValue.toggle()
        } label: {
            Text(label)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(isOn.wrappedValue ? .white : .textSecondary)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(isOn.wrappedValue ? color : Color.bgCardHover)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(isOn.wrappedValue ? color : Color.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}
