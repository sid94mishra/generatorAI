import { Alert, type AlertButton } from 'react-native';
import { confirm } from './AlertDialog';
import { afterConfirm, alertMessage, setStepUpHandler } from './alertDialogModel';

function pressAlertButton(index: number): void {
  const call = (Alert.alert as jest.Mock).mock.calls.at(-1)!;
  (call[2] as AlertButton[])[index]!.onPress?.();
}

describe('AlertDialog (MP-29)', () => {
  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    setStepUpHandler(null);
  });

  it('joins the message and impact lines', () => {
    expect(alertMessage({ message: 'Gone.', impact: ['23 workspaces · 4.2 GB'] })).toBe('Gone.\n23 workspaces · 4.2 GB');
    expect(alertMessage({})).toBeUndefined();
  });

  it('resolves true on the destructive action and false on cancel', async () => {
    const yes = confirm({ title: 'Delete this chat?', confirmLabel: 'Delete' });
    const call = (Alert.alert as jest.Mock).mock.calls.at(-1)!;
    expect(call[0]).toBe('Delete this chat?');
    expect((call[2] as AlertButton[]).map((b) => [b.text, b.style])).toEqual([['Cancel', 'cancel'], ['Delete', 'destructive']]);
    pressAlertButton(1);
    await expect(yes).resolves.toBe(true);
    const no = confirm({ title: 'Kill?', confirmLabel: 'Kill', cancelLabel: 'Keep' });
    pressAlertButton(0);
    await expect(no).resolves.toBe(false);
  });

  it('runs the registered step-up after confirm and fails closed without one', async () => {
    await expect(afterConfirm({ title: 'Revoke?', confirmLabel: 'Revoke', requireStepUp: true })).resolves.toBe(false);
    setStepUpHandler(async () => true);
    const result = confirm({ title: 'Revoke?', confirmLabel: 'Revoke', requireStepUp: true });
    pressAlertButton(1);
    await expect(result).resolves.toBe(true);
    setStepUpHandler(async () => false);
    const denied = confirm({ title: 'Revoke?', confirmLabel: 'Revoke', requireStepUp: true });
    pressAlertButton(1);
    await expect(denied).resolves.toBe(false);
  });
});
