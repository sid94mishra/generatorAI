// CONVINV-R11 — a double-click on the stage composer's Stop must not force-stop.
// The composer used to flip to "Force stop" on the first press, so the second
// click of a double-click sent `force: true`.

import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cancelMutate = vi.fn();
let chatInputProps: { onStop?: () => void } = {};

vi.mock('@/hooks/workflowQueries.js', () => ({
  useSendStageMessage: () => ({ mutateAsync: vi.fn() }),
  useCancelStageTurn: () => ({ mutate: cancelMutate, isPending: false }),
}));
vi.mock('@/blocks/composer/index.js', () => ({
  Composer: (props: { onStop?: () => void }) => {
    chatInputProps = props;
    return null;
  },
}));

import { StageComposer } from '@/features/workflows/run/stages/StageComposer.js';
import type { StageView } from '@/features/workflows/run/model/types.js';

beforeEach(() => {
  vi.useFakeTimers();
  cancelMutate.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('StageComposer Stop', () => {
  it('sends one graceful cancel for a double-click', () => {
    const stage = { id: 'sr1', rawStatus: 'running', streaming: true } as unknown as StageView;
    render(<StageComposer runId="run-1" stage={stage} />);

    act(() => chatInputProps.onStop!());
    act(() => {
      vi.advanceTimersByTime(100);
      chatInputProps.onStop!();
    });

    expect(cancelMutate).toHaveBeenCalledTimes(1);
    expect(cancelMutate).toHaveBeenCalledWith({ runId: 'run-1', instanceId: 'sr1' });
  });
});
