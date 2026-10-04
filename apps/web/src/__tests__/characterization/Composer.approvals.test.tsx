// The composer's Approvals group (D-96): a chat's tool-approval policy, picked from the Agent mode menu.

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createComposerHarness, setupComposerTest } from './helpers/renderComposer.js';
import { Composer } from '@/blocks/composer/index.js';

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
vi.mock('@/hooks/useSpeechToText.js', async () => (await import('./helpers/composerMocks.js')).speechModule());

setupComposerTest();
const renderComposer = createComposerHarness(Composer);
const modeChip = () => screen.getByRole('button', { name: /^Agent mode: / });

describe('Composer — Approvals', () => {
  it('names a gated policy on the chip and changes it from the Agent mode menu', async () => {
    const user = userEvent.setup();
    const onApprovalModeChange = vi.fn();
    renderComposer({ approvalMode: 'default', onApprovalModeChange });
    expect(modeChip()).toHaveAccessibleName('Agent mode: Auto, Ask first');
    await user.click(modeChip());
    const group = screen.getByRole('group', { name: 'Approvals' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Ask before tools run' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('option', { name: 'Full access (never ask)' }));
    expect(onApprovalModeChange).toHaveBeenCalledWith('bypassPermissions');
    expect(screen.queryByRole('listbox', { name: 'Agent mode' })).not.toBeInTheDocument();
  });

  it('shows nothing extra for full access, and no Approvals group without a setter', async () => {
    const user = userEvent.setup();
    renderComposer({ approvalMode: 'bypassPermissions' });
    expect(modeChip()).toHaveAccessibleName('Agent mode: Auto');
    await user.click(modeChip());
    expect(screen.queryByRole('group', { name: 'Approvals' })).not.toBeInTheDocument();
  });
});
