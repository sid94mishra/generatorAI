// ────────────────────────────────────────────────────────────────
// ChatComposer — two-phase Stop, integration (09-verification.md §5.1
// "Stop / two-phase stop"; 03-component-inventory-domain.md §6.1 item 20;
// D-29 keeps this timing).
//
// Mounts ChatInput with the REAL `useTwoPhaseStop`, wired the way ChatPage
// wires it (pages/ChatPage.tsx:913-921, 1524, 1557-1558):
//   isStreaming = isLive,  stopState = stop,  onStop = stop.press,
//   onCancel({ force, budgetSeconds }) → cancel mutation.
// `cancel` below stands in for `cancelMutation.mutate`. ChatPage also runs
// `applyStopEffects` (pages/chatStopEffects.ts) inside onCancel; that local
// store write is pinned by its own tests and is left out here so this file
// depends only on the composer and the hook.
//
// Pinned: the first press sends one cancel; a double tap inside 400 ms sends
// nothing more; after 15 s with the turn still live the control becomes
// "Force reset" and the press sends `force: true`; the control stands down
// when `isLive` goes false. These assertions must stay unchanged through the
// P4 split; only the marked import lines change.
// ────────────────────────────────────────────────────────────────

import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createComposerHarness, sendButton, setupComposerTest } from './helpers/renderComposer.js';

// Import under test — the only lines that change when P4 moves the files.
import { Composer as ChatInput } from '@/blocks/composer/index.js';
import { useTwoPhaseStop } from '@/hooks/useTwoPhaseStop.js';

vi.mock('@/hooks/composerQueries.js', async (importOriginal) =>
  (await import('./helpers/composerMocks.js')).composerQueriesModule(await importOriginal()));
vi.mock('@/hooks/queries.js', async (importOriginal) =>
  (await import('./helpers/composerMocks.js')).queriesModule(await importOriginal()));
vi.mock('@/hooks/harnessQueries.js', async (importOriginal) =>
  (await import('./helpers/composerMocks.js')).harnessQueriesModule(await importOriginal()));
vi.mock('@/hooks/projectQueries.js', async (importOriginal) =>
  (await import('./helpers/composerMocks.js')).projectQueriesModule(await importOriginal()));
vi.mock('@/platform/surfaceCapabilities.js', async (importOriginal) =>
  (await import('./helpers/composerMocks.js')).surfaceCapabilitiesModule(await importOriginal()));
vi.mock('@/hooks/useSpeechToText.js', async () =>
  (await import('./helpers/composerMocks.js')).speechModule());

setupComposerTest();

interface HostProps {
  sessionId: string;
  disabled: boolean;
  placeholder: string;
  isLive: boolean;
  cancel: (args: { force: boolean; budgetSeconds: number }) => void;
}

/** The ChatPage wiring, reduced to the stop control. */
function StopHost({ isLive, cancel, ...composer }: HostProps) {
  const stop = useTwoPhaseStop({
    isLive,
    onCancel: ({ force, budgetSeconds }) => cancel({ force, budgetSeconds }),
  });
  return <ChatInput {...composer} isStreaming={isLive} stopState={stop} onStop={stop.press} />;
}

const renderHost = createComposerHarness(StopHost);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

/**
 * A press. `fireEvent` rather than user-event: these tests run on fully fake
 * timers (no `shouldAdvanceTime`) so the 400 ms / 15 s thresholds are exact,
 * and a disabled button swallows the click exactly as it does for a user.
 */
const click = (el: HTMLElement) => fireEvent.click(el);

function setup(isLive = true) {
  const cancel = vi.fn();
  const r = renderHost({ isLive, cancel });
  return { ...r, cancel };
}

describe('ChatComposer — two-phase stop (09 §5.1, D-29)', () => {
  it('shows an enabled "Stop" while the turn is live; the first press sends one graceful cancel', () => {
    const { cancel } = setup();
    const stop = screen.getByRole('button', { name: 'Stop' });
    expect(stop).toBeEnabled();
    click(stop);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith({ force: false, budgetSeconds: 10 });
    expect(screen.getByRole('button', { name: 'Stopping…' })).toBeDisabled();
  });

  it('a double tap within 400 ms sends nothing more', () => {
    const { cancel } = setup();
    click(screen.getByRole('button', { name: 'Stop' }));
    advance(200);
    const arming = screen.getByRole('button', { name: 'Stopping…' });
    expect(arming).toBeDisabled();
    click(arming);
    advance(199);
    click(screen.getByRole('button', { name: 'Stopping…' }));
    expect(cancel).toHaveBeenCalledTimes(1);
    // Past the arming window (next 200 ms tick) the control accepts a press again.
    advance(200);
    expect(screen.getByRole('button', { name: 'Stopping…' })).toBeEnabled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('between 400 ms and 15 s a second press re-sends the graceful cancel', () => {
    const { cancel } = setup();
    click(screen.getByRole('button', { name: 'Stop' }));
    advance(1_000);
    click(screen.getByRole('button', { name: 'Stopping…' }));
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenLastCalledWith({ force: false, budgetSeconds: 10 });
  });

  it('after 15 s with the turn still live the control becomes "Force reset" and sends force: true', () => {
    const { cancel } = setup();
    click(screen.getByRole('button', { name: 'Stop' }));
    advance(14_800);
    expect(screen.queryByRole('button', { name: 'Force reset' })).not.toBeInTheDocument();
    advance(400);
    const force = screen.getByRole('button', { name: 'Force reset' });
    expect(force).toHaveAttribute('title', 'The turn did not stop gracefully — reset it');
    click(force);
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenLastCalledWith({ force: true, budgetSeconds: 10 });
  });

  it('stands down when isLive goes false: Send returns and no further cancel is sent', () => {
    const { cancel, update } = setup();
    click(screen.getByRole('button', { name: 'Stop' }));
    advance(1_000);
    update({ isLive: false });
    expect(screen.queryByRole('button', { name: /^(Stop|Stopping…|Force reset)$/ })).not.toBeInTheDocument();
    expect(sendButton()).toBeInTheDocument();
    advance(20_000);
    expect(cancel).toHaveBeenCalledTimes(1);

    // The next turn starts a fresh attempt, not the old escalation.
    update({ isLive: true });
    const stop = screen.getByRole('button', { name: 'Stop' });
    expect(stop).toBeEnabled();
    click(stop);
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenLastCalledWith({ force: false, budgetSeconds: 10 });
  });

  it('shows Send, not Stop, while no turn is live', () => {
    setup(false);
    expect(sendButton()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
  });
});
