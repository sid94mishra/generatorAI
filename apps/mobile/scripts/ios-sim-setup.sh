#!/bin/zsh
# One-time: make Xcode usable for simulator builds, installing it if needed.
#
# If Xcode is already in /Applications (the App Store is the simplest source
# when this macOS meets its minimum), this only accepts the licence, runs the
# first-launch tasks and downloads the iOS simulator runtime.
#
# Otherwise it installs a chosen version from developer.apple.com through
# `xcodes` — for a macOS older than the App Store Xcode's minimum — which asks
# for an Apple ID and a two-factor code that only you can supply.
#
#   ./scripts/ios-sim-setup.sh            # installs Xcode 27.0 when none is present
#   XCODE_VERSION=26.5 ./scripts/ios-sim-setup.sh
set -e
VERSION="${XCODE_VERSION:-27.0}"
XCODES="${XCODES_BIN:-$HOME/.local/bin/xcodes}"
command -v "$XCODES" >/dev/null || XCODES="$(command -v xcodes || true)"
if ! ls -d /Applications/Xcode*.app >/dev/null 2>&1 && [ ! -x "$XCODES" ]; then
  echo "No Xcode in /Applications and no xcodes CLI. Install Xcode from the App Store, or xcodes: https://github.com/XcodesOrg/xcodes"
  exit 1
fi

if ! ls -d /Applications/Xcode*.app >/dev/null 2>&1; then
  echo "==> Installing Xcode $VERSION (about 3 GB download, 12 GB unpacked). Apple ID and 2FA code are asked for next."
  "$XCODES" install "$VERSION" --experimental-unxip --directory /Applications
fi

APP="$(ls -d /Applications/Xcode*.app | sort | tail -1)"
echo "==> Selecting $APP, accepting the licence and running first-launch tasks (needs your Mac password)."
sudo xcode-select -s "$APP/Contents/Developer"
sudo xcodebuild -license accept
sudo xcodebuild -runFirstLaunch

echo "==> Downloading the iOS simulator runtime (about 8 GB)."
xcodebuild -downloadPlatform iOS

echo "==> Done."
xcodebuild -version
xcrun simctl list devices available | grep -m5 iPhone
