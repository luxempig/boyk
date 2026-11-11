#!/bin/bash
# Build Chrome extension for distribution
# Copies extension files to dist-extension/ and creates a ZIP

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SRC_DIR="$PROJECT_DIR/chrome-extension"
DIST_DIR="$PROJECT_DIR/dist-extension"

echo "Building Boyk Chrome Extension..."

# Clean previous build
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/icons"

# Copy extension files
cp "$SRC_DIR/manifest.json" "$DIST_DIR/"
cp "$SRC_DIR/background.js" "$DIST_DIR/"
cp "$SRC_DIR/content.js" "$DIST_DIR/"
cp "$SRC_DIR/popup.js" "$DIST_DIR/"
cp "$SRC_DIR/popup.html" "$DIST_DIR/"
cp "$SRC_DIR/popup.css" "$DIST_DIR/"
cp "$SRC_DIR/warning.css" "$DIST_DIR/"

# Copy icons
cp "$SRC_DIR/icons/icon16.png" "$DIST_DIR/icons/"
cp "$SRC_DIR/icons/icon48.png" "$DIST_DIR/icons/"
cp "$SRC_DIR/icons/icon128.png" "$DIST_DIR/icons/"

# Inject Supabase config into the COPIED files (never the source).
# Falls back to the public publishable values so the build never breaks if env is unset.
SUPA_URL="${VITE_SUPABASE_URL:-https://ggmkhgmrjtaacbcgnuwy.supabase.co}"
SUPA_KEY="${VITE_SUPABASE_ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdnbWtoZ21yanRhYWNiY2dudXd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg1MDAwNzUsImV4cCI6MjA4NDA3NjA3NX0.gjuDC0b4a9CqH6e6zNOKHmrFOQvWi_dIPI9h7ePtjew}"

# Route through a temp file instead of `sed -i` — the -i backup-suffix syntax
# differs between BSD (macOS) and GNU (Linux CI) sed, so this stays portable.
for f in "$DIST_DIR/background.js" "$DIST_DIR/popup.js"; do
  tmp="$(mktemp)"
  sed \
    -e "s|__SUPABASE_URL__|$SUPA_URL|g" \
    -e "s|__SUPABASE_ANON_KEY__|$SUPA_KEY|g" \
    "$f" >"$tmp"
  mv "$tmp" "$f"
done

# Create ZIP for Chrome Web Store upload (written into dist-extension/, excluding itself)
ZIP_NAME="boyk-extension.zip"
cd "$DIST_DIR"
rm -f "$ZIP_NAME"
zip -r "$ZIP_NAME" . -x ".*" -x "$ZIP_NAME"

echo ""
echo "Build complete:"
echo "  Directory: dist-extension/"
echo "  Archive:   dist-extension/$ZIP_NAME"
echo ""
echo "To install locally:"
echo "  1. Open chrome://extensions/"
echo "  2. Enable Developer Mode"
echo "  3. Click 'Load unpacked' and select the dist-extension/ directory"
