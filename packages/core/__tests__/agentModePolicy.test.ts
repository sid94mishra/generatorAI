// ────────────────────────────────────────────────────────────────
// Agent-mode registry + policy (PLN-01)
//
// These tests pin the CONTRACT rather than any single mode: every registered
// mode must be fully described, and every policy decision must be derivable
// from the descriptor. That is what makes adding a mode a one-entry change
// instead of a cross-cutting edit.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  AGENT_MODES,
  AGENT_MODE_REGISTRY,
  DEFAULT_AGENT_MODE,
  agentModeDescriptor,
  coerceAgentMode,
  isAgentMode,
  isStageReviewOutcome,
} from '@generatorai/shared';
import {
  instructionsForMode,
  resolveModeDescriptor,
  resolveTurnPermissionMode,
  shouldAttachPermissionHandler,
  AUTO_MODE_PLAN_INSTRUCTIONS,
  PLAN_MODE_INSTRUCTIONS,
} from '../src/services/agentModePolicy.js';

describe('agent mode registry', () => {
  it('describes every advertised mode', () => {
    // A mode listed in AGENT_MODES but missing from the registry would crash
    // the composer at render time, so assert the two stay in lockstep.
    for (const mode of AGENT_MODES) {
      const d = AGENT_MODE_REGISTRY[mode];
      expect(d, `no descriptor for "${mode}"`).toBeDefined();
      expect(d.mode).toBe(mode);
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.description.length).toBeGreaterThan(0);
    }
    expect(Object.keys(AGENT_MODE_REGISTRY).sort()).toEqual([...AGENT_MODES].sort());
  });

  it('defaults to an autonomous, non-blocking mode', () => {
    // The default must never open a gate — an unattended caller that forgets
    // to pass a mode would otherwise hang forever.
    const d = agentModeDescriptor(DEFAULT_AGENT_MODE);
    expect(d.planGate).not.toBe('blocking');
    expect(d.questionGate).toBe(false);
  });

  it('falls back to the default for unknown input', () => {
    expect(agentModeDescriptor(undefined).mode).toBe(DEFAULT_AGENT_MODE);
    expect(resolveModeDescriptor(undefined).mode).toBe(DEFAULT_AGENT_MODE);
  });

  it('only a blocking mode may open a question gate', () => {
    // A blocking question in an autonomous run has nobody to answer it.
    for (const mode of AGENT_MODES) {
      const d = AGENT_MODE_REGISTRY[mode];
      if (d.questionGate) expect(d.planGate).toBe('blocking');
    }
  });

  it('only a non-blocking mode uses the record_plan tool', () => {
    // In plan mode the native gate is the capture path; offering record_plan
    // as well would let the agent file a plan and skip its own approval.
    for (const mode of AGENT_MODES) {
      const d = AGENT_MODE_REGISTRY[mode];
      if (d.usesRecordPlanTool) expect(d.planGate).toBe('non_blocking');
    }
  });
});

describe('coerceAgentMode', () => {
  it('accepts current modes', () => {
    expect(coerceAgentMode('auto')).toBe('auto');
    expect(coerceAgentMode('plan')).toBe('plan');
  });

  it('folds the pre-rename "interactive" alias onto auto', () => {
    // Exported workflow definitions and older API clients still send this.
    expect(coerceAgentMode('interactive')).toBe('auto');
    expect(isAgentMode('interactive')).toBe(false);
  });

  it('returns undefined for junk so callers apply their own default', () => {
    expect(coerceAgentMode('nope')).toBeUndefined();
    expect(coerceAgentMode(undefined)).toBeUndefined();
    expect(coerceAgentMode(42)).toBeUndefined();
  });
});

describe('resolveTurnPermissionMode', () => {
  it('forces read-only for plan mode regardless of chat policy', () => {
    // This is what makes "no writes while planning" structural rather than a
    // prompt instruction the model may ignore.
    expect(resolveTurnPermissionMode('plan', 'bypassPermissions')).toBe('plan');
    expect(resolveTurnPermissionMode('plan', 'acceptEdits')).toBe('plan');
    expect(resolveTurnPermissionMode('plan', undefined)).toBe('plan');
  });

  it('lets an autonomous turn defer to the chat policy', () => {
    expect(resolveTurnPermissionMode('auto', undefined)).toBe('bypassPermissions');
    expect(resolveTurnPermissionMode('auto', 'bypassPermissions')).toBe('bypassPermissions');
    // An operator can still opt a chat into prompting without leaving auto.
    expect(resolveTurnPermissionMode('auto', 'acceptEdits')).toBe('acceptEdits');
    expect(resolveTurnPermissionMode('auto', 'default')).toBe('default');
  });
});

describe('shouldAttachPermissionHandler', () => {
  it('stays off for the autonomous default', () => {
    // Attaching the handler forces Claude out of bypassPermissions (HITL-06),
    // which would turn every existing autonomous chat into a prompt storm.
    expect(shouldAttachPermissionHandler(undefined)).toBe(false);
    expect(shouldAttachPermissionHandler('bypassPermissions')).toBe(false);
  });

  it('turns on when the chat asked for gated permissions', () => {
    expect(shouldAttachPermissionHandler('acceptEdits')).toBe(true);
    expect(shouldAttachPermissionHandler('default')).toBe(true);
  });
});

describe('instructionsForMode', () => {
  it('gives plan mode the blocking-gate workflow', () => {
    expect(instructionsForMode('plan')).toBe(PLAN_MODE_INSTRUCTIONS);
  });

  it('gives auto mode the record_plan workflow', () => {
    const text = instructionsForMode('auto');
    expect(text).toBe(AUTO_MODE_PLAN_INSTRUCTIONS);
    expect(text).toContain('record_plan');
    // The whole point of auto mode: never stop for approval.
    expect(text).toMatch(/does NOT pause you/i);
  });

  it('only mentions the exit-plan tool behind an explicit plan-mode guard', () => {
    // That tool is not registered outside plan mode, so an UNCONDITIONAL
    // instruction to call it would make the model improvise (historically:
    // `skill(exit_plan_mode)`). The auto block is delivered via the system
    // message, which is fixed for the conversation while the mode is chosen
    // per turn — so it may reference the tool, but only inside a guard.
    const text = instructionsForMode('auto') ?? '';
    if (/exit.plan.mode/i.test(text)) {
      expect(text).toMatch(/If you ARE in plan mode/i);
      // The guard must come BEFORE the mention, otherwise it reads as an
      // instruction the model should follow immediately.
      expect(text.search(/If you ARE in plan mode/i)).toBeLessThan(
        text.search(/exit.plan.mode/i),
      );
    }
  });
});

describe('isStageReviewOutcome', () => {
  it('accepts the three verdicts', () => {
    expect(isStageReviewOutcome('approved')).toBe(true);
    expect(isStageReviewOutcome('changes_requested')).toBe(true);
    expect(isStageReviewOutcome('rejected')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isStageReviewOutcome('approve')).toBe(false);
    expect(isStageReviewOutcome(true)).toBe(false);
    expect(isStageReviewOutcome(undefined)).toBe(false);
  });
});
