// iOS Notification Service Extension (mobile 06 §7.2, MD-92): swaps each push's title and body for its
// lock-screen-safe `data.redacted` while App lock (or "Hide notification previews") is on. Built by
// @bacons/apple-targets at prebuild. It holds no credentials and makes no network calls.
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = () => ({
  type: 'notification-service',
  name: 'NotificationService',
  bundleIdentifier: '.notification-service',
  deploymentTarget: '18.0',
  frameworks: ['UserNotifications'],
  entitlements: {
    'com.apple.security.application-groups': ['group.dev.generatorai.app'],
  },
});
