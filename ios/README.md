# Boyk for iPhone

The SwiftUI app, distributed to beta testers through TestFlight.

## Layout

```
ios/
├── Boyk.xcworkspace        Open this in Xcode
├── Boyk/                   App target: entry point and assets only
├── BoykPackage/            Swift package that holds all feature code
│   ├── Sources/BoykFeature/
│   │   ├── App/            Configuration and app wiring
│   │   ├── Models/         Codable types shared with the web API
│   │   ├── Services/       Supabase, graph API, barcode lookup, error reporting
│   │   ├── ViewModels/     Observable state for each screen
│   │   ├── Views/          SwiftUI screens
│   │   └── Theme/          Colors, type and spacing tokens
│   └── Tests/              Unit tests
├── BoykUITests/            UI tests
└── Config/                 Build settings (.xcconfig) and entitlements
```

The app target is a thin shell. Everything else lives in the package, so most work builds and
tests without touching the Xcode project file.

## What it does

- Scan a barcode or search a brand and see the ownership chain behind it.
- Create boycotts, adopt other people's, and check a scanned product against them.
- A feed of posts, replies and reposts, with report and block controls.
- Sign in with email and password, with email confirmation and password reset.

## Building

Open `Boyk.xcworkspace`, pick the `Boyk` scheme and an iPhone simulator, and run. It targets
iOS 17 and later.

The app talks to the same backend as the web app. That backend now runs as a read-only snapshot
(see the main README), so graph and barcode lookups work and anything that needs an account does
not.
