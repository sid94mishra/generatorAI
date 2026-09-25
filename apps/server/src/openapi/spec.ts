// ────────────────────────────────────────────────────────────────
// OpenAPI 3.1 spec (DOC-01).
//
// Hand-curated definition of the HTTP surface. We chose a hand-authored
// spec over `zod-to-openapi` because:
//
//   1. Our Zod schemas live in `@generatorai/shared/config` and the
//      domain types; they don't directly shape every request/response
//      body — routes transform between them. Auto-derivation would
//      require a round of schema re-plumbing for a marginal gain in
//      accuracy over what the routes actually return.
//   2. This file gives us one concise place to spot behaviour drift;
//      a route author who changes a 200 to a 202 also has to update
//      the spec, which is preferable to silent drift behind code
//      generation.
//
// Keep this spec in lock-step with:
//   - `apps/server/src/routes/*.ts`
//   - `packages/shared/src/types/*.ts`
//   - `packages/shared/src/types/IPlatformClient.ts`
//
// When adding a new route: add the path + response schema here; don't
// rely on the OpenAPI UI alone to discover it. Smoke test via
// `curl http://localhost:3100/api/openapi.json | jq '.paths | keys'`.
// ────────────────────────────────────────────────────────────────

export interface OpenAPIDocument {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: { url: string; description?: string }[];
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
}

const errorResponseSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: {},
      },
      required: ['code', 'message'],
    },
  },
};

const idParam = {
  in: 'path',
  name: 'id',
  required: true,
  schema: { type: 'string' },
};

const cidParam = {
  in: 'path',
  name: 'cid',
  required: true,
  schema: { type: 'string' },
};

/** A pull-request number. Must parse as a positive integer, or the route 400s. */
const prNumberParam = {
  in: 'path',
  name: 'number',
  required: true,
  schema: { type: 'integer', minimum: 1 },
};

const runIdParam = {
  in: 'path',
  name: 'runId',
  required: true,
  schema: { type: 'string' },
};

export const OPENAPI_SPEC: OpenAPIDocument = {
  openapi: '3.1.0',
  info: {
    title: 'GeneratorAI HTTP API',
    version: '0.1.0',
    description: [
      'Local-first AI-agent workflow automation. All endpoints are',
      'reachable under `/api`. The server assumes a localhost trust',
      'boundary — there is no end-user authentication. Webhook endpoints',
      'verify HMAC / Bearer; everything else is open on the LAN.',
      '',
      '**Streaming:** SSE is exposed at `/api/stream?scope=run|chat|session|global&id=<id>`',
      'with `Last-Event-ID` resume (STR-08). The REST replay companion',
      'is `/api/stream/replay`.',
    ].join(' '),
  },
  servers: [{ url: 'http://localhost:3100', description: 'Local dev server' }],
  components: {
    schemas: {
      Error: errorResponseSchema,
      // ── Source control (feature-source-control.md; shapes mirror
      // packages/shared/src/types/SourceControl.ts) ──
      ChatSourceControlOptions: {
        type: 'object',
        description: 'Agent-native source control for a chat: what the server does after each completed turn.',
        properties: {
          autoCommit: { type: 'boolean' },
          autoPush: { type: 'boolean' },
          autoPullRequest: { type: 'boolean' },
          base: { type: 'string' },
          draft: { type: 'boolean' },
        },
        required: ['autoCommit', 'autoPush', 'autoPullRequest'],
      },
      SourceControlAccount: {
        type: 'object',
        description: 'A connected VCS-host account. The token lives in the secret store and never appears here.',
        properties: {
          id: { type: 'string' },
          provider: { type: 'string', enum: ['github'] },
          label: { type: 'string' },
          host: { type: 'string' },
          login: { type: 'string' },
          avatarUrl: { type: 'string' },
          scopes: { type: 'array', items: { type: 'string' } },
          authMethod: { type: 'string', enum: ['token', 'device', 'gh-cli'] },
          createdAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'provider', 'label', 'authMethod', 'createdAt'],
      },
      SourceControlProviderInfo: {
        type: 'object',
        properties: {
          id: { type: 'string', enum: ['github'] },
          name: { type: 'string' },
          loginMethods: {
            type: 'array',
            items: { type: 'string', enum: ['token', 'device', 'gh-cli'] },
          },
        },
        required: ['id', 'name', 'loginMethods'],
      },
      SourceControlSettings: {
        type: 'object',
        properties: {
          accounts: { type: 'array', items: { $ref: '#/components/schemas/SourceControlAccount' } },
          defaultAccountId: { type: 'string', nullable: true },
          generation: {
            type: 'object',
            description: 'Harness provider/model used to write commit messages and PR text. Null = heuristic text.',
            properties: {
              provider: { type: 'string', nullable: true },
              model: { type: 'string', nullable: true },
            },
            required: ['provider', 'model'],
          },
          editor: {
            type: 'object',
            properties: { defaultEditor: { $ref: '#/components/schemas/EditorId' } },
            required: ['defaultEditor'],
          },
          defaultBase: { type: 'string', nullable: true },
        },
        required: ['accounts', 'defaultAccountId', 'generation', 'editor', 'defaultBase'],
      },
      SourceControlSettingsResponse: {
        type: 'object',
        properties: {
          settings: { $ref: '#/components/schemas/SourceControlSettings' },
          providers: { type: 'array', items: { $ref: '#/components/schemas/SourceControlProviderInfo' } },
          editors: { type: 'array', items: { $ref: '#/components/schemas/EditorInfo' } },
        },
        required: ['settings', 'providers', 'editors'],
      },
      DeviceLoginStart: {
        type: 'object',
        properties: {
          loginId: { type: 'string' },
          userCode: { type: 'string' },
          verificationUri: { type: 'string' },
          expiresIn: { type: 'integer' },
          interval: { type: 'integer' },
        },
        required: ['loginId', 'userCode', 'verificationUri', 'expiresIn', 'interval'],
      },
      DeviceLoginStatus: {
        type: 'object',
        properties: {
          loginId: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'complete', 'expired', 'error'] },
          account: { $ref: '#/components/schemas/SourceControlAccount' },
          error: { type: 'string' },
        },
        required: ['loginId', 'status'],
      },
      EditorId: {
        type: 'string',
        nullable: true,
        enum: ['vscode', 'vscode-insiders', 'cursor', 'windsurf', null],
      },
      EditorInfo: {
        type: 'object',
        properties: {
          id: { type: 'string', enum: ['vscode', 'vscode-insiders', 'cursor', 'windsurf'] },
          name: { type: 'string' },
          available: { type: 'boolean', description: 'The server host can launch this editor (CLI found).' },
          scheme: { type: 'string', description: 'URL scheme for the browser-side fallback, e.g. `vscode`.' },
        },
        required: ['id', 'name', 'available', 'scheme'],
      },
      OpenInEditorRequest: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Absolute path on the SERVER host. Must resolve inside a known workspace mount, project codebase or worktree, or the request is refused with 403.',
          },
          line: { type: 'integer', minimum: 1 },
          column: { type: 'integer', minimum: 1 },
          editor: { type: 'string', enum: ['vscode', 'vscode-insiders', 'cursor', 'windsurf'] },
        },
        required: ['path'],
      },
      OpenInEditorResult: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          editor: { type: 'string', enum: ['vscode', 'vscode-insiders', 'cursor', 'windsurf'] },
          fallbackUrl: {
            type: 'string',
            description: 'A URL the client can try when the server could not launch anything.',
          },
          error: { type: 'string' },
        },
        required: ['ok'],
      },
      PullRequestSummary: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['github'] },
          number: { type: 'integer' },
          url: { type: 'string' },
          title: { type: 'string' },
          state: { type: 'string', enum: ['open', 'closed', 'merged'] },
          head: { type: 'string' },
          base: { type: 'string' },
          draft: { type: 'boolean' },
          author: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: ['provider', 'number', 'url', 'title', 'state', 'head', 'base'],
      },
      ChecksSummary: {
        type: 'object',
        properties: {
          total: { type: 'integer' },
          passed: { type: 'integer' },
          failed: { type: 'integer' },
          pending: { type: 'integer' },
          conclusion: {
            type: 'string',
            enum: ['success', 'failure', 'neutral', 'cancelled', 'pending', 'unknown'],
          },
        },
        required: ['total', 'passed', 'failed', 'pending', 'conclusion'],
      },
      PullRequestDetail: {
        allOf: [
          { $ref: '#/components/schemas/PullRequestSummary' },
          {
            type: 'object',
            properties: {
              body: { type: 'string' },
              mergeable: { type: 'boolean', nullable: true, description: 'Null while the host is still computing it.' },
              mergeableState: { type: 'string' },
              additions: { type: 'integer' },
              deletions: { type: 'integer' },
              changedFiles: { type: 'integer' },
              commits: { type: 'integer' },
              headSha: { type: 'string' },
              baseSha: { type: 'string' },
              labels: { type: 'array', items: { type: 'string' } },
              checks: { $ref: '#/components/schemas/ChecksSummary' },
            },
            required: [
              'body', 'mergeable', 'additions', 'deletions', 'changedFiles',
              'commits', 'headSha', 'baseSha', 'labels',
            ],
          },
        ],
      },
      PullRequestFile: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          previousPath: { type: 'string' },
          status: { type: 'string', enum: ['added', 'modified', 'removed', 'renamed'] },
          additions: { type: 'integer' },
          deletions: { type: 'integer' },
          patch: { type: 'string', description: 'Unified diff hunks; absent for binary / very large files.' },
        },
        required: ['path', 'status', 'additions', 'deletions'],
      },
      PullRequestComment: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          author: { type: 'string' },
          body: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          url: { type: 'string' },
          path: { type: 'string' },
          line: { type: 'integer' },
          kind: { type: 'string', enum: ['review', 'issue'] },
        },
        required: ['id', 'author', 'body', 'createdAt', 'kind'],
      },
      ProjectPullRequest: {
        allOf: [
          { $ref: '#/components/schemas/PullRequestSummary' },
          {
            type: 'object',
            properties: {
              codebaseId: { type: 'string' },
              codebaseAlias: { type: 'string' },
            },
            required: ['codebaseId', 'codebaseAlias'],
          },
        ],
      },
      ProjectPullRequestsResponse: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/ProjectPullRequest' } },
          unavailable: {
            type: 'array',
            description: 'Codebases that could not be listed, each with a user-facing reason.',
            items: {
              type: 'object',
              properties: {
                codebaseId: { type: 'string' },
                alias: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['codebaseId', 'alias', 'reason'],
            },
          },
        },
        required: ['items', 'unavailable'],
      },
      RepoReadiness: {
        type: 'object',
        description: 'Whether one mount can commit / push / open a PR — and, when it cannot, why.',
        properties: {
          alias: { type: 'string' },
          repoDir: { type: 'string' },
          isRepo: { type: 'boolean' },
          hasRemote: { type: 'boolean' },
          remoteUrl: { type: 'string' },
          slug: {
            type: 'object',
            properties: {
              owner: { type: 'string' },
              repo: { type: 'string' },
              host: { type: 'string' },
            },
            required: ['owner', 'repo', 'host'],
          },
          providerId: { type: 'string', enum: ['github'] },
          accountId: { type: 'string' },
          connected: { type: 'boolean' },
          branch: { type: 'string', nullable: true },
          detached: { type: 'boolean' },
          defaultBranch: { type: 'string', nullable: true },
          onDefaultBranch: { type: 'boolean' },
          dirty: { type: 'boolean' },
          changedFiles: { type: 'integer' },
          ahead: { type: 'integer', nullable: true },
          behind: { type: 'integer', nullable: true },
          hasUpstream: { type: 'boolean' },
          mergeInProgress: { type: 'boolean' },
          conflictedFiles: { type: 'array', items: { type: 'string' } },
          openPullRequest: {
            allOf: [{ $ref: '#/components/schemas/PullRequestSummary' }],
            nullable: true,
          },
          can: {
            type: 'object',
            properties: {
              commit: { type: 'boolean' },
              push: { type: 'boolean' },
              pullRequest: { type: 'boolean' },
            },
            required: ['commit', 'push', 'pullRequest'],
          },
          reasons: {
            type: 'object',
            properties: {
              commit: { type: 'string' },
              push: { type: 'string' },
              pullRequest: { type: 'string' },
            },
          },
        },
        required: [
          'alias', 'repoDir', 'isRepo', 'hasRemote', 'connected', 'branch',
          'detached', 'defaultBranch', 'onDefaultBranch', 'dirty', 'changedFiles',
          'ahead', 'behind', 'hasUpstream', 'mergeInProgress', 'conflictedFiles',
          'openPullRequest', 'can', 'reasons',
        ],
      },
      WorkspaceReadinessResponse: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string' },
          repos: { type: 'array', items: { $ref: '#/components/schemas/RepoReadiness' } },
        },
        required: ['workspaceId', 'repos'],
      },
      ScmFlowRequest: {
        type: 'object',
        properties: {
          alias: { type: 'string', description: 'Mount alias; `.` for the root.' },
          commit: {
            type: 'object',
            properties: { message: { type: 'string' }, generate: { type: 'boolean' } },
          },
          push: { type: 'boolean' },
          pullRequest: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              body: { type: 'string' },
              base: { type: 'string' },
              draft: { type: 'boolean' },
              generate: { type: 'boolean' },
            },
          },
          sync: {
            type: 'boolean',
            description: 'Merge the base branch in before push/PR. Default true when pushing or opening a PR.',
          },
          branch: {
            type: 'object',
            properties: { createIfOnDefault: { type: 'boolean' }, name: { type: 'string' } },
          },
          hint: { type: 'string', description: 'Hint for generated text (e.g. the chat task).' },
        },
      },
      ScmFlowStep: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            enum: ['readiness', 'branch', 'commit', 'sync', 'push', 'pull_request'],
          },
          status: { type: 'string', enum: ['done', 'skipped', 'failed', 'blocked'] },
          detail: { type: 'string' },
        },
        required: ['id', 'status'],
      },
      ScmConflictReport: {
        type: 'object',
        properties: {
          base: { type: 'string' },
          head: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          mergeStarted: {
            type: 'boolean',
            description: 'True when the merge was applied to the working tree and markers are present.',
          },
        },
        required: ['base', 'head', 'files', 'mergeStarted'],
      },
      ScmFlowResult: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'conflicts', 'blocked', 'failed'] },
          alias: { type: 'string' },
          steps: { type: 'array', items: { $ref: '#/components/schemas/ScmFlowStep' } },
          branch: { type: 'string' },
          commit: {
            type: 'object',
            properties: { sha: { type: 'string' }, message: { type: 'string' } },
            required: ['sha', 'message'],
          },
          pushed: { type: 'boolean' },
          pullRequest: { $ref: '#/components/schemas/PullRequestSummary' },
          conflicts: { $ref: '#/components/schemas/ScmConflictReport' },
          error: { type: 'string' },
          readiness: { $ref: '#/components/schemas/RepoReadiness' },
        },
        required: ['status', 'alias', 'steps', 'readiness'],
      },
      ScmGenerateRequest: {
        type: 'object',
        properties: {
          alias: { type: 'string' },
          kind: { type: 'string', enum: ['commit', 'pull_request'] },
          hint: { type: 'string' },
          base: { type: 'string' },
        },
        required: ['kind'],
      },
      ScmGenerateResult: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['commit', 'pull_request'] },
          message: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
          model: { type: 'string' },
          source: { type: 'string', enum: ['model', 'heuristic'] },
        },
        required: ['kind', 'source'],
      },
      Chat: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          sessionId: { type: 'string' },
          status: { type: 'string', enum: ['active', 'archived'] },
          model: { type: 'string', nullable: true },
          sourceControl: { $ref: '#/components/schemas/ChatSourceControlOptions' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'name', 'sessionId', 'status'],
      },
      ChatMessage: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          sessionId: { type: 'string' },
          chatId: { type: 'string', nullable: true },
          role: { type: 'string', enum: ['user', 'assistant', 'system', 'tool'] },
          content: { type: 'string' },
          metadata: {
            type: 'object',
            properties: {
              turnId: { type: 'string', description: 'WEB-02 — stable turn identifier' },
              thinkingText: { type: 'string' },
              toolCalls: { type: 'array', items: { type: 'object' } },
            },
            additionalProperties: true,
          },
          timestamp: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'sessionId', 'role', 'content', 'timestamp'],
      },
      WorkflowDefinition: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          version: { type: 'integer' },
          sessionMode: { type: 'string', enum: ['auto', 'single', 'per-stage'] },
          variables: { type: 'array' },
          tags: { type: 'array', items: { type: 'string' } },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'name', 'version'],
      },
      WorkflowRun: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          workflowDefinitionId: { type: 'string' },
          status: {
            type: 'string',
            enum: [
              'pending', 'queued', 'running', 'paused', 'completed',
              'failed', 'cancelled',
            ],
          },
          permissionMode: {
            type: 'string',
            enum: ['bypassPermissions', 'default', 'acceptEdits', 'plan'],
            description:
              'HITL permission mode. Default `bypassPermissions` is fully ' +
              'autonomous. Flip to `plan` / `default` / `acceptEdits` to ' +
              'surface interrupts for human approval (see /pending-interrupts).',
          },
          variables: { type: 'object', additionalProperties: true },
          startedAt: { type: 'string', format: 'date-time', nullable: true },
          completedAt: { type: 'string', format: 'date-time', nullable: true },
        },
        required: ['id', 'workflowDefinitionId', 'status'],
      },
      StageRun: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          workflowRunId: { type: 'string' },
          stageDefinitionId: { type: 'string' },
          name: { type: 'string' },
          status: {
            type: 'string',
            enum: [
              'pending', 'queued', 'running', 'paused', 'completed',
              'failed', 'cancelled', 'skipped', 'sleeping', 'awaiting_input',
            ],
          },
          wakeAt: { type: 'string', format: 'date-time', nullable: true },
          interruptData: {},
          retryCount: { type: 'integer' },
          version: { type: 'integer' },
        },
        required: ['id', 'workflowRunId', 'stageDefinitionId', 'status'],
      },
      Automation: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          trigger: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['schedule', 'webhook', 'manual'] },
            },
          },
          enabled: { type: 'boolean' },
        },
      },
      ResumeStageRequest: {
        type: 'object',
        properties: {
          outcome: { type: 'string', enum: ['approved', 'changes_requested', 'rejected'] },
          value: {},
          reason: { type: 'string' },
          followUpPrompt: { type: 'string' },
        },
        required: ['outcome'],
      },
      Agent: {
        type: 'object',
        description:
          'AGT-01 — reusable instructions bundled with a fixed set ' +
          'of skills, MCP servers and capability groups.',
        properties: {
          id: { type: 'string' },
          scope: { type: 'string', enum: ['system', 'global', 'project'] },
          projectId: {
            type: 'string',
            description: "'' for system/global scope — never null, so the (scope, project_id, slug) unique index behaves.",
          },
          slug: { type: 'string' },
          ref: {
            type: 'string',
            description: 'Derived `${scope}:${slug}` — the PORTABLE binding identifier.',
          },
          name: { type: 'string' },
          description: {
            type: 'string',
            description: 'Required (>= 10 chars). Both SDKs use it as the delegation routing signal.',
          },
          instructions: { type: 'string' },
          role: { type: 'string', enum: ['agent', 'orchestrator'] },
          projection: { type: 'string', enum: ['append', 'replace'] },
          tags: { type: 'array', items: { type: 'string' } },
          enabled: { type: 'boolean' },
          skillIds: { type: 'array', items: { type: 'string' } },
          mcpServerIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Ids from the vetted registry only — inline server definitions are rejected.',
          },
          tools: { $ref: '#/components/schemas/AgentToolPolicy' },
          runtime: { type: 'object', additionalProperties: true },
          orchestration: {
            type: 'object',
            properties: {
              teamAgentRefs: { type: 'array', items: { type: 'string' } },
              maxWorkers: { type: 'integer' },
              defaultWorkerModel: { type: 'string' },
            },
          },
          version: {
            type: 'integer',
            description: 'Bumped on every mutation; part of the conversation binding key.',
          },
          sourcePath: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'scope', 'slug', 'ref', 'name', 'description', 'role', 'version'],
      },
      AgentToolPolicy: {
        type: 'object',
        description:
          'Tri-state capability groups. `true` = force on, `false` = force off ' +
          '(beats a lower level\'s true), omitted = inherit.',
        properties: {
          browser: { type: 'boolean' },
          widgets: { type: 'boolean' },
          extensionAuthoring: { type: 'boolean' },
          orchestration: { type: 'boolean' },
          fileRead: { type: 'boolean' },
          fileWrite: { type: 'boolean' },
          shell: { type: 'boolean' },
          web: { type: 'boolean' },
        },
      },
      AgentOverrides: {
        type: 'object',
        description:
          'Binding-site delta. Capability lists UNION with the agent\'s own; ' +
          'removals always win.',
        properties: {
          addSkillIds: { type: 'array', items: { type: 'string' } },
          removeSkillIds: { type: 'array', items: { type: 'string' } },
          addMcpServerIds: { type: 'array', items: { type: 'string' } },
          removeMcpServerIds: { type: 'array', items: { type: 'string' } },
          tools: { $ref: '#/components/schemas/AgentToolPolicy' },
          runtime: { type: 'object', additionalProperties: true },
          appendInstructions: { type: 'string' },
          extraAllow: { type: 'array', items: { type: 'string' } },
          extraDeny: { type: 'array', items: { type: 'string' } },
        },
      },
      ResolvedAgentProjection: {
        type: 'object',
        description:
          'What the harness will actually receive. MCP `env` / `headers` are ' +
          'REDACTED before this leaves the server.',
        properties: {
          agentRef: { type: 'string' },
          agentVersion: { type: 'integer' },
          driving: { type: 'object', nullable: true, additionalProperties: true },
          team: { type: 'array', items: { type: 'object', additionalProperties: true } },
          skills: {
            type: 'object',
            properties: {
              ids: { type: 'array', items: { type: 'string' } },
              names: { type: 'array', items: { type: 'string' } },
              directories: { type: 'array', items: { type: 'string' } },
              disabledNames: { type: 'array', items: { type: 'string' } },
              refs: { type: 'array', items: { type: 'object', additionalProperties: true } },
            },
          },
          mcpServers: { type: 'object', additionalProperties: true },
          toolPolicy: {
            type: 'object',
            properties: {
              allow: { type: 'array', items: { type: 'string' } },
              deny: { type: 'array', items: { type: 'string' } },
              groups: { $ref: '#/components/schemas/AgentToolPolicy' },
            },
          },
          runtime: { type: 'object', additionalProperties: true },
          warnings: {
            type: 'array',
            description:
              'Machine-readable — core never emits user-facing English. ' +
              'Map `code` + `params` to copy in the presentation layer.',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                params: { type: 'object', additionalProperties: true },
              },
              required: ['code'],
            },
          },
        },
        required: ['driving', 'team', 'skills', 'mcpServers', 'toolPolicy', 'runtime', 'warnings'],
      },
    },
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description:
          'Optional — only required when `GENERATORAI_API_KEY` env is ' +
          'set. Localhost deployments typically leave this off.',
      },
    },
  },
  paths: {
    '/api/health': {
      get: {
        tags: ['System'],
        summary: 'Server health + runtime config summary',
        responses: {
          '200': {
            description: 'Health snapshot',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['ok'] },
                    uptime: { type: 'number' },
                    version: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/openapi.json': {
      get: {
        tags: ['System'],
        summary: 'This OpenAPI document',
        responses: {
          '200': {
            description: 'Spec document',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },

    '/api/chats': {
      get: {
        tags: ['Chats'],
        summary: 'List chats',
        parameters: [
          { in: 'query', name: 'status', schema: { type: 'string', enum: ['active', 'archived'] } },
        ],
        responses: {
          '200': {
            description: 'Chats',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Chat' } },
              },
            },
          },
        },
      },
      post: {
        tags: ['Chats'],
        summary: 'Create chat',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  model: { type: 'string' },
                  workspacePath: { type: 'string' },
                },
                required: ['name'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created chat',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Chat' } } },
          },
        },
      },
    },
    '/api/chats/{id}': {
      get: {
        tags: ['Chats'],
        summary: 'Get chat',
        parameters: [idParam],
        responses: {
          '200': { description: 'Chat', content: { 'application/json': { schema: { $ref: '#/components/schemas/Chat' } } } },
          '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      delete: {
        tags: ['Chats'],
        summary: 'Delete chat',
        parameters: [idParam],
        responses: { '204': { description: 'Deleted' } },
      },
    },
    '/api/chats/{id}/messages': {
      get: {
        tags: ['Chats'],
        summary: 'List chat messages',
        parameters: [
          idParam,
          { in: 'query', name: 'limit', schema: { type: 'integer' } },
          { in: 'query', name: 'offset', schema: { type: 'integer' } },
        ],
        responses: {
          '200': {
            description: 'Messages',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/ChatMessage' } },
              },
            },
          },
        },
      },
      post: {
        tags: ['Chats'],
        summary: 'Send a prompt',
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  content: { type: 'string' },
                  attachments: { type: 'array' },
                },
                required: ['content'],
              },
            },
          },
        },
        responses: { '202': { description: 'Accepted — stream via /api/stream' } },
      },
    },
    '/api/chats/{id}/transcript': {
      get: {
        tags: ['Chats'],
        summary: 'Whole transcript, oldest first (no page cap)',
        parameters: [
          idParam,
          { in: 'query', name: 'format', schema: { type: 'string', enum: ['json', 'markdown'] } },
        ],
        responses: {
          '200': {
            description: 'Transcript',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    chatId: { type: 'string' },
                    name: { type: 'string' },
                    messages: { type: 'array', items: { $ref: '#/components/schemas/ChatMessage' } },
                  },
                },
              },
              'text/markdown': { schema: { type: 'string' } },
            },
          },
        },
      },
    },
    '/api/chats/{id}/rewind': {
      post: {
        tags: ['Chats'],
        summary: 'Rewind to the start of a turn (files, conversation or both)',
        description:
          'Files go back to the snapshot taken before the turn on every mount; the conversation drops the turn and everything after it, natively when the provider can branch (Claude, Codex) and otherwise by seeding a fresh provider session with a digest of the surviving turns.',
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  turnId: { type: 'string' },
                  scope: { type: 'string', enum: ['all', 'code', 'conversation'] },
                },
                required: ['turnId'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Rewound — `conversation` is native | synthetic | skipped' },
          '404': { description: 'Unknown turn' },
          '409': { description: 'CHAT_BUSY — a turn is still streaming' },
        },
      },
    },
    '/api/chats/{id}/fork': {
      post: {
        tags: ['Chats'],
        summary: 'Branch the conversation after a turn into a new chat',
        description:
          'The fork shares the parent workspace (files as they are now) and copies the transcript through the chosen turn (default: the last). Provider history is copied natively where supported, else seeded.',
        parameters: [idParam],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { turnId: { type: 'string' }, name: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Forked — `{ chat, turnId?, conversation }`' },
          '404': { description: 'Unknown turn' },
          '409': { description: 'CHAT_BUSY — a turn is still streaming' },
        },
      },
    },

    // ── Agents (AGT-01) ──
    // Reading the catalog needs `read:workflows`; AUTHORING an agent grants
    // capability (skills, MCP servers, tool policy) and therefore needs
    // `admin:settings`. BINDING an existing agent to a chat goes through
    // PATCH /api/chats/{id} instead, so a paired device can pick an agent
    // without being able to author one.
    '/api/agents': {
      get: {
        tags: ['Agents'],
        summary: 'List agents',
        parameters: [
          { in: 'query', name: 'scope', schema: { type: 'string', enum: ['system', 'global', 'project'] } },
          { in: 'query', name: 'role', schema: { type: 'string', enum: ['agent', 'orchestrator'] } },
          { in: 'query', name: 'projectId', schema: { type: 'string' } },
          { in: 'query', name: 'q', schema: { type: 'string' } },
          { in: 'query', name: 'enabledOnly', schema: { type: 'string', enum: ['1'] } },
          {
            in: 'query',
            name: 'selectable',
            schema: { type: 'string', enum: ['1'] },
            description:
              'Return the shadow-resolved picker list (project shadows global shadows system) instead of raw rows.',
          },
        ],
        responses: {
          '200': {
            description: 'Agents',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Agent' } },
              },
            },
          },
        },
      },
      post: {
        tags: ['Agents'],
        summary: 'Create agent',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/Agent' },
                  { type: 'object', required: ['name', 'description', 'instructions'] },
                ],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created agent (with non-fatal `warnings`)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Agent' } } },
          },
          '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '409': { description: 'Slug already exists in this scope', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/agents/{id}': {
      get: {
        tags: ['Agents'],
        summary: 'Get agent (by id or scope:slug ref)',
        parameters: [idParam],
        responses: {
          '200': { description: 'Agent', content: { 'application/json': { schema: { $ref: '#/components/schemas/Agent' } } } },
          '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      put: {
        tags: ['Agents'],
        summary: 'Update agent (bumps version)',
        parameters: [idParam],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Agent' } } },
        },
        responses: {
          '200': { description: 'Updated agent', content: { 'application/json': { schema: { $ref: '#/components/schemas/Agent' } } } },
          '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      delete: {
        tags: ['Agents'],
        summary: 'Delete agent',
        description:
          'Answers 409 while the agent is still bound to a chat, stage or ' +
          'workflow. `?force=1` soft-deletes (disables) instead, so existing ' +
          'bindings keep running from their frozen snapshot.',
        parameters: [
          idParam,
          { in: 'query', name: 'force', schema: { type: 'string', enum: ['1'] } },
        ],
        responses: {
          '200': {
            description: 'Deleted',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { deleted: { type: 'boolean' }, soft: { type: 'boolean' } },
                },
              },
            },
          },
          '409': { description: 'Still bound', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/agents/{id}/usage': {
      get: {
        tags: ['Agents'],
        summary: 'Where this agent is bound',
        parameters: [idParam],
        responses: {
          '200': {
            description: 'The chats, stages and workflows currently bound to this agent',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    chats: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: { id: { type: 'string' }, name: { type: 'string' } },
                      },
                    },
                    stages: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          name: { type: 'string' },
                          workflowDefinitionId: { type: 'string' },
                        },
                      },
                    },
                    workflows: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: { id: { type: 'string' }, name: { type: 'string' } },
                      },
                    },
                  },
                  required: ['chats', 'stages', 'workflows'],
                },
              },
            },
          },
        },
      },
    },
    '/api/agents/{id}/export': {
      post: {
        tags: ['Agents'],
        summary: 'Export as a credential-free .agent.md document',
        parameters: [idParam],
        responses: {
          '200': {
            description: 'Markdown document',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { markdown: { type: 'string' } } },
              },
            },
          },
        },
      },
    },
    '/api/agents/import': {
      post: {
        tags: ['Agents'],
        summary: 'Import a .agent.md document',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  markdown: { type: 'string', description: 'Max 256 KB.' },
                  scope: { type: 'string', enum: ['global', 'project'] },
                  projectId: { type: 'string' },
                  overwrite: { type: 'boolean' },
                },
                required: ['markdown'],
              },
            },
          },
        },
        responses: {
          '201': { description: 'Imported agent', content: { 'application/json': { schema: { $ref: '#/components/schemas/Agent' } } } },
          '400': { description: 'Malformed document', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/agents/resolve-preview': {
      post: {
        tags: ['Agents'],
        summary: 'Effective capabilities for a binding (or an unsaved draft)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  agentRef: { type: 'string' },
                  overrides: { $ref: '#/components/schemas/AgentOverrides' },
                  projectId: { type: 'string' },
                  harnessType: { type: 'string', enum: ['copilot', 'claude-agent'] },
                  scope: { type: 'string', enum: ['chat', 'stage', 'worker'] },
                  draft: {
                    type: 'object',
                    additionalProperties: true,
                    description: 'Preview an UNSAVED agent. Ignored when `agentRef` is present.',
                  },
                },
                required: ['scope'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Redacted projection',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ResolvedAgentProjection' },
              },
            },
          },
        },
      },
    },

    '/api/workflow-definitions': {
      get: {
        tags: ['Workflows'],
        summary: 'List workflow definitions',
        responses: {
          '200': {
            description: 'Definitions',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/WorkflowDefinition' },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Workflows'],
        summary: 'Create workflow definition',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: {
          '201': {
            description: 'Created',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/WorkflowDefinition' } },
            },
          },
        },
      },
    },
    '/api/workflow-definitions/{id}': {
      get: {
        tags: ['Workflows'],
        summary: 'Get definition (with stages + edges)',
        parameters: [idParam],
        responses: {
          '200': {
            description: 'Definition',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/WorkflowDefinition' } },
            },
          },
        },
      },
      delete: {
        tags: ['Workflows'],
        summary: 'Delete definition + all runs',
        parameters: [idParam],
        responses: { '204': { description: 'Deleted' } },
      },
    },

    '/api/workflow-runs': {
      post: {
        tags: ['Runs'],
        summary: 'Start a workflow run',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  workflowDefinitionId: { type: 'string' },
                  variables: { type: 'object', additionalProperties: true },
                  permissionMode: {
                    type: 'string',
                    enum: ['bypassPermissions', 'default', 'acceptEdits', 'plan'],
                    description: 'HITL default — defaults to bypassPermissions',
                  },
                },
                required: ['workflowDefinitionId'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Run created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkflowRun' } } },
          },
        },
      },
    },
    '/api/workflow-runs/{runId}': {
      get: {
        tags: ['Runs'],
        summary: 'Get run with stage runs',
        parameters: [runIdParam],
        responses: {
          '200': { description: 'Run', content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkflowRun' } } } },
        },
      },
    },
    '/api/workflow-runs/{runId}/pause': {
      post: {
        tags: ['Runs'],
        summary: 'Pause a running workflow',
        parameters: [runIdParam],
        responses: { '200': { description: 'Paused' } },
      },
    },
    '/api/workflow-runs/{runId}/resume': {
      post: {
        tags: ['Runs'],
        summary: 'Resume a paused workflow',
        parameters: [runIdParam],
        responses: { '200': { description: 'Running' } },
      },
    },
    '/api/workflow-runs/{runId}/cancel': {
      post: {
        tags: ['Runs'],
        summary: 'Cancel a workflow',
        parameters: [runIdParam],
        responses: { '200': { description: 'Cancelled' } },
      },
    },
    '/api/workflow-runs/{runId}/permission-mode': {
      get: {
        tags: ['Runs', 'HITL'],
        summary: 'Get current permission mode',
        parameters: [runIdParam],
        responses: {
          '200': {
            description: 'Mode',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { mode: { type: 'string' } },
                },
              },
            },
          },
        },
      },
      patch: {
        tags: ['Runs', 'HITL'],
        summary: 'Change permission mode mid-run',
        parameters: [runIdParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  mode: {
                    type: 'string',
                    enum: ['bypassPermissions', 'default', 'acceptEdits', 'plan'],
                  },
                },
                required: ['mode'],
              },
            },
          },
        },
        responses: { '200': { description: 'Mode updated' } },
      },
    },
    '/api/workflow-runs/{runId}/pending-interrupts': {
      get: {
        tags: ['Runs', 'HITL'],
        summary: 'List stages awaiting human approval',
        parameters: [runIdParam],
        responses: {
          '200': {
            description: 'Pending stages',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/StageRun' } },
              },
            },
          },
        },
      },
    },
    '/api/workflow-runs/{runId}/stages/{stageId}/resume': {
      post: {
        tags: ['Runs', 'HITL'],
        summary: 'Approve or reject an awaiting_input stage',
        parameters: [
          runIdParam,
          { in: 'path', name: 'stageId', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ResumeStageRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Resumed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { ok: { type: 'boolean' } },
                },
              },
            },
          },
          '409': {
            description: 'Stage no longer awaiting_input (race)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    reason: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/workflow-runs/{runId}/stages/{stageId}/pause': {
      post: {
        tags: ['Runs'],
        summary: 'Pause a specific stage run',
        parameters: [
          runIdParam,
          { in: 'path', name: 'stageId', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Paused' } },
      },
    },
    '/api/workflow-runs/{runId}/stages/{stageId}/retry': {
      post: {
        tags: ['Runs'],
        summary: 'Retry a failed stage',
        parameters: [
          runIdParam,
          { in: 'path', name: 'stageId', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Queued for retry' } },
      },
    },
    '/api/workflow-runs/{runId}/stages/{stageId}/cancel': {
      post: {
        tags: ['Runs'],
        summary: 'Cancel a stage',
        parameters: [
          runIdParam,
          { in: 'path', name: 'stageId', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Cancelled' } },
      },
    },

    '/api/automations': {
      get: {
        tags: ['Automations'],
        summary: 'List automations',
        responses: {
          '200': {
            description: 'Automations',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Automation' } },
              },
            },
          },
        },
      },
      post: {
        tags: ['Automations'],
        summary: 'Create automation',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { '201': { description: 'Created' } },
      },
    },

    '/api/stream': {
      get: {
        tags: ['Streaming'],
        summary: 'Unified SSE stream (STR-03)',
        parameters: [
          {
            in: 'query',
            name: 'scope',
            required: true,
            schema: { type: 'string', enum: ['session', 'run', 'chat', 'global'] },
          },
          { in: 'query', name: 'id', required: false, schema: { type: 'string' } },
          {
            in: 'header',
            name: 'Last-Event-ID',
            required: false,
            schema: { type: 'string' },
            description: 'STR-08 — resume from a known sequence id',
          },
        ],
        responses: {
          '200': {
            description: 'Server-Sent Events stream (text/event-stream)',
            content: { 'text/event-stream': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/api/stream/replay': {
      get: {
        tags: ['Streaming'],
        summary: 'REST companion to /api/stream for Last-Event-ID gap fill',
        parameters: [
          { in: 'query', name: 'scope', required: true, schema: { type: 'string' } },
          { in: 'query', name: 'id', required: false, schema: { type: 'string' } },
          { in: 'query', name: 'afterSequence', required: false, schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'Events' } },
      },
    },

    // ── Source control: accounts + settings (doc §2) ──

    '/api/source-control/settings': {
      get: {
        tags: ['SourceControl'],
        summary: 'Settings, available sign-in methods, and launchable editors',
        responses: {
          '200': {
            description: 'Settings',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SourceControlSettingsResponse' },
              },
            },
          },
        },
      },
      put: {
        tags: ['SourceControl'],
        summary: 'Update settings (partial; absent keys are left alone)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  defaultAccountId: { type: 'string', nullable: true },
                  generation: {
                    type: 'object',
                    properties: {
                      provider: { type: 'string', nullable: true },
                      model: { type: 'string', nullable: true },
                    },
                  },
                  editor: {
                    type: 'object',
                    properties: { defaultEditor: { $ref: '#/components/schemas/EditorId' } },
                  },
                  defaultBase: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated settings',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/SourceControlSettings' } },
            },
          },
          '400': { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/source-control/accounts': {
      post: {
        tags: ['SourceControl'],
        summary: 'Connect an account (token / gh-cli / completed device flow)',
        description:
          'The token is validated against the host, stored in the secret store and dropped. ' +
          'It never appears in a response or a log line.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  provider: { type: 'string', enum: ['github'] },
                  method: { type: 'string', enum: ['token', 'gh-cli', 'device'] },
                  token: { type: 'string', description: 'Required when `method` is `token`. Write-only.' },
                  host: { type: 'string' },
                  label: { type: 'string' },
                },
                required: ['provider', 'method'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Connected account',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/SourceControlAccount' } },
            },
          },
          '400': { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/source-control/accounts/{id}': {
      delete: {
        tags: ['SourceControl'],
        summary: 'Disconnect an account and forget its token',
        parameters: [idParam],
        responses: { '204': { description: 'Removed' } },
      },
    },
    '/api/source-control/accounts/device/start': {
      post: {
        tags: ['SourceControl'],
        summary: 'Start the OAuth device flow',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  provider: { type: 'string', enum: ['github'] },
                  host: { type: 'string' },
                },
                required: ['provider'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'User code + verification URL',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/DeviceLoginStart' } },
            },
          },
          '400': { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/source-control/accounts/device/{loginId}': {
      get: {
        tags: ['SourceControl'],
        summary: 'Poll a device login (the server does the token polling)',
        parameters: [
          { in: 'path', name: 'loginId', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Login status',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/DeviceLoginStatus' } },
            },
          },
          '404': { description: 'Unknown login id', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/source-control/config': {
      get: {
        tags: ['SourceControl'],
        summary: 'Legacy provider selection (kept for older clients)',
        responses: { '200': { description: 'Config' } },
      },
      put: {
        tags: ['SourceControl'],
        summary: 'Legacy provider selection update',
        responses: { '200': { description: 'Config' }, '400': { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
      },
    },
    '/api/source-control/status': {
      get: {
        tags: ['SourceControl'],
        summary: 'Whether source control is usable (`enabled` = at least one account)',
        responses: {
          '200': {
            description: 'Status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    activeProvider: { type: 'string', enum: ['github', 'none'] },
                    enabled: { type: 'boolean' },
                  },
                  required: ['activeProvider', 'enabled'],
                },
              },
            },
          },
        },
      },
    },

    // ── Source control: workspace mounts (doc §3 / §4) ──

    '/api/workspaces/{id}/scm/readiness': {
      get: {
        tags: ['SourceControl', 'Workspaces'],
        summary: 'Can this workspace commit / push / open a PR — and if not, why',
        description: 'Without `alias`, one RepoReadiness per git-capable mount; non-repos are reported with `isRepo: false`.',
        parameters: [
          idParam,
          { in: 'query', name: 'alias', required: false, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Readiness per mount',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/WorkspaceReadinessResponse' },
              },
            },
          },
          '404': { description: 'Workspace not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/workspaces/{id}/scm/flow': {
      post: {
        tags: ['SourceControl', 'Workspaces'],
        summary: 'Run the commit → sync → push → pull-request flow',
        description:
          '`blocked` and `conflicts` are ordinary 200 results carrying the reason or the ' +
          'conflicted file list — both are states the client renders, not request failures.',
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ScmFlowRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Flow result',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ScmFlowResult' } },
            },
          },
          '404': { description: 'Workspace not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/workspaces/{id}/scm/generate': {
      post: {
        tags: ['SourceControl', 'Workspaces'],
        summary: 'Generate a commit message or PR title/body (no git steps run)',
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ScmGenerateRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Generated text',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ScmGenerateResult' } },
            },
          },
          '400': { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '404': { description: 'Workspace not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/workspaces/{id}/scm/conflicts/start': {
      post: {
        tags: ['SourceControl', 'Workspaces'],
        summary: 'Apply the base merge to the working tree so conflicts can be edited',
        parameters: [idParam],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { alias: { type: 'string' }, base: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Conflict report',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ScmConflictReport' } },
            },
          },
          '404': { description: 'Workspace not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/workspaces/{id}/scm/conflicts/continue': {
      post: {
        tags: ['SourceControl', 'Workspaces'],
        summary: 'Commit the merge once no conflict markers remain',
        description: '`ok: false` is a 200 — "these files are still conflicted" is a normal answer, not an error.',
        parameters: [idParam],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { alias: { type: 'string' }, message: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Merge committed, or the files still to resolve',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    sha: { type: 'string' },
                    remaining: { type: 'array', items: { type: 'string' } },
                  },
                  required: ['ok', 'remaining'],
                },
              },
            },
          },
          '404': { description: 'Workspace not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/workspaces/{id}/scm/conflicts/abort': {
      post: {
        tags: ['SourceControl', 'Workspaces'],
        summary: 'git merge --abort',
        parameters: [idParam],
        responses: {
          '204': { description: 'Aborted' },
          '404': { description: 'Workspace not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/workspaces/{id}/scm/conflicts/resolve-with-agent': {
      post: {
        tags: ['SourceControl', 'Workspaces'],
        summary: 'Start the merge and ask a chat to resolve the conflicts',
        description:
          'A normal chat turn the user can watch, stop and rewind. Nothing is pushed until ' +
          'the user presses Continue.',
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { alias: { type: 'string' }, chatId: { type: 'string' } },
                required: ['chatId'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Prompt sent',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    chatId: { type: 'string' },
                    files: { type: 'array', items: { type: 'string' } },
                  },
                  required: ['chatId', 'files'],
                },
              },
            },
          },
          '400': { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '404': { description: 'Workspace or chat not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '409': { description: 'The chat is busy', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    // ── Source control: pull requests under a project (doc §6) ──

    '/api/projects/{id}/pull-requests': {
      get: {
        tags: ['SourceControl', 'Projects'],
        summary: 'Pull requests across every codebase of a project',
        description: 'A codebase without a remote, without a connected account, or whose host call failed is listed under `unavailable` — it never fails the response.',
        parameters: [
          idParam,
          { in: 'query', name: 'state', required: false, schema: { type: 'string', enum: ['open', 'closed', 'all'] } },
        ],
        responses: {
          '200': {
            description: 'Pull requests + unavailable codebases',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ProjectPullRequestsResponse' },
              },
            },
          },
        },
      },
    },
    '/api/projects/{id}/codebases/{cid}/pull-requests/{number}': {
      get: {
        tags: ['SourceControl', 'Projects'],
        summary: 'Pull request detail (checks attached when the host answers)',
        parameters: [idParam, cidParam, prNumberParam],
        responses: {
          '200': {
            description: 'Pull request',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/PullRequestDetail' } },
            },
          },
          '400': { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '409': { description: 'The remote host is not connected', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/projects/{id}/codebases/{cid}/pull-requests/{number}/files': {
      get: {
        tags: ['SourceControl', 'Projects'],
        summary: 'Files changed by a pull request',
        parameters: [idParam, cidParam, prNumberParam],
        responses: {
          '200': {
            description: 'Changed files',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/PullRequestFile' } },
              },
            },
          },
          '400': { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '409': { description: 'The remote host is not connected', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/projects/{id}/codebases/{cid}/pull-requests/{number}/comments': {
      get: {
        tags: ['SourceControl', 'Projects'],
        summary: 'Review + issue comments on a pull request',
        parameters: [idParam, cidParam, prNumberParam],
        responses: {
          '200': {
            description: 'Comments',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/PullRequestComment' } },
              },
            },
          },
          '400': { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '409': { description: 'The remote host is not connected', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/projects/{id}/codebases/{cid}/pull-requests/{number}/review-chat': {
      post: {
        tags: ['SourceControl', 'Projects'],
        summary: 'Create a chat on the PR head branch and send the review prompt',
        parameters: [idParam, cidParam, prNumberParam],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  instructions: { type: 'string' },
                  model: { type: 'string' },
                  agentRef: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created chat',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { chat: { $ref: '#/components/schemas/Chat' } },
                  required: ['chat'],
                },
              },
            },
          },
          '400': { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '409': { description: 'The remote host is not connected', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/projects/{id}/codebases/{cid}/readiness': {
      get: {
        tags: ['SourceControl', 'Projects'],
        summary: 'Readiness for a codebase checkout',
        parameters: [idParam, cidParam],
        responses: {
          '200': {
            description: 'Readiness',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/RepoReadiness' } },
            },
          },
          '400': { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    // ── Open in editor (doc §7) ──

    '/api/editor/editors': {
      get: {
        tags: ['Editor'],
        summary: 'Editors this server host can launch',
        responses: {
          '200': {
            description: 'Editors',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/EditorInfo' } },
              },
            },
          },
        },
      },
    },
    '/api/editor/open': {
      post: {
        tags: ['Editor'],
        summary: 'Open a path in an editor on the server host',
        description:
          'The path must resolve (symlinks followed) inside a known workspace mount, project ' +
          'codebase or worktree. `ok: false` is still a 200 — `fallbackUrl` is what the ' +
          'browser tries when the server could not launch anything.',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/OpenInEditorRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Launch result',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/OpenInEditorResult' } },
            },
          },
          '400': { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '403': { description: 'Path is outside every known root', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    '/api/copilot/models': {
      get: {
        tags: ['Copilot'],
        summary: 'List available Copilot models (honours harness.type config)',
        responses: { '200': { description: 'Models' } },
      },
    },
  },
};
