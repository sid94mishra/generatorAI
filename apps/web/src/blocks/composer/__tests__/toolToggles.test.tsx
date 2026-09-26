import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Chat } from '@generatorai/shared';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { listComposerTools, registerComposerTool, useComposerTools, type ComposerToolEntry } from '../toolToggles.js';

const chat = { id: 'c1', orchestratorMode: true } as Chat;

function entry(overrides: Partial<ComposerToolEntry> = {}): ComposerToolEntry {
  return {
    id: 'workflows',
    label: 'Workflows',
    hint: 'Let this chat run workflows',
    icon: 'workflows',
    order: 40,
    defaultFor: (c) => !!c.orchestratorMode,
    available: () => true,
    read: (c) => !!c.orchestratorMode,
    write: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('composer tool-toggle registry', () => {
  it('lists entries in order and unregisters', () => {
    const offB = registerComposerTool(entry({ id: 'widgets', label: 'Widgets', order: 30 }));
    const offA = registerComposerTool(entry({ id: 'browser', label: 'Browser', order: 10 }));
    expect(listComposerTools().map((e) => e.id)).toEqual(['browser', 'widgets']);
    offA();
    offB();
    expect(listComposerTools()).toHaveLength(0);
  });

  it('useComposerTools hides unavailable entries, reads values and writes through the entry', async () => {
    const write = vi.fn(async () => undefined);
    const off1 = registerComposerTool(entry({ write }));
    const off2 = registerComposerTool(entry({ id: 'computer', label: 'Computer use', available: () => false }));
    const { result } = renderHook(() => useComposerTools(chat));
    expect(result.current.tools.map((t) => [t.entry.id, t.on])).toEqual([['workflows', true]]);
    await act(() => result.current.setTool('workflows', false));
    expect(write).toHaveBeenCalledWith('c1', false);
    off1();
    off2();
  });

  it('a failed write toasts an error', async () => {
    const spy = vi.spyOn(toast, 'error').mockReturnValue('t');
    const off = registerComposerTool(entry({ write: async () => Promise.reject(new Error('nope')) }));
    const { result } = renderHook(() => useComposerTools(chat));
    await act(() => result.current.setTool('workflows', true));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('Could not turn Workflows on', { description: 'nope' }));
    off();
    spy.mockRestore();
  });
});
