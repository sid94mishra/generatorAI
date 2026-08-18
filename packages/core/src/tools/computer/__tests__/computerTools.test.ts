import { describe, it, expect, vi } from 'vitest';
import type { ComputerActionResult, ComputerElement } from '@generatorai/shared';
import {
  buildComputerToolSet,
  COMPUTER_TOOL_NAMES,
  isComputerToolName,
  parseKeyChord,
  projectElements,
} from '../index.js';
import { snapshotPayload } from '../computerToolTypes.js';
import type { ComputerService } from '../../../services/ComputerService.js';

function makeCtx(overrides: Partial<Record<string, unknown>> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const ok: ComputerActionResult = {
    ok: true,
    snapshot: null,
    screenshot: null,
    action: { path: 'accessibility', verification: { state: 'verified' } },
  };
  const computerService = {
    capabilities: vi.fn(async () => ({
      platform: 'darwin',
      provider: 'cua-driver',
      providerVersion: '1',
      supports: {},
      limitations: [],
    })),
    listApps: vi.fn(async () => ({ apps: [{ id: 'a', name: 'A', pid: 1, frontmost: true, windowCount: 1 }] })),
    listWindows: vi.fn(async () => ({ windows: [{ id: 9, title: 'W', index: 0, focused: true, minimised: false }] })),
    snapshot: vi.fn(async (...args: unknown[]) => {
      calls.push({ method: 'snapshot', args });
      return ok;
    }),
    act: vi.fn(async (...args: unknown[]) => {
      calls.push({ method: 'act', args });
      return ok;
    }),
    launchApp: vi.fn(async (...args: unknown[]) => {
      calls.push({ method: 'launchApp', args });
      return { app: { appId: 'a', name: 'A', pid: 1 } };
    }),
    ...overrides,
  } as unknown as ComputerService;

  return {
    calls,
    ctx: { computerService, workspaceId: 'ws-1', workspaceRoot: '/tmp/ws-1', chatId: 'chat-1' },
  };
}

function tool(name: string) {
  const { ctx, calls } = makeCtx();
  const found = buildComputerToolSet(ctx).find((t) => t.name === name);
  if (!found) throw new Error(`no tool named ${name}`);
  return { tool: found, calls, ctx };
}

describe('computer tool set', () => {
  it('exposes exactly the declared names', () => {
    const { ctx } = makeCtx();
    const names = buildComputerToolSet(ctx).map((t) => t.name).sort();
    expect(names).toEqual([...COMPUTER_TOOL_NAMES].sort());
  });

  it('gates every tool except the capability probe', () => {
    const { ctx } = makeCtx();
    for (const definition of buildComputerToolSet(ctx)) {
      if (definition.name === 'computer_capabilities') {
        expect(definition.skipPermission).toBe(true);
        continue;
      }
      expect(definition.skipPermission).not.toBe(true);
      expect(definition.requiredPermissions?.[0]?.kind).toBe('computer_use');
    }
  });

  it('rejects a call with no app reference before touching the service', async () => {
    const { tool: snapshot, calls } = tool('computer_snapshot');
    const result = (await snapshot.handler({})) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/appId/);
    expect(calls).toHaveLength(0);
  });

  it('prefers appId over appName over pid so the safety check cannot be steered', async () => {
    const { tool: snapshot, calls } = tool('computer_snapshot');
    await snapshot.handler({ appId: 'com.a', appName: 'B', pid: 3 });
    expect(calls[0]?.args[1]).toEqual({ by: 'appId', appId: 'com.a' });

    const second = tool('computer_snapshot');
    await second.tool.handler({ appName: 'B', pid: 3 });
    expect(second.calls[0]?.args[1]).toEqual({ by: 'appName', appName: 'B' });

    const third = tool('computer_snapshot');
    await third.tool.handler({ pid: 3 });
    expect(third.calls[0]?.args[1]).toEqual({ by: 'pid', pid: 3 });
  });

  it('requires the snapshot fence on element-addressed tools', async () => {
    for (const name of ['computer_click', 'computer_set_value', 'computer_perform_action']) {
      const { tool: t, calls } = tool(name);
      const result = (await t.handler({ appId: 'com.a', elementIndex: 0, value: 'x', actionName: 'AXPress' })) as {
        ok: boolean;
      };
      expect(result.ok).toBe(false);
      expect(calls).toHaveLength(0);
    }
  });

  it('passes a well-formed fenced request through', async () => {
    const { tool: click, calls } = tool('computer_click');
    await click.handler({ appId: 'com.a', snapshotId: 's1', elementIndex: 4, button: 'right', clickCount: 2 });
    expect(calls[0]?.args[2]).toEqual({
      type: 'click',
      snapshotId: 's1',
      elementIndex: 4,
      button: 'right',
      clickCount: 2,
    });
  });

  it('sends a placeholder app on window-scoped tools, for the service to overwrite', async () => {
    const { tool: type, calls } = tool('computer_type_text');
    await type.handler({ appId: 'com.a', text: 'hello', windowId: 9 });
    const request = calls[0]?.args[2] as { target: { app: { appId: string }; window: unknown } };
    expect(request.target.app.appId).toBe('');
    expect(request.target.window).toEqual({ by: 'id', id: 9 });
  });

  it('drops unknown modifiers rather than forwarding them', async () => {
    const { tool: press, calls } = tool('computer_press_key');
    await press.handler({ appId: 'com.a', key: 'a', modifiers: ['Meta', 'Hyper', 42] });
    const request = calls[0]?.args[2] as { modifiers?: string[] };
    expect(request.modifiers).toEqual(['Meta']);
  });

  it('splits a chord written into `key`, instead of sending it as a key name', async () => {
    // Sending `ctrl+\`` through as a key NAME is what typed a bare `c` into the
    // editor the agent had focused, corrupting a file in the user's repository.
    const { tool: press, calls } = tool('computer_press_key');
    await press.handler({ appId: 'com.a', key: 'ctrl+`' });
    expect(calls[0]?.args[2]).toMatchObject({ key: '`', modifiers: ['Control'] });
  });

  it('forwards the Chromium/Electron focus point', async () => {
    const { tool: type, calls } = tool('computer_type_text');
    await type.handler({ appId: 'com.a', text: 'git pull', focusX: 900, focusY: 1040 });
    expect(calls[0]?.args[2]).toMatchObject({ focus: { x: 900, y: 1040 } });
  });

  it('forwards an element reference for XAML hosts', async () => {
    const { tool: type, calls } = tool('computer_type_text');
    await type.handler({ appId: 'com.a', text: 'C:\\', snapshotId: 's1', elementIndex: 3 });
    expect(calls[0]?.args[2]).toMatchObject({ element: { snapshotId: 's1', elementIndex: 3 } });
  });

  it('ignores a half-supplied element reference', async () => {
    // Sending element_index without its snapshot makes the driver fail closed;
    // dropping the pair keeps the plain typing path available instead.
    const { tool: type, calls } = tool('computer_type_text');
    await type.handler({ appId: 'com.a', text: 'x', elementIndex: 3 });
    expect(calls[0]?.args[2]).not.toHaveProperty('element');
  });

  it('merges a chord in `key` with modifiers passed separately, without duplicates', async () => {
    const { tool: press, calls } = tool('computer_press_key');
    await press.handler({ appId: 'com.a', key: 'Shift+Meta+p', modifiers: ['Shift'] });
    const request = calls[0]?.args[2] as { key: string; modifiers?: string[] };
    expect(request.key).toBe('p');
    expect([...(request.modifiers ?? [])].sort()).toEqual(['Meta', 'Shift']);
  });

  it('steers the model toward snapshot addressing in its descriptions', () => {
    const { ctx } = makeCtx();
    const tools = buildComputerToolSet(ctx);
    const byName = new Map(tools.map((t) => [t.name, t.description]));
    expect(byName.get('computer_click')).toMatch(/ALWAYS prefer this over coordinates/);
    expect(byName.get('computer_set_value')).toMatch(/STRONGLY PREFERRED over computer_type_text/);
    expect(byName.get('computer_click_point')).toMatch(/LAST RESORT/);
    for (const name of ['computer_type_text', 'computer_press_key', 'computer_paste_text', 'computer_scroll', 'computer_drag']) {
      expect(byName.get(name)).toMatch(/takes over the user/);
    }
  });

  it('forwards launch arguments so a folder opens in one call', async () => {
    // Driving File Explorer's address bar instead took 31 actions and 12
    // minutes without arriving: Windows 11 shows a breadcrumb until it enters
    // edit mode, so the value set on it is never committed.
    const { tool: launch, calls } = tool('computer_launch_app');
    await launch.handler({ name: 'explorer.exe', arguments: ['C:\\Users\\me\\project'] });
    expect(calls[0]?.args[4]).toEqual(['C:\\Users\\me\\project']);
  });

  it('drops non-string launch arguments', async () => {
    const { tool: launch, calls } = tool('computer_launch_app');
    await launch.handler({ name: 'explorer.exe', arguments: ['C:\\ok', 7, null] });
    expect(calls[0]?.args[4]).toEqual(['C:\\ok']);
  });

  it('recognises its own tool names', () => {
    expect(isComputerToolName('computer_click')).toBe(true);
    expect(isComputerToolName('click_element')).toBe(false);
    expect(isComputerToolName(42)).toBe(false);
  });
});

describe('parseKeyChord', () => {
  it('splits the spellings a model actually writes', () => {
    expect(parseKeyChord('ctrl+`')).toEqual({ key: '`', modifiers: ['Control'] });
    expect(parseKeyChord('Meta+S')).toEqual({ key: 'S', modifiers: ['Meta'] });
    expect(parseKeyChord('cmd+shift+p')).toEqual({ key: 'p', modifiers: ['Meta', 'Shift'] });
    expect(parseKeyChord(' alt + F4 ')).toEqual({ key: 'F4', modifiers: ['Alt'] });
  });

  it('leaves a plain key alone', () => {
    for (const key of ['Enter', 'Escape', 'a', 'F5']) {
      expect(parseKeyChord(key)).toEqual({ key, modifiers: [] });
    }
  });

  it('treats a literal plus as a key, not a separator', () => {
    expect(parseKeyChord('+')).toEqual({ key: '+', modifiers: [] });
    expect(parseKeyChord('ctrl++')).toEqual({ key: '+', modifiers: ['Control'] });
  });

  it('does not invent modifiers from words it does not know', () => {
    // Better to send the original string and let the driver refuse than to
    // guess and deliver a keystroke the agent never asked for.
    expect(parseKeyChord('hyper+x')).toEqual({ key: 'hyper+x', modifiers: [] });
    expect(parseKeyChord('a+b')).toEqual({ key: 'a+b', modifiers: [] });
  });

  it('does not collapse an incomplete chord into a keystroke', () => {
    // Guessing here would deliver a keystroke the agent never asked for, which
    // is precisely how a stray character ended up in a user's source file.
    expect(parseKeyChord('ctrl+')).toEqual({ key: 'ctrl+', modifiers: [] });
    expect(parseKeyChord('ctrl++x')).toEqual({ key: 'ctrl++x', modifiers: [] });
  });
});

describe('projectElements', () => {
  const element = (over: Partial<ComputerElement>): ComputerElement => ({
    index: 0,
    role: 'textField',
    secure: false,
    value: null,
    traits: ['focused'],
    actions: [],
    childCount: 0,
    bounds: { x: 1, y: 2, w: 3, h: 4 },
    ...over,
  });

  it('never emits the value of a secure field, even if one leaked in', () => {
    const projected = projectElements([element({ secure: true, value: 'hunter2' })]);
    expect(projected[0]).not.toHaveProperty('value');
    expect(projected[0]).toMatchObject({ secure: true });
  });

  it('omits bounds so the model is not tempted toward pixel clicking', () => {
    const projected = projectElements([element({ value: 'hi' })]);
    expect(projected[0]).not.toHaveProperty('bounds');
    expect(projected[0]).toMatchObject({ index: 0, role: 'textField', value: 'hi' });
  });

  it('keeps advertised actions, which are the performAction allowlist', () => {
    const projected = projectElements([element({ actions: ['AXPress'] })]);
    expect(projected[0]?.['actions']).toEqual(['AXPress']);
  });

  it('never hands the provider handle to the model — it addresses by index', () => {
    const projected = projectElements([element({ token: 's00000001:7' })]);
    expect(projected[0]).not.toHaveProperty('token');
  });
});

describe('snapshotPayload', () => {
  const result = (elements: ComputerElement[]): ComputerActionResult => ({
    ok: true,
    screenshot: null,
    snapshot: {
      snapshotId: 's1',
      window: { id: 7, title: 'Book1 - Excel', focused: true, index: 0, minimised: false },
      elements,
      truncated: null,
      capturedAt: new Date().toISOString(),
    } as never,
    action: { path: 'accessibility', verification: { state: 'verified' } },
  });

  const cell = (index: number): ComputerElement => ({
    index,
    role: 'DataItem',
    label: `A${index}`,
    secure: false,
    value: 'x',
    traits: [],
    actions: [],
    childCount: 0,
  });

  it('says when the view is filtered, so a short list is not read as an empty window', () => {
    const payload = snapshotPayload(result([cell(1)]), 'A1');
    expect(payload['filteredBy']).toBe('A1');
    expect(String(payload['filterNote'])).toMatch(/NOT the whole window/);
  });

  it('stays silent about filtering when nothing was filtered', () => {
    const payload = snapshotPayload(result([cell(1)]));
    expect(payload).not.toHaveProperty('filteredBy');
    expect(payload).not.toHaveProperty('filterNote');
  });

  // A client-side "drop the boring ones" heuristic looked cheap and was not:
  // measured on a live Chrome window it deleted 79 elements of readable page
  // content, while dropping nothing at all on Excel, Notepad or Explorer.
  // `query` and the provider's own element cap do this honestly.
  it('lists every element it was given, however dull they look', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ ...cell(i), value: null }));
    const payload = snapshotPayload(result(many));
    expect((payload['elements'] as unknown[]).length).toBe(200);
    expect(payload).not.toHaveProperty('omitted');
  });

  // Measured on VS Code: one unqualified snapshot serialised to 22.6 KB, past
  // the harness's inline limit, so the whole result — screenshot included —
  // was swapped for a "saved to a temp file" stub. The model then re-issued
  // the identical snapshot nine times and shelled out to PowerShell to parse
  // the file. Clipping keeps the result in a form it can actually read.
  it('clips a window too large to return whole, and says so', () => {
    const wide = Array.from({ length: 400 }, (_, i) => ({
      ...cell(i),
      label: `element ${i} with a fairly long accessible label`,
      value: 'some value text that pushes the payload along',
    }));
    const payload = snapshotPayload(result(wide));
    const shown = (payload['elements'] as unknown[]).length;

    expect(shown).toBeLessThan(400);
    expect(payload['elementCount']).toBe(400);
    expect(payload['clipped']).toEqual({ shown, total: 400 });
    expect(String(payload['clippedNote'])).toMatch(/query/);
    expect(JSON.stringify(payload).length).toBeLessThan(20_000);
  });
});
