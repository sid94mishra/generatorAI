import { describe, expect, it } from 'vitest';
import {
  COMPUTER_CONSENT_GATE_COPY,
  PERMISSION_GATE_COPY,
  PLAN_GATE_COPY,
  QUESTION_GATE_COPY,
} from '../copy.js';
import { GATE_ACTIONS, GATE_KEY_BINDINGS, GATE_KINDS, gateLifecycle, type GateKey } from '../gates.js';
import { formatBinding } from '../keys.js';
import { STEP_KINDS, STEP_VERBS, humanizeToolName, isToolSearchTool, toolDisplayName, toolSearchTarget, toolStepKind, toolStepVerb } from '../toolVerbs.js';

describe('gate contract', () => {
  it('every gate kind has actions, and every action has copy', () => {
    const copy = {
      permission: PERMISSION_GATE_COPY.actions,
      question: QUESTION_GATE_COPY.actions,
      plan: PLAN_GATE_COPY.actions,
      computer_consent: COMPUTER_CONSENT_GATE_COPY.actions,
    } as const;
    for (const kind of GATE_KINDS) {
      expect(GATE_ACTIONS[kind].length).toBeGreaterThan(0);
      for (const action of GATE_ACTIONS[kind]) {
        expect((copy[kind] as Record<string, string>)[action.id], `${kind}.${action.id}`).toBeTruthy();
      }
    }
  });

  it('keeps one primary action per state group and valid key bindings', () => {
    for (const key of Object.keys(GATE_KEY_BINDINGS) as GateKey[]) {
      expect(formatBinding(GATE_KEY_BINDINGS[key], 'web').length).toBe(1);
    }
    expect(formatBinding(GATE_KEY_BINDINGS.escape, 'web')).toEqual([['Esc']]);
    expect(formatBinding(GATE_KEY_BINDINGS.mod_enter, 'desktopMac')).toEqual([['⌘', '↵']]);
  });

  it('maps server statuses to a lifecycle', () => {
    expect(gateLifecycle('permission', 'pending')).toBe('pending');
    expect(gateLifecycle('permission', 'denied')).toBe('resolved');
    expect(gateLifecycle('question', 'expired')).toBe('expired');
    expect(gateLifecycle('plan', 'awaiting_review')).toBe('pending');
    expect(gateLifecycle('plan', 'approved')).toBe('resolved');
    expect(gateLifecycle('plan', 'superseded')).toBe('expired');
  });

  it('keeps the historical accessible names of the permission actions', () => {
    expect(PERMISSION_GATE_COPY.actionLabel('allow_once', 'Bash')).toBe('Allow Bash');
    expect(PERMISSION_GATE_COPY.actionLabel('deny', 'Bash')).toBe('Deny Bash');
    expect(PERMISSION_GATE_COPY.actionLabel('confirm_deny', 'Bash')).toBe('Confirm deny Bash');
  });
});

describe('tool verbs', () => {
  it('has a verb for every kind', () => {
    for (const kind of STEP_KINDS) {
      expect(STEP_VERBS[kind].done).toBeTruthy();
      expect(STEP_VERBS[kind].live).toBeTruthy();
    }
  });

  it.each([
    ['Read', 'read', 'Read'],
    ['Grep', 'search', 'Searched'],
    ['Glob', 'search', 'Searched'],
    ['Bash', 'run', 'Ran'],
    ['powershell', 'run', 'Ran'],
    ['Edit', 'edit', 'Edited'],
    ['Write', 'edit', 'Edited'],
    ['mcp__generatorai-tools__navigate_page', 'browser', 'Opened browser'],
    ['screenshot_page', 'browser', 'Took screenshot'],
    ['computer_bring_to_front', 'computer', 'Focused window'],
    ['spawn_background_agent', 'delegate', 'Delegated'],
    ['TodoWrite', 'plan', 'Revised plan'],
    ['Task', 'subagent', 'Task'],
    ['render_widget', 'widget', 'Rendered widget'],
    ['mcp__github__list_issues', 'tool', 'List issues'],
    ['mcp__generatorai-tools__check_background_agents', 'tool', 'Check tasks'],
    ['ToolSearch', 'tool', 'Loaded tools'],
  ])('%s → %s / %s', (tool, kind, verb) => {
    expect(toolStepKind(tool)).toBe(kind);
    expect(toolStepVerb(tool, false)).toBe(verb);
  });

  it('has live verbs', () => {
    expect(toolStepVerb('Bash', true)).toBe('Running');
    expect(toolStepVerb('Read', true)).toBe('Reading');
  });

  it('names tools the way a person reads them', () => {
    expect(toolDisplayName('mcp__generatorai-tools__spawn_background_agent')).toBe('Delegate');
    expect(toolDisplayName('mcp__generatorai-tools__list_models')).toBe('List models');
    expect(toolDisplayName('mcp__github__createPullRequest')).toBe('Create pull request');
    expect(toolDisplayName('Bash')).toBe('Bash');
  });

  it('turns a ToolSearch select query into the tools it loaded', () => {
    expect(isToolSearchTool('ToolSearch')).toBe(true);
    expect(isToolSearchTool('mcp__x__ToolSearch')).toBe(true);
    expect(isToolSearchTool('Grep')).toBe(false);
    expect(
      toolSearchTarget({
        query: 'select:mcp__generatorai-tools__list_models,mcp__generatorai-tools__spawn_background_agent,mcp__generatorai-tools__check_background_agents',
        max_results: 10,
      }),
    ).toBe('List models, Delegate, Check tasks');
    expect(toolSearchTarget({ query: 'github issues' })).toBe('“github issues”');
    expect(toolSearchTarget({})).toBeUndefined();
  });

  it('humanizes MCP names', () => {
    expect(humanizeToolName('mcp__server__tool')).toBe('tool');
    expect(humanizeToolName('Read')).toBe('Read');
  });
});
