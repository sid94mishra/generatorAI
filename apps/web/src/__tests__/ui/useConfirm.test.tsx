// ────────────────────────────────────────────────────────────────
// useConfirm — promise-based ConfirmDialog, the replacement for the four
// `window.confirm()` calls the design-system ratchet caught.
// ────────────────────────────────────────────────────────────────

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useConfirm } from '@/components/ui/useConfirm.js';

function Harness({ onResult }: { onResult: (ok: boolean) => void }) {
  const { confirm, dialog } = useConfirm();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          void confirm({
            title: 'Revoke device?',
            description: 'It loses access immediately.',
            confirmLabel: 'Revoke',
            variant: 'destructive',
          }).then(onResult)
        }
      >
        Revoke
      </button>
      {dialog}
    </>
  );
}

describe('useConfirm', () => {
  it('resolves true when the user confirms', async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    });
    const dialog = screen.getByRole('alertdialog', { name: 'Revoke device?' });
    expect(dialog).toHaveTextContent('It loses access immediately.');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Revoke', hidden: false }));
    });
    // The trigger is also named "Revoke" but is behind the modal; the
    // dialog's confirm button is the one inside the alertdialog.
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('resolves false on Cancel and on Escape', async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(false));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    });
    const dialog = await screen.findByRole('alertdialog');
    await act(async () => {
      fireEvent.keyDown(dialog, { key: 'Escape' });
    });
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(2));
    expect(onResult).toHaveBeenLastCalledWith(false);
  });

  it('gives Cancel initial focus for destructive confirms so Enter cannot destroy by accident', async () => {
    render(<Harness onResult={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })),
    );
  });
});
