#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
APP="release/robaq AI.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" macos/build-cache
SDK="$(xcrun --sdk macosx --show-sdk-path)"
ARCHS="${ROBAQ_ARCHS:-arm64}"
BINARIES=()
for ARCH in $ARCHS; do
  xcrun swiftc macos/main.swift -sdk "$SDK" -target "$ARCH-apple-macos12.0" -module-cache-path macos/build-cache -O -o "macos/build-cache/robaq-$ARCH" -framework Cocoa -framework WebKit
  BINARIES+=("macos/build-cache/robaq-$ARCH")
done
lipo -create "${BINARIES[@]}" -output "$APP/Contents/MacOS/robaq"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>robaq</string>
<key>CFBundleIdentifier</key><string>app.robaq.desktop</string>
<key>CFBundleName</key><string>robaq AI</string>
<key>CFBundleDisplayName</key><string>robaq AI</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSMicrophoneUsageDescription</key><string>robaq AI uses your microphone for voice conversations and voice reactions.</string>
<key>NSCameraUsageDescription</key><string>robaq AI uses your camera when you choose to attach a photo.</string>
</dict></plist>
PLIST
ICONSET="macos/build-cache/AppIcon.iconset"
mkdir -p "$ICONSET"
SOURCE="ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
for SIZE in 16 32 128 256 512; do
 sips -z "$SIZE" "$SIZE" "$SOURCE" --out "$ICONSET/icon_${SIZE}x${SIZE}.png" >/dev/null
 DOUBLE=$((SIZE * 2))
 sips -z "$DOUBLE" "$DOUBLE" "$SOURCE" --out "$ICONSET/icon_${SIZE}x${SIZE}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
codesign --force --sign - "$APP"
plutil -lint "$APP/Contents/Info.plist"
codesign --verify --strict "$APP"
ditto -c -k --sequesterRsrc --keepParent "$APP" 'release/robaq-AI-macOS.zip'
