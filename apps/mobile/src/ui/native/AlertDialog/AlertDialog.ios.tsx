// MP-29 AlertDialog — iOS: UIAlertController through RN Alert: the question, what is lost (+ impact lines), Cancel and
// the destructive action in the system red. The step-up runs after confirm. No host is needed on iOS.
import { Alert } from 'react-native';

import type { AlertDialogOptions } from './AlertDialog.types';
import { afterConfirm, alertMessage } from './alertDialogModel';

export type { AlertDialogOptions, StepUpHandler } from './AlertDialog.types';

/** The platform alert (also Android's when no AlertDialogHost is mounted). */
export function systemConfirm(options: AlertDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: boolean): void => {
      if (settled) return;
      settled = true;
      if (!v) resolve(false);
      else void afterConfirm(options).then(resolve);
    };
    Alert.alert(
      options.title,
      alertMessage(options),
      [
        { text: options.cancelLabel ?? 'Cancel', style: 'cancel', onPress: () => done(false) },
        { text: options.confirmLabel, style: options.destructive === false ? 'default' : 'destructive', onPress: () => done(true) },
      ],
      { cancelable: true, onDismiss: () => done(false) },
    );
  });
}

export const confirm = systemConfirm;

/** iOS needs no host (Android mounts the Compose dialog here). */
export function AlertDialogHost(): null {
  return null;
}
