// A shell step reads as the command the agent ran: Codex's `/bin/zsh -lc "<line>"` wrapper is unwrapped, and a
// failed command's error is the end of what it printed, not the whole output in red.
import { describe, expect, it } from 'vitest';
import { toolCallErrorText, unwrapShellLine } from '../transcript/deriveTimeline.js';

describe('unwrapShellLine', () => {
  it('unwraps a double-quoted -lc line and its escapes', () => {
    expect(unwrapShellLine(`/bin/zsh -lc "sed -n '1,80p' apps/api/src/app.ts && rg -n \\"GET /monitors\\" apps"`)).toBe(
      `sed -n '1,80p' apps/api/src/app.ts && rg -n "GET /monitors" apps`,
    );
  });
  it("unwraps a single-quoted line, with the '\\'' idiom", () => {
    expect(unwrapShellLine(`bash -c 'echo it'\\''s done'`)).toBe(`echo it's done`);
  });
  it('leaves anything else alone', () => {
    for (const c of ['pnpm test', 'zsh -lc echo', `bash -c 'a' 'b'`, '/bin/zsh script.sh']) expect(unwrapShellLine(c)).toBe(c);
  });
});

describe('toolCallErrorText — shell', () => {
  const failed = (tool: string, result: string) =>
    toolCallErrorText({ type: 'tool_call', blockId: 1, callId: 'c', tool, args: {}, status: 'complete', error: true, result });
  it("keeps a failed command's last lines", () => {
    const out = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
    expect(failed('shell', out)).toBe(`…\n${Array.from({ length: 8 }, (_, i) => `line ${i + 23}`).join('\n')}`);
  });
  it('keeps a short failure and a non-shell error whole', () => {
    expect(failed('shell', 'sed: x.ts: No such file')).toBe('sed: x.ts: No such file');
    const long = Array.from({ length: 30 }, (_, i) => `e${i}`).join('\n');
    expect(failed('mcp__github__create_issue', long)).toBe(long);
  });
});
