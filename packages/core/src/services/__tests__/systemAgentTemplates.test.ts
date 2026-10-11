// The bundled system agents (templates/system/artifacts/agents) parse, and the
// Workflow Author carries the workflow tools a plain chat lacks (U-11).
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAgentMarkdown } from '../agentMarkdown.js';

const dir = resolve(__dirname, '../../../../../templates/system/artifacts/agents');

describe('system agent templates', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.agent.md'));

  it.each(files)('%s parses', (file) => {
    const parsed = parseAgentMarkdown(readFileSync(join(dir, file), 'utf8'));
    expect(parsed.name).toBeTruthy();
  });

  it('the Workflow Author can author and run workflows but not edit files', () => {
    const parsed = parseAgentMarkdown(readFileSync(join(dir, 'workflow-author.agent.md'), 'utf8'));
    expect(parsed.tools).toMatchObject({ workflows: true, workflowAuthoring: true, fileWrite: false, shell: false });
  });
});
