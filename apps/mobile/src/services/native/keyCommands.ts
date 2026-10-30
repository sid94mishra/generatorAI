// Hardware keyboard shortcuts (06 §3.10, M5-09): the registry's desktop bindings as native key commands — iOS
// `UIKeyCommand`s on the key window (shown in the ⌘-hold overlay and the iPadOS menu bar), Android a delegating
// `Window.Callback` that consumes only matching chords (and lists them in the Meta+/ helper). Mobile declares no
// bindings of its own: iPad uses the `desktopMac` bindings, Android the `desktopWinLinux` ones.
//
// The native side lives in the local device-key module (modules/generatorai-device-key). Every call is optional:
// on a client built before M5-09 the functions are missing and this is a no-op (`keyCommandsAvailable()` false).
import { requireOptionalNativeModule } from 'expo';
import type { NativeKeyCommand } from './keyCommandMap';

export { nativeKeyCommand, nativeKeyCommands, type KeyModifier, type NativeKeyCommand } from './keyCommandMap';

interface KeyCommandsNative {
  setKeyCommands?: (commands: NativeKeyCommand[]) => void;
  setKeyCommandsSuspended?: (suspended: boolean) => void;
  isHardwareKeyboardAttached?: () => boolean;
  addListener?: (event: string, listener: (payload: Record<string, unknown>) => void) => { remove: () => void };
}

const native = requireOptionalNativeModule<KeyCommandsNative>('GeneratorAIDeviceKey');

export function keyCommandsAvailable(): boolean {
  return typeof native?.setKeyCommands === 'function';
}

export function setKeyCommands(commands: NativeKeyCommand[]): void {
  native?.setKeyCommands?.(commands);
}

export function setKeyCommandsSuspended(suspended: boolean): void {
  native?.setKeyCommandsSuspended?.(suspended);
}

export function isHardwareKeyboardAttached(): boolean {
  try {
    return native?.isHardwareKeyboardAttached?.() === true;
  } catch {
    return false;
  }
}

/** `onKeyCommand` → the command id; `onHardwareKeyboardChange` → attached. Returns the unsubscribe. */
export function addKeyCommandListeners(onCommand: (id: string) => void, onKeyboard: (attached: boolean) => void): () => void {
  if (!keyCommandsAvailable() || typeof native?.addListener !== 'function') return () => undefined;
  const a = native.addListener('onKeyCommand', (p) => {
    if (typeof p.id === 'string') onCommand(p.id);
  });
  const b = native.addListener('onHardwareKeyboardChange', (p) => onKeyboard(p.attached === true));
  return () => {
    a.remove();
    b.remove();
  };
}
