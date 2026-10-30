// Expo UI (SwiftUI) for the iOS native wrappers, loaded only when this client has the ExpoUI native module: the
// package barrels register native views on import, so a client without the module (Jest, an older dev client)
// must never evaluate them (MD-128). Import it as '../expoUi.ios' from *.ios.tsx files only (03 §1.1).
import { requireOptionalNativeModule } from 'expo';
import type * as SwiftUI from '@expo/ui/swift-ui';
import type * as SwiftUIModifiers from '@expo/ui/swift-ui/modifiers';

export interface SwiftUIKit {
  ui: typeof SwiftUI;
  modifiers: typeof SwiftUIModifiers;
}

export const swiftUI: SwiftUIKit | null =
  requireOptionalNativeModule('ExpoUI') === null
    ? null
    : {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        ui: require('@expo/ui/swift-ui') as typeof SwiftUI,
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        modifiers: require('@expo/ui/swift-ui/modifiers') as typeof SwiftUIModifiers,
      };
