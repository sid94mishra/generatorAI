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
        issues: {
          type: 'array',
          items: { $ref: '#/components/schemas/ValidationIssue' },
          description: 'WORKFLOW_INVALID (422): every problem, each pointing at a field',
        },
        current: {
          $ref: '#/components/schemas/WorkflowDefinition',
          description: 'REVISION_CONFLICT (409): the record the save lost to',
        },
      },
      required: ['code', 'message'],
    },
  },
};

const errorContent = { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } };

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

const issueNumberParam = {
  in: 'path',
  name: 'number',
  required: true,
  description: 'Issue number',
  schema: { type: 'integer', minimum: 1 },
};

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

const runIdParam = {
  in: 'path',
  name: 'runId',
  required: true,
  schema: { type: 'string' },
};

const instanceIdParam = {
  in: 'path',
  name: 'instanceId',
  required: true,
  schema: { type: 'string' },
};

const interactionIdParam = {
  in: 'path',
  name: 'interactionId',
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
      PushDataV2: {
        type: 'object',
        description: 'Mobile push data. v2 clients route exclusively with href and serverId; route remains for existing consumers. Receiving a link never performs an action.',
        required: ['v', 'serverId', 'href', 'route', 'category', 'threadId'],
        properties: {
          v: { type: 'integer', const: 2 }, serverId: { type: 'string' }, href: { type: 'string' },
          route: { type: 'string' }, category: { type: 'string' }, threadId: { type: 'string' },
          entity: { type: 'string', enum: ['chat', 'workflow_run', 'automation_execution'] },
          entityId: { type: 'string' }, workflowDefinitionId: { type: 'string' },
          chatId: { type: 'string' }, interactionId: { type: 'string' },
          kind: { type: 'string', enum: ['permission', 'question', 'plan'] },
          actions: { type: 'array', items: { type: 'string' } },
          // MG-06 part B (mobile M9-02): `category` is a shared NotificationCategoryId
          // (approval, approval.risky, question, plan, run.approval, done, failed, scope_request).
          risk: { type: 'string', enum: ['standard', 'risky'] },
          runId: { type: 'string' }, stageRunId: { type: 'string' },
          question: {
            type: 'object',
            description: 'A chat question: the first question and up to four option labels, so a lock-screen reply can be matched to an option.',
            required: ['id', 'options', 'multiSelect', 'freeText', 'count'],
            properties: {
              id: { type: 'string' }, options: { type: 'array', items: { type: 'string' }, maxItems: 4 },
              multiSelect: { type: 'boolean' }, freeText: { type: 'boolean' }, count: { type: 'integer' },
            },
          },
          redacted: {
            type: 'object',
            description: 'Lock-screen-safe title and body (no command, path or message text); shown by the iOS service extension while App lock hides previews.',
            required: ['title', 'body'],
            properties: { title: { type: 'string' }, body: { type: 'string' } },
          },
          counts: {
            type: 'object',
            description: "The sending server's attention counts at send time (app badge).",
            required: ['needsYou', 'running'],
            properties: { needsYou: { type: 'integer' }, running: { type: 'integer' } },
          },
        },
      },
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
      MergePullRequestResult: {
        type: 'object',
        properties: {
          merged: { type: 'boolean' },
          sha: { type: 'string', description: 'The merge (or squash / last rebased) commit on the base branch.' },
          message: { type: 'string', description: "The host's own message." },
          branchDeleted: { type: 'boolean', description: 'Present when deleteBranch was asked for: false when the branch was already gone.' },
          branchDeleteError: { type: 'string', description: 'Why the head branch could not be deleted (the merge itself succeeded).' },
        },
        required: ['merged', 'message'],
      },
      IssueSummary: {
        type: 'object',
        description: 'A host issue — never a pull request, even where the host lists both together.',
        properties: {
          provider: { type: 'string', enum: ['github'] },
          number: { type: 'integer' },
          title: { type: 'string' },
          body: { type: 'string', description: 'Markdown; empty when the issue has no description.' },
          state: { type: 'string', enum: ['open', 'closed'] },
          stateReason: { type: 'string', enum: ['completed', 'not_planned', 'reopened'] },
          labels: { type: 'array', items: { type: 'string' } },
          author: { type: 'string' },
          url: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          comments: { type: 'integer', description: 'Number of comments.' },
        },
        required: ['provider', 'number', 'title', 'body', 'state', 'labels', 'url', 'createdAt', 'updatedAt', 'comments'],
      },
      IssueComment: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          author: { type: 'string' },
          body: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          url: { type: 'string' },
        },
        required: ['id', 'author', 'body', 'createdAt'],
      },
      IssueDetailResponse: {
        type: 'object',
        properties: {
          issue: { $ref: '#/components/schemas/IssueSummary' },
          comments: { type: 'array', items: { $ref: '#/components/schemas/IssueComment' } },
        },
        required: ['issue', 'comments'],
      },
      ProjectIssue: {
        allOf: [
          { $ref: '#/components/schemas/IssueSummary' },
          {
            type: 'object',
            properties: { codebaseId: { type: 'string' }, codebaseAlias: { type: 'string' } },
            required: ['codebaseId', 'codebaseAlias'],
          },
        ],
      },
      ProjectIssuesResponse: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/ProjectIssue' } },
          unavailable: {
            type: 'array',
            description: 'Codebases that could not be listed, each with a user-facing reason.',
            items: {
              type: 'object',
              properties: { codebaseId: { type: 'string' }, alias: { type: 'string' }, reason: { type: 'string' } },
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
      WorkflowGraph: {
        type: 'object',
        description:
          'A v2 workflow document (`formatVersion: 2`): `workflow` settings, `stages` identified by `key`, ' +
          'and `edges` between stage keys. The full JSON Schema ships as ' +
          '`@generatorai/workflow-spec/workflow.schema.json`.',
        properties: {
          formatVersion: { type: 'integer', enum: [2] },
          workflow: { type: 'object', additionalProperties: true },
          stages: { type: 'array', items: { type: 'object', additionalProperties: true } },
          edges: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                from: { type: 'string' },
                to: { type: 'string' },
                on: { type: 'string', enum: ['success', 'failure', 'completion', 'always'] },
                when: { type: 'string' },
              },
              required: ['from', 'to', 'on'],
            },
          },
        },
        required: ['formatVersion', 'workflow', 'stages'],
      },
      ValidationIssue: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          severity: { type: 'string', enum: ['error', 'warning', 'info'] },
          path: { type: 'string', description: 'JSON pointer into the graph, e.g. `/stages/2/prompts/0/text`' },
          stageKey: { type: 'string' },
          message: { type: 'string' },
          hint: { type: 'string' },
        },
        required: ['code', 'severity', 'path', 'message'],
      },
      ValidationResult: {
        type: 'object',
        properties: {
          valid: { type: 'boolean' },
          issues: { type: 'array', items: { $ref: '#/components/schemas/ValidationIssue' } },
        },
        required: ['valid', 'issues'],
      },
      WorkflowDefinition: {
        type: 'object',
        description: 'A definition record: the working graph plus its draft/published state.',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['draft', 'published'] },
          revision: {
            type: 'integer',
            description: 'Bumped on every save; `PUT /graph` sends it back as `expectedRevision`',
          },
          currentVersionId: { type: ['string', 'null'], description: 'The published version new runs execute' },
          hasUnpublishedChanges: { type: 'boolean' },
          archivedAt: { type: ['string', 'null'], format: 'date-time' },
          needsAttention: { type: 'array', items: { type: 'string' } },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          graph: { $ref: '#/components/schemas/WorkflowGraph' },
        },
        required: ['id', 'status', 'revision', 'currentVersionId', 'graph'],
      },
      WorkflowDefinitionSummary: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          projectId: { type: ['string', 'null'] },
          status: { type: 'string', enum: ['draft', 'published'] },
          revision: { type: 'integer' },
          currentVersionId: { type: ['string', 'null'] },
          tags: { type: 'array', items: { type: 'string' } },
          stageCount: { type: 'integer' },
          needsAttention: { type: 'boolean' },
          archivedAt: { type: ['string', 'null'], format: 'date-time' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'name', 'status', 'revision', 'stageCount'],
      },
      WorkflowDefinitionVersion: {
        type: 'object',
        description: 'An immutable snapshot of a graph; every run pins one.',
        properties: {
          id: { type: 'string' },
          workflowDefinitionId: { type: 'string' },
          version: { type: 'integer' },
          kind: { type: 'string', enum: ['published', 'test'] },
          contentHash: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          graph: { $ref: '#/components/schemas/WorkflowGraph', description: 'Only on the single-version read' },
        },
        required: ['id', 'workflowDefinitionId', 'version', 'kind'],
      },
      WorkflowRun: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          workflowDefinitionId: { type: 'string' },
          definitionVersionId: { type: 'string', description: 'The immutable definition version this run executes' },
          status: {
            type: 'string',
            enum: ['created', 'starting', 'running', 'waiting', 'paused', 'finalizing', 'cancelling', 'completed', 'failed', 'cancelled'],
          },
          statusReason: { type: 'string', nullable: true },
          outcome: { type: 'string', enum: ['completed', 'failed', 'cancelled'], nullable: true },
          version: { type: 'integer', description: 'CAS version (`expectedVersion` on commands)' },
          ancestorRunId: { type: 'string', nullable: true, description: 'The run this one was forked from' },
          permissionMode: {
            type: 'string',
            enum: ['bypassPermissions', 'default', 'acceptEdits', 'plan'],
            description:
              "The operator's explicit run-level permission mode; unset lets the stage, workflow and trigger " +
              'layers and the deployment posture decide. Gated modes park stages `awaiting_input` for approval.',
          },
          variables: { type: 'object', additionalProperties: true },
          startedAt: { type: 'string', format: 'date-time', nullable: true },
          completedAt: { type: 'string', format: 'date-time', nullable: true },
        },
        required: ['id', 'workflowDefinitionId', 'definitionVersionId', 'status'],
      },
      StageRun: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          workflowRunId: { type: 'string' },
          stageKey: { type: 'string', description: "The stage's key in the run's pinned graph" },
          name: { type: 'string' },
          instancePath: { type: 'string', description: 'Unique per run; the stage key at the top level' },
          status: {
            type: 'string',
            enum: [
              'pending', 'ready', 'starting', 'running', 'validating', 'awaiting_input', 'waiting',
              'retry_wait', 'paused', 'completed', 'failed', 'skipped', 'cancelled',
            ],
          },
          statusReason: { type: 'string', nullable: true },
          interruptData: { description: 'What an awaiting_input instance asks for; answered with the approve command' },
          currentAttempt: { type: 'integer' },
          version: { type: 'integer' },
        },
        required: ['id', 'workflowRunId', 'stageKey', 'instancePath', 'status'],
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
          projectId: { type: 'string' },
          codebases: {
            type: 'array',
            description:
              "D-103: the project codebases its runs mount (always as worktrees), each cut from `baseRef` (omitted: the codebase's default branch). Omitted: the workflow's own codebases.",
            items: {
              type: 'object',
              properties: { alias: { type: 'string' }, baseRef: { type: 'string' } },
              required: ['alias'],
            },
          },
        },
      },
      RunCommand: {
        type: 'object',
        description:
          'Discriminated by `command`. The full JSON Schema ships as `@generatorai/workflow-spec/run-command.schema.json`.',
        properties: {
          command: { type: 'string', enum: ['pause', 'resume', 'cancel', 'retry', 'skip', 'fail', 'approve'] },
          instanceId: { type: 'string', description: 'The instance the command targets; omitted means the run' },
          expectedVersion: { type: 'integer' },
          mode: { type: 'string', enum: ['drain', 'interrupt', 'resume', 'restart'], description: 'pause: drain|interrupt; retry: resume|restart' },
          as: { type: 'string', enum: ['completed', 'skipped'], description: 'skip only' },
          outcome: { type: 'string', enum: ['approved', 'changes_requested', 'rejected'], description: 'approve only' },
          feedback: { type: 'string', description: 'approve only' },
          data: { type: 'object', additionalProperties: true, description: "approve only: a question's answers, a plan decision" },
        },
        required: ['command'],
      },
      InvocationRequest: {
        type: 'object',
        description:
          'The one request that starts a run. The full JSON Schema ships as `@generatorai/workflow-spec/invocation.schema.json`; ' +
          'fields are listed in docs/workflow-overhaul/generated/INVOCATION.md.',
        properties: {
          target: {
            type: 'object',
            description: "{kind: 'definition', workflowDefinitionId, version?, testRun?} | {kind: 'script', scriptId} | {kind: 'fork', sourceRunId, rerunFrom?, definition?, workspace?}",
          },
          variables: { type: 'object', additionalProperties: true, description: 'Engine-reserved names (__*, repo_path_*, repo_branch_*) are refused' },
          projectId: { type: 'string' },
          codebases: { type: 'array', items: { type: 'object' }, description: '[{alias, baseRef?, mode: worktree|in_place}]' },
          stageOverrides: { type: 'array', items: { type: 'object' }, description: '[{stageKey, skip?, variables?, model?}]' },
          overrides: { type: 'object', description: '{model?, harnessType?, reasoningEffort?, permissionMode?}' },
          uploads: { type: 'array', items: { type: 'object' }, description: '[{uploadId, category}]' },
          profile: { type: 'string' },
          name: { type: 'string' },
          budget: { type: 'object' },
          idempotencyKey: { type: 'string' },
          client: { type: 'string', enum: ['web', 'desktop', 'mobile', 'cli', 'tui', 'sdk', 'mcp', 'http'] },
        },
        required: ['target'],
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
      // ── Attention feed (G-01; mirrors packages/shared/src/types/Attention.ts) ──
      AttentionItem: {
        type: 'object',
        description:
          'One Needs you or Running row. `ask` is present exactly when the item is in `needsYou`. ' +
          '`ask.detail` and `progress.label` are omitted for principals without `read:chats` ' +
          '(chat items) or `read:workflows` (run and automation items).',
        properties: {
          key: { type: 'string', description: '`${entity}:${entityId}`, plus `:${ask.id}` for asks' },
          entity: { type: 'string', enum: ['chat', 'workflow_run', 'automation_execution'] },
          entityId: { type: 'string' },
          title: { type: 'string' },
          href: { type: 'string', description: 'In-app route, e.g. `/chats/abc?dock=plan`' },
          project: {
            type: 'object',
            properties: { id: { type: 'string' }, name: { type: 'string' } },
            required: ['id', 'name'],
          },
          parent: {
            type: 'object',
            description: 'Set on worker chats: the orchestrator chat they roll up to.',
            properties: {
              entity: { type: 'string', enum: ['chat'] },
              id: { type: 'string' },
              title: { type: 'string' },
            },
            required: ['entity', 'id', 'title'],
          },
          state: { type: 'string', enum: ['needs_you', 'running', 'waiting', 'paused', 'queued'] },
          since: { type: 'string', format: 'date-time' },
          ask: {
            type: 'object',
            properties: {
              kind: {
                type: 'string',
                enum: [
                  'tool_permission',
                  'question',
                  'plan_review',
                  'stage_approval',
                  'stage_input',
                  'computer_consent',
                  'run_paused',
                ],
              },
              id: { type: 'string' },
              summary: {
                type: 'string',
                description: 'One line. A tool-permission gate states its action in words (D-107): "Run this command?", "Open a page in the browser?", "Allow github: Create issue?".',
              },
              detail: { type: 'string' },
              actions: {
                type: 'array',
                items: { type: 'string', enum: ['allow_once', 'deny', 'approve', 'reject', 'answer', 'open'] },
              },
              risk: {
                type: 'string',
                enum: ['standard', 'risky'],
                description: 'Tool-permission gates only (MG-04, D-106): a risky gate needs a signed answer from a phone. Shell commands are risky only when they use the network, install or publish packages, push, delete or overwrite data, need elevated rights, pipe into a shell or write outside the workspace.',
              },
            },
            required: ['kind', 'id', 'summary', 'actions'],
          },
          progress: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              step: { type: 'integer' },
              of: { type: 'integer' },
            },
          },
          stoppable: { type: 'boolean' },
          meta: { $ref: '#/components/schemas/ActivityMeta' },
        },
        required: ['key', 'entity', 'entityId', 'title', 'href', 'state', 'since', 'stoppable'],
      },
      ActivityMeta: {
        type: 'object',
        description:
          'Who/what runs an attention or recent-activity item (D-92). Every field is omitted when unknown. ' +
          '`workers` is set on orchestrator chats: their workers by lifecycle (queued = spawned, inReview = ' +
          'finished and being read by the orchestrator; cancelled workers count in `total` only).',
        properties: {
          agent: { type: 'string', description: 'The bound agent\'s name' },
          model: { type: 'string', description: 'Model id the chat runs on' },
          workers: {
            type: 'object',
            properties: {
              total: { type: 'integer' },
              running: { type: 'integer' },
              queued: { type: 'integer' },
              inReview: { type: 'integer' },
              done: { type: 'integer' },
              failed: { type: 'integer' },
            },
            required: ['total', 'running', 'queued', 'inReview', 'done', 'failed'],
          },
          automation: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              triggerType: { type: 'string', enum: ['manual', 'schedule', 'webhook'] },
              cronExpression: { type: 'string' },
            },
            required: ['id', 'triggerType'],
          },
        },
      },
      RecentActivityItem: {
        type: 'object',
        description: 'One finished chat turn, terminal workflow run or terminal automation execution (G-11).',
        properties: {
          key: { type: 'string' },
          entity: { type: 'string', enum: ['chat', 'run', 'automation_execution'] },
          entityId: { type: 'string' },
          title: { type: 'string' },
          href: { type: 'string' },
          project: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } }, required: ['id', 'name'] },
          endedAt: { type: 'string', format: 'date-time' },
          outcome: { type: 'string', enum: ['succeeded', 'failed', 'cancelled'] },
          summary: { type: 'string' },
          changes: { $ref: '#/components/schemas/ChatChangeStats' },
          pullRequest: { type: 'object', properties: { number: { type: 'integer' }, url: { type: 'string' } }, required: ['number', 'url'] },
          commit: { type: 'object', properties: { branch: { type: 'string' }, sha: { type: 'string' } }, required: ['branch'] },
          retry: { type: 'string', enum: ['chat_prompt', 'run_retry'] },
          meta: { $ref: '#/components/schemas/ActivityMeta' },
          unread: { type: 'boolean', description: 'Chats: finished after the person last read the chat (D-83)' },
        },
        required: ['key', 'entity', 'entityId', 'title', 'href', 'endedAt', 'outcome', 'summary'],
      },
      AttentionCounts: {
        type: 'object',
        properties: {
          needsYou: { type: 'integer' },
          running: { type: 'integer' },
          byEntity: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              properties: { needsYou: { type: 'integer' }, running: { type: 'integer' } },
              required: ['needsYou', 'running'],
            },
          },
        },
        required: ['needsYou', 'running', 'byEntity'],
      },
      // ── Chat list v2 (G-02; mirrors packages/shared/src/types/ChatList.ts) ──
      ChatChangeStats: {
        type: 'object',
        description: 'Net change of the chat workspace, session baseline → working tree.',
        properties: {
          files: { type: 'integer' },
          additions: { type: 'integer' },
          deletions: { type: 'integer' },
        },
        required: ['files', 'additions', 'deletions'],
      },
      ChatListSummary: {
        type: 'object',
        properties: {
          lastActivityAt: { type: 'string', format: 'date-time', description: 'Newest turn start or end (creation time before the first turn).' },
          lastTurn: {
            type: 'object',
            description: 'Absent until the first turn ends.',
            properties: {
              status: { type: 'string', enum: ['succeeded', 'failed', 'cancelled'] },
              endedAt: { type: 'string', format: 'date-time' },
              error: { type: 'string', description: 'First line of the provider error; only on `failed`.' },
            },
            required: ['status', 'endedAt'],
          },
          changes: {
            allOf: [{ $ref: '#/components/schemas/ChatChangeStats' }],
            description: 'Absent when the chat has no workspace or the stats were not computed yet.',
          },
          agent: {
            type: 'object',
            properties: {
              ref: { type: 'string' },
              name: { type: 'string' },
              role: { type: 'string', enum: ['agent', 'orchestrator'] },
            },
            required: ['ref', 'name'],
          },
          preview: {
            type: 'object',
            description: 'One line of the newest message.',
            properties: {
              text: { type: 'string' },
              role: { type: 'string', enum: ['user', 'assistant', 'system', 'tool'] },
              at: { type: 'string', format: 'date-time' },
            },
            required: ['text', 'role', 'at'],
          },
        },
        required: ['lastActivityAt'],
      },
      ChatListItem: {
        allOf: [
          { $ref: '#/components/schemas/Chat' },
          {
            type: 'object',
            properties: { summary: { $ref: '#/components/schemas/ChatListSummary' } },
            required: ['summary'],
          },
        ],
      },
      ChatListPage: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/ChatListItem' } },
          nextCursor: { type: 'string', nullable: true, description: 'Pass back as `cursor` (same sort); null on the last page.' },
          total: { type: 'integer', description: 'Rows matching every filter, across all pages.' },
          counts: {
            type: 'object',
            description: 'All / Active / Archived — every filter applied except `status`.',
            properties: {
              all: { type: 'integer' },
              active: { type: 'integer' },
              archived: { type: 'integer' },
            },
            required: ['all', 'active', 'archived'],
          },
        },
        required: ['items', 'nextCursor', 'total', 'counts'],
      },
      ChatBulkRequest: {
        type: 'object',
        properties: { ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 200 } },
        required: ['ids'],
      },
      ChatBulkResult: {
        type: 'object',
        properties: {
          succeeded: { type: 'array', items: { type: 'string' } },
          failed: {
            type: 'array',
            items: {
              type: 'object',
              properties: { id: { type: 'string' }, code: { type: 'string' }, message: { type: 'string' } },
              required: ['id', 'code', 'message'],
            },
          },
        },
        required: ['succeeded', 'failed'],
      },
      ComputerPendingConsent: {
        type: 'object',
        properties: {
          requestId: { type: 'string' },
          workspaceId: { type: 'string' },
          chatId: { type: 'string' },
          appIdentity: { type: 'string' },
          appLabel: { type: 'string' },
          action: { type: 'string' },
          summary: { type: 'string' },
          path: { type: 'string', enum: ['synthetic', 'accessibility'] },
          plan: {
            type: 'array',
            description: 'G-07: the steps of a batched request, answered once',
            items: { type: 'object', properties: { action: { type: 'string' }, target: { type: 'string' } }, required: ['action'] },
          },
          expiresAt: { type: 'integer' },
        },
        required: ['requestId', 'workspaceId', 'appIdentity', 'appLabel', 'action', 'summary', 'path', 'expiresAt'],
      },
      ComputerControlState: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string' },
          mode: { type: 'string', enum: ['agent', 'paused', 'user'] },
          changedAt: { type: 'integer', nullable: true },
        },
        required: ['workspaceId', 'mode', 'changedAt'],
      },
      HarnessCatalogModel: {
        type: 'object',
        description:
          'One model a provider serves for the signed-in account (G-09). Every field is what the provider\'s own ' +
          'listing returned (D-131); an absent field was not returned.',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          provider: { type: 'string' },
          description: { type: 'string' },
          isDefault: { type: 'boolean', description: 'The provider flags this model as the account default' },
          resolvedModel: { type: 'string', description: 'Canonical id an alias resolves to (Claude)' },
          inputModalities: { type: 'array', items: { type: 'string' } },
          features: { type: 'array', items: { type: 'string' }, description: 'Provider-reported capability flags' },
          category: { type: 'string', description: "The provider's own picker category, when it sends one (Copilot)" },
          promptTokenLimit: { type: 'integer', description: 'Prompt tokens of the default tier (context gauge)' },
          totalContextWindow: { type: 'integer' },
          longContext: {
            type: 'object',
            properties: { promptTokenLimit: { type: 'integer' }, totalContextWindow: { type: 'integer' } },
          },
          maxOutputTokens: { type: 'integer' },
          supportsVision: { type: 'boolean' },
          supportsReasoning: { type: 'boolean' },
          reasoningEfforts: { type: 'array', items: { type: 'string' } },
          defaultReasoningEffort: { type: 'string' },
          supportsLongContext: { type: 'boolean' },
        },
        required: ['id', 'name'],
      },
      HarnessVisibilityResponse: {
        type: 'object',
        properties: {
          providers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                label: { type: 'string' },
                stability: { type: 'string', enum: ['stable', 'experimental'] },
                visible: { type: 'boolean' },
                source: { type: 'string', enum: ['default', 'setting', 'env'] },
              },
              required: ['type', 'label', 'stability', 'visible', 'source'],
            },
          },
        },
        required: ['providers'],
      },
      HarnessProviderStatus: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          label: { type: 'string' },
          installed: { type: 'boolean' },
          connected: { type: 'boolean' },
          authenticated: { type: 'boolean' },
          ready: { type: 'boolean', description: 'Usable right now; a picker never auto-selects a provider that is not ready' },
          error: { type: 'string', nullable: true },
          checkedAt: { type: 'integer' },
          modelCount: { type: 'integer' },
          models: { type: 'array', items: { $ref: '#/components/schemas/HarnessCatalogModel' } },
          supportsLogin: { type: 'boolean' },
        },
        required: ['type', 'label', 'installed', 'connected', 'authenticated', 'ready', 'modelCount', 'models', 'supportsLogin'],
      },
      HarnessProvidersResponse: {
        type: 'object',
        properties: {
          primary: { type: 'string', description: 'Configured default provider, reported whether or not it is ready' },
          stale: { type: 'boolean', description: 'Served from the snapshot while a background re-probe runs' },
          providers: { type: 'array', items: { $ref: '#/components/schemas/HarnessProviderStatus' } },
        },
        required: ['primary', 'stale', 'providers'],
      },
      AttentionSnapshot: {
        type: 'object',
        description:
          'Deltas follow on the `global` stream scope as `attention.upsert` `{seq, item}`, ' +
          '`attention.remove` `{seq, key}` and `attention.counts` `{seq, counts}`. Apply a delta ' +
          'whose seq is exactly `seq + 1`; on any larger jump, refetch this snapshot.',
        properties: {
          seq: { type: 'integer' },
          generatedAt: { type: 'string', format: 'date-time' },
          needsYou: { type: 'array', items: { $ref: '#/components/schemas/AttentionItem' } },
          running: { type: 'array', items: { $ref: '#/components/schemas/AttentionItem' } },
          counts: { $ref: '#/components/schemas/AttentionCounts' },
        },
        required: ['seq', 'generatedAt', 'needsYou', 'running', 'counts'],
      },
      TlsStatus: {
        type: 'object',
        description: 'Built-in HTTPS for other devices (D-110). Public: never contains key material.',
        properties: {
          enabled: { type: 'boolean', enum: [true] },
          source: { type: 'string', enum: ['generated', 'custom'] },
          fingerprintSha256: { type: 'string', description: 'SHA-256 of the served certificate, colon-separated hex — what a browser shows in its warning.' },
          caFingerprintSha256: { type: ['string', 'null'], description: 'SHA-256 of the local CA (generated only) — what a native client pins.' },
          issuer: { type: 'string' },
          notBefore: { type: 'number' },
          notAfter: { type: 'number' },
          names: { type: 'array', items: { type: 'string' } },
          customCertificateProblem: { type: ['string', 'null'] },
        },
        required: ['enabled', 'source', 'fingerprintSha256', 'caFingerprintSha256', 'issuer', 'notBefore', 'notAfter', 'names', 'customCertificateProblem'],
      },
      TailscaleAccessStatus: {
        type: 'object',
        description: '"Connect with Tailscale" (D-123). Fields after `origin` are present only with `detail: "full"` (admin:settings).',
        properties: {
          detail: { type: 'string', enum: ['full', 'limited'] },
          enabled: { type: 'boolean', description: "The owner's choice; re-applied when the server starts." },
          state: { type: 'string', enum: ['not-installed', 'not-running', 'needs-login', 'https-disabled', 'ready', 'on', 'error'] },
          origin: { type: ['string', 'null'], description: '`https://<machine>.<tailnet>.ts.net` while on.' },
          dnsName: { type: ['string', 'null'] },
          tailnet: { type: ['string', 'null'] },
          version: { type: ['string', 'null'] },
          cliPath: { type: ['string', 'null'] },
          loginUrl: { type: ['string', 'null'] },
          enableHttpsUrl: { type: ['string', 'null'] },
          problem: { type: ['string', 'null'] },
          conflict: { type: ['string', 'null'] },
          funnel: { type: 'boolean' },
          blockers: { type: 'array', items: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } },
        },
        required: ['detail', 'enabled', 'state', 'origin'],
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
    '/api/artifacts/{id}/download': {
      get: {
        tags: ['Artifacts'], summary: 'Download registered artifact bytes (MG-21)',
        description: 'Requires read:files plus the owning session read:chats or read:workflows scope. Only managed artifact storage is served.',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Binary bytes; Content-Type and RFC 5987 Content-Disposition describe the file', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } },
          '403': { description: 'Missing file/owner scope or path outside managed storage' },
          '404': { description: 'Artifact or file not found' },
        },
      },
    },
    '/api/auth/approval-nonce': {
      post: {
        tags: ['Auth'], summary: 'Single-use approval nonce bound to this device (MG-05)',
        description: 'Paired devices only. Valid 60 s; spent by an approval proof or an approval-key registration.',
        responses: {
          '200': { description: 'Nonce', content: { 'application/json': { schema: { type: 'object', properties: { nonce: { type: 'string' }, expiresAt: { type: 'number' } }, required: ['nonce', 'expiresAt'] } } } },
          '403': { description: 'NOT_A_DEVICE' },
        },
      },
    },
    '/api/auth/devices/me/approval-key': {
      put: {
        tags: ['Auth'], summary: "Register this device's biometric-gated approval key (MG-05)",
        description: 'DPoP-authenticated; the device id comes from the principal. `proof` is the new key signing the canonical JSON {"deviceId","nonce","serverId","typ":"gai-approval-key"} (ES256, raw r||s, base64url).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  publicJwk: { type: 'object', properties: { kty: { type: 'string', enum: ['EC'] }, crv: { type: 'string', enum: ['P-256'] }, x: { type: 'string' }, y: { type: 'string' } }, required: ['kty', 'crv', 'x', 'y'] },
                  keyProtection: { type: 'string', enum: ['secure-enclave', 'strongbox', 'tee'] },
                  presence: { type: 'string', enum: ['biometry', 'passcode'] },
                  nonce: { type: 'string' },
                  proof: { type: 'string' },
                },
                required: ['publicJwk', 'keyProtection', 'presence', 'nonce', 'proof'],
              },
            },
          },
        },
        responses: { '204': { description: 'Registered' }, '400': { description: 'INVALID_BODY' }, '403': { description: 'NOT_A_DEVICE or APPROVAL_PROOF_INVALID' } },
      },
      delete: {
        tags: ['Auth'], summary: "Remove this device's approval key (MG-05)",
        responses: { '204': { description: 'Removed (idempotent)' } },
      },
    },
    '/api/auth/devices/me': {
      get: {
        tags: ['Auth'], summary: "This device's own record (MG-01)",
        description: 'read:status only; the device id comes from the principal. Never returns key material, the owner or the relay binding.',
        responses: {
          '200': {
            description: 'SelfDeviceView',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    deviceId: { type: 'string' },
                    name: { type: 'string' },
                    platform: { type: 'string' },
                    scopes: { type: 'array', items: { type: 'string' } },
                    createdAt: { type: 'string', format: 'date-time' },
                    lastSeenAt: { type: 'string', format: 'date-time' },
                    connectionMode: { type: 'string' },
                    credentialVersion: { type: 'integer' },
                    approvalKey: { type: 'object', properties: { createdAt: { type: 'string', format: 'date-time' }, presence: { type: 'string', enum: ['biometry', 'passcode'] } } },
                  },
                  required: ['deviceId', 'name', 'platform', 'scopes', 'createdAt', 'connectionMode', 'credentialVersion'],
                },
              },
            },
          },
          '404': { description: 'NOT_A_DEVICE or NOT_FOUND' },
        },
      },
    },
    '/api/auth/tls/ca.crt': {
      get: {
        tags: ['Auth'], summary: "This install's local CA certificate (D-110)",
        description: 'Public. Installing it on a device makes browsers trust the generated certificate. Name-constrained to private addresses, `.local` and `localhost`.',
        security: [],
        responses: {
          '200': { description: 'PEM certificate', content: { 'application/x-x509-ca-cert': { schema: { type: 'string' } } } },
          '404': { description: 'TLS_NOT_ACTIVE — loopback-only server or a custom certificate' },
        },
      },
    },
    '/api/security/tls/certificate': {
      put: {
        tags: ['Security'], summary: 'Serve your own certificate to other devices (D-113)',
        description: 'admin:settings. The certificate must match the key, be a server certificate valid now, and name this computer (a LAN address, `<host>.local`, an advertised URL host, or `<host>.<domain>`). The key must be unencrypted PEM.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { certificatePem: { type: 'string', maxLength: 65536 }, privateKeyPem: { type: 'string', maxLength: 16384 } },
                required: ['certificatePem', 'privateKeyPem'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Now serving it', content: { 'application/json': { schema: { type: 'object', properties: { tls: { $ref: '#/components/schemas/TlsStatus' } } } } } },
          '400': { description: 'INVALID_CERTIFICATE, INVALID_KEY, ENCRYPTED_KEY, KEY_MISMATCH, CA_CERTIFICATE, EXPIRED, NOT_YET_VALID or NAME_MISMATCH' },
          '409': { description: 'TLS_NOT_ACTIVE — Network exposure is off' },
        },
      },
      delete: {
        tags: ['Security'], summary: 'Go back to the generated certificate (D-113)',
        responses: {
          '200': { description: 'Serving the generated certificate', content: { 'application/json': { schema: { type: 'object', properties: { tls: { $ref: '#/components/schemas/TlsStatus' } } } } } },
          '409': { description: 'TLS_NOT_ACTIVE' },
        },
      },
    },
    '/api/security/tailscale': {
      get: {
        tags: ['Security'], summary: 'Connect with Tailscale — status (D-123)',
        description:
          'read:status. What the Tailscale CLI on this machine reports and whether `https://<machine>.<tailnet>.ts.net` serves this server. ' +
          'Without admin:settings the answer is `{ detail: "limited", enabled, state, origin: null }` (D-120).',
        responses: { '200': { description: 'TailscaleAccessStatus', content: { 'application/json': { schema: { $ref: '#/components/schemas/TailscaleAccessStatus' } } } } },
      },
      post: {
        tags: ['Security'], summary: 'Turn Tailscale access on or off (D-123)',
        description:
          'admin:settings. On runs `tailscale serve --bg --https=443 http://127.0.0.1:<port>` (no shell) and persists the choice; it is re-applied ' +
          'when the server starts. Off removes the 443 handler only when it still points at this server. `replace` overrides another app\'s handler.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { enabled: { type: 'boolean' }, replace: { type: 'boolean' } }, required: ['enabled'] } } },
        },
        responses: {
          '200': { description: 'TailscaleAccessStatus after the change', content: { 'application/json': { schema: { $ref: '#/components/schemas/TailscaleAccessStatus' } } } },
          '400': { description: 'INVALID_BODY' },
          '409': {
            description:
              'TAILSCALE_BLOCKED, TAILSCALE_NOT_INSTALLED, TAILSCALE_NOT_RUNNING, TAILSCALE_NEEDS_LOGIN, TAILSCALE_HTTPS_DISABLED (error.tailscale.enableHttpsUrl is ' +
              "Tailscale's link), TAILSCALE_SERVE_CONFLICT, TAILSCALE_NO_NAME, TAILSCALE_SERVE_FAILED or TAILSCALE_ERROR; `error.tailscale` carries the status",
          },
        },
      },
    },
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
    '/api/stats/summary': {
      get: {
        tags: ['Stats'],
        summary: 'Chats/runs/automations aggregate over a time range (G-10)',
        description:
          'Home "This week", the Workflows stat strip, AutomationDetail\'s stat row, WorkflowDetail\'s rail. ' +
          '`from`/`to` are computed by the CLIENT in its own local time zone. `successRate`/`avgDurationMs`/' +
          '`medianDurationMs` are omitted, not `0`, whenever their denominator is zero (D-36).',
        parameters: [
          { in: 'query', name: 'from', required: true, schema: { type: 'string', format: 'date-time' } },
          { in: 'query', name: 'to', required: true, schema: { type: 'string', format: 'date-time' } },
          { in: 'query', name: 'projectId', required: false, schema: { type: 'string' } },
          { in: 'query', name: 'definitionId', required: false, schema: { type: 'string' } },
          { in: 'query', name: 'automationId', required: false, schema: { type: 'string' } },
          { in: 'query', name: 'groupBy', required: false, schema: { type: 'string', enum: ['definition'] } },
        ],
        responses: {
          '200': {
            description: 'Stats summary',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          '400': { description: '`from`/`to` missing or unparseable', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/activity/recent': {
      get: {
        tags: ['Activity'],
        summary: 'Recently finished activity, merged across chats, runs and automations (G-11)',
        description:
          'Home "Recently finished". Merges each chat\'s finished turn, terminal workflow runs and terminal ' +
          'automation executions into one feed, newest first. Pull-request- and commit-derived items are not ' +
          'built in this pass (see packages/shared/src/types/RecentActivity.ts).',
        parameters: [
          { in: 'query', name: 'since', required: false, schema: { type: 'string', format: 'date-time' } },
          { in: 'query', name: 'limit', required: false, schema: { type: 'integer', default: 20, maximum: 100 } },
          { in: 'query', name: 'projectId', required: false, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Recent activity feed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { items: { type: 'array', items: { $ref: '#/components/schemas/RecentActivityItem' } } },
                  required: ['items'],
                },
              },
            },
          },
          '400': { description: '`since` is not a parseable timestamp', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/search': {
      get: {
        tags: ['Search'],
        summary: "CommandPalette's entity search across chats, projects, agents, workflows, automations and scripts (G-18)",
        description:
          'One merged, ranked list. Each type is dropped from the results (never a 403) when the caller lacks its ' +
          'read scope — `read:chats` (chat), `read:projects` (project), `read:workflows` (agent/workflow/automation/script). ' +
          'Settings entries and navigation targets are matched client-side and are not part of this response.',
        parameters: [
          { in: 'query', name: 'q', required: true, schema: { type: 'string' } },
          {
            in: 'query',
            name: 'types',
            required: false,
            schema: { type: 'string' },
            description: 'Comma-separated subset of chat,project,agent,workflow,automation,script. Default: every readable type.',
          },
          { in: 'query', name: 'limit', required: false, schema: { type: 'integer', default: 20, maximum: 50 } },
        ],
        responses: {
          '200': {
            description: 'Ranked results',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    results: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          type: { type: 'string', enum: ['chat', 'project', 'agent', 'workflow', 'automation', 'script'] },
                          id: { type: 'string' },
                          title: { type: 'string' },
                          subtitle: { type: 'string' },
                          href: { type: 'string' },
                          status: { type: 'string' },
                          actions: { type: 'array', items: { type: 'string', enum: ['open', 'run', 'new_chat'] } },
                        },
                        required: ['type', 'id', 'title', 'href'],
                      },
                    },
                  },
                  required: ['results'],
                },
              },
            },
          },
        },
      },
    },
    '/api/system/info': {
      get: {
        tags: ['System'],
        summary: 'Server, database, disk and agent-capacity summary (G-12)',
        description:
          'Home "System" card + Settings › Diagnostics. `database.sizeBytes` and `disk` are omitted, not zero, ' +
          'when the server could not measure them (D-36).',
        responses: {
          '200': {
            description: 'System info snapshot',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    serverName: { type: 'string' },
                    serverVersion: { type: 'string' },
                    platform: { type: 'string' },
                    uptimeSec: { type: 'number' },
                    agents: {
                      type: 'object',
                      properties: { max: { type: 'integer' } },
                      required: ['max'],
                    },
                    database: {
                      type: 'object',
                      properties: { kind: { type: 'string', enum: ['sqlite'] }, sizeBytes: { type: 'integer' } },
                      required: ['kind'],
                    },
                    disk: {
                      type: 'object',
                      properties: { usedBytes: { type: 'integer' }, totalBytes: { type: 'integer' } },
                      required: ['usedBytes', 'totalBytes'],
                    },
                  },
                  required: ['serverName', 'serverVersion', 'platform', 'uptimeSec', 'agents', 'database'],
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
        summary: 'List chats, one page at a time (G-02)',
        description:
          'Keyset-paged. `projectId`, `agentRef`, `tag` and `state` may repeat (any of); different filters must all match. ' +
          '`state=needs_you|running` is resolved against the attention feed; `done|failed` is the last turn outcome of a chat that is not live. ' +
          'Worker chats are left out unless `workers=true`.',
        parameters: [
          { in: 'query', name: 'status', schema: { type: 'string', enum: ['active', 'archived'] }, description: 'Lifecycle segment; omitted = all.' },
          { in: 'query', name: 'projectId', schema: { type: 'array', items: { type: 'string' } }, style: 'form', explode: true },
          { in: 'query', name: 'agentRef', schema: { type: 'array', items: { type: 'string' } }, style: 'form', explode: true },
          { in: 'query', name: 'tag', schema: { type: 'array', items: { type: 'string' } }, style: 'form', explode: true },
          {
            in: 'query',
            name: 'state',
            schema: { type: 'array', items: { type: 'string', enum: ['needs_you', 'running', 'done', 'failed'] } },
            style: 'form',
            explode: true,
          },
          { in: 'query', name: 'q', schema: { type: 'string', maxLength: 200 }, description: 'Case-insensitive substring of the name, the description or a tag.' },
          { in: 'query', name: 'sort', schema: { type: 'string', enum: ['activity', 'created', 'name'], default: 'activity' } },
          { in: 'query', name: 'cursor', schema: { type: 'string' }, description: '`nextCursor` of the previous page (same sort).' },
          { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
          { in: 'query', name: 'workers', schema: { type: 'boolean', default: false } },
        ],
        responses: {
          '200': {
            description: 'One page of chats',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ChatListPage' } } },
          },
          '400': {
            description: 'Invalid filter, sort, limit or cursor',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
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
    '/api/chats/archive': {
      post: {
        tags: ['Chats'],
        summary: 'Archive several chats (G-02 bulk bar)',
        description:
          'Per-id outcome; an already archived chat counts as archived. At most 200 ids per request: ' +
          'clients split a larger selection into several requests and merge the results (runChatBulk).',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ChatBulkRequest' } } },
        },
        responses: {
          '200': {
            description: 'Per-id outcome',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ChatBulkResult' } } },
          },
          '400': { description: 'Invalid body', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/chats/delete': {
      post: {
        tags: ['Chats'],
        summary: 'Permanently delete several chats (G-02 bulk bar)',
        description: 'Per-id outcome. At most 200 ids per request; clients batch larger selections (runChatBulk).',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ChatBulkRequest' } } },
        },
        responses: {
          '200': {
            description: 'Per-id outcome',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ChatBulkResult' } } },
          },
          '400': { description: 'Invalid body', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/chats/{id}/workflow-runs': {
      get: {
        tags: ['Chats'],
        summary: "The runs the chat started through its workflow tools, as run cards (status, stage n of m, pending decisions, link)",
        parameters: [idParam],
        responses: { '200': { description: '{runs: ChatWorkflowRunCard[]}' }, '404': { description: 'Chat not found' } },
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
    '/api/chats/ingest': {
      post: {
        tags: ['Chats'],
        summary: 'Send shared content to an existing or a new chat in one request (mobile share sheet, MG-09)',
        description:
          'multipart: `target` (JSON `{"chatId"}` or `{"newChat":{"name"?,"projectId"?,"agentRef"?,"model"?}}`), `note`, `text`, `url` ' +
          '(sent as prompt text, never fetched), `attachments[]` (≤ 5 × 10 MB). Header `Idempotency-Key` required: a retry within 24 h answers ' +
          'the first chat (200, `X-Idempotent-Replay: true`) without sending again. A new chat gets the defaults and permission gates of ' +
          '`POST /api/chats`. Needs write:chats. 409 CHAT_BUSY / INTERACTION_PENDING as for the prompt route.',
        parameters: [{ in: 'header', name: 'Idempotency-Key', required: true, schema: { type: 'string', maxLength: 200 } }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  target: { type: 'string', description: 'JSON target' },
                  note: { type: 'string' },
                  text: { type: 'string' },
                  url: { type: 'string' },
                  attachments: { type: 'array', items: { type: 'string', format: 'binary' } },
                },
                required: ['target'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Sent',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { chatId: { type: 'string' }, created: { type: 'boolean' } }, required: ['chatId', 'created'] },
              },
            },
          },
          '200': { description: 'Replayed (same Idempotency-Key)' },
          '400': { description: 'No key, a malformed target, or nothing to send' },
          '409': { description: 'CHAT_BUSY or INTERACTION_PENDING' },
        },
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
    '/api/agents/import/preview': {
      post: {
        tags: ['Agents'],
        summary: 'Preview a .agent.md import without writing (MG-12)',
        description: 'Parsed fields, unresolved skill / MCP / team names as warnings, and the agent an import would replace. Same scope as the import.',
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
                },
                required: ['markdown'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'AgentImportPreview { parsed, warnings[], conflict? }' },
          '400': { description: 'VALIDATION_ERROR or PARSE_ERROR { message }' },
          '413': { description: 'TOO_LARGE — over 256 KB' },
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
        summary: 'List workflow definitions (summaries, newest first)',
        parameters: [
          { in: 'query', name: 'projectId', schema: { type: 'string' }, description: '`global` lists definitions without a project' },
          { in: 'query', name: 'status', schema: { type: 'string', enum: ['draft', 'published'] } },
          { in: 'query', name: 'q', schema: { type: 'string' }, description: 'Name contains' },
          { in: 'query', name: 'cursor', schema: { type: 'string' } },
          { in: 'query', name: 'limit', schema: { type: 'integer' } },
          { in: 'query', name: 'includeArchived', schema: { type: 'boolean' } },
        ],
        responses: {
          '200': {
            description: 'A page of definitions',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', items: { $ref: '#/components/schemas/WorkflowDefinitionSummary' } },
                    nextCursor: { type: 'string' },
                  },
                  required: ['items'],
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Workflows'],
        summary: 'Create a draft definition from a graph',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkflowGraph' } } } },
        responses: {
          '201': { description: 'Created (draft)', content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkflowDefinition' } } } },
          '403': { description: 'INSUFFICIENT_SCOPE: a command-bearing field needs `admin:settings`', content: errorContent },
          '422': { description: 'WORKFLOW_INVALID: `error.issues` lists every problem', content: errorContent },
        },
      },
    },
    '/api/workflow-definitions/validate': {
      post: {
        tags: ['Workflows'],
        summary: "Validate a graph without saving it: the spec's rules plus the server's (agents exist and are enabled, models, provider capabilities, command fields)",
        description: 'Needs read:workflows only. The result carries `schema: {version, hash}`; an agent compares the hash with its skill.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkflowGraph' } } } },
        responses: {
          '200': {
            description: 'The validation result, valid or not',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationResult' } } },
          },
        },
      },
    },
    '/api/workflow-definitions/plan': {
      post: {
        tags: ['Workflows'],
        summary: 'What a run of a graph (unsaved) or a saved definition would do; nothing is written',
        description:
          'Body `{graph | workflowId, variables?, stageOverrides?, codebases?, projectId?}` (a missing required codebase is a warning here) → `{plan: InvocationPlan, guards, unresolved, warnings}`. Needs read:workflows only.',
        responses: { '200': { description: 'AuthoringPlan' }, '400': { description: 'VALIDATION_ERROR' }, '422': { description: 'The graph is not valid' } },
      },
    },
    '/api/workflow-definitions/schema': {
      get: {
        tags: ['Workflows'],
        summary: 'The workflow JSON Schema the server validates against: `{version, hash, jsonSchema}`',
        responses: { '200': { description: 'The schema and its hash' } },
      },
    },
    '/api/workflow-definitions/authoring/skill': {
      get: {
        tags: ['Workflows'],
        summary: 'The generated `generatorai-workflow-author` skill bundle: `{name, schemaHash, files[]}`',
        responses: { '200': { description: 'The bundle file list' } },
      },
    },
    '/api/workflow-definitions/authoring/skill/file': {
      get: {
        tags: ['Workflows'],
        summary: 'One file of the authoring skill bundle (`?path=reference/schema.md`)',
        responses: { '200': { description: 'The file' }, '400': { description: 'Not a bundle path' } },
      },
    },
    '/api/workflow-definitions/import': {
      post: {
        tags: ['Workflows'],
        summary: 'Import a canonical document, or create a draft from a template',
        parameters: [
          {
            in: 'query',
            name: 'publish',
            schema: { type: 'boolean' },
            description: 'Publish at once (people only; integrations import drafts)',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                oneOf: [
                  { $ref: '#/components/schemas/WorkflowGraph' },
                  {
                    type: 'object',
                    properties: {
                      templateId: { type: 'string' },
                      name: { type: 'string' },
                      projectId: { type: ['string', 'null'] },
                    },
                    required: ['templateId'],
                  },
                ],
              },
            },
          },
        },
        responses: {
          '201': { description: 'Imported', content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkflowDefinition' } } } },
          '403': { description: 'PUBLISH_NOT_ALLOWED or INSUFFICIENT_SCOPE', content: errorContent },
          '422': { description: 'WORKFLOW_INVALID', content: errorContent },
        },
      },
    },
    '/api/workflow-definitions/{id}': {
      get: {
        tags: ['Workflows'],
        summary: 'Get a definition with its working graph',
        parameters: [idParam],
        responses: {
          '200': { description: 'Definition', content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkflowDefinition' } } } },
          '404': { description: 'Not found', content: errorContent },
        },
      },
      delete: {
        tags: ['Workflows'],
        summary: 'Delete a definition, or archive it when runs pin its versions',
        parameters: [idParam],
        responses: {
          '200': {
            description: '`{deleted: true}`, or `{archived: true, runs}` when the definition has runs',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { type: 'object', properties: { deleted: { type: 'boolean', enum: [true] } }, required: ['deleted'] },
                    {
                      type: 'object',
                      properties: { archived: { type: 'boolean', enum: [true] }, runs: { type: 'integer' } },
                      required: ['archived', 'runs'],
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
    '/api/workflow-definitions/{id}/graph': {
      put: {
        tags: ['Workflows'],
        summary: 'Replace the working graph (optimistic concurrency on revision)',
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  graph: { $ref: '#/components/schemas/WorkflowGraph' },
                  expectedRevision: { type: 'integer' },
                },
                required: ['graph', 'expectedRevision'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Saved; the revision is bumped', content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkflowDefinition' } } } },
          '400': { description: 'The body is not `{graph, expectedRevision}`', content: errorContent },
          '403': { description: 'INSUFFICIENT_SCOPE: adding or changing a command needs `admin:settings`', content: errorContent },
          '409': { description: 'REVISION_CONFLICT: `error.current` is the record the save lost to', content: errorContent },
          '422': { description: 'WORKFLOW_INVALID: `error.issues` lists every problem', content: errorContent },
        },
      },
    },
    '/api/workflow-definitions/{id}/publish': {
      post: {
        tags: ['Workflows'],
        summary: 'Publish the working graph as the version new runs execute',
        description:
          'A person publishes (PD-14): a service account, an internal service or an MCP device gets 403 unless the operator set `GENERATORAI_ALLOW_AGENT_PUBLISH=true`.',
        parameters: [idParam],
        responses: {
          '200': { description: 'Published', content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkflowDefinition' } } } },
          '403': { description: 'INSUFFICIENT_SCOPE: only a person publishes', content: errorContent },
          '422': { description: 'WORKFLOW_INVALID', content: errorContent },
        },
      },
    },
    '/api/workflow-definitions/{id}/versions': {
      get: {
        tags: ['Workflows'],
        summary: 'List the published and test versions',
        parameters: [idParam],
        responses: {
          '200': {
            description: 'Versions, without their graphs',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/WorkflowDefinitionVersion' } },
              },
            },
          },
        },
      },
    },
    '/api/workflow-definitions/{id}/versions/{versionId}': {
      get: {
        tags: ['Workflows'],
        summary: 'Get one version with its graph',
        parameters: [idParam, { in: 'path', name: 'versionId', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Version',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkflowDefinitionVersion' } } },
          },
          '404': { description: 'Not found', content: errorContent },
        },
      },
    },
    '/api/workflow-definitions/{id}/export': {
      get: {
        tags: ['Workflows'],
        summary: 'The canonical document text: importing it gives back the same graph',
        parameters: [idParam],
        responses: {
          '200': {
            description: 'Canonical JSON',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkflowGraph' } } },
          },
        },
      },
    },

    '/api/workflow-runs': {
      get: {
        tags: ['Runs'],
        summary: 'Search runs, oldest first; every filter narrows',
        parameters: [
          { in: 'query', name: 'status', schema: { type: 'string' }, description: 'Comma list of run states' },
          { in: 'query', name: 'definitionId', schema: { type: 'string' } },
          { in: 'query', name: 'trigger', schema: { type: 'string' }, description: 'Comma list of trigger kinds (user, automation, fork, stage, …); a run without a trigger is user' },
          { in: 'query', name: 'from', schema: { type: 'string' }, description: 'Created at or after (ISO date or epoch ms)' },
          { in: 'query', name: 'to', schema: { type: 'string' }, description: 'Created at or before (ISO date or epoch ms)' },
          { in: 'query', name: 'q', schema: { type: 'string' }, description: 'Part of the run name, or the start of its id' },
          { in: 'query', name: 'var', schema: { type: 'array', items: { type: 'string' } }, style: 'form', explode: true, description: 'name=value (repeatable): a variable with that value' },
          { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 1000 }, description: 'Only the newest N matches' },
        ],
        responses: {
          '200': { description: 'Runs', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/WorkflowRun' } } } } },
          '400': { description: 'VALIDATION_ERROR (an unknown status, a bad date, var or limit)' },
        },
      },
    },
    '/api/workflow-runs/stage-history': {
      get: {
        tags: ['Runs'],
        summary: "One stage's newest executions across the definition's runs (every instance), newest first: `[{stageRun, run: {id, name, status, createdAt}}]`",
        parameters: [
          { in: 'query', name: 'definitionId', required: true, schema: { type: 'string' } },
          { in: 'query', name: 'stageKey', required: true, schema: { type: 'string' } },
          { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 200, default: 20 } },
        ],
        responses: { '200': { description: 'The executions' }, '400': { description: 'VALIDATION_ERROR' } },
      },
    },
    '/api/settings/workflow-engine': {
      get: {
        tags: ['Runs'],
        summary: 'The workflow engine settings (P07): flow key limits, the workflow summary model, the trigger debounce, their defaults and every flow key live',
        description:
          '`{settings: {flowLimits, summaryModel, triggerDebounceMs}, defaults: {flowLimits, triggerDebounceMs}, flows: [{flowKey, kind, running, queued, limit, configurable, detail?}]}`. ' +
          'Flow keys: global, provider:<id>, model:<id>, check:global (configurable), worktree:<mountId> and run:<id> (live only). Needs read:workflows.',
        responses: { '200': { description: 'The settings and the live flow keys' } },
      },
      put: {
        tags: ['Runs'],
        summary: 'Change the workflow engine settings (applied at once); `flowLimits` is the whole set — a key left out goes back to its default',
        description: 'Body `{flowLimits?: {<key>: 1..256}, summaryModel?: string | null, triggerDebounceMs?: 0..600000}`. Needs admin:settings.',
        responses: { '200': { description: 'The settings and the live flow keys' }, '400': { description: 'INVALID_BODY' }, '403': { description: 'FORBIDDEN_SCOPE' } },
      },
    },
    '/api/workflow-invocations': {
      post: {
        tags: ['Runs'],
        summary: 'Start a workflow run: THE one run-start route (a definition, a script or a fork)',
        description:
          'JSON `InvocationRequest` (full JSON Schema: `@generatorai/workflow-spec/invocation.schema.json`), or multipart with a `request` JSON field ' +
          'plus `skills|agents|prompts` files. The trigger is derived from the caller. `Idempotency-Key` (or `idempotencyKey`) replays the same run for 24 h; ' +
          'another body under the same key is a 409. Needs exec:agent + read:workflows; a script target also write:workflows; bypass off loopback or an ' +
          'in-place codebase admin:settings.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/InvocationRequest' } } } },
        responses: {
          '202': { description: 'InvocationResult: runId, trigger, plan, links' },
          '400': { description: '{error: {code: VALIDATION_ERROR, message, issues[]}}' },
          '403': { description: 'FORBIDDEN_SCOPE or PERMISSION_ESCALATION' },
          '404': { description: 'NOT_FOUND' },
          '409': { description: 'IDEMPOTENCY_KEY_REUSED, DRAFT_NOT_RUNNABLE or CONFLICT' },
          '422': { description: 'CODEBASE_REQUIRED, DEPTH_LIMIT, RECURSION, BUDGET_EXHAUSTED or PERMISSION_GATING_UNSUPPORTED' },
          '503': { description: 'ENGINE_UNAVAILABLE' },
        },
      },
    },
    '/api/workflow-tools': {
      get: {
        tags: ['Workflows'],
        summary: "The workflow tools of an external agent (the MCP server): `{tools: [{name, description, parametersSchema, readOnly}]}`",
        responses: { '200': { description: 'The tool list' } },
      },
    },
    '/api/workflow-tools/{name}': {
      post: {
        tags: ['Workflows'],
        summary: 'Call one workflow tool as an external agent: `{arguments, idempotencyKey?, clientName?}` → `{result}`',
        description:
          'The same handlers as the in-app tools. Refusals come back as `result: {ok: false, code, error}`. Running, answering and cancelling need exec:agent; a draft write:workflows.',
        parameters: [{ in: 'path', name: 'name', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: '{result}' }, '404': { description: 'No such tool' } },
      },
    },
    '/api/workflow-invocations/plan': {
      post: {
        tags: ['Runs'],
        summary: 'What an invocation would do (stages by layer, skips, codebases, phases, post-processing, permission mode); nothing is written',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/InvocationRequest' } } } },
        responses: { '200': { description: 'InvocationPlan' }, '400': { description: 'VALIDATION_ERROR' } },
      },
    },
    '/api/workflow-invocations/uploads': {
      post: {
        tags: ['Runs'],
        summary: 'Stage skills, agents or prompts for a run that has not started (multipart; TTL 1 h)',
        responses: { '201': { description: '{uploads: [{uploadId, category, name}]}' }, '400': { description: 'VALIDATION_ERROR' } },
      },
    },
    '/api/workflow-invocations/{runId}/digest': {
      get: {
        tags: ['Runs'],
        summary: "The run's digest; `wait=N` (≤ 60 s) long-polls for `finalized` (or an approval with `stopOnApproval=true`)",
        parameters: [runIdParam],
        responses: { '200': { description: 'RunDigest' }, '404': { description: 'NOT_FOUND' } },
      },
    },
    '/api/workflow-runs/{runId}/workspace': {
      get: {
        tags: ['Runs'],
        summary: "The run's workspace: root, artifacts, uploads and every mount with its files",
        parameters: [runIdParam],
        responses: { '200': { description: 'RunWorkspaceInfo' }, '404': { description: 'No workspace yet' } },
      },
    },
    '/api/workflow-runs/{runId}/workspace/diff': {
      get: {
        tags: ['Runs'],
        summary: "Each mount's change set",
        parameters: [runIdParam],
        responses: { '200': { description: '{hasGit, repos: [{alias, files}]}' } },
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
    '/api/workflow-runs/{runId}/commands': {
      post: {
        tags: ['Runs', 'HITL'],
        summary: 'An operator command on the run or one of its instances',
        description:
          'pause {mode: drain|interrupt}, resume, cancel, retry {mode: resume|restart}, skip {as}, fail, approve {outcome, feedback?, data?}, ' +
          'the loop decisions grant_iterations {n}, raise_budget, continue_with_input {text}, accept, accept_iteration {k}, and deliver_event ' +
          '{eventKey, idempotencyKey, data?} (P05). `instanceId` targets one instance; `expectedVersion` makes the command conditional. ' +
          '`approve` also resolves an approval wait (its form is validated) and a decision of a sub-workflow child sent to the parent run. ' +
          'The decisions (approve, the loop decisions, deliver_event) need exec:agent; every other command also needs write:workflows. ' +
          'A mobile device sends `approve` with `approvalProof` beside the command (mobile MG-05): the device approval key signs gate ' +
          '{kind: stage_approval, id: instanceId, entityId: runId} and the decision approve / reject / request_changes for approved / rejected / ' +
          'changes_requested; until workflow approvals carry a server risk verdict every one counts as risky.',
        parameters: [runIdParam],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RunCommand' } } },
        },
        responses: {
          '200': { description: 'deliver_event: the same key and data were delivered before (`replayed: true`)' },
          '202': { description: 'Accepted by the engine' },
          '400': { description: 'Invalid command, or approval data that does not match the form schema of the wait' },
          '403': { description: 'A run-control command without write:workflows; APPROVAL_KEY_MISSING, APPROVAL_PROOF_REQUIRED or APPROVAL_PROOF_INVALID for an approval from a mobile device' },
          '404': { description: 'Unknown run or instance' },
          '409': { description: 'invalid_state, version_conflict or conflict' },
          '503': { description: 'No workflow engine in this process' },
        },
      },
    },
    '/api/workflow-runs/{runId}/pending-decisions': {
      get: {
        tags: ['Runs', 'HITL'],
        summary: 'Every decision the run waits on, with those of its sub-workflow children (P05)',
        description:
          'Completion reviews, in-turn gates, parked loops, approval and event waits: `{runId (the owning run), instanceId, stageKey, instancePath, name, kind, waitType?, ' +
          'interruptData, version, callback?, via: [{runId, instanceId, stageKey, name}]}`. Answer any of them with the commands route of this run.',
        parameters: [runIdParam],
        responses: { '200': { description: 'Pending decisions' }, '404': { description: 'Unknown run' } },
      },
    },
    '/api/workflow-callbacks/{token}': {
      post: {
        tags: ['Runs'],
        summary: "Deliver an event wait's event with its callback token (public; P05 §4.3)",
        description:
          'The token (from the waiting wait: `callback.url`) authenticates the delivery: an HMAC over the run, the wait instance and its event key. ' +
          'Body `{data?, idempotencyKey?}` or the `Idempotency-Key` header; without a key the data is the key. Rate-limited per token and address.',
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: false,
          content: { 'application/json': { schema: { type: 'object', properties: { data: {}, idempotencyKey: { type: 'string' } } } } },
        },
        responses: {
          '200': { description: 'Replayed (the same key and data were delivered before)' },
          '202': { description: 'Delivered' },
          '404': { description: 'Unknown or invalid token' },
          '409': { description: 'The wait is not waiting any more, or the same key with other data' },
          '429': { description: 'Rate limited' },
        },
      },
    },
    '/api/workflow-runs/{runId}/instances/{instanceId}/messages': {
      post: {
        tags: ['Runs', 'HITL'],
        summary: 'Send an operator message to a stage (a stage is a compact chat)',
        description:
          'multipart (`prompt`, `attachments[]`, `mode`) or JSON. Between turns the message is queued as the next turn; a completed stage is AMENDED ' +
          '(its output replaced, successors not re-run); a paused stage is retried with the message as its next turn.',
        parameters: [runIdParam, instanceIdParam],
        responses: {
          '202': { description: '`outcome`: queued, amending or retrying' },
          '400': { description: 'Empty or invalid message' },
          '404': { description: 'Unknown run or instance' },
          '409': { description: 'STAGE_BUSY (mid-turn), INTERACTION_PENDING (an open gate), STAGE_NOT_STARTED or STAGE_NOT_CONVERSABLE' },
          '503': { description: 'No workflow engine in this process' },
        },
      },
    },
    '/api/workflow-runs/{runId}/instances/{instanceId}/turn/cancel': {
      post: {
        tags: ['Runs'],
        summary: "Stop the stage's turn in flight without failing the stage",
        parameters: [runIdParam, instanceIdParam],
        requestBody: {
          required: false,
          content: { 'application/json': { schema: { type: 'object', properties: { force: { type: 'boolean' } } } } },
        },
        responses: { '200': { description: 'Stopped' }, '409': { description: 'NO_ACTIVE_TURN' } },
      },
    },
    '/api/workflow-runs/{runId}/instances/{instanceId}/interactions/{interactionId}/permission': {
      post: {
        tags: ['Runs', 'HITL'],
        summary: "Answer a stage's tool-permission gate ({behavior: allow|deny, message?, remember?})",
        description:
          'A risky gate (the MG-04 verdict on the parked interaction) answered by a mobile device carries `approvalProof` (gate {kind: tool_permission, id: interactionId, entityId: runId}, decision = behavior). ' +
          '`remember: true` with `allow` ("Allow for this run", U-16) also stores the gate\'s `rememberRules` for the run: every stage then allows a request they cover without asking.',
        parameters: [runIdParam, instanceIdParam, interactionIdParam],
        responses: {
          '202': { description: 'Answered' },
          '403': { description: 'APPROVAL_KEY_MISSING, APPROVAL_PROOF_REQUIRED or APPROVAL_PROOF_INVALID (a risky gate answered by a mobile device)' },
          '409': { description: 'INTERACTION_STALE' },
          '422': { description: 'NOT_REMEMBERABLE — the gate always asks (risky, an always-ask tool, or a never-listed command)' },
        },
      },
    },
    '/api/workflow-runs/{runId}/permission-rules': {
      get: {
        tags: ['Runs', 'HITL'],
        summary: 'The permission rules this run remembered ("Allow for this run", U-16): {rules: [{id, kind: command|tool, match, createdAt}]}',
        parameters: [runIdParam],
        responses: { '200': { description: 'Rules, oldest first' }, '404': { description: 'Unknown run' } },
      },
      delete: {
        tags: ['Runs', 'HITL'],
        summary: 'Clear the run\'s remembered permission rules: {removed}',
        parameters: [runIdParam],
        responses: { '200': { description: 'Cleared' }, '404': { description: 'Unknown run' } },
      },
    },
    '/api/workflow-runs/{runId}/permission-rules/{ruleId}': {
      delete: {
        tags: ['Runs', 'HITL'],
        summary: 'Revoke one remembered permission rule',
        parameters: [runIdParam, { name: 'ruleId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': { description: 'Revoked' }, '404': { description: 'No such rule on this run' } },
      },
    },
    '/api/workflow-runs/{runId}/instances/{instanceId}/interactions/{interactionId}/answer': {
      post: {
        tags: ['Runs', 'HITL'],
        summary: "Answer a stage's question gate ({answers, freeformResponse?})",
        parameters: [runIdParam, instanceIdParam, interactionIdParam],
        responses: { '202': { description: 'Answered' }, '409': { description: 'INTERACTION_STALE' } },
      },
    },
    '/api/workflow-runs/{runId}/instances/{instanceId}/interactions/{interactionId}/plan': {
      post: {
        tags: ['Runs', 'HITL'],
        summary: "Decide a stage's plan review ({approved, action?, feedback?})",
        parameters: [runIdParam, instanceIdParam, interactionIdParam],
        responses: { '202': { description: 'Decided' }, '409': { description: 'INTERACTION_STALE' } },
      },
    },
    '/api/workflow-runs/{runId}/instances/{instanceId}/attachments/{artifactId}': {
      get: {
        tags: ['Runs'],
        summary: 'A file attached to a stage message',
        parameters: [runIdParam, instanceIdParam, { name: 'artifactId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'The file' }, '404': { description: 'Not an attachment of this stage' } },
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
        description: '`codebases` (D-103) needs `projectId`; see the Automation schema.',
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
    '/api/stream/replay/prelude': {
      get: {
        tags: ['Streaming'],
        summary: "Opening a chat: its latest turn's first seq and the earlier rows its transcript still needs",
        parameters: [{ in: 'query', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: '{ turnStartSeq, rows } — page /api/stream/replay from turnStartSeq (0: from the start)' } },
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
    '/api/source-control/remote-refs': {
      post: {
        tags: ['SourceControl'],
        summary: 'Branches a Git remote advertises, before a clone (MG-11)',
        description: '`git ls-remote --symref` over https / ssh / git transports only (ext:: and file:// refused), no credential prompt, 15 s timeout, at most 500 branches. Needs write:projects.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
        },
        responses: {
          '200': {
            description: 'RemoteRefs',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    defaultBranch: { type: 'string' },
                    branches: { type: 'array', items: { type: 'string' } },
                    truncated: { type: 'boolean' },
                  },
                  required: ['branches', 'truncated'],
                },
              },
            },
          },
          '400': { description: 'VALIDATION_ERROR or INVALID_URL' },
          '401': { description: 'AUTH_REQUIRED' },
          '404': { description: 'NOT_FOUND' },
          '502': { description: 'REMOTE_FAILED' },
          '504': { description: 'TIMEOUT' },
        },
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

    // ── Project-scoped workflow runs (G-15) — ProjectDetail Runs tab ──

    '/api/projects/{id}/runs': {
      get: {
        tags: ['Projects'],
        summary: 'Paged workflow runs for a project, newest first (G-15)',
        description:
          '`WorkflowRun` carries no `projectId` of its own, so this joins through the definition server-side. ' +
          'Tolerates a project with zero definitions / zero runs (empty page, `total: 0`).',
        parameters: [
          idParam,
          { in: 'query', name: 'status', required: false, schema: { type: 'string' }, description: 'Comma-separated, any-of.' },
          { in: 'query', name: 'cursor', required: false, schema: { type: 'string' } },
          { in: 'query', name: 'limit', required: false, schema: { type: 'integer', default: 50, maximum: 200 } },
        ],
        responses: {
          '200': {
            description: 'One page of runs',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', items: { type: 'object' } },
                    nextCursor: { type: 'string', nullable: true },
                    total: { type: 'integer' },
                  },
                  required: ['items', 'nextCursor', 'total'],
                },
              },
            },
          },
          '400': { description: 'Invalid status value or unknown cursor', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    // ── Codebase fetch/clone logs and live status (G-16) ──

    '/api/projects/{id}/codebases/{cid}/fetch': {
      post: {
        tags: ['Projects'],
        summary: 'Start a background fetch job for a codebase (G-16)',
        description:
          'Was synchronous; now returns as soon as the job starts. Tail its progress with ' +
          '`GET .../logs`, or subscribe to `codebase.status_changed` on the `global` stream scope.',
        parameters: [idParam, cidParam],
        responses: {
          '202': {
            description: 'Job started',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { jobId: { type: 'string' } },
                  required: ['jobId'],
                },
              },
            },
          },
          '404': { description: 'Unknown codebase', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/projects/{id}/codebases/{cid}/logs': {
      get: {
        tags: ['Projects'],
        summary: "Tail a codebase's clone/fetch logs + current job (G-16)",
        description:
          'Served from an in-memory ring buffer of the last 500 lines (process lifetime, cleared on restart). ' +
          'Poll only while `job.status === \'running\'`.',
        parameters: [
          idParam,
          cidParam,
          { in: 'query', name: 'limit', required: false, schema: { type: 'integer', default: 200, maximum: 500 } },
        ],
        responses: {
          '200': {
            description: 'Log lines + job',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    lines: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          ts: { type: 'string', format: 'date-time' },
                          stream: { type: 'string', enum: ['stdout', 'stderr'] },
                          text: { type: 'string' },
                        },
                        required: ['ts', 'stream', 'text'],
                      },
                    },
                    job: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        kind: { type: 'string', enum: ['clone', 'fetch'] },
                        status: { type: 'string', enum: ['running', 'succeeded', 'failed'] },
                        startedAt: { type: 'string', format: 'date-time' },
                        endedAt: { type: 'string', format: 'date-time' },
                        error: { type: 'string' },
                      },
                      required: ['id', 'kind', 'status', 'startedAt'],
                    },
                  },
                  required: ['lines'],
                },
              },
            },
          },
          '404': { description: 'Unknown codebase', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    // ── Per-project artifact customization (G-19) ──

    '/api/projects/{id}/artifact-prefs': {
      get: {
        tags: ['Projects'],
        summary: 'Per-project skill/prompt/agent/MCP enable-disable (G-19)',
        description:
          'Stored inline on the project\'s existing JSON `settings` column — no migration. Applied by ' +
          '`ArtifactCatalog` when resolving skills/MCP servers for a chat or stage in this project, and by ' +
          '`GET .../available-artifacts` for skill/prompt/agent pickers.',
        parameters: [idParam],
        responses: {
          '200': {
            description: 'Disabled artifact ids',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    disabled: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          type: { type: 'string', enum: ['skill', 'prompt', 'agent', 'mcp'] },
                          id: { type: 'string' },
                        },
                        required: ['type', 'id'],
                      },
                    },
                  },
                  required: ['disabled'],
                },
              },
            },
          },
        },
      },
      put: {
        tags: ['Projects'],
        summary: 'Replace the disabled set (G-19)',
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  disabled: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        type: { type: 'string', enum: ['skill', 'prompt', 'agent', 'mcp'] },
                        id: { type: 'string' },
                      },
                      required: ['type', 'id'],
                    },
                  },
                },
                required: ['disabled'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'The saved set', content: { 'application/json': { schema: { type: 'object' } } } },
          '400': { description: 'Malformed entry', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
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
    '/api/projects/{id}/codebases/{cid}/pull-requests/{number}/merge': {
      post: {
        tags: ['SourceControl', 'Projects'],
        summary: 'Merge a pull request (D-146)',
        description:
          'Merges with the chosen method and, when asked, deletes the head branch on the host. A merged, closed or draft PR, or one ' +
          'the host refuses (conflicts, required checks or reviews, a moved head), answers 409 SCM_NOT_MERGEABLE with the reason. ' +
          'A branch that cannot be deleted never fails a merge that happened: see branchDeleteError.',
        parameters: [idParam, cidParam, prNumberParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  method: { type: 'string', enum: ['merge', 'squash', 'rebase'], default: 'merge' },
                  deleteBranch: { type: 'boolean' },
                  commitTitle: { type: 'string', maxLength: 256 },
                  commitMessage: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Merged', content: { 'application/json': { schema: { $ref: '#/components/schemas/MergePullRequestResult' } } } },
          '400': errorResponse('Invalid request'),
          '409': errorResponse('The remote host is not connected (SCM_NOT_CONNECTED) or the PR cannot be merged (SCM_NOT_MERGEABLE)'),
        },
      },
    },

    // ── Source control: issues under a project (D-146) ──

    '/api/projects/{id}/issues': {
      get: {
        tags: ['SourceControl', 'Projects'],
        summary: 'Issues across every codebase of a project, newest activity first',
        description: 'Pull requests are excluded. A codebase without a remote, without a connected account, or whose host call failed is listed under `unavailable`.',
        parameters: [
          idParam,
          { in: 'query', name: 'state', required: false, schema: { type: 'string', enum: ['open', 'closed', 'all'] } },
          { in: 'query', name: 'labels', required: false, description: 'Comma-separated: only issues carrying every label', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Issues + unavailable codebases', content: { 'application/json': { schema: { $ref: '#/components/schemas/ProjectIssuesResponse' } } } },
        },
      },
    },
    '/api/projects/{id}/codebases/{cid}/issues': {
      post: {
        tags: ['SourceControl', 'Projects'],
        summary: "Create an issue in the codebase's repository",
        parameters: [idParam, cidParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string', minLength: 1, maxLength: 256 },
                  body: { type: 'string' },
                  labels: { type: 'array', items: { type: 'string' } },
                },
                required: ['title'],
              },
            },
          },
        },
        responses: {
          '201': { description: 'Created issue', content: { 'application/json': { schema: { $ref: '#/components/schemas/IssueSummary' } } } },
          '400': errorResponse('Invalid request'),
          '409': errorResponse('The remote host is not connected'),
        },
      },
    },
    '/api/projects/{id}/codebases/{cid}/issues/{number}': {
      get: {
        tags: ['SourceControl', 'Projects'],
        summary: 'An issue with its comments (oldest first)',
        parameters: [idParam, cidParam, issueNumberParam],
        responses: {
          '200': { description: 'Issue + comments', content: { 'application/json': { schema: { $ref: '#/components/schemas/IssueDetailResponse' } } } },
          '400': errorResponse('Invalid request'),
          '404': errorResponse('Not an issue (missing, or a pull request)'),
          '409': errorResponse('The remote host is not connected'),
        },
      },
    },
    '/api/projects/{id}/codebases/{cid}/issues/{number}/comments': {
      post: {
        tags: ['SourceControl', 'Projects'],
        summary: 'Comment on an issue',
        parameters: [idParam, cidParam, issueNumberParam],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { body: { type: 'string', minLength: 1 } }, required: ['body'] } } },
        },
        responses: {
          '201': { description: 'Created comment', content: { 'application/json': { schema: { $ref: '#/components/schemas/IssueComment' } } } },
          '400': errorResponse('Invalid request'),
          '409': errorResponse('The remote host is not connected'),
        },
      },
    },
    '/api/projects/{id}/codebases/{cid}/issues/{number}/close': {
      post: {
        tags: ['SourceControl', 'Projects'],
        summary: 'Close an issue as completed or not planned, optionally commenting first',
        parameters: [idParam, cidParam, issueNumberParam],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  reason: { type: 'string', enum: ['completed', 'not_planned'], default: 'completed' },
                  comment: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'The closed issue', content: { 'application/json': { schema: { $ref: '#/components/schemas/IssueSummary' } } } },
          '400': errorResponse('Invalid request'),
          '409': errorResponse('The remote host is not connected'),
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

    '/api/attention': {
      get: {
        tags: ['Attention'],
        summary: 'Needs you + Running across chats, workflow runs and automation executions (G-01)',
        description:
          'Requires `read:activity`. Needs you is oldest ask first; Running is longest-running first. ' +
          'An entity with a pending ask appears only under Needs you.',
        parameters: [
          {
            in: 'query',
            name: 'projectId',
            required: false,
            schema: { type: 'string' },
            description: 'Only items belonging to this project (counts follow the filter).',
          },
        ],
        responses: {
          '200': {
            description: 'Attention snapshot',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AttentionSnapshot' } },
            },
          },
          '400': {
            description: 'Invalid projectId',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '503': {
            description: 'The attention feed has not started (or failed to): unknown, not empty (ATTENTION_UNAVAILABLE)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },

    '/api/harness/providers': {
      get: {
        tags: ['Harness'],
        summary: 'Readiness and model catalog of every agent provider (G-09)',
        description:
          'Answered from the last snapshot (`stale: true` while a background re-probe runs; poll until false). ' +
          '`refresh=1` forces a blocking re-probe that spawns each provider CLI.',
        parameters: [{ in: 'query', name: 'refresh', required: false, schema: { type: 'string', enum: ['1', 'true'] } }],
        responses: {
          '200': {
            description: 'Providers',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HarnessProvidersResponse' } } },
          },
        },
      },
    },

    '/api/harness/visibility': {
      get: {
        tags: ['Harness'],
        summary: 'Which agent providers this server serves (D-131)',
        description:
          'Every supported provider with its stability and whether it is served. A hidden provider is absent from every ' +
          'provider/model route and cannot run a turn. `source`: default (stability), setting (an admin), env ' +
          '(`GENERATORAI_EXPERIMENTAL_PROVIDERS`).',
        responses: {
          '200': {
            description: 'Visibility',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HarnessVisibilityResponse' } } },
          },
        },
      },
      put: {
        tags: ['Harness'],
        summary: 'Reveal or hide providers (admin:harnesses, D-131)',
        description: 'Body `{visible: {<provider>: true | false | null}}`; null returns a provider to its default. Applied at once.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { visible: { type: 'object', additionalProperties: { type: 'boolean', nullable: true } } },
                required: ['visible'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Visibility after the change',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HarnessVisibilityResponse' } } },
          },
          '400': { description: 'Unknown provider or malformed body', content: errorContent },
        },
      },
    },

    '/api/harness/providers/{type}/login': {
      post: {
        tags: ['Harness'],
        summary: "Start the provider's own sign-in (G-09)",
        parameters: [{ in: 'path', name: 'type', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Sign-in started: open `authUrl` when present, then re-probe; `completed` = signed in already',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { authUrl: { type: 'string' }, loginId: { type: 'string' }, completed: { type: 'boolean' } },
                },
              },
            },
          },
          '404': { description: 'Unknown provider', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '409': { description: 'No in-app sign-in (UNSUPPORTED)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    '/api/chats/{id}/background-tasks': {
      get: {
        tags: ['Chats'],
        summary: "An orchestrator chat's background workers",
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: '`{ tasks }`; a cancelled task carries `cancelledBy` (user | orchestrator) and `cancelledAt` (epoch ms, G-20)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    tasks: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          taskId: { type: 'string' },
                          taskName: { type: 'string' },
                          status: { type: 'string', enum: ['spawned', 'running', 'needs_review', 'completed', 'failed', 'cancelled', 'interrupted'] },
                          model: { type: 'string' },
                          agentRef: { type: 'string' },
                          agentName: { type: 'string' },
                          objective: { type: 'string', description: 'The first line of what the orchestrator asked the worker to do (its brief).' },
                          reviewRounds: { type: 'integer' },
                          cancelledBy: { type: 'string', enum: ['user', 'orchestrator'] },
                          cancelledAt: { type: 'integer' },
                        },
                        required: ['taskId', 'taskName', 'status', 'reviewRounds'],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    '/api/chats/{id}/background-tasks/{taskId}/detail': {
      get: {
        tags: ['Chats'],
        summary: 'One background worker: the brief, review rounds and latest steps (D-89)',
        description:
          'Read from the worker chat\'s persisted messages, so it survives a server restart. `rounds` are the ' +
          'follow-ups the orchestrator sent after reading a result; `lastSteps` the worker\'s latest tool calls (≤ 8).',
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
          { in: 'path', name: 'taskId', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'The task detail',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    taskId: { type: 'string' },
                    taskName: { type: 'string' },
                    status: { type: 'string', enum: ['spawned', 'running', 'needs_review', 'completed', 'failed', 'cancelled', 'interrupted'] },
                    model: { type: 'string' },
                    brief: {
                      type: 'object',
                      nullable: true,
                      properties: {
                        text: { type: 'string' },
                        objective: { type: 'string' },
                        context: { type: 'string' },
                        boundaries: { type: 'string' },
                      },
                      required: ['text'],
                    },
                    rounds: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: { round: { type: 'integer' }, at: { type: 'string', format: 'date-time' }, request: { type: 'string' } },
                        required: ['round', 'at', 'request'],
                      },
                    },
                    reviewRounds: { type: 'integer' },
                    maxReviewRounds: { type: 'integer' },
                    outcome: { type: 'string', enum: ['accepted', 'in_review', 'reworking', 'running', 'failed', 'cancelled'] },
                    lastSteps: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          tool: { type: 'string' },
                          args: {},
                          status: { type: 'string', enum: ['running', 'complete'] },
                          success: { type: 'boolean' },
                          fileOp: {
                            type: 'object',
                            properties: {
                              kind: { type: 'string' },
                              filePath: { type: 'string' },
                              additions: { type: 'integer' },
                              deletions: { type: 'integer' },
                            },
                          },
                          at: { type: 'string', format: 'date-time' },
                        },
                        required: ['id', 'tool', 'status', 'at'],
                      },
                    },
                  },
                  required: ['taskId', 'taskName', 'status', 'brief', 'rounds', 'reviewRounds', 'maxReviewRounds', 'outcome', 'lastSteps'],
                },
              },
            },
          },
          '404': { description: 'Not a background task of this chat', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    '/api/chats/{id}/background-tasks/{taskId}/cancel': {
      post: {
        tags: ['Chats'],
        summary: 'Cancel one background worker, attributed to the user (G-20)',
        description:
          'The orchestrator chat stream carries the same attribution on `chat.background_task.status` / ' +
          '`chat.background_task.completed` (`cancelledBy`, `cancelledAt`). A worker stopped because its ' +
          'orchestrator stopped, rewound, was archived or deleted is attributed to `orchestrator`.',
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
          { in: 'path', name: 'taskId', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '202': {
            description: 'Cancelled (or already cancelled: the first attribution is kept)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    taskId: { type: 'string' },
                    cancelledBy: { type: 'string', enum: ['user', 'orchestrator'] },
                    cancelledAt: { type: 'integer' },
                  },
                  required: ['ok', 'taskId', 'cancelledBy', 'cancelledAt'],
                },
              },
            },
          },
          '404': { description: 'Unknown task', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/chats/{id}/background-tasks/{taskId}/resume': {
      post: {
        tags: ['Chats'],
        summary: 'Resume a worker a server restart interrupted (D-100)',
        description:
          'Only an `interrupted` worker resumes: it is re-attached and prompted to finish from its transcript; when it ' +
          'settles the orchestrator is prompted to collect the result. Progress arrives on the orchestrator chat stream.',
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
          { in: 'path', name: 'taskId', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '202': {
            description: 'Resumed',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { ok: { type: 'boolean' }, taskId: { type: 'string' } }, required: ['ok', 'taskId'] },
              },
            },
          },
          '404': { description: 'Unknown task', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '409': { description: 'The task is not interrupted', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    '/api/workspaces/{id}/computer/consent': {
      get: {
        tags: ['Computer'],
        summary: 'Consent prompts awaiting an answer (G-07: `plan` lists a batched request)',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: '`{ pending }`',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { pending: { type: 'array', items: { $ref: '#/components/schemas/ComputerPendingConsent' } } },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Computer'],
        summary: 'Answer a prompt; `scope` app | any picks "this app only" or "any app" (G-07)',
        description:
          'Omitted `scope` keeps each decision’s own reach: allow_run any app, the rest this app. A deny is ' +
          'always for the app. `always_allow` + `any` stores a grant on appIdentity `*`; synthetic prompts ' +
          'downgrade `always_allow` to `allow_once`.',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  requestId: { type: 'string' },
                  appIdentity: { type: 'string' },
                  decision: { type: 'string', enum: ['allow_once', 'allow_run', 'always_allow', 'deny'] },
                  scope: { type: 'string', enum: ['app', 'any'] },
                },
                required: ['requestId', 'appIdentity', 'decision'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: '`{ ok, requestId, decision, scope }`',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    requestId: { type: 'string' },
                    decision: { type: 'string' },
                    scope: { type: 'string', enum: ['app', 'any'] },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid body', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '409': { description: 'No longer awaiting an answer (NOT_PENDING)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    '/api/workspaces/{id}/computer/control': {
      get: {
        tags: ['Computer'],
        summary: 'Who drives the desktop: agent | paused | user (G-07)',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Control state',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ComputerControlState' } } },
          },
        },
      },
      post: {
        tags: ['Computer'],
        summary: 'Pause agent (paused), Take over (user) or hand back (agent) (G-07)',
        description:
          'While `paused` or `user`, every agent desktop operation on this workspace is refused (`agent_paused` / ' +
          '`user_in_control`). A change emits `computer.control_changed` `{ workspaceId, mode, previous, changedAt }` ' +
          'on the workspace stream scope.',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { mode: { type: 'string', enum: ['agent', 'paused', 'user'] } },
                required: ['mode'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'New control state',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ComputerControlState' } } },
          },
          '400': { description: 'Invalid mode', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    '/api/harness/providers/{type}/logout': {
      post: {
        tags: ['Harness'],
        summary: "Sign the provider's account out (G-09)",
        parameters: [{ in: 'path', name: 'type', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Signed out' },
          '404': { description: 'Unknown provider', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '409': { description: 'No in-app sign-out (UNSUPPORTED)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
  },
};
