#!/bin/sh
# Build "Bonsai Chat.app" from BonsaiChat.applescript + icon.icns and install it.
# It goes into /Applications, or ~/Applications if this account cannot write there (APP_DEST overrides).
set -e
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
DEST="${APP_DEST:-/Applications}"
mkdir -p "$DEST" 2>/dev/null || true
if [ ! -w "$DEST" ]; then
	DEST="$HOME/Applications"
	mkdir -p "$DEST"
fi
A="Bonsai Chat.app"
rm -rf "$A"
sed "s|__ROOT__|$ROOT|" BonsaiChat.applescript | osacompile -s -o "$A"
cp icon.icns "$A/Contents/Resources/applet.icns"
rm -f "$A/Contents/Resources/Assets.car"
echo "$ROOT" > "$A/Contents/Resources/root.txt" # which install this app belongs to (the uninstaller checks it)
/usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$A/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string local.bonsai-chat" "$A/Contents/Info.plist"
codesign --force --deep -s - "$A"
rm -rf "$DEST/$A"
cp -R "$A" "$DEST/"
touch "$DEST/$A"
echo "installed $DEST/$A"
