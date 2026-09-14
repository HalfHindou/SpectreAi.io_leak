#!/bin/bash
# Brand the Electron.app binary as "Spectre AI" for dev mode
# Run automatically after npm install via postinstall hook

ELECTRON_APP="$(dirname "$0")/../node_modules/electron/dist/Electron.app"

if [ ! -d "$ELECTRON_APP" ]; then
  echo "[brand] Electron.app not found, skipping"
  exit 0
fi

PLIST="$ELECTRON_APP/Contents/Info.plist"

# Rename main app
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName 'Spectre AI'" "$PLIST" 2>/dev/null
/usr/libexec/PlistBuddy -c "Set :CFBundleName 'Spectre AI'" "$PLIST" 2>/dev/null
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier 'com.spectre.ai'" "$PLIST" 2>/dev/null
/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile 'spectre.icns'" "$PLIST" 2>/dev/null

# Add SPECTRE_DEV env var
/usr/libexec/PlistBuddy -c "Add :LSEnvironment:SPECTRE_DEV string true" "$PLIST" 2>/dev/null

# Symlink executable
cd "$ELECTRON_APP/Contents/MacOS"
[ ! -L "Spectre AI" ] && ln -sf "Electron" "Spectre AI"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable 'Spectre AI'" "$PLIST" 2>/dev/null

# Copy icon
cp "$(dirname "$0")/../assets/icon.icns" "$ELECTRON_APP/Contents/Resources/spectre.icns" 2>/dev/null

# Rename helpers
FRAMEWORKS="$ELECTRON_APP/Contents/Frameworks"
for helper in "Electron Helper" "Electron Helper (GPU)" "Electron Helper (Plugin)" "Electron Helper (Renderer)"; do
  NEW_NAME=$(echo "$helper" | sed 's/Electron/Spectre AI/')
  HP="$FRAMEWORKS/$helper.app/Contents/Info.plist"
  if [ -f "$HP" ]; then
    /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName '$NEW_NAME'" "$HP" 2>/dev/null
    /usr/libexec/PlistBuddy -c "Set :CFBundleName '$NEW_NAME'" "$HP" 2>/dev/null
  fi
done

# Re-register with LaunchServices
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$ELECTRON_APP" 2>/dev/null

echo "[brand] Electron.app branded as Spectre AI"
