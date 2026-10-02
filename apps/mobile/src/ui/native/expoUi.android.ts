// Expo UI (Jetpack Compose) for the Android native wrappers, loaded only when this client has the ExpoUI native
// module (see expoUi.ios.ts). Import it as '../expoUi.android' from *.android.tsx files only (03 §1.1).
import { requireOptionalNativeModule } from 'expo';
import type * as Compose from '@expo/ui/jetpack-compose';
import type * as ComposeModifiers from '@expo/ui/jetpack-compose/modifiers';

export interface ComposeKit {
  ui: typeof Compose;
  modifiers: typeof ComposeModifiers;
}

export const compose: ComposeKit | null =
  requireOptionalNativeModule('ExpoUI') === null
    ? null
    : {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        ui: require('@expo/ui/jetpack-compose') as typeof Compose,
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        modifiers: require('@expo/ui/jetpack-compose/modifiers') as typeof ComposeModifiers,
      };
