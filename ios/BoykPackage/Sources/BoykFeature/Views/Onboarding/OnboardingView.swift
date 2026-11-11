import SwiftUI

/// First-launch onboarding. Mirrors web's `OnboardingModal.jsx` but drops the
/// "Chrome Extension" step since it's not relevant on iOS. Stored completion
/// state lives in `@AppStorage("boyk_onboarding_complete")` — same key web uses
/// in localStorage so a hypothetical future cross-device sync would be trivial.
struct OnboardingView: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage("boyk_onboarding_complete") private var isComplete: Bool = false

    @State private var step: Int = 0

    private let steps: [OnboardingStep] = [
        OnboardingStep(
            id: "welcome",
            icon: "target",
            tint: .accent,
            title: "Welcome to Boyk",
            description: "Take a stand with your wallet. Create boycotts to rally others, or keep a personal blacklist of companies to avoid."
        ),
        OnboardingStep(
            id: "create",
            icon: "megaphone.fill",
            tint: .green,
            title: "Create Boycotts & Posts",
            description: "Tap + to create a boycott or post. Add companies and reasons. Make boycotts public to rally followers, or keep them private."
        ),
        OnboardingStep(
            id: "check",
            icon: "barcode.viewfinder",
            tint: .orange,
            title: "Scan & Check Products",
            description: "Use the Check tab to scan barcodes while shopping. Instantly see if a product or its parent company is on any of your boycotts."
        ),
        OnboardingStep(
            id: "explore",
            icon: "safari.fill",
            tint: .blue,
            title: "Explore & Follow",
            description: "Discover boycotts created by others. Follow ones that align with your values and see your collective impact grow."
        ),
    ]

    var body: some View {
        ZStack {
            Color.bgDark.ignoresSafeArea()

            VStack(spacing: 0) {
                progressDots
                    .padding(.top, 24)

                TabView(selection: $step) {
                    ForEach(Array(steps.enumerated()), id: \.element.id) { index, content in
                        stepContent(content)
                            .tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .animation(.easeInOut, value: step)

                navigationBar
                    .padding(.horizontal, 24)
                    .padding(.bottom, 24)
            }
        }
        .sensoryFeedback(.selection, trigger: step)
        .sensoryFeedback(.success, trigger: isComplete)
    }

    // MARK: - Progress dots

    private var progressDots: some View {
        HStack(spacing: 8) {
            ForEach(0..<steps.count, id: \.self) { index in
                Capsule()
                    .fill(index == step ? Color.accent : Color.border)
                    .frame(width: index == step ? 24 : 8, height: 8)
                    .animation(.spring(response: 0.35), value: step)
            }
        }
    }

    // MARK: - Step content

    private func stepContent(_ content: OnboardingStep) -> some View {
        VStack(spacing: 20) {
            Spacer(minLength: 24)

            ZStack {
                Circle()
                    .fill(content.tint.opacity(0.15))
                    .frame(width: 96, height: 96)
                Image(systemName: content.icon)
                    .font(.system(size: 40, weight: .light))
                    .foregroundStyle(content.tint)
            }

            Text(content.title)
                .font(.system(size: 28, weight: .bold))
                .foregroundColor(.textPrimary)
                .multilineTextAlignment(.center)

            Text(content.description)
                .font(.system(size: 15))
                .foregroundColor(.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .lineSpacing(4)

            Spacer()
        }
    }

    // MARK: - Navigation

    private var navigationBar: some View {
        HStack {
            if step == 0 {
                Button("Skip") { complete() }
                    .foregroundColor(.textMuted)
            } else {
                Button {
                    withAnimation { step -= 1 }
                } label: {
                    Label("Back", systemImage: "chevron.left")
                        .labelStyle(.titleAndIcon)
                        .foregroundColor(.textMuted)
                }
            }

            Spacer()

            if step == steps.count - 1 {
                Button {
                    complete()
                } label: {
                    Label("Done", systemImage: "checkmark")
                        .labelStyle(.titleAndIcon)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 10)
                        .background(Color.green)
                        .clipShape(Capsule())
                }
            } else {
                Button {
                    withAnimation { step += 1 }
                } label: {
                    HStack(spacing: 4) {
                        Text("Next")
                        Image(systemName: "chevron.right")
                    }
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)
                    .background(LinearGradient.boykAccent)
                    .clipShape(Capsule())
                }
            }
        }
    }

    private func complete() {
        isComplete = true
        dismiss()
    }
}

private struct OnboardingStep: Identifiable {
    let id: String
    let icon: String
    let tint: Color
    let title: String
    let description: String
}
