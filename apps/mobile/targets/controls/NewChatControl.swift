// The Control Center control (iOS 18+, mobile 06 §7.5, MX-05, MWidgets "Controls"): one button, "New chat", that
// opens the app on the new-chat sheet. "Pause agents" is not built (MD-06, MG-16: no server feature).

import AppIntents
import SwiftUI
import WidgetKit

struct NewChatControl: ControlWidget {
  static let kind: String = "dev.generatorai.app.control.new-chat"

  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: Self.kind) {
      ControlWidgetButton(action: OpenNewChatIntent()) {
        Label("New chat", systemImage: "square.and.pencil")
      }
    }
    .displayName("New chat")
    .description("Start a new chat in GeneratorAI.")
  }
}

@main
struct GeneratorAIControls: WidgetBundle {
  var body: some Widget {
    NewChatControl()
  }
}
