// ────────────────────────────────────────────────────────────────
// The agent only ever sees two things: the tool names it is handed, and the
// skill that tells it how to use them. Those drift silently — a tool gets
// added and the skill still describes fifteen, or the skill keeps recommending
// a tool that was renamed — and the failure lands on the model, mid-task,
// as a call to something that does not exist.
//
// This locks the three lists together: what is registered, what is exported as
// the gate's allow-list, and what the skill actually documents.
// ────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { COMPUTER_TOOL_NAMES } from '../index.js';

const SKILL = path.resolve(
  process.cwd(),
  'templates/system/artifacts/skills/computer-use.md',
);

function skillText(): string {
  return readFileSync(SKILL, 'utf8');
}

describe('computer tool surface', () => {
  it('documents every registered tool in the skill', () => {
    const text = skillText();
    const undocumented = COMPUTER_TOOL_NAMES.filter((name) => !text.includes(name));
    expect(undocumented).toEqual([]);
  });

  it('does not promise the agent a tool that no longer exists', () => {
    const mentioned = [...new Set([...skillText().matchAll(/computer_[a-z_]+/g)].map((m) => m[0]))];
    const ghosts = mentioned.filter((name) => !COMPUTER_TOOL_NAMES.includes(name as never));
    expect(ghosts).toEqual([]);
  });

  it('keeps the skill scoped to our tools — a competing skill would name the raw driver', () => {
    const text = skillText();
    // `cua-driver`'s own agent skill drives its CLI directly, which bypasses
    // consent, the blocklist, and the audit log. Ours must never teach that.
    expect(text).not.toMatch(/\bcua-driver\s+(call|mcp|start_session)\b/);
  });
});
