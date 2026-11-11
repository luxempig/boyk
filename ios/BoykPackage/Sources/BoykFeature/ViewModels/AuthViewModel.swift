import Foundation
import Supabase

@MainActor
public class AuthViewModel: ObservableObject {
    public enum AuthState: Sendable {
        case loading
        case unauthenticated
        case authenticated
    }

    @Published public var state: AuthState = .loading
    @Published public var user: User?
    @Published public var error: String?
    /// Set when an account exists but its email isn't confirmed yet: after
    /// sign-up (Supabase returns no session until the link is tapped) or a
    /// sign-in attempt before confirming. The auth screen shows a
    /// check-your-inbox card for this address.
    @Published public var awaitingConfirmation: String?

    public init() {}

    public func restoreSession() async {
        do {
            let session = try await supabase.auth.session
            self.user = session.user
            self.state = .authenticated
            SentryService.setUser(id: session.user.id.uuidString)
        } catch {
            self.user = nil
            self.state = .unauthenticated
            SentryService.clearUser()
        }
    }

    public func signIn(email: String, password: String) async {
        guard !email.isEmpty, !password.isEmpty else {
            self.error = "Email and password are required"
            return
        }

        self.error = nil
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        do {
            let session = try await supabase.auth.signIn(email: address, password: password)
            self.awaitingConfirmation = nil
            self.user = session.user
            self.state = .authenticated
            SentryService.setUser(id: session.user.id.uuidString)
        } catch {
            if error.localizedDescription.lowercased().contains("email not confirmed") {
                self.awaitingConfirmation = address
            } else {
                self.error = parseAuthError(error)
            }
        }
    }

    /// Signs in with an email OR a username (matching web login). If the
    /// identifier has no "@", it is resolved to an email via get_email_by_username.
    public func signInWithIdentifier(_ identifier: String, password: String) async {
        let trimmed = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !password.isEmpty else {
            self.error = "Email/username and password are required"
            return
        }
        if trimmed.contains("@") {
            await signIn(email: trimmed, password: password)
            return
        }
        // Resolve username → email.
        do {
            let email: String? = try await supabase
                .rpc("get_email_by_username", params: ["p_username": trimmed.lowercased()])
                .execute()
                .value
            guard let email, !email.isEmpty else {
                self.error = "No account found for that username."
                return
            }
            await signIn(email: email, password: password)
        } catch {
            self.error = "No account found for that username."
        }
    }

    /// Sends a password-reset email. Returns true on success so the view can
    /// show a confirmation.
    @discardableResult
    public func sendPasswordReset(email: String) async -> Bool {
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard trimmed.contains("@") else {
            self.error = "Enter your account email to reset your password."
            return false
        }
        do {
            try await supabase.auth.resetPasswordForEmail(trimmed)
            self.error = nil
            return true
        } catch {
            self.error = parseAuthError(error)
            return false
        }
    }

    public func signUp(email: String, password: String, username: String) async {
        guard !email.isEmpty, !password.isEmpty, !username.isEmpty else {
            self.error = "All fields are required"
            return
        }

        guard password.count >= 6 else {
            self.error = "Password must be at least 6 characters"
            return
        }

        guard username.count >= 3 else {
            self.error = "Username must be at least 3 characters"
            return
        }

        self.error = nil
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        do {
            let response = try await supabase.auth.signUp(
                email: address,
                password: password,
                data: ["username": .string(username.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())]
            )
            // An already-registered email gets a placeholder user with no
            // identities and no email, so it doesn't reveal which addresses
            // have accounts. Say so rather than wait for a link that won't come.
            if response.session == nil, response.user.identities?.isEmpty == true {
                self.error = "An account with this email already exists. Log in instead, or reset your password."
                return
            }
            // With email confirmation on, there's no session until the user
            // taps the link, so they can't be signed in yet.
            guard response.session != nil else {
                self.awaitingConfirmation = address
                return
            }
            self.user = response.user
            self.state = .authenticated
            SentryService.setUser(id: response.user.id.uuidString)
        } catch {
            self.error = parseAuthError(error)
        }
    }

    /// Sends the sign-up confirmation email again. Returns true on success.
    @discardableResult
    public func resendConfirmation() async -> Bool {
        guard let address = awaitingConfirmation else { return false }
        do {
            try await supabase.auth.resend(email: address, type: .signup)
            self.error = nil
            return true
        } catch {
            self.error = parseAuthError(error)
            return false
        }
    }

    public func signOut() async {
        // Supabase SDK clears its local session synchronously; the await is just the server-side revoke.
        try? await supabase.auth.signOut()
        self.user = nil
        self.state = .unauthenticated
        SentryService.clearUser()
    }

    /// Permanently deletes the account via the `delete-account` edge function —
    /// the same backend flow as the web app (data removed; public boycotts
    /// reassigned to the "[Deleted User]" sentinel) — then clears local state.
    public func deleteAccount() async throws {
        try await supabase.functions.invoke("delete-account")
        try? await supabase.auth.signOut()
        self.user = nil
        self.state = .unauthenticated
        SentryService.clearUser()
    }

    /// Updates the signed-in user's password. Supabase requires an active
    /// session (the user is already authenticated here).
    public func updatePassword(_ newPassword: String) async throws {
        try await supabase.auth.update(user: UserAttributes(password: newPassword))
    }

    /// Updates the signed-in user's email. Supabase sends a confirmation link to
    /// the new address; the change takes effect once confirmed.
    public func updateEmail(_ newEmail: String) async throws {
        let trimmed = newEmail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let updated = try await supabase.auth.update(user: UserAttributes(email: trimmed))
        self.user = updated
    }

    private func parseAuthError(_ error: Error) -> String {
        let message = error.localizedDescription.lowercased()
        if message.contains("invalid login") || message.contains("invalid") {
            return "Invalid email or password."
        }
        if message.contains("already registered") {
            return "An account with this email already exists."
        }
        if message.contains("email not confirmed") {
            return "Please confirm your email before signing in."
        }
        if message.contains("rate limit") {
            return "Too many attempts. Please try again later."
        }
        return error.localizedDescription
    }
}
