// Security › Connect an external agent (D-181, D-178): how Claude Code,
// Codex or Cursor reach this server through `generatorai-mcp` — pair it as an
// MCP device (the group above), then the one-line config per client, each
// with a copy button. Static: the snippets come from `externalAgentSetups()`
// in @generatorai/shared (the same command `generatorai skill install`
// prints); nothing here is fetched.

import type { ReactNode } from 'react';
import { externalAgentSetups, MCP_SERVER_ARGS, MCP_SERVER_COMMAND } from '@generatorai/shared';
import { CodeBlock } from '@/ui/patterns/CodeBlock/CodeBlock.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';

const BUILD = ['pnpm --filter @generatorai/mcp-server bundle', 'cd packages/mcp-server && pnpm link --global'].join('\n');
const PAIR = `${MCP_SERVER_COMMAND} pair "<pairing link>"`;
const NARROW = `${MCP_SERVER_COMMAND} ${MCP_SERVER_ARGS.join(' ')} --toolsets chats,files --read-only`;

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-1.5">
      <span className="text-small text-fg-2">
        {n} · {title}
      </span>
      {children}
    </li>
  );
}

export function ConnectAgentGroup() {
  return (
    <section className="flex flex-col gap-2" data-testid="security-connect-agent">
      <SectionHeader
        title="Connect an external agent"
        level={3}
        hint="Claude Code, Codex or Cursor use this server's chats, projects, automations and workflows over MCP"
      />
      <ol className="flex flex-col gap-4 rounded-panel border border-line bg-raised p-4">
        <Step n={1} title="Install generatorai-mcp on the computer the agent runs on (from a GeneratorAI checkout)">
          <CodeBlock lang="bash" copy={BUILD}>
            {BUILD}
          </CodeBlock>
        </Step>
        <Step n={2} title="Pair it: under Pair a new device, choose MCP server, generate a code, copy the pairing link, then run">
          <CodeBlock lang="bash" copy={PAIR}>
            {PAIR}
          </CodeBlock>
        </Step>
        <Step n={3} title="Add it to your agent">
          <div className="flex flex-col gap-2">
            {externalAgentSetups().map((setup) => (
              <CodeBlock
                key={setup.id}
                lang={setup.lang}
                copy={setup.snippet}
                header={
                  <span>
                    {setup.label} · {setup.where}
                  </span>
                }
              >
                {setup.snippet}
              </CodeBlock>
            ))}
          </div>
        </Step>
        <Step n={4} title="Optional: serve fewer tools by adding flags to the command">
          <CodeBlock lang="bash" copy={NARROW}>
            {NARROW}
          </CodeBlock>
        </Step>
      </ol>
      <p className="text-small text-fg-3">
        Chats an external agent starts never skip approvals (at most Accept edits). Risky actions and questions wait for you here, in
        Needs you. Revoke the device under Paired devices to cut it off.
      </p>
    </section>
  );
}
