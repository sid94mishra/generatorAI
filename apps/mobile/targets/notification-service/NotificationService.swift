// Notification Service Extension (mobile 06 §7.2, MD-33 / MD-92).
//
// Every push from the server is sent with `mutableContent: true`, so iOS hands it to this extension before showing
// it. When the app has set the App Group flag `privacy.redact` (App lock on, or Settings › App lock & privacy ›
// "Hide notification previews"), the title and body are replaced with the payload's lock-screen-safe
// `redacted` copy ("Permission needed" / "Open GeneratorAI to see it.") — never the command or message text.
// Otherwise the push is shown unchanged. No network, no credentials: it only reads the flag and the payload.
//
// Expo Push puts the notification's `data` under the `body` key of the APNs payload (expo-notifications reads it
// from `userInfo["body"]` the same way).

import UserNotifications

final class NotificationService: UNNotificationServiceExtension {
  private static let appGroup = "group.dev.generatorai.app"
  private static let redactFlag = "privacy.redact"

  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var bestAttempt: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
      contentHandler(request.content)
      return
    }
    bestAttempt = content

    let redact = UserDefaults(suiteName: Self.appGroup)?.integer(forKey: Self.redactFlag) == 1
    if redact {
      let data = content.userInfo["body"] as? [String: Any]
      let redacted = data?["redacted"] as? [String: Any]
      // A push without the redacted copy still loses its text: the flag promises no previews.
      content.title = (redacted?["title"] as? String) ?? "GeneratorAI"
      content.subtitle = ""
      content.body = (redacted?["body"] as? String) ?? "Open GeneratorAI to see it."
    }
    contentHandler(content)
  }

  override func serviceExtensionTimeWillExpire() {
    // Called when time runs out: deliver what we have rather than the original text.
    if let contentHandler = contentHandler, let content = bestAttempt {
      contentHandler(content)
    }
  }
}
