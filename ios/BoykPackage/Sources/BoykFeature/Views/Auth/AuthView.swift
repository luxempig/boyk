import SwiftUI

struct AuthView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @State private var mode: AuthMode = .login
    @State private var email = ""
    @State private var password = ""
    @State private var username = ""
    @State private var resetSent = false
    @State private var confirmationResent = false

    enum AuthMode {
        case login, signup
    }

    var body: some View {
        ZStack {
            Color.bgDark.ignoresSafeArea()

            // Atmosphere — pink glow above, green glow below, mirroring the
            // web auth page's radial washes (indigo swapped out for candy).
            RadialGradient(
                colors: [Color.logoPink.opacity(0.16), .clear],
                center: .top, startRadius: 0, endRadius: 420
            )
            .ignoresSafeArea()
            RadialGradient(
                colors: [Color.logoGreen.opacity(0.10), .clear],
                center: .bottom, startRadius: 0, endRadius: 380
            )
            .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 28) {
                    // Wordmark — lowercase gradient-clipped "boyk" with a soft
                    // glow, over the mono tagline, matching the web.
                    VStack(spacing: 10) {
                        Text("boyk")
                            .font(.system(size: 52, weight: .bold))
                            .tracking(-1)
                            .foregroundStyle(LinearGradient.boykAccent)
                            .shadow(color: Color.logoPink.opacity(0.45), radius: 18)

                        Text("EXPOSE · BOYCOTT · RESIST")
                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                            .tracking(3)
                            .foregroundColor(.textMuted)
                    }
                    .padding(.top, 72)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Boyk. Expose, boycott, resist.")
                    .accessibilityAddTraits(.isHeader)

                    // Mode toggle — neutral capsule segments; the gradient is
                    // reserved for the submit CTA.
                    HStack(spacing: 0) {
                        modeButton("Log In", isActive: mode == .login) {
                            mode = .login
                            authVM.error = nil
                        }
                        modeButton("Sign Up", isActive: mode == .signup) {
                            mode = .signup
                            authVM.error = nil
                            authVM.awaitingConfirmation = nil
                        }
                    }
                    .padding(4)
                    .background(Capsule().fill(Color.bgCard))
                    .overlay(Capsule().stroke(Color.border, lineWidth: 1))
                    .padding(.horizontal)

                    // Form
                    VStack(spacing: 14) {
                        if let address = authVM.awaitingConfirmation {
                            confirmationCard(address)
                        }

                        if mode == .signup {
                            inputField("Username", text: $username, icon: "person")
                        }

                        inputField(
                            mode == .login ? "Email or username" : "Email",
                            text: $email,
                            icon: "envelope"
                        )
                        .textContentType(mode == .login ? .username : .emailAddress)
                        .keyboardType(mode == .login ? .default : .emailAddress)
                        .autocapitalization(.none)

                        SecureField("Password", text: $password)
                            .padding(14)
                            .background(Color.bgCard)
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                            .overlay(
                                RoundedRectangle(cornerRadius: 14)
                                    .stroke(Color.border, lineWidth: 1)
                            )
                            .foregroundColor(.textPrimary)
                            .textContentType(mode == .signup ? .newPassword : .password)

                        // Error
                        if let error = authVM.error {
                            Text(error)
                                .font(.system(size: 13))
                                .foregroundColor(.danger)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(12)
                                .background(Color.danger.opacity(0.1))
                                .clipShape(RoundedRectangle(cornerRadius: 14))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 14)
                                        .stroke(Color.danger.opacity(0.3), lineWidth: 1)
                                )
                        }

                        // Submit — full-width candy gradient capsule with a
                        // glow, like the web's Sign In button.
                        Button {
                            Task {
                                if mode == .login {
                                    await authVM.signInWithIdentifier(email, password: password)
                                } else {
                                    await authVM.signUp(email: email, password: password, username: username)
                                }
                            }
                        } label: {
                            Text(mode == .login ? "Log In" : "Create Account")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundColor(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 16)
                                .background(Capsule().fill(LinearGradient.boykAccent))
                                .shadow(color: Color.logoPink.opacity(0.35), radius: 12, y: 4)
                        }
                        .padding(.top, 4)
                        .accessibilityLabel(
                            mode == .login ? "Log in to your account" : "Create your account"
                        )

                        // Forgot password (login only)
                        if mode == .login {
                            if resetSent {
                                Text("Password reset link sent — check your email.")
                                    .font(.system(size: 12))
                                    .foregroundColor(.success)
                                    .frame(maxWidth: .infinity, alignment: .center)
                            } else {
                                Button {
                                    Task { resetSent = await authVM.sendPasswordReset(email: email) }
                                } label: {
                                    Text("Forgot password?")
                                        .font(.system(size: 13))
                                        .foregroundColor(.accent)
                                        .frame(maxWidth: .infinity, alignment: .center)
                                }
                            }
                        }
                    }
                    .padding(.horizontal)

                    Spacer()
                }
            }
        }
        // A new account can't sign in until its email is confirmed, so send
        // the user to Log In with their email filled in, ready for after they
        // tap the link.
        .onChange(of: authVM.awaitingConfirmation) { _, address in
            confirmationResent = false
            guard let address else { return }
            mode = .login
            email = address
            password = ""
        }
    }

    private func confirmationCard(_ address: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Check your inbox", systemImage: "envelope.badge")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(.textPrimary)

            Text("We sent a confirmation link to \(address). Tap it, then come back here and log in.")
                .font(.system(size: 13))
                .foregroundColor(.textMuted)
                .fixedSize(horizontal: false, vertical: true)

            if confirmationResent {
                Text("Sent again. It can take a minute, and may land in spam.")
                    .font(.system(size: 12))
                    .foregroundColor(.success)
            } else {
                Button {
                    Task { confirmationResent = await authVM.resendConfirmation() }
                } label: {
                    Text("Resend email")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.accent)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.success.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(Color.success.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    private func modeButton(_ title: String, isActive: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(isActive ? .textPrimary : .textMuted)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(
                    Capsule().fill(isActive ? Color.bgCardHover : Color.clear)
                )
        }
        // This segmented control and the submit button below both read as
        // "Log In" to VoiceOver. The hint and selected trait distinguish the
        // mode switch from the action that actually submits the form.
        .accessibilityHint("Switches the form to \(title.lowercased())")
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }

    private func inputField(_ placeholder: String, text: Binding<String>, icon: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundColor(.textMuted)
                .frame(width: 20)
                .accessibilityHidden(true)

            TextField(placeholder, text: text)
                .foregroundColor(.textPrimary)
                .autocapitalization(.none)
                .disableAutocorrection(true)
        }
        .padding(14)
        .background(Color.bgCard)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(Color.border, lineWidth: 1)
        )
    }
}
