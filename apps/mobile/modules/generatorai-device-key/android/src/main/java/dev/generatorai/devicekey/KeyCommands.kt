// ────────────────────────────────────────────────────────────────
// Hardware keyboard shortcuts for Android tablets and Chromebooks
// (mobile 06 §3.10, M5-09).
//
// UNCOMPILED: written without the Android SDK on the authoring machine.
// Review the first `expo prebuild --platform android && expo run:android`.
//
// The JS side (src/services/native/keyCommands.ts) hands over the commands
// built from the shared COMMANDS registry (desktopWinLinux bindings). The
// activity's `Window.Callback` is wrapped ONCE by a delegating callback that
// consumes only a key-down whose key code and Ctrl / Alt / Shift / Meta
// state match a registered command exactly (and the matching key-up);
// everything else passes through untouched, so a TextInput keeps every key.
// No MainActivity edits. The callback also lists the shortcuts in the
// system keyboard-shortcuts helper (Meta + /).
//
// Suspended (a focused terminal owns every key, MD-19): nothing matches.
// ────────────────────────────────────────────────────────────────

package dev.generatorai.devicekey

import android.app.Activity
import android.os.Build
import android.view.KeyEvent
import android.view.KeyboardShortcutGroup
import android.view.KeyboardShortcutInfo
import android.view.Menu
import android.view.Window
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** One hardware shortcut from JS (src/services/native/keyCommandMap.ts `NativeKeyCommand`). */
class KeyCommandRecord : Record {
  @Field val id: String = ""
  @Field val input: String = ""
  @Field val modifiers: List<String> = emptyList()
  @Field val title: String = ""
}

internal data class KeyCommandSpec(
  val id: String,
  val keyCode: Int,
  val ctrl: Boolean,
  val alt: Boolean,
  val shift: Boolean,
  val meta: Boolean,
  val title: String,
) {
  val metaState: Int
    get() = (if (ctrl) KeyEvent.META_CTRL_ON else 0) or
      (if (alt) KeyEvent.META_ALT_ON else 0) or
      (if (shift) KeyEvent.META_SHIFT_ON else 0) or
      (if (meta) KeyEvent.META_META_ON else 0)
}

internal object KeyCommandCenter {
  @Volatile var specs: List<KeyCommandSpec> = emptyList()
  @Volatile var suspended = false
  @Volatile var emit: ((String) -> Unit)? = null

  /** Key-down codes we consumed, so their key-ups are consumed too. */
  private val consumed = mutableSetOf<Int>()

  fun spec(record: KeyCommandRecord): KeyCommandSpec? {
    val code = keyCode(record.input) ?: return null
    val mods = record.modifiers.toSet()
    return KeyCommandSpec(record.id, code, "ctrl" in mods, "alt" in mods, "shift" in mods, "cmd" in mods, record.title)
  }

  /** Wrap the activity's window callback once (main thread). */
  fun install(activity: Activity?) {
    val window = activity?.window ?: return
    val current = window.callback ?: return
    if (current is KeyCommandWindowCallback) return
    window.callback = KeyCommandWindowCallback(current)
  }

  /** True when the event belongs to a registered command (and was forwarded). */
  fun handle(event: KeyEvent): Boolean {
    if (event.action == KeyEvent.ACTION_UP) {
      return synchronized(consumed) { consumed.remove(event.keyCode) }
    }
    if (suspended || event.action != KeyEvent.ACTION_DOWN) return false
    val hit = specs.firstOrNull {
      it.keyCode == event.keyCode &&
        it.ctrl == event.isCtrlPressed &&
        it.alt == event.isAltPressed &&
        it.shift == event.isShiftPressed &&
        it.meta == event.isMetaPressed
    } ?: return false
    synchronized(consumed) { consumed.add(event.keyCode) }
    // Auto-repeat of a held chord fires once.
    if (event.repeatCount == 0) emit?.invoke(hit.id)
    return true
  }

  fun keyCode(input: String): Int? = when (input) {
    "escape" -> KeyEvent.KEYCODE_ESCAPE
    "up" -> KeyEvent.KEYCODE_DPAD_UP
    "down" -> KeyEvent.KEYCODE_DPAD_DOWN
    "left" -> KeyEvent.KEYCODE_DPAD_LEFT
    "right" -> KeyEvent.KEYCODE_DPAD_RIGHT
    "enter" -> KeyEvent.KEYCODE_ENTER
    "tab" -> KeyEvent.KEYCODE_TAB
    "," -> KeyEvent.KEYCODE_COMMA
    "." -> KeyEvent.KEYCODE_PERIOD
    "/" -> KeyEvent.KEYCODE_SLASH
    "[" -> KeyEvent.KEYCODE_LEFT_BRACKET
    "]" -> KeyEvent.KEYCODE_RIGHT_BRACKET
    "-" -> KeyEvent.KEYCODE_MINUS
    "=" -> KeyEvent.KEYCODE_EQUALS
    else -> if (input.length == 1) {
      val c = input[0]
      when (c) {
        in 'a'..'z' -> KeyEvent.KEYCODE_A + (c - 'a')
        in '0'..'9' -> KeyEvent.KEYCODE_0 + (c - '0')
        else -> null
      }
    } else {
      null
    }
  }
}

/** Delegates every callback to the activity's own; intercepts only matching key events. */
internal class KeyCommandWindowCallback(private val wrapped: Window.Callback) : Window.Callback by wrapped {
  override fun dispatchKeyEvent(event: KeyEvent?): Boolean {
    if (event != null && KeyCommandCenter.handle(event)) return true
    return wrapped.dispatchKeyEvent(event)
  }

  override fun onProvideKeyboardShortcuts(data: MutableList<KeyboardShortcutGroup>?, menu: Menu?, deviceId: Int) {
    wrapped.onProvideKeyboardShortcuts(data, menu, deviceId)
    if (data == null) return
    val items = KeyCommandCenter.specs.map { KeyboardShortcutInfo(it.title, it.keyCode, it.metaState) }
    if (items.isNotEmpty()) data.add(KeyboardShortcutGroup("GeneratorAI", items))
  }

  override fun onPointerCaptureChanged(hasCapture: Boolean) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) wrapped.onPointerCaptureChanged(hasCapture)
  }
}
