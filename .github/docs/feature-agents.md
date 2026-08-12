# Agents (AGT-01)

> First-class, user-authored agents: reusable instructions bundled with a fixed set
> of skills, MCP servers and capabilities, bindable to a chat, a workflow stage
> or an orchestrator's team.

Related: [feature-skills-agents-mcp.md](./feature-skills-agents-mcp.md) (the raw
asset catalog), [feature-chat.md](./feature-chat.md),
[feature-stages.md](./feature-stages.md),
[feature-orchestrator-chat.md](./feature-orchestrator-chat.md).

---

## 1. What an Agent is

An **Agent** is a persisted entity, not a file convention. It carries:

| Group | Fields |
|---|---|
| Identity | `scope`, `projectId`, `slug`, `ref`, `name`, `description`, `tags`, `enabled` |
| Instructions | `instructions`, `projection` (`append` \| `replace`) |
| Capability | `skillIds[]`, `mcpServerIds[]`, `tools` (tri-state groups) |
| Runtime | `runtime.{model, harnessType, reasoningEffort, contextTier, maxTurns, permissionMode, defaultAgentMode}` |
| Role | `role` (`agent` \| `orchestrator`), `orchestration.{teamAgentRefs, maxWorkers, defaultWorkerModel}` |
| Provenance | `version`, `sourcePath`, `createdAt`, `updatedAt` |

Types: [packages/shared/src/types/Agent.ts](../../packages/shared/src/types/Agent.ts).

### `ref` is the binding identifier, not `id`

Every binding site stores `ref` = `` `${scope}:${slug}` ``, never the row id.
A workflow exported from one installation and imported into another keeps
working, because the ref does not depend on a primary key.

### Scopes and shadowing

`system` → `global` → `project`, most specific wins.

- **`system`** — synced from `.agent.md` files under
  [templates/system/artifacts/agents/](../../templates/system/artifacts/agents/)
  on every boot. Read-only in the UI: an edit would be overwritten on the next
  restart. Removing the file disables the row (it is not deleted, so existing
  bindings keep their snapshot).
- **`global`** — user-authored, available everywhere.
- **`project`** — scoped to one project. A project agent **shadows** a global
  agent with the same slug in pickers.

`projectId` is `''` (never `NULL`) for system/global scope, because SQLite treats
`NULL` as distinct in a UNIQUE index — `(scope, project_id, slug)` would stop
enforcing slug uniqueness.

---

## 2. The union algebra

This is the core of the feature and lives in exactly one place:
[packages/core/src/services/AgentResolver.ts](../../packages/core/src/services/AgentResolver.ts).

> If an agent has 5 skills and 3 MCP servers, and the stage it is bound to
> selects 2 more skills, the stage gets **7 skills** and 3 MCP servers.

Levels, lowest to highest specificity:

| Level | Source |
|---|---|
| L0 | Platform defaults (`DEFAULT_AGENT_TOOL_POLICY`) |
| L1 | Workflow / chat `harnessConfig.agentOverrides` (`baseHarnessConfig`) |
| L2 | The agent itself |
| L3 | Binding-site `overrides` (`AgentOverrides`) |
| L4 | The most specific harness config (`runtimeOverrides`) |

Fold rules:

- **Skills and MCP servers — UNION**, then subtract `removeSkillIds` /
  `removeMcpServerIds` / `excludedMcpServerIds`. **Removal always wins**, even
  over an add at a higher level.
- **Tool groups — tri-state fold.** `true` = force on, `false` = force off,
  `undefined` = inherit. A `false` at any level beats a `true` at a lower one.
  This is why the editor exposes three states, not a checkbox: collapsing them
  would make "inherit" unrepresentable.
- **Scalars (model, effort, permission mode…) — most specific wins.**
- **Instructions — ordered concatenation**, the agent's own text first, then each
  level's `appendInstructions`.
- **`role: 'orchestrator'` forces `tools.orchestration = true`.** An
  orchestrator that cannot spawn workers is not an orchestrator.

### Warnings are machine-readable

`ResolvedAgentProjection.warnings` is `{ code, params }`. Core never emits
user-facing English — the presentation layer owns the copy table
([apps/web/src/lib/agentCopy.ts](../../apps/web/src/lib/agentCopy.ts)).

Codes: `FIELD_UNSUPPORTED_BY_PROVIDER`, `SKILL_NOT_FOUND`,
`MCP_SERVER_NOT_FOUND`, `AGENT_NOT_FOUND`, `AGENT_DISABLED`,
`STAGING_BUDGET_EXCEEDED`, `INSTRUCTIONS_LARGE`, `TEAM_AGENT_DISABLED`,
`TEAM_AGENT_NOT_FOUND`.

---

## 3. Instruction projection

`projection: 'append'` (default) appends the agent's instructions **after** every
platform block, wrapped as untrusted content:

```
<generatorai:agent trust="user">
…the agent's instructions…
</generatorai:agent>
```

`projection: 'replace'` drops the base instructions but **still injects** the
browser / widget / orchestrator / plan blocks. Without them the tools those
blocks describe become unusable, which is a worse failure than a slightly
longer prompt.

Provider-native binding (`SessionConfig.agent` on Copilot, `Options.agent` on
Claude) is deliberately **not** exposed for the driving agent: on Claude it
replaces the entire system prompt, including the platform blocks.

---

## 4. Freezing and the conversation binding key

A chat stores `agentRef`, `agentId`, `agentVersion`, `agentOverrides` **and**
`agentSnapshot` (the full resolved projection).

- **Create** resolves live and freezes the result into `agentSnapshot`.
- **Resume / replay** re-uses the frozen snapshot. Resolving live would let an
  agent edit change the tool set of an in-flight conversation and invalidate
  the prompt-cache prefix mid-thread.

The conversation binding key is:

```
`${harnessType}::${model}::${agentRef}::${agentVersion}`
```

Editing an agent bumps `version`, which changes the key and forces exactly one
rebind on the next turn. Changing the per-turn agent *mode* does **not** touch
the key, so it must not rebind.

---

## 5. Provider mapping

| Concept | Copilot SDK 1.0.8 | Claude Agent SDK 0.3.220 |
|---|---|---|
| Team members | `SessionConfig.customAgents[]` | `Options.agents` (`AgentDefinition`) |
| Skills | `skillDirectories` + `disabledSkills` (by NAME) | `Options.skills: string[] \| 'all'` |
| MCP servers | `mcpServers`, tools named `<server>-<tool>` | `mcpServers`, tools named `mcp__<server>__<tool>` |
| Tool deny | `defaultAgent.excludedTools` | `disallowedTools` |
| Delegation | implicit | requires `Agent` in `allowedTools` (added automatically) |
| `maxTurns` | unsupported → warning | enforced |

Unsupported fields never fail silently: the provider records a
`FIELD_UNSUPPORTED_BY_PROVIDER` warning retrievable through
`getConversationWarnings()`.

### Skill staging

[AgentStagingService](../../packages/core/src/services/AgentStagingService.ts)
copies the selected skills into
`<workspaceRoot>/.generatorai/skills/<name>/SKILL.md` with a content-addressed
`manifest.json`, under a 5 MB / 200-file budget. De-selected skills are removed;
`cleanup()` runs on workspace delete.

---

## 6. Authoring format — `.agent.md`

The same document is used by the bundled system agents, by export and by
import, so an agent is portable between an installation, a repository and a
teammate.

```markdown
---
name: Code Reviewer
description: Reviews diffs for correctness, security and style. Use after code changes are complete.
tools: read, search, bash
model: claude-sonnet-4-5
x-generatorai:
  role: agent
  projection: append
  skillIds: [system-skill-code-review]
  mcpServerIds: [github]
  tools:
    fileWrite: false
    shell: true
---

You are a meticulous reviewer. Prioritise correctness and security over style…
```

Hardening (see
[agentMarkdown.ts](../../packages/core/src/services/agentMarkdown.ts)):

- Parsed with `yaml` at `maxAliasCount: 0` — a YAML alias bomb cannot be used
  as a denial-of-service vector.
- 256 KB hard cap on the document; 32 KB on instructions (8 KB warns).
- Frontmatter keys are **allow-listed**; anything else is rejected rather than
  ignored.
- The `x-generatorai` block **cannot** set `harnessType`, `scope`, `enabled`,
  `sourcePath`, or an inline MCP server. MCP servers are referenced by id from
  the vetted registry only — an inline definition is an arbitrary local
  process-spawn primitive that would bypass the `exec:terminal` scope.
- Export is credential-free: MCP `env` and `headers` are never written.

---

## 7. Data model

Migration **v26** (`first_class_agents`) adds:

- `agents` table with a unique index on `(scope, project_id, slug)`.
- `chats`: `agent_ref`, `agent_id`, `agent_version`, `agent_overrides`, `agent_snapshot`
- `chat_messages`: `agent_ref`, `agent_version`
- `workflow_definitions`: `default_agent_ref`
- `stage_definitions`: `agent_ref`
- `workflow_runs`: `agent_snapshot`

Column additions live in the idempotent `safeAddColumn` pre-block, which runs
*before* the versioned loop — see
[packages/db/src/migrations/index.ts](../../packages/db/src/migrations/index.ts).

---

## 8. HTTP API

Scopes: reading needs `read:workflows`; **authoring needs `admin:settings`**,
because an agent grants capability. Binding an existing agent to a chat goes
through `PATCH /api/chats/:id` instead, so a paired device can pick an agent
without being able to author one.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/agents` | `?scope`, `?role`, `?projectId`, `?q`, `?enabledOnly=1`, `?selectable=1` |
| POST | `/api/agents` | 409 on duplicate slug in scope |
| GET | `/api/agents/:id` | id **or** `scope:slug` ref |
| PUT | `/api/agents/:id` | bumps `version` |
| DELETE | `/api/agents/:id` | 409 while bound; `?force=1` soft-deletes |
| GET | `/api/agents/:id/usage` | the bound chats / stages / workflows (entities, not counts) |
| POST | `/api/agents/:id/export` | `{ markdown }` |
| POST | `/api/agents/import` | `{ markdown, scope?, projectId?, overwrite? }` |
| POST | `/api/agents/resolve-preview` | effective capabilities; supports an unsaved `draft` |

`resolve-preview` responses are **redacted** — MCP `env` / `headers` never
reach a browser.

SSE events: `agent.created`, `agent.updated`, `agent.deleted`,
`chat.agent_changed`.

---

## 9. CLI

```powershell
generatorai agent list --scope global --role orchestrator
generatorai agent show system:code-reviewer
generatorai agent create --file ./reviewer.agent.md --scope global --overwrite
generatorai agent export system:code-reviewer --out reviewer.agent.md
generatorai agent usage global:reviewer
generatorai agent delete global:reviewer --force
generatorai agent resolve --ref global:reviewer --add-skill system-skill-testing

# Bind at chat creation; additions UNION with the agent's own capabilities.
generatorai chat create "Review PR" --agent system:code-reviewer --add-skill system-skill-testing
```

---

## 10. SDK

```typescript
const ai = await GeneratorAI.create({ /* … */ });

await ai.agents.list({ role: 'orchestrator' });
await ai.agents.import(markdown, { scope: 'global' });

// "What will the harness actually get?"
const projection = await ai.agents.resolve({
  agentRef: 'global:reviewer',
  overrides: { addSkillIds: ['system-skill-testing'] },
  scope: 'stage',
});
```

`ai.agents` throws a clear error when the host did not pass `agentService` /
`agentResolver` to `createCoreServices()`, rather than returning an empty
catalog that looks like "no agents exist".

In a workflow script:

```javascript
stage('review').agentRef('system:code-reviewer').prompt('Review the diff');
```

---

## 11. Web UI

| Surface | File |
|---|---|
| Catalog | [AgentsListPage.tsx](../../apps/web/src/pages/AgentsListPage.tsx) |
| Editor + live preview | [AgentEditorPage.tsx](../../apps/web/src/pages/AgentEditorPage.tsx) |
| Picker | [AgentPicker.tsx](../../apps/web/src/components/agents/AgentPicker.tsx) |
| Binding-site delta | [AgentOverridesEditor.tsx](../../apps/web/src/components/agents/AgentOverridesEditor.tsx) |
| Tri-state groups | [ToolPolicyEditor.tsx](../../apps/web/src/components/agents/ToolPolicyEditor.tsx) |
| Effective capabilities | [EffectiveCapabilitiesPanel.tsx](../../apps/web/src/components/agents/EffectiveCapabilitiesPanel.tsx) |
| Stage binding | [AgentBindingSection.tsx](../../apps/web/src/components/workflow/AgentBindingSection.tsx) |

Every binding surface shows the **resolved** projection next to the inputs,
because the union algebra is not legible from either side alone.

Mobile is read-only: the picker in `NewChatSheet` can bind an agent, but
authoring stays on web where the full capability policy is visible.

---

## 12. Bundled agents

Shipped in [templates/system/artifacts/agents/](../../templates/system/artifacts/agents/):

`code-reviewer`, `implementation-planner`, `test-author`, `docs-writer`,
`security-auditor`, `bug-fixer`, and `delivery-lead` (an orchestrator whose
team is the other six).

---

## 13. Edge cases

| Situation | Behaviour |
|---|---|
| Bound agent deleted | Chat keeps running from `agentSnapshot`; new bindings warn `AGENT_NOT_FOUND` |
| Bound agent disabled | Same, with `AGENT_DISABLED` |
| Agent edited mid-conversation | `version` bump → binding key changes → exactly one rebind on the next turn |
| Skill removed from the catalog | `SKILL_NOT_FOUND` warning; the rest of the projection still resolves |
| Orchestrator lists itself in its team | Rejected at save time |
| Instructions > 8 KB | `INSTRUCTIONS_LARGE` warning; > 32 KB is rejected |
| Stage bound to an agent but no resolver wired | `StageExecutionError` — failing loudly beats running without the agent's tool policy |
