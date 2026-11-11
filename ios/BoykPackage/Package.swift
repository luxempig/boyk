// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "BoykFeature",
    platforms: [.iOS(.v17)],
    products: [
        .library(
            name: "BoykFeature",
            targets: ["BoykFeature"]
        ),
    ],
    dependencies: [
        .package(url: "https://github.com/supabase/supabase-swift.git", from: "2.0.0"),
        .package(url: "https://github.com/getsentry/sentry-cocoa.git", from: "8.0.0"),
        .package(url: "https://github.com/kean/Nuke.git", from: "12.0.0"),
    ],
    targets: [
        .target(
            name: "BoykFeature",
            dependencies: [
                .product(name: "Supabase", package: "supabase-swift"),
                .product(name: "Sentry", package: "sentry-cocoa"),
                .product(name: "Nuke", package: "Nuke"),
                .product(name: "NukeUI", package: "Nuke"),
            ]
        ),
        .testTarget(
            name: "BoykFeatureTests",
            dependencies: [
                "BoykFeature",
            ]
        ),
    ]
)
