// ────────────────────────────────────────────────────────────────
// `run_code` (D-182): the code-mode tool. The agent writes the body of an
// async function that calls the session's OTHER tools as `tools.<name>(args)`;
// it runs in the QuickJS-wasm sandbox (sandbox.ts) and returns one JSON report.
//
// Every injected function calls the session's own `ToolDefinition.handler` —
// the same function a provider calls for a direct call — so the gates that
// live in handlers (askBeforeRunning / askBeforeActing approvals, plan-mode
// refusals, computer-use refusals, workflow and GitHub gates) apply unchanged.
// What a provider adds AROUND a handler does not: its native permission
// prompt (Copilot asks for host tools without `skipPermission`; it asks once
// for `run_code` itself instead), its hook bridge and its transcript event per
// call — a script's calls are reported in the `calls` trace instead.
// ────────────────────────────────────────────────────────────────

import { takeToolBinaries, type ToolCallContext, type ToolDefinition } from '../../domain/ports/IAgentHarness.js';
import { DEFAULT_SANDBOX_LIMITS, runInQuickJs, type SandboxLimits, type SandboxTool } from './sandbox.js';
import { renderToolListing } from './signatures.js';

export const RUN_CODE_TOOL_NAME = 'run_code';

/** Deadline bounds (seconds). */
export const RUN_CODE_DEFAULT_TIMEOUT_S = 60;
export const RUN_CODE_MAX_TIMEOUT_S = 300;

export interface CodeModeToolOptions {
  /** Telemetry owner tag. */
  owner?: string;
  /** Overrides of the sandbox limits other than the deadline (tests). */
  limits?: Partial<Omit<SandboxLimits, 'timeoutMs'>>;
  /** Budget for the signature listing in the description. */
  maxListingChars?: number;
}

/** The provider default per-tool budget (`GENERATORAI_TOOL_TIMEOUT_MS`, 120 s), as gates.ts reads it. */
function toolTimeoutMs(): number {
  const raw = Number(process.env['GENERATORAI_TOOL_TIMEOUT_MS'] ?? 120_000);
  return Number.isFinite(raw) && raw > 0 ? raw : 120_000;
}

function withBudget<T>(work: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${name} timed out after ${Math.round(ms / 1000)} s`)), ms);
    timer.unref?.();
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * A handler's result as the script sees it: JSON text parsed, other text as a
 * string, binary attachments (screenshots) left out with a count.
 */
export function toScriptValue(result: unknown): unknown {
  const { text, binaries } = takeToolBinaries(result);
  let value = text;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      try {
        value = JSON.parse(trimmed);
      } catch {
        // plain text stays text
      }
    }
  }
  if (binaries.length > 0 && value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>), attachmentsOmitted: binaries.length };
  }
  return value;
}

function describe(listing: string, limits: SandboxLimits): string {
  return [
    'Run a short async JavaScript script that calls your other tools as functions — to chain, loop over or batch many ' +
      'tool calls in ONE step and return only what matters.',
    '`code` is the body of an async function: call `await tools.<name>(args)` and `return` a JSON-compatible value; ' +
      '`console.log` is captured. Results arrive parsed (JSON text becomes a value, other text a string). A failing ' +
      'tool throws an Error you can catch. Calls get the same approvals and permissions as direct calls.',
    `Sandbox: QuickJS, nothing but \`tools\` and \`console\` (no require/import, files, network, process or timers). ` +
      `Limits: ${Math.round(limits.memoryBytes / (1024 * 1024))} MB memory; deadline \`timeoutSeconds\` ` +
      `(default ${RUN_CODE_DEFAULT_TIMEOUT_S}, max ${RUN_CODE_MAX_TIMEOUT_S}, tool calls and approvals included); ` +
      `${limits.maxCalls} tool calls; ${Math.round(limits.maxOutputChars / 1000)}k characters of output.`,
    'Returns JSON {ok, error?, result, logs, calls: [{tool, ok, ms, error?}], truncated?}.',
    listing ? `Callable tools:\n${listing}` : 'No other tools are available to call.',
  ].join('\n');
}

const SCHEMA = {
  type: 'object' as const,
  properties: {
    code: {
      type: 'string',
      description:
        'Body of an async JS function, e.g. `const r = await tools.list_items({}); return r.items.length;`',
    },
    timeoutSeconds: {
      type: 'number',
      description: `Deadline for the whole script in seconds (default ${RUN_CODE_DEFAULT_TIMEOUT_S}, max ${RUN_CODE_MAX_TIMEOUT_S}).`,
    },
  },
  required: ['code'],
};

/**
 * The `run_code` tool over `sessionTools` — every tool already bound to the
 * session (run_code itself is skipped). Build it after the session's other
 * tools are in place: the listing and the callable set are fixed here.
 */
export function buildCodeModeTool(sessionTools: readonly ToolDefinition[], opts: CodeModeToolOptions = {}): ToolDefinition {
  const callable = sessionTools.filter((t) => t.name !== RUN_CODE_TOOL_NAME && typeof t.handler === 'function');
  const byName = new Map(callable.map((t) => [t.name, t]));
  const limits: SandboxLimits = { ...DEFAULT_SANDBOX_LIMITS, ...opts.limits };
  const listing = renderToolListing(
    [...byName.values()].map((t) => ({ name: t.name, description: t.description, parametersSchema: t.parametersSchema })),
    opts.maxListingChars,
  );

  return {
    name: RUN_CODE_TOOL_NAME,
    description: describe(listing, limits),
    parametersSchema: SCHEMA,
    // The provider's own per-call budget: the longest deadline plus room to report.
    timeoutMs: (RUN_CODE_MAX_TIMEOUT_S + 30) * 1000,
    ...(opts.owner ? { owner: opts.owner } : {}),
    handler: async (args: Record<string, unknown>, ctx?: ToolCallContext) => {
      const code = typeof args['code'] === 'string' ? args['code'] : '';
      if (!code.trim()) throw new Error('code is required');
      const requested = typeof args['timeoutSeconds'] === 'number' && Number.isFinite(args['timeoutSeconds'])
        ? args['timeoutSeconds']
        : RUN_CODE_DEFAULT_TIMEOUT_S;
      const timeoutS = Math.min(RUN_CODE_MAX_TIMEOUT_S, Math.max(1, requested));

      let seq = 0;
      const tools: Record<string, SandboxTool> = {};
      for (const [name, def] of byName) {
        tools[name] = async (toolArgs, signal) => {
          if (signal.expired) throw new Error('the script was stopped');
          seq += 1;
          // A replayed run_code call replays the same inner ids, so handlers that key idempotency on them hold.
          const inner: ToolCallContext = ctx?.toolCallId ? { toolCallId: `${ctx.toolCallId}:${seq}` } : {};
          const result = await withBudget(Promise.resolve(def.handler(toolArgs, inner)), def.timeoutMs ?? toolTimeoutMs(), name);
          return toScriptValue(result);
        };
      }

      const report = await runInQuickJs(code, tools, { ...limits, timeoutMs: timeoutS * 1000 });
      return JSON.stringify(report);
    },
  };
}
