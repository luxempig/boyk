import SwiftUI
import NukeUI

/// Drop-in replacement for AsyncImage that uses Nuke's pipeline for memory + disk caching.
/// Resolves URL strings (which is what most call sites have on hand), accepts a fallback
/// view for failure/empty states, and applies a single content shape so it composes cleanly
/// with `.frame` and `.clipShape` modifiers at the call site.
struct BoykImage<Fallback: View>: View {
    let url: URL?
    @ViewBuilder let fallback: () -> Fallback

    init(url: URL?, @ViewBuilder fallback: @escaping () -> Fallback) {
        self.url = Self.normalized(url)
        self.fallback = fallback
    }

    init(urlString: String?, @ViewBuilder fallback: @escaping () -> Fallback) {
        self.url = Self.normalized(urlString.flatMap(URL.init(string:)))
        self.fallback = fallback
    }

    /// Rewrites logo URLs the data pipeline stores in forms iOS can't load
    /// directly (the same URLs work in browsers, so the web app shows these
    /// logos): plaintext `http://` is blocked by App Transport Security, and
    /// Nuke has no SVG decoder. Wikimedia rasterizes its own SVGs server-side
    /// when `Special:FilePath` gets a `width` parameter, so pointing at the
    /// thumbnail yields a PNG the pipeline can decode.
    private static func normalized(_ url: URL?) -> URL? {
        guard let url,
              var comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { return url }

        if comps.scheme == "http" { comps.scheme = "https" }

        let host = comps.host ?? ""
        let isWikimedia = host.hasSuffix("wikimedia.org") || host.hasSuffix("wikipedia.org")
        if isWikimedia, comps.path.lowercased().hasSuffix(".svg"),
           !(comps.queryItems ?? []).contains(where: { $0.name == "width" }) {
            comps.queryItems = (comps.queryItems ?? []) + [URLQueryItem(name: "width", value: "256")]
        }

        return comps.url ?? url
    }

    var body: some View {
        // No URL at all means there is nothing to wait for, so show the caller's
        // fallback immediately rather than a loading state that never resolves.
        if url == nil {
            fallback()
        } else {
            LazyImage(url: url) { state in
                if let image = state.image {
                    image
                        .resizable()
                } else if state.error != nil {
                    // A genuine failure: unsupported format (Nuke cannot decode
                    // SVG), 404, or a network error. The caller's fallback is the
                    // failure representation and must stand on its own.
                    fallback()
                } else {
                    // Still in flight. Kept visually distinct from failure so a
                    // permanent error never masquerades as a slow load.
                    Skeleton()
                }
            }
        }
    }
}
