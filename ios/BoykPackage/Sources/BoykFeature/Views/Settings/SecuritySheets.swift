import SwiftUI

/// Change the signed-in user's password. Mirrors the web Settings → Security flow.
struct ChangePasswordSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject var authVM: AuthViewModel

    @State private var newPassword = ""
    @State private var confirmPassword = ""
    @State private var isSaving = false
    @State private var error: String?

    private var canSave: Bool {
        newPassword.count >= 8 && newPassword == confirmPassword && !isSaving
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.bgDark.ignoresSafeArea()
                VStack(alignment: .leading, spacing: 16) {
                    secureField("New password (8+ characters)", text: $newPassword)
                    secureField("Confirm new password", text: $confirmPassword)

                    if let error {
                        Text(error)
                            .font(.system(size: 13))
                            .foregroundColor(.danger)
                    }

                    Spacer()
                }
                .padding(16)
            }
            .navigationTitle("Change Password")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }.foregroundColor(.textSecondary)
                }
            }
            .safeAreaInset(edge: .bottom) {
                saveButton(title: "Update Password", canSave: canSave, isSaving: isSaving) {
                    Task { await save() }
                }
            }
        }
    }

    private func save() async {
        guard newPassword == confirmPassword else {
            error = "Passwords do not match"
            return
        }
        isSaving = true
        defer { isSaving = false }
        do {
            try await authVM.updatePassword(newPassword)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Change the signed-in user's email. Supabase emails a confirmation link.
struct ChangeEmailSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject var authVM: AuthViewModel

    @State private var newEmail = ""
    @State private var isSaving = false
    @State private var error: String?
    @State private var sent = false

    private var canSave: Bool {
        newEmail.contains("@") && newEmail.contains(".") && !isSaving
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.bgDark.ignoresSafeArea()
                VStack(alignment: .leading, spacing: 16) {
                    Text("Current: \(authVM.user?.email ?? "—")")
                        .font(.system(size: 13))
                        .foregroundColor(.textMuted)

                    plainField("New email address", text: $newEmail)

                    if sent {
                        Text("Check your new inbox for a confirmation link to finish the change.")
                            .font(.system(size: 13))
                            .foregroundColor(.success)
                    }
                    if let error {
                        Text(error)
                            .font(.system(size: 13))
                            .foregroundColor(.danger)
                    }

                    Spacer()
                }
                .padding(16)
            }
            .navigationTitle("Change Email")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }.foregroundColor(.textSecondary)
                }
            }
            .safeAreaInset(edge: .bottom) {
                saveButton(title: "Update Email", canSave: canSave, isSaving: isSaving) {
                    Task { await save() }
                }
            }
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await authVM.updateEmail(newEmail)
            sent = true
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Shared field/button helpers

private func fieldChrome<V: View>(_ content: V) -> some View {
    content
        .foregroundColor(.textPrimary)
        .padding(12)
        .background(Color.bgCard)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.border, lineWidth: 1))
}

@ViewBuilder
private func secureField(_ placeholder: String, text: Binding<String>) -> some View {
    fieldChrome(
        SecureField(placeholder, text: text)
            .textFieldStyle(.plain)
            .textContentType(.newPassword)
    )
}

@ViewBuilder
private func plainField(_ placeholder: String, text: Binding<String>) -> some View {
    fieldChrome(
        TextField(placeholder, text: text)
            .textFieldStyle(.plain)
            .textContentType(.emailAddress)
            .keyboardType(.emailAddress)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
    )
}

@ViewBuilder
private func saveButton(
    title: String,
    canSave: Bool,
    isSaving: Bool,
    action: @escaping () -> Void
) -> some View {
    Button(action: action) {
        HStack {
            if isSaving { ProgressView().tint(.white).scaleEffect(0.8) }
            Text(title).font(.system(size: 16, weight: .semibold))
        }
        .foregroundColor(.white)
        .frame(maxWidth: .infinity)
        .padding(16)
        .background(canSave ? AnyShapeStyle(LinearGradient.boykAccent) : AnyShapeStyle(Color.bgCardHover))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
    .disabled(!canSave)
    .padding(16)
    .background(.ultraThinMaterial)
}
