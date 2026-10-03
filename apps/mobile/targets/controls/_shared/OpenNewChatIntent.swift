// "New chat" for the Control Center control (mobile 06 §7.5, MX-05). Compiled into the app and the controls
// extension (`_shared`): with `openAppWhenRun` the system runs it in the app, which then opens the shared launcher
// link — routed like any deep link (allowlist, server rules, 06 §3.12). It never acts by itself.

import AppIntents
import Foundation

@available(iOS 18.0, *)
struct OpenNewChatIntent: AppIntent {
  static let title: LocalizedStringResource = "New chat"
  static let description = IntentDescription("Start a new chat in GeneratorAI.")
  static let openAppWhenRun: Bool = true
  static let isDiscoverable: Bool = true

  @MainActor
  func perform() async throws -> some IntentResult & OpensIntent {
    // LAUNCHER_ACTIONS `chat.new` (packages/shared ui-contract), the same link the home-screen quick action opens.
    return .result(opensIntent: OpenURLIntent(URL(string: "generatorai://command/chat.new")!))
  }
}
