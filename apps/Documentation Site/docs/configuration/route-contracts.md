# Supplemental route validation contracts

These validators are declared in server route files rather than exported by the shared configuration modules. They are extracted as source, without importing route handlers or starting the server. Use the [host/client preference guide](./projects-and-settings.md) for application defaults and the [HTTP catalogue](../reference/http-routes.md) for endpoint paths. A validator is only one part of authorization and route-level semantic checks.

## auth

Source: `apps/server/src/routes/auth.ts`. Imported symbols retain their source names; see the linked feature/configuration guides for those values.

### createPairingSchema

```typescript
const createPairingSchema = z.object({
  deviceName: z.string().min(1).max(64),
  platform: z.enum(PLATFORMS).default('other'),
  scopes: z.array(z.string()).optional(),
  ttlMs: z.number().int().min(30_000).max(10 * 60_000).optional(),
  /** Include a relay invite so the device can connect off-LAN. */
  includeRelay: z.boolean().default(false),
});
```

### pairingTokenSchema

```typescript
const pairingTokenSchema = z.string().min(12).max(512);
```

### previewPairingSchema

```typescript
const previewPairingSchema = z.object({
  pairingToken: pairingTokenSchema,
});
```

### completePairingSchema

```typescript
const completePairingSchema = z.object({
  pairingToken: pairingTokenSchema,
  publicJwk: z.object({
    kty: z.string(),
    crv: z.string().optional(),
    x: z.string().optional(),
    y: z.string().optional(),
    n: z.string().optional(),
    e: z.string().optional(),
    alg: z.string().optional(),
    kid: z.string().optional(),
    use: z.string().optional(),
  }).strict(),
  deviceName: z.string().min(1).max(64).optional(),
  platform: z.enum(PLATFORMS).optional(),
  connectionMode: z.enum(['loopback', 'lan', 'ssh', 'relay', 'auto']).optional(),
});
```

### refreshSchema

```typescript
const refreshSchema = z.object({
  resumeSecret: z.string().min(16).max(512),
});
```

### renameSchema

```typescript
const renameSchema = z.object({ name: z.string().min(1).max(64) });
```

### scopesSchema

```typescript
const scopesSchema = z.object({ scopes: z.array(z.string()).max(SCOPES.length) });
```

### revokeSchema

```typescript
const revokeSchema = z.object({ reason: z.string().min(1).max(200).default('revoked by operator') });
```

### pushTokenSchema

```typescript
const pushTokenSchema = z.object({
  provider: z.enum(['expo', 'apns', 'fcm']),
  token: z.string().min(1).max(512),
  platform: z.string().min(1).max(32),
});
```

### muteSchema

```typescript
const muteSchema = z.object({
  /** Epoch ms, or null to unmute. */
  mutedUntil: z.number().int().positive().nullable(),
});
```

## browser

Source: `apps/server/src/routes/browser.ts`. Imported symbols retain their source names; see the linked feature/configuration guides for those values.

### StartBodySchema

```typescript
const StartBodySchema = z.object({
  url: z.string().url().optional(),
  config: BrowserConfigSchema.optional(),
});
```

### ActionBodySchema

```typescript
const ActionBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('navigate'), url: z.string().url() }),
  z.object({ kind: z.literal('reload') }),
  z.object({ kind: z.literal('back') }),
  z.object({ kind: z.literal('forward') }),
  z.object({ kind: z.literal('screenshot') }),
  z.object({ kind: z.literal('snapshot') }),
  z.object({ kind: z.literal('inspector'), on: z.boolean() }),
]);
```

### CookieImportBodySchema

```typescript
const CookieImportBodySchema = z.object({
  browser: z.enum(['chrome', 'edge', 'brave', 'arc']),
  hostFilter: z.array(z.string().min(1).max(200)).max(50).optional(),
});
```

### SelectionBodySchema

```typescript
const SelectionBodySchema = z.object({
  url: z.string(),
  cssSelector: z.string().optional(),
  xpath: z.string().optional(),
  outerHtml: z.string(),
  computedStyle: z.record(z.string()).optional(),
  boundingBox: z
    .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .optional(),
  ts: z.number(),
});
```

### CaptureBodySchema

```typescript
const CaptureBodySchema = z.object({
    clip: z.object({
      x: z.number().min(0),
      y: z.number().min(0),
      width: z.number().positive(),
      height: z.number().positive(),
    }),
    quality: z.number().min(20).max(100).optional(),
  });
```

## chats

Source: `apps/server/src/routes/chats.ts`. Imported symbols retain their source names; see the linked feature/configuration guides for those values.

### CancelTurnBodySchema

```typescript
const CancelTurnBodySchema = z
  .object({
    force: z.boolean().optional(),
    budgetSeconds: z
      .number()
      .finite()
      .transform((s) => Math.min(60, Math.max(0.5, s)))
      .optional(),
  })
  .strip();
```

### RewindChatSchema

```typescript
const RewindChatSchema = z
  .object({
    turnId: z.string().min(1),
    scope: z.enum(['all', 'code', 'conversation']).optional(),
  })
  .strip();
```

### ForkChatSchema

```typescript
const ForkChatSchema = z
  .object({
    turnId: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(200).optional(),
  })
  .strip();
```

## computer

Source: `apps/server/src/routes/computer.ts`. Imported symbols retain their source names; see the linked feature/configuration guides for those values.

### ConsentBodySchema

```typescript
const ConsentBodySchema = z.object({
  requestId: z.string().min(1),
  appIdentity: z.string().min(1),
  decision: z.enum(['allow_once', 'allow_run', 'always_allow', 'deny']),
});
```

### RuntimeActionSchema

```typescript
const RuntimeActionSchema = z.object({ action: z.enum(['start', 'restart', 'stop']) });
```

### RecordingActionSchema

```typescript
const RecordingActionSchema = z.object({
  action: z.enum(['start', 'stop', 'status']),
  /**
   * Also run a whole-screen video capture. Off by default: it needs ffmpeg, it
   * records everything on screen rather than the target window, and it records
   * the lock screen once the workstation locks. The live preview does not use
   * it — window frames and the cursor trace survive a lock, and this does not.
   */
  screenVideo: z.boolean().optional(),
  /** Window to frame the capture on. Omitted means the whole desktop. */
  windowTitle: z.string().max(300).optional(),
});
```

## internal-browser

Source: `apps/server/src/routes/internal-browser.ts`. Imported symbols retain their source names; see the linked feature/configuration guides for those values.

### CdpEndpointBodySchema

```typescript
const CdpEndpointBodySchema = z.object({
  workspaceId: z.string().min(1),
  wsUrl: z.string().url().nullable(),
});
```

## internal-computer

Source: `apps/server/src/routes/internal-computer.ts`. Imported symbols retain their source names; see the linked feature/configuration guides for those values.

### EndpointBodySchema

```typescript
const EndpointBodySchema = z.object({
  workspaceId: z.string().min(1),
  endpoint: z
    .object({
      socketPath: z.string().min(1),
      driverVersion: z.string().min(1),
      pid: z.number().int().nonnegative(),
      platform: z.string().min(1),
      displayServer: z.string().min(1).optional(),
    })
    .nullable(),
});
```

### ConsentBodySchema

```typescript
const ConsentBodySchema = z.object({
  requestId: z.string().min(1),
  // Required so a caller that learned a requestId from the SSE stream cannot
  // approve without also naming what it is approving. The store rejects a
  // mismatch rather than treating it as an answer.
  appIdentity: z.string().min(1),
  decision: z.enum(['allow_once', 'allow_run', 'always_allow', 'deny']),
});
```

## scopeRequests

Source: `apps/server/src/routes/scopeRequests.ts`. Imported symbols retain their source names; see the linked feature/configuration guides for those values.

### createSchema

```typescript
const createSchema = z.object({
  scopes: z.array(z.string().min(1).max(64)).min(1).max(SCOPES.length),
  reason: z.string().max(500).optional(),
});
```

### approveSchema

```typescript
const approveSchema = z.object({
  scopes: z.array(z.string().min(1).max(64)).max(SCOPES.length).optional(),
  note: z.string().max(500).optional(),
});
```

### denySchema

```typescript
const denySchema = z.object({
  note: z.string().max(500).optional(),
});
```

## security

Source: `apps/server/src/routes/security.ts`. Imported symbols retain their source names; see the linked feature/configuration guides for those values.

### networkAccessSchema

```typescript
const networkAccessSchema = z.object({
  mode: z.enum(['local-only', 'network-accessible']),
});
```

## system

Source: `apps/server/src/routes/system.ts`. Imported symbols retain their source names; see the linked feature/configuration guides for those values.

### computerUseSchema

```typescript
const computerUseSchema = z.object({
  enabled: z.boolean(),
  allowSynthetic: z.boolean().optional(),
});
```

### audioSchema

```typescript
const audioSchema = z.object({
    sttEngine: z.enum(STT_ENGINE_CHOICES).optional(),
    textFormatter: z.enum(TEXT_FORMATTER_CHOICES).optional(),
    endpointSilenceMs: z.number().int().min(MIN_ENDPOINT_MS).max(MAX_ENDPOINT_MS).optional(),
    interimResults: z.boolean().optional(),
    ttsEnabled: z.boolean().optional(),
    ttsVoice: z.string().min(1).max(64).optional(),
    ttsSpeed: z.number().min(0.5).max(2).optional(),
  });
```

### workspaceRetentionSchema

```typescript
const workspaceRetentionSchema = z.object({
    enabled: z.boolean(),
    retentionDays: z.number().int().min(MIN_RETENTION_DAYS).max(MAX_RETENTION_DAYS).optional(),
  });
```

## terminals

Source: `apps/server/src/routes/terminals.ts`. Imported symbols retain their source names; see the linked feature/configuration guides for those values.

### CreateBodySchema

```typescript
const CreateBodySchema = z.object({
  cols: z.number().int().min(1).max(500).optional(),
  rows: z.number().int().min(1).max(200).optional(),
  shell: z.string().min(1).max(512).optional(),
  attachToSandbox: z.boolean().optional(),
  runId: z.string().min(1).max(128).optional(),
});
```

### ResizeBodySchema

```typescript
const ResizeBodySchema = z.object({
  cols: z.number().int().min(1).max(500),
  rows: z.number().int().min(1).max(200),
});
```

### SignalBodySchema

```typescript
const SignalBodySchema = z.object({
  name: z.string().min(1).max(32),
});
```

## workflowRuns

Source: `apps/server/src/routes/workflowRuns.ts`. Imported symbols retain their source names; see the linked feature/configuration guides for those values.

### StageMessageSchema

```typescript
const StageMessageSchema = z.object({
  prompt: z.string().trim().min(1).max(100_000),
  mode: AgentModeSchema.optional(),
});
```

### CancelStageTurnSchema

```typescript
const CancelStageTurnSchema = z.object({ force: z.boolean().optional() }).strict();
```

### StagePlanDecisionSchema

```typescript
const StagePlanDecisionSchema = PlanDecisionSchema.pick({ approved: true, action: true, feedback: true });
```

