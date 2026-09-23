#!/bin/zsh
# Build the app for the iOS simulator (Release, so no Metro is needed), install
# it on a booted iPhone simulator and launch it.
#
#   ./scripts/ios-sim-run.sh                       # first available iPhone
#   SIM_NAME="iPhone 17 Pro" ./scripts/ios-sim-run.sh
#   PAIR_URL='generatorai://pair?code=…' ./scripts/ios-sim-run.sh   # open a pairing link after launch
#
# `ios/` is generated (`npx expo prebuild --platform ios`) and git-ignored.
set -e
cd "$(dirname "$0")/.."
BUNDLE_ID="dev.generatorai.app"

# `xcode-select` may still point at the Command Line Tools (switching it needs
# sudo). DEVELOPER_DIR selects Xcode for this process tree without it.
if ! xcodebuild -version >/dev/null 2>&1; then
  XCODE_APP="$(ls -d /Applications/Xcode*.app 2>/dev/null | sort | tail -1)"
  [ -n "$XCODE_APP" ] && export DEVELOPER_DIR="$XCODE_APP/Contents/Developer"
fi
xcodebuild -version >/dev/null 2>&1 || {
  echo "Xcode is not usable yet. Install it from the App Store, open it once and accept the licence"
  echo "(or run ./scripts/ios-sim-setup.sh). Details: $(xcodebuild -version 2>&1 | head -1)"
  exit 1
}
xcrun simctl list runtimes 2>/dev/null | grep -q "iOS" || {
  echo "No iOS simulator runtime. Download it: xcodebuild -downloadPlatform iOS"
  exit 1
}

if [ ! -d ios/Pods ]; then
  CI=1 npx expo prebuild --platform ios --no-install
  (cd ios && pod install)
fi

NAME="${SIM_NAME:-$(xcrun simctl list devices available | grep -m1 -oE 'iPhone [0-9]+ Pro' )}"
[ -n "$NAME" ] || NAME="$(xcrun simctl list devices available | grep -m1 -oE 'iPhone[^()]+' | sed 's/ *$//')"
echo "==> Simulator: $NAME"
xcrun simctl boot "$NAME" 2>/dev/null || true
open -a Simulator

echo "==> Building (Release, simulator). The first build takes a while."
xcodebuild -workspace ios/GeneratorAI.xcworkspace -scheme GeneratorAI -configuration Release \
  -sdk iphonesimulator -destination "platform=iOS Simulator,name=$NAME" \
  -derivedDataPath ios/build ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO \
  build | grep -E "error:|warning: unable|BUILD (SUCCEEDED|FAILED)|\*\* " || true

APP="$(find ios/build/Build/Products/Release-iphonesimulator -maxdepth 1 -name '*.app' | head -1)"
[ -d "$APP" ] || { echo "Build did not produce an .app"; exit 1; }
xcrun simctl install booted "$APP"
xcrun simctl launch booted "$BUNDLE_ID"
[ -n "$PAIR_URL" ] && { sleep 4; xcrun simctl openurl booted "$PAIR_URL"; }
echo "==> Launched $BUNDLE_ID on $NAME"
