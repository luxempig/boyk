#!/bin/bash
# Build the iOS app and upload it to TestFlight
# Bumps the build number, archives, exports a distribution IPA, validates it
# and uploads. Needs ASC_KEY_ID and ASC_ISSUER_ID in .env, and the matching
# key at ~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
IOS_DIR="$PROJECT_DIR/ios"
CONFIG="$IOS_DIR/Config/Shared.xcconfig"
BUILD_DIR="${TMPDIR:-/tmp}/boyk-ios-release"

# Read the two values directly: macOS's bash 3.2 silently sources nothing from
# a process substitution, so `source <(grep ...)` leaves both empty.
env_value() { grep -E "^$1=" "$PROJECT_DIR/.env" | tail -1 | cut -d= -f2- | tr -d "\"'"; }
ASC_KEY_ID=$(env_value ASC_KEY_ID)
ASC_ISSUER_ID=$(env_value ASC_ISSUER_ID)
KEY_FILE="$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8"
if [ -z "$ASC_KEY_ID" ] || [ -z "$ASC_ISSUER_ID" ] || [ ! -f "$KEY_FILE" ]; then
  echo "Missing App Store Connect credentials (ASC_KEY_ID, ASC_ISSUER_ID, $KEY_FILE)" >&2
  exit 1
fi

# TestFlight rejects a build number it has already seen, so bump before archiving.
CURRENT=$(grep '^CURRENT_PROJECT_VERSION' "$CONFIG" | sed 's/.*= *//')
NEXT=$((CURRENT + 1))
VERSION=$(grep '^MARKETING_VERSION' "$CONFIG" | sed 's/.*= *//')
sed -i '' "s/^CURRENT_PROJECT_VERSION = .*/CURRENT_PROJECT_VERSION = $NEXT/" "$CONFIG"
echo "Building $VERSION ($NEXT)..."

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
cat > "$BUILD_DIR/ExportOptions.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>D5H5726S52</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>destination</key><string>export</string>
</dict>
</plist>
PLIST

# Release signs with the production APNs entitlement (Config/Boyk.Release.entitlements)
xcodebuild -workspace "$IOS_DIR/Boyk.xcworkspace" -scheme Boyk \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$BUILD_DIR/Boyk.xcarchive" -allowProvisioningUpdates archive

xcodebuild -exportArchive -archivePath "$BUILD_DIR/Boyk.xcarchive" \
  -exportPath "$BUILD_DIR/export" -exportOptionsPlist "$BUILD_DIR/ExportOptions.plist" \
  -allowProvisioningUpdates

IPA="$BUILD_DIR/export/Boyk.ipa"
echo "Checking the signed IPA..."
# Check the exported IPA, not the archive: the archive is development-signed and
# only the export re-signs it for distribution with aps-environment=production.
rm -rf "$BUILD_DIR/ipa" && unzip -q "$IPA" -d "$BUILD_DIR/ipa"
APS=$(codesign -d --entitlements - --xml "$BUILD_DIR/ipa/Payload/Boyk.app" 2>/dev/null \
  | plutil -extract aps-environment raw - 2>/dev/null)
[ "$APS" = "production" ] \
  || { echo "Refusing to upload: aps-environment is '$APS', not production" >&2; exit 1; }

# altool exits 0 on some rejections (e.g. a missing agreement), so check its output too.
for STEP in --validate-app --upload-app; do
  OUT=$(xcrun altool $STEP -f "$IPA" -t ios --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" 2>&1) || true
  echo "$OUT"
  if echo "$OUT" | grep -q "ERROR:"; then
    echo "altool $STEP failed. Build number left at $NEXT in $CONFIG; revert it before retrying." >&2
    exit 1
  fi
done

echo
echo "Uploaded $VERSION ($NEXT). Processing takes 5-15 minutes."
echo "Commit the build number: git commit -m 'Bump the iOS build number to $NEXT' $CONFIG"
