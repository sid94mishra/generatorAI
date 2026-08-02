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
      Chat: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          sessionId: { type: 'string' },
          status: { type: 'string', enum: ['active', 'archived'] },
          model: { type: 'string', nullable: true },
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
          approved: { type: 'boolean' },
          value: {},
          reason: { type: 'string' },
        },
        required: ['approved'],
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

    '/api/copilot/models': {
      get: {
        tags: ['Copilot'],
        summary: 'List available Copilot models (honours harness.type config)',
        responses: { '200': { description: 'Models' } },
      },
    },

    '/api/webhooks/github': {
      post: {
        tags: ['Webhooks'],
        summary: 'GitHub webhook endpoint (HMAC-verified)',
        responses: { '200': { description: 'Accepted' }, '401': { description: 'Signature mismatch' } },
      },
    },
  },
};
