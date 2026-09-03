import { describe, it, expect } from 'vitest';
import { CommandRegistry } from '../registry.js';
import type { CommandSpec } from '../CommandSpec.js';
import { generateCompletions, prefixMap, completeDynamic, type DynamicCompletionRequest } from '../toCompletions.js';

/** Minimal fake spec — only the fields the registry/completion code reads. */
function fakeSpec(group: string, verb: string, overrides: Partial<CommandSpec> = {}): CommandSpec {
  return {
    id: `${group}.${verb.replace(/ /g, '-') || 'default'}`,
    group,
    verb,
    summary: `${group} ${verb}`.trim(),
    args: [],
    flags: [],
    requiresServer: true,
    sinceVersion: '0.0.0',
    output: { kind: 'void' },
    async handler() {
      return { data: null };
    },
    ...overrides,
  };
}

function buildTestRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  registry.declareGroup({ name: 'run', summary: 'Runs' });
  registry.declareGroup({ name: 'chat', summary: 'Chats' });
  registry.register(
    fakeSpec('run', 'cancel'), // 1-word verb -> "run cancel"
    fakeSpec('run', 'hitl approve', {
      args: [{ name: 'run', description: 'Run id', required: true }],
    }), // 2-word verb -> "run hitl approve"
    fakeSpec('run', 'hitl reject'), // shares the "hitl" branch with "approve"
    fakeSpec('chat', 'send', {
      flags: [{ name: 'model', description: 'Model', type: 'string', choices: ['sonnet', 'opus'] as const }],
    }),
  );
  return registry.freeze();
}

describe('prefixMap', () => {
  it('maps the root prefix to every group name (the first word of every path)', () => {
    const registry = buildTestRegistry();
    const tree = prefixMap(registry.visible());
    expect(tree.get('')).toEqual(['chat', 'run']);
  });

  it('maps a group prefix to its verbs, and a multi-word verb prefix to its sub-verbs', () => {
    const registry = buildTestRegistry();
    const tree = prefixMap(registry.visible());
    expect(tree.get('run')).toEqual(['cancel', 'hitl']);
    expect(tree.get('run hitl')).toEqual(['approve', 'reject']);
    expect(tree.get('run hitl approve')).toBeUndefined(); // a leaf — nothing follows it in the static tree
  });
});

describe('generateCompletions', () => {
  for (const shell of ['bash', 'zsh', 'fish', 'powershell', 'nushell'] as const) {
    it(`emits a non-trivial ${shell} script`, () => {
      const registry = buildTestRegistry();
      const script = generateCompletions(registry, shell);
      expect(script.length).toBeGreaterThan(50);
      expect(script).toContain('generatorai');
    });
  }

  it("bash's static tree carries the multi-word verb's two levels as separate associative-array entries", () => {
    const registry = buildTestRegistry();
    const script = generateCompletions(registry, 'bash');
    expect(script).toContain(`_generatorai_TREE['run']='cancel hitl'`);
    expect(script).toContain(`_generatorai_TREE['run hitl']='approve reject'`);
    // The root entry can't use a literal empty-string key — bash rejects
    // `arr['']=...` outright ("bad array subscript", verified against a
    // real bash 5.2 interpreter) — so it must use the sentinel instead.
    expect(script).toContain(`_generatorai_TREE['@@ROOT@@']='chat run'`);
    expect(script).not.toMatch(/_generatorai_TREE\['run hitl approve'\]/);
  });

  it('bash gates the associative-array tree behind a BASH_VERSINFO check and still defines a working fallback for bash < 4', () => {
    const registry = buildTestRegistry();
    const script = generateCompletions(registry, 'bash');
    // `declare -A`/`[[ -v arr[key] ]]` need bash 4.2+; stock macOS bash is
    // 3.2. Both branches must define the SAME function name so the final
    // `complete -F` line works regardless of which one ran.
    expect(script).toContain('if ((BASH_VERSINFO[0] >= 4)); then');
    expect(script).toMatch(/declare -A _generatorai_TREE[\s\S]*else[\s\S]*_generatorai_completions\(\)[\s\S]*fi/);
    // The fallback branch has no associative array at all — just the flat
    // full-path list every shell used before the hierarchical fix.
    expect(script).toContain('run hitl approve');
    expect(script.match(/_generatorai_completions\(\) \{/g)).toHaveLength(2);
  });

  it("zsh's static tree mirrors bash's, keyed the same way", () => {
    const registry = buildTestRegistry();
    const script = generateCompletions(registry, 'zsh');
    expect(script).toContain(`_generatorai_TREE['run']="cancel hitl"`);
    expect(script).toContain(`_generatorai_TREE['run hitl']="approve reject"`);
  });

  it("powershell's static tree is a hashtable keyed the same way", () => {
    const registry = buildTestRegistry();
    const script = generateCompletions(registry, 'powershell');
    expect(script).toContain(`$Tree['run'] = @('cancel', 'hitl')`);
    expect(script).toContain(`$Tree['run hitl'] = @('approve', 'reject')`);
  });

  it('fish chains a separate completion condition per depth for a multi-word verb, not one joined candidate', () => {
    const registry = buildTestRegistry();
    const script = generateCompletions(registry, 'fish');
    expect(script).toContain(`-n '__fish_seen_subcommand_from run' -a 'hitl'`);
    // `__fish_seen_subcommand_from run hitl` (one call, two words) is OR
    // across its arguments — true the instant "run" alone is typed, well
    // before "hitl" is. Real AND requires repeating `-n`, once per word
    // already seen (fish ANDs repeated `-n` conditions on one `complete`
    // call) — that, not a joined phrase, is the fix being asserted here.
    expect(script).toContain(`-n '__fish_seen_subcommand_from run' -n '__fish_seen_subcommand_from hitl' -a 'approve'`);
    expect(script).toContain(`-n '__fish_seen_subcommand_from run' -n '__fish_seen_subcommand_from hitl' -a 'reject'`);
    // The old bug: both words offered as siblings in one `-a 'hitl approve'`.
    expect(script).not.toContain(`-a 'hitl approve'`);
    // The other old bug: a single joined-phrase condition, satisfied by "run" alone.
    expect(script).not.toContain(`-n '__fish_seen_subcommand_from run hitl'`);
  });

  it('leaves nushell as the pre-existing flat command list (undocumented completion-context API, not verified locally)', () => {
    const registry = buildTestRegistry();
    const script = generateCompletions(registry, 'nushell');
    expect(script).toContain('nu-complete generatorai commands');
    expect(script).toContain('"run hitl approve"');
  });
});

describe('completeDynamic', () => {
  function request(line: string, registry: CommandRegistry): DynamicCompletionRequest {
    return { line, registry, lookup: async () => [] };
  }

  it('offers group names at the very start', async () => {
    const registry = buildTestRegistry();
    const result = await completeDynamic(request('generatorai ', registry));
    expect(result).toContain('run');
    expect(result).toContain('chat');
    // Must be the bare group name, not a full path like "run cancel".
    expect(result).not.toContain('run cancel');
  });

  it('offers only the next word under an already-typed group, not full paths', async () => {
    const registry = buildTestRegistry();
    const result = await completeDynamic(request('generatorai run ', registry));
    expect(result.sort()).toEqual(['cancel', 'hitl']);
  });

  it('distinguishes a trailing space (new word) from mid-word typing', async () => {
    const registry = buildTestRegistry();
    // "run" with no trailing space: still typing the group name itself.
    const stillTyping = await completeDynamic(request('generatorai ru', registry));
    expect(stillTyping).toEqual(['run']);

    // "run " with a trailing space: group is committed, offer its verbs.
    const committed = await completeDynamic(request('generatorai run ', registry));
    expect(committed.sort()).toEqual(['cancel', 'hitl']);
  });

  it('walks two levels into a multi-word verb one word at a time', async () => {
    const registry = buildTestRegistry();
    const afterHitl = await completeDynamic(request('generatorai run hitl ', registry));
    expect(afterHitl.sort()).toEqual(['approve', 'reject']);

    const filtered = await completeDynamic(request('generatorai run hitl app', registry));
    expect(filtered).toEqual(['approve']);
  });

  it('falls through to positional-arg completion once past the known tree', async () => {
    const registry = buildTestRegistry();
    // "run hitl approve" is a full, resolved command — the next word is a
    // positional arg, not a tree lookup, and args here have no `choices`, so
    // this must NOT crash and must NOT return tree words.
    const result = await completeDynamic(request('generatorai run hitl approve ', registry));
    expect(result).toEqual([]);
  });

  it('still completes flag values via choices once a command is resolved (untouched branch, pre-existing behavior)', async () => {
    const registry = buildTestRegistry();
    // No trailing space after "so": this exercises the RESOLVED branch's
    // existing rest/positional math exactly as it worked before this
    // change (out of scope to touch — see the file's own comment on why
    // `tokens` above stays untouched). A trailing-space variant here
    // ("--model " with nothing typed yet) hits the SAME pre-existing
    // trailing-whitespace-loss bug this task fixed for the group/verb
    // branch, just not fixed here since it's outside this task's scope.
    const result = await completeDynamic(request('generatorai chat send --model so', registry));
    expect(result).toEqual(['sonnet']);
  });
});
