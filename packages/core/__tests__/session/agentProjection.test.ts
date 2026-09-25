// WP-2.4 — agent projection, explicit spec, instructions and skills.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResolvedAgentProjection } from '@generatorai/shared';
import { AgentResolver } from '../../src/services/AgentResolver.js';
import { AgentStagingService } from '../../src/services/AgentStagingService.js';
import {
  appendAgentInstructions,
  applyAgentProjection,
  applyExplicitSpec,
  deliverSkills,
} from '../../src/services/session/agentProjection.js';
import { appendSystemBlock } from '../../src/services/session/cfg.js';
import { ComposeError } from '../../src/services/session/types.js';
import { quietLogger } from './boot.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), 'gai-ap-'));
  dirs.push(d);
  return d;
};

function projection(over: Partial<ResolvedAgentProjection> = {}): ResolvedAgentProjection {
  return {
    ...AgentResolver.empty(),
    agentRef: 'global:a',
    driving: { ref: 'global:a', name: 'A', description: 'd', instructions: 'AGENT-TEXT', projection: 'append', role: 'agent' },
    ...over,
  };
}

const resolverReturning = (p: ResolvedAgentProjection) => ({ resolve: async () => p }) as unknown as AgentResolver;

describe('appendAgentInstructions', () => {
  it('appends the fenced instructions after every platform block', () => {
    const cfg: Record<string, unknown> = { systemMessage: { mode: 'append', content: 'BASE' } };
    appendSystemBlock(cfg, '\n\n[Integrated Browser]');
    appendAgentInstructions(cfg, projection(), 'BASE');
    const content = (cfg['systemMessage'] as { content: string }).content;
    expect(content.indexOf('[Integrated Browser]')).toBeLessThan(content.indexOf('AGENT-TEXT'));
    expect(content.startsWith('BASE')).toBe(true);
  });

  it("'replace' drops only the replaceable base, never a platform block (W-51)", () => {
    const cfg: Record<string, unknown> = { systemMessage: { mode: 'append', content: 'AUTHOR' } };
    appendSystemBlock(cfg, '\n\n[Workspace] hint');
    appendSystemBlock(cfg, '\n\n[Integrated Browser]');
    appendAgentInstructions(cfg, projection({ driving: { ...projection().driving!, projection: 'replace' } }), 'AUTHOR');
    const sys = cfg['systemMessage'] as { mode: string; content: string };
    expect(sys.mode).toBe('replace');
    expect(sys.content).not.toContain('AUTHOR');
    expect(sys.content).toContain('[Workspace] hint');
    expect(sys.content).toContain('[Integrated Browser]');
    expect(sys.content.trimEnd().endsWith('</generatorai:agent>')).toBe(true);
  });
});

describe('applyAgentProjection', () => {
  it('maps a team member with every restriction (W-52)', async () => {
    const cfg: Record<string, unknown> = {};
    await applyAgentProjection(
      cfg,
      { scope: 'stage', agentRef: 'global:a' },
      {
        agentResolver: resolverReturning(
          projection({
            team: [
              {
                ref: 'global:r',
                name: 'reviewer',
                description: 'r',
                instructions: 'i',
                tools: ['Read'],
                disallowedTools: ['Bash'],
                reasoningEffort: 'low',
                maxTurns: 3,
                permissionMode: 'plan',
              },
            ],
          }),
        ),
      },
    );
    expect(cfg['customAgents']).toEqual([
      {
        name: 'reviewer',
        description: 'r',
        instructions: 'i',
        tools: ['Read'],
        disallowedTools: ['Bash'],
        reasoningEffort: 'low',
        maxTurns: 3,
        permissionMode: 'plan',
      },
    ]);
  });

  it('a stage whose agent is missing or disabled fails (C-12); a chat keeps going', async () => {
    const missing = { ...AgentResolver.empty(), warnings: [{ code: 'AGENT_NOT_FOUND', params: { ref: 'global:x' } }] };
    const disabled = { ...AgentResolver.empty(), warnings: [{ code: 'AGENT_DISABLED', params: { ref: 'global:x' } }] };
    await expect(
      applyAgentProjection({}, { scope: 'stage', agentRef: 'global:x' }, { agentResolver: resolverReturning(missing as ResolvedAgentProjection) }),
    ).rejects.toMatchObject({ code: 'agent_not_found' });
    await expect(
      applyAgentProjection({}, { scope: 'stage', agentRef: 'global:x' }, { agentResolver: resolverReturning(disabled as ResolvedAgentProjection) }),
    ).rejects.toBeInstanceOf(ComposeError);
    const chat = await applyAgentProjection({}, { scope: 'chat', agentRef: 'global:x' }, { agentResolver: resolverReturning(missing as ResolvedAgentProjection) });
    expect(chat.warnings.map((w) => w.params?.['code'])).toEqual(['AGENT_NOT_FOUND']);
  });
});

describe('applyExplicitSpec', () => {
  it('lists and instructions from the merged spec, runtime scalars from the binding layer only', () => {
    const cfg: Record<string, unknown> = { reasoningEffort: 'high', maxTurns: 12 }; // the agent's
    applyExplicitSpec(
      cfg,
      { systemMessage: { mode: 'append', content: 'WF' }, systemPromptAppend: 'X', maxTurns: 4, reasoningEffort: 'low', tools: { excluded: ['a'] } },
      { maxTurns: 5 },
    );
    expect(cfg['systemMessage']).toEqual({ mode: 'append', content: 'WF' });
    expect(cfg['systemPromptAppend']).toBe('X');
    expect(cfg['excludedTools']).toEqual(['a']);
    // The workflow's `low` sits under the agent's `high`; the stage's own 5 beats the agent.
    expect(cfg['reasoningEffort']).toBe('high');
    expect(cfg['maxTurns']).toBe(5);
  });
});

describe('deliverSkills (RV-7, RV-8)', () => {
  function stagedSkills(root: string): string {
    const d = join(root, 'skills-src');
    mkdirSync(join(d, 'review'), { recursive: true });
    writeFileSync(join(d, 'review', 'SKILL.md'), '---\nname: review\ndescription: r\n---\nbody');
    writeFileSync(join(d, 'review', 'check.sh'), 'echo ok');
    return d;
  }

  it("claude-agent ('plugin'): a local plugin root, plugin-qualified names, no directory list", async () => {
    const root = scratch();
    const cfg: Record<string, unknown> = { skills: ['review'], skillDirectories: [stagedSkills(root)] };
    const warnings = await deliverSkills(cfg, 'claude-agent', root, new AgentStagingService(quietLogger));
    expect(warnings).toEqual([]);
    const pluginRoot = join(root, '.generatorai', 'plugin');
    expect(cfg['plugins']).toEqual([{ type: 'local', path: pluginRoot }]);
    expect(cfg['skills']).toEqual(['generatorai:review']);
    expect(cfg['skillDirectories']).toBeUndefined();
    expect(JSON.parse(readFileSync(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf-8')).name).toBe('generatorai');
    expect(existsSync(join(pluginRoot, 'skills', 'review', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(pluginRoot, 'skills', 'review', 'check.sh'))).toBe(true);
  });

  it("copilot ('directories') keeps the directories; codex warns they are process-global; opencode cannot load skills", async () => {
    const root = scratch();
    const src = stagedSkills(root);
    const copilot: Record<string, unknown> = { skillDirectories: [src] };
    expect(await deliverSkills(copilot, 'copilot', root, undefined)).toEqual([]);
    expect(copilot['skillDirectories']).toEqual([src]);
    expect((await deliverSkills({ skillDirectories: [src] }, 'codex', root, undefined)).map((w) => w.code)).toEqual([
      'skills_process_global',
    ]);
    expect((await deliverSkills({ skills: ['review'] }, 'opencode', root, undefined)).map((w) => w.code)).toEqual([
      'skills_unsupported',
    ]);
  });
});
