// iOS 18 Control Center control "New chat" (mobile 06 §7.5, MX-05; MD-189). A WidgetKit extension built by
// @bacons/apple-targets at prebuild. `_shared/` is compiled into the app too: a control's intent with
// `openAppWhenRun` must exist in both targets. No App Group, no data: it only opens a deep link.
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = () => ({
  type: 'widget',
  name: 'Controls',
  bundleIdentifier: '.controls',
  deploymentTarget: '18.0',
  frameworks: ['SwiftUI', 'WidgetKit', 'AppIntents'],
});
