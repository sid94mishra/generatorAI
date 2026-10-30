// MP-29 AlertDialog — Android: the M3 Compose AlertDialog through Expo UI, shown by AlertDialogHost (mounted once by
// the shell): optional centred icon, the question (system font, MD-74), what is lost, and end-aligned text buttons;
// the destructive action is err-coloured. Without a mounted host, or without the ExpoUI module, it is the system
// AlertDialog (RN Alert). The step-up runs after confirm.
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useThemeColors } from '../../lib/themeColors';
import { Icon } from '../../primitives/Icon';
import { compose } from '../expoUi.android';
import type { AlertDialogOptions } from './AlertDialog.types';
import { systemConfirm } from './AlertDialog.ios';
import { afterConfirm, alertMessage, presentToHost, registerAlertHost, type AlertRequest } from './alertDialogModel';

export type { AlertDialogOptions, StepUpHandler } from './AlertDialog.types';

export function confirm(options: AlertDialogOptions): Promise<boolean> {
  if (!compose) return systemConfirm(options);
  return new Promise((resolve) => {
    const handed = presentToHost({ options, resolve: (v) => (v ? void afterConfirm(options).then(resolve) : resolve(false)) });
    if (!handed) void systemConfirm(options).then(resolve);
  });
}

export function AlertDialogHost(): React.ReactElement | null {
  const colors = useThemeColors();
  const [request, setRequest] = useState<AlertRequest | null>(null);
  useEffect(() => {
    registerAlertHost(setRequest);
    return () => registerAlertHost(null);
  }, []);
  if (!compose || !request) return null;
  const { ui } = compose;
  const { options } = request;
  const finish = (v: boolean): void => {
    setRequest(null);
    request.resolve(v);
  };
  const message = alertMessage(options);
  return (
    <ui.Host matchContents>
      <ui.AlertDialog onDismissRequest={() => finish(false)} colors={{ containerColor: colors.overlay, titleContentColor: colors.fg, textContentColor: colors.fg2, iconContentColor: colors.fg2 }}>
        {options.icon ? (
          <ui.AlertDialog.Icon>
            <ui.RNHostView matchContents>
              <View>
                <Icon concept={options.icon} size={24} tone="fg-2" />
              </View>
            </ui.RNHostView>
          </ui.AlertDialog.Icon>
        ) : null}
        <ui.AlertDialog.Title>
          <ui.Text>{options.title}</ui.Text>
        </ui.AlertDialog.Title>
        {message ? (
          <ui.AlertDialog.Text>
            <ui.Text>{message}</ui.Text>
          </ui.AlertDialog.Text>
        ) : null}
        <ui.AlertDialog.ConfirmButton>
          <ui.TextButton onClick={() => finish(true)} colors={{ contentColor: options.destructive === false ? colors.fg : colors.err }}>
            <ui.Text>{options.confirmLabel}</ui.Text>
          </ui.TextButton>
        </ui.AlertDialog.ConfirmButton>
        <ui.AlertDialog.DismissButton>
          <ui.TextButton onClick={() => finish(false)} colors={{ contentColor: colors.fg }}>
            <ui.Text>{options.cancelLabel ?? 'Cancel'}</ui.Text>
          </ui.TextButton>
        </ui.AlertDialog.DismissButton>
      </ui.AlertDialog>
    </ui.Host>
  );
}
