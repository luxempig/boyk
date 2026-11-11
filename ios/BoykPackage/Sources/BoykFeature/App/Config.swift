import Foundation
import Supabase

public enum Config: Sendable {
    public static let supabaseURL = URL(string: "https://ggmkhgmrjtaacbcgnuwy.supabase.co")!
    public static let supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdnbWtoZ21yanRhYWNiY2dudXd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg1MDAwNzUsImV4cCI6MjA4NDA3NjA3NX0.gjuDC0b4a9CqH6e6zNOKHmrFOQvWi_dIPI9h7ePtjew"
    public static let neo4jAPIBase = URL(string: "https://boyk.org/neo4j-api")!

    // Drop in the iOS Sentry DSN once you've created the iOS project in Sentry.
    // Empty string disables Sentry entirely (the SDK is wired but inert).
    // boyk-ios project in the "boyk" Sentry org. A DSN only allows sending
    // events, so it is safe to ship in the binary. It goes through boyk.org's
    // relay (public/_worker.js) because some networks block sentry.io.
    public static let sentryDSN = "https://2177362dad7ae8b48912400a3af0ee3e@boyk.org/sentry-relay/4512203232575488"
}

public let supabase = SupabaseClient(
    supabaseURL: Config.supabaseURL,
    supabaseKey: Config.supabaseAnonKey
)
