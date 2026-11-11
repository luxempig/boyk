import SwiftUI

/// User-facing report form. Mirrors `ReportBoycottModal.jsx` on web —
/// 8 radio reasons + an optional details field that becomes required when
/// the user picks `.other`. All validation invariants are also enforced by
/// the `report_boycott` Postgres RPC, so a malicious client can't bypass
/// them; the UI rules are just for a nicer experience.
struct ReportBoycottSheet: View {
    let boycottID: UUID
    let boycottName: String

    @Environment(\.dismiss) private var dismiss

    @State private var reason: BoycottReportReason?
    @State private var details: String = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var showSuccess = false

    private let maxDetails = 1000

    private var trimmedDetails: String {
        details.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSubmit: Bool {
        guard let reason, !isSubmitting else { return false }
        if reason.requiresDetails && trimmedDetails.isEmpty { return false }
        return true
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Why are you reporting **\(boycottName)**?")
                        .font(.system(size: 14))
                        .foregroundColor(.textMuted)
                }

                Section("Reason") {
                    ForEach(BoycottReportReason.allCases) { r in
                        Button {
                            reason = r
                        } label: {
                            HStack {
                                Text(r.label)
                                    .foregroundColor(.textPrimary)
                                Spacer()
                                if reason == r {
                                    Image(systemName: "checkmark")
                                        .foregroundColor(.accent)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }

                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(reason?.requiresDetails == true ? "Details (required)" : "Details (optional)")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(reason?.requiresDetails == true ? .danger : .textSecondary)
                            Spacer()
                            Text("\(trimmedDetails.count)/\(maxDetails)")
                                .font(.system(size: 11))
                                .foregroundColor(.textMuted)
                        }
                        TextField(
                            reason?.requiresDetails == true
                                ? "Please describe the issue."
                                : "Add context if you'd like.",
                            text: $details,
                            axis: .vertical
                        )
                        .lineLimit(3...8)
                        .onChange(of: details) { _, newValue in
                            if newValue.count > maxDetails {
                                details = String(newValue.prefix(maxDetails))
                            }
                        }
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.system(size: 13))
                            .foregroundColor(.danger)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.bgDark)
            .navigationTitle("Report boycott")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isSubmitting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await submit() }
                    } label: {
                        if isSubmitting {
                            ProgressView()
                        } else {
                            Text("Submit")
                                .fontWeight(.semibold)
                        }
                    }
                    .disabled(!canSubmit)
                }
            }
            .overlay(alignment: .top) {
                if showSuccess {
                    successBanner
                        .padding(.top, 8)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
        }
        .sensoryFeedback(.success, trigger: showSuccess)
    }

    private var successBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
            Text("Thanks — we'll review this report.")
                .font(.system(size: 13, weight: .semibold))
        }
        .foregroundColor(.white)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(LinearGradient.boykAccent)
        .clipShape(Capsule())
        .shadow(radius: 6, y: 2)
    }

    private func submit() async {
        guard let reason, canSubmit else { return }
        errorMessage = nil
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            try await SupabaseService.shared.reportBoycott(
                boycottID: boycottID,
                reason: reason,
                details: trimmedDetails.isEmpty ? nil : trimmedDetails
            )
            withAnimation { showSuccess = true }
            try? await Task.sleep(nanoseconds: 900_000_000)
            dismiss()
        } catch {
            errorMessage = (error as NSError).localizedDescription
        }
    }
}
