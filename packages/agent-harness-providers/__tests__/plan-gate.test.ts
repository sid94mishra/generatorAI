import { describe, it, expect } from 'vitest';
import {
  extractPlanContent,
  derivePlanSummary,
  normaliseClaudeQuestions,
  buildAskUserQuestionResult,
  isPlanGateTool,
  isFileWriteTool,
  isFileReadTool,
  EXIT_PLAN_MODE_TOOL,
  ASK_USER_QUESTION_TOOL,
} from '../src/providers/claude-agent/plan-gate.js';
import {
  normalisePlanActions,
  toCopilotAction,
  resolveCopilotPlanContent,
  normaliseCopilotQuestion,
  flattenAnswer,
} from '../src/providers/copilot/plan-gate.js';

// PLN-01 — Claude side.
//
// The SDK's `ExitPlanModeInput` declares only a deprecated `allowedPrompts`
// field plus an open index signature; there is NO contractual `plan` field
// (the plan lives in `ExitPlanModeOutput`, which canUseTool never sees). These
// tests lock in the fallback chain that makes the gate work anyway.
describe('Claude plan gate — plan extraction', () => {
  it('prefers an opportunistic input.plan when present', () => {
    expect(extractPlanContent({ plan: '# Do the thing' }, 'accumulated')).toBe('# Do the thing');
  });

  it('falls back to the turn text when input carries no plan', () => {
    expect(extractPlanContent({ allowedPrompts: [] }, '# From the message')).toBe('# From the message');
  });

  it('ignores blank/whitespace plan fields', () => {
    expect(extractPlanContent({ plan: '   ' }, '# Real plan')).toBe('# Real plan');
  });

  it('returns null when nothing usable exists so the caller can fail loudly', () => {
    expect(extractPlanContent({}, '   ')).toBeNull();
  });

  it('also accepts planContent/content aliases', () => {
    expect(extractPlanContent({ planContent: 'A' }, '')).toBe('A');
    expect(extractPlanContent({ content: 'B' }, '')).toBe('B');
  });
});

describe('Claude plan gate — summary derivation', () => {
  it('uses the first markdown heading', () => {
    expect(derivePlanSummary('# Add OAuth login\n\nSteps...')).toBe('Add OAuth login');
  });

  it('falls back to the first non-empty line', () => {
    expect(derivePlanSummary('\n\nRefactor the parser\nmore text')).toBe('Refactor the parser');
  });

  it('strips list markers', () => {
    expect(derivePlanSummary('- Step one')).toBe('Step one');
  });

  it('never returns empty', () => {
    expect(derivePlanSummary('   ')).toBe('Implementation plan');
  });
});

describe('Claude plan gate — tool classification', () => {
  it('recognises the plan-gate tools', () => {
    expect(isPlanGateTool(EXIT_PLAN_MODE_TOOL)).toBe(true);
    expect(isPlanGateTool(ASK_USER_QUESTION_TOOL)).toBe(true);
    expect(isPlanGateTool('Bash')).toBe(false);
  });

  it('classifies file tools for the acceptEdits post-approval policy', () => {
    expect(isFileWriteTool('Write')).toBe(true);
    expect(isFileWriteTool('Edit')).toBe(true);
    expect(isFileWriteTool('Bash')).toBe(false);
    expect(isFileReadTool('Read')).toBe(true);
    expect(isFileReadTool('Write')).toBe(false);
  });
});

describe('Claude plan gate — AskUserQuestion normalisation', () => {
  const input = {
    questions: [
      {
        question: 'Which database should we use?',
        header: 'Database choice that is far too long',
        options: [
          { label: 'Postgres', description: 'Relational' },
          { label: 'SQLite', description: 'Embedded', preview: '```sql\n--\n```' },
        ],
        multiSelect: false,
      },
    ],
  };

  it('caps the header at 12 characters (Claude contract)', () => {
    const [q] = normaliseClaudeQuestions(input);
    expect(q?.header).toHaveLength(12);
  });

  it('always allows freeform because the model never emits an "Other" option', () => {
    const [q] = normaliseClaudeQuestions(input);
    expect(q?.allowFreeform).toBe(true);
  });

  it('preserves option previews', () => {
    const [q] = normaliseClaudeQuestions(input);
    expect(q?.options[1]?.preview).toContain('sql');
  });

  it('handles a missing questions array', () => {
    expect(normaliseClaudeQuestions({})).toEqual([]);
  });

  it('keys answers by question TEXT, not our synthetic id', () => {
    const questions = normaliseClaudeQuestions(input);
    const result = buildAskUserQuestionResult(input, questions, { q0: ['Postgres'] });
    expect(result['answers']).toEqual({ 'Which database should we use?': 'Postgres' });
  });

  it('passes multi-select answers as an array', () => {
    const multi = {
      questions: [{ question: 'Pick features', header: 'Feat', options: [{ label: 'A' }, { label: 'B' }], multiSelect: true }],
    };
    const questions = normaliseClaudeQuestions(multi);
    const result = buildAskUserQuestionResult(multi, questions, { q0: ['A', 'B'] });
    expect(result['answers']).toEqual({ 'Pick features': ['A', 'B'] });
  });

  it('carries a freeform dismissal through as `response`', () => {
    const questions = normaliseClaudeQuestions(input);
    const result = buildAskUserQuestionResult(input, questions, {}, 'Just use whatever is simplest');
    expect(result['response']).toBe('Just use whatever is simplest');
  });
});

// PLN-01 — Copilot side.
describe('Copilot plan gate — action normalisation', () => {
  it('maps the SDK action vocabulary onto the domain set', () => {
    expect(normalisePlanActions(['exit_only', 'interactive', 'autopilot'])).toEqual([
      'exit_only',
      'implement_interactive',
      'implement_autopilot',
    ]);
  });

  it('collapses autopilot_fleet into autopilot (fleet mode not exposed in v1)', () => {
    expect(normalisePlanActions(['autopilot_fleet'])).toEqual(['implement_autopilot']);
  });

  it('drops unknown provider strings instead of leaking them', () => {
    expect(normalisePlanActions(['something_new'])).toEqual([
      'implement_interactive',
      'exit_only',
    ]);
  });

  it('always offers a usable fallback when the provider sends nothing', () => {
    expect(normalisePlanActions(undefined)).toEqual(['implement_interactive', 'exit_only']);
  });

  it('round-trips domain actions back to SDK strings', () => {
    expect(toCopilotAction('implement_interactive')).toBe('interactive');
    expect(toCopilotAction('implement_autopilot')).toBe('autopilot');
    expect(toCopilotAction('exit_only')).toBe('exit_only');
    expect(toCopilotAction(undefined)).toBeUndefined();
  });
});

describe('Copilot plan gate — plan content resolution', () => {
  it('prefers planContent', () => {
    expect(resolveCopilotPlanContent('# Plan', 'summary', 'text')).toBe('# Plan');
  });

  it('falls back to accumulated turn text (planContent is OPTIONAL in the SDK)', () => {
    expect(resolveCopilotPlanContent(undefined, 'summary', '# From text')).toBe('# From text');
  });

  it('falls back to the summary as a last resort', () => {
    expect(resolveCopilotPlanContent(undefined, 'A summary', '  ')).toBe('A summary');
  });

  it('returns null when nothing is available so we never approve an empty plan', () => {
    expect(resolveCopilotPlanContent(undefined, undefined, '')).toBeNull();
  });
});

describe('Copilot plan gate — question bridging', () => {
  it('wraps a single question in the domain multi-question shape', () => {
    const [q] = normaliseCopilotQuestion({ question: 'Use TypeScript?', choices: ['Yes', 'No'] });
    expect(q?.options.map((o) => o.label)).toEqual(['Yes', 'No']);
    expect(q?.multiSelect).toBe(false);
  });

  it('derives a short chip header', () => {
    const [q] = normaliseCopilotQuestion({ question: 'Which package manager should we standardise on?' });
    expect((q?.header.length ?? 0)).toBeLessThanOrEqual(12);
  });

  it('honours allowFreeform=false', () => {
    const [q] = normaliseCopilotQuestion({ question: 'Pick', choices: ['A'], allowFreeform: false });
    expect(q?.allowFreeform).toBe(false);
  });

  it('flattens a selected choice and marks it non-freeform', () => {
    expect(flattenAnswer({ q0: ['Yes'] }, undefined, ['Yes', 'No'])).toEqual({
      answer: 'Yes',
      wasFreeform: false,
    });
  });

  it('marks a custom answer as freeform', () => {
    expect(flattenAnswer({ q0: ['Maybe'] }, undefined, ['Yes', 'No'])).toEqual({
      answer: 'Maybe',
      wasFreeform: true,
    });
  });

  it('uses the freeform response when nothing was selected', () => {
    expect(flattenAnswer({}, 'I do not know', ['Yes'])).toEqual({
      answer: 'I do not know',
      wasFreeform: true,
    });
  });
});
