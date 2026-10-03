// The OS the data layer runs on, for services outside `services/native` and `services/notifications` (MD-15: only
// these and the kit's platform layer read `Platform`). `web` is the browser preview, which has no sensor, microphone
// stream or keychain.
import { Platform } from 'react-native';

export type RuntimeOs = 'ios' | 'android' | 'web';

export const RUNTIME_OS: RuntimeOs = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
export const IS_NATIVE_RUNTIME = RUNTIME_OS !== 'web';
