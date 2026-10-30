// ────────────────────────────────────────────────────────────────
// Hardware keyboard shortcuts for iPad (mobile 06 §3.10, M5-09).
//
// The JS side (src/services/native/keyCommands.ts) hands over the commands
// built from the shared COMMANDS registry (desktopMac bindings). They are
// installed as `UIKeyCommand`s on the ROOT VIEW CONTROLLER of the active
// scene's key window (06 §3.10; `addKeyCommand` is a UIViewController API).
// The root controller is in the responder chain of pushed screens and — as
// their presenter — of form sheets and full-screen modals, and the iPadOS ⌘-hold
// overlay / menu bar list them by `discoverabilityTitle`. The action is a
// `UIResponder` extension, so whichever responder UIKit asks first answers
// and forwards the command id (`propertyList`) to JS as `onKeyCommand`.
//
// Suspended (a focused terminal owns every key, MD-19): the commands are
// REMOVED, not ignored — an installed command would swallow the key.
// They are re-installed whenever a scene activates or a window becomes key.
//
// Hardware keyboard presence (KbdHint) comes from GameController's
// `GCKeyboard.coalesced`, with connect / disconnect notifications.
// ────────────────────────────────────────────────────────────────

import GameController
import UIKit

internal struct KeyCommandSpec {
  let id: String
  let input: String
  let modifiers: [String]
  let title: String
}

internal final class KeyCommandCenter: NSObject {
  static let shared = KeyCommandCenter()

  /// Set by the module: forwards a command id to JS.
  var emit: ((String) -> Void)?

  private var specs: [KeyCommandSpec] = []
  private var suspended = false
  private weak var installedController: UIViewController?
  private var installedCommands: [UIKeyCommand] = []
  private var observing = false

  /// Main thread only.
  func install(_ next: [KeyCommandSpec]) {
    specs = next
    observe()
    reinstall()
  }

  /// Main thread only.
  func setSuspended(_ value: Bool) {
    guard value != suspended else { return }
    suspended = value
    reinstall()
  }

  func fire(_ id: String) {
    guard !suspended else { return }
    emit?(id)
  }

  @objc private func reinstall() {
    uninstall()
    guard !suspended, !specs.isEmpty, let controller = Self.keyWindow()?.rootViewController else { return }
    let commands = specs.compactMap(Self.makeCommand)
    for command in commands {
      controller.addKeyCommand(command)
    }
    installedController = controller
    installedCommands = commands
  }

  private func uninstall() {
    if let controller = installedController {
      for command in installedCommands {
        controller.removeKeyCommand(command)
      }
    }
    installedController = nil
    installedCommands = []
  }

  private func observe() {
    guard !observing else { return }
    observing = true
    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(reinstall), name: UIScene.didActivateNotification, object: nil)
    center.addObserver(self, selector: #selector(reinstall), name: UIWindow.didBecomeKeyNotification, object: nil)
  }

  /// The key window of the foreground-active scene (Stage Manager can show several scenes).
  private static func keyWindow() -> UIWindow? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let ordered = scenes.filter { $0.activationState == .foregroundActive } + scenes.filter { $0.activationState != .foregroundActive }
    for scene in ordered {
      if let window = scene.windows.first(where: { $0.isKeyWindow }) {
        return window
      }
    }
    return ordered.first?.windows.first
  }

  private static func makeCommand(_ spec: KeyCommandSpec) -> UIKeyCommand? {
    guard let input = keyInput(spec.input) else { return nil }
    var flags: UIKeyModifierFlags = []
    for modifier in spec.modifiers {
      switch modifier {
      case "cmd": flags.insert(.command)
      case "ctrl": flags.insert(.control)
      case "alt": flags.insert(.alternate)
      case "shift": flags.insert(.shift)
      default: break
      }
    }
    let command = UIKeyCommand(
      title: spec.title,
      image: nil,
      action: #selector(UIResponder.gai_handleKeyCommand(_:)),
      input: input,
      modifierFlags: flags,
      propertyList: spec.id
    )
    command.discoverabilityTitle = spec.title
    if #available(iOS 15.0, *) {
      // ⌘[ / arrows / Escape would otherwise go to text navigation first.
      command.wantsPriorityOverSystemBehavior = true
    }
    return command
  }

  private static func keyInput(_ name: String) -> String? {
    switch name {
    case "escape": return UIKeyCommand.inputEscape
    case "up": return UIKeyCommand.inputUpArrow
    case "down": return UIKeyCommand.inputDownArrow
    case "left": return UIKeyCommand.inputLeftArrow
    case "right": return UIKeyCommand.inputRightArrow
    case "enter": return "\r"
    case "tab": return "\t"
    default: return name.count == 1 ? name : nil
    }
  }
}

extension UIResponder {
  /// Target of every GeneratorAI key command; forwards its id to JS.
  @objc func gai_handleKeyCommand(_ command: UIKeyCommand) {
    guard let id = command.propertyList as? String else { return }
    KeyCommandCenter.shared.fire(id)
  }
}

internal final class KeyboardPresence: NSObject {
  static let shared = KeyboardPresence()

  var onChange: ((Bool) -> Void)?
  private var observing = false

  var attached: Bool {
    return GCKeyboard.coalesced != nil
  }

  func start() {
    guard !observing else { return }
    observing = true
    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(changed), name: .GCKeyboardDidConnect, object: nil)
    center.addObserver(self, selector: #selector(changed), name: .GCKeyboardDidDisconnect, object: nil)
  }

  @objc private func changed() {
    onChange?(attached)
  }
}
