// ────────────────────────────────────────────────────────────────
// MCP request-body schemas — shared by the project MCP routes and the
// global Settings MCP routes so both accept exactly the same shape.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';

/** `KEY` → value. Keys are trimmed, non-empty, and free of whitespace/`=`. */
const credentialMap = z
  .record(z.string().min(1).max(200), z.string().max(64 * 1024))
  .refine(
    (m) => Object.keys(m).every((k) => /^[^\s=]+$/.test(k)),
    { message: 'credential keys must not contain whitespace or "="' },
  );

export const McpTransportSchema = z.enum(['stdio', 'http', 'sse']);

/**
 * Body for creating / replacing an MCP server (project or custom scope).
 * `headers` is only meaningful for http/sse, `env` for stdio; the wrong one
 * for the transport is rejected rather than silently dropped.
 */
export const McpServerBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional(),
    serverType: McpTransportSchema.default('http'),
    url: z.string().trim().url().optional(),
    command: z.string().trim().min(1).max(1000).optional(),
    args: z.array(z.string().max(4000)).max(64).optional(),
    timeoutMs: z.number().int().positive().max(3_600_000).optional(),
    enabled: z.boolean().optional(),
    headers: credentialMap.optional(),
    env: credentialMap.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.serverType === 'stdio') {
      if (!v.command) ctx.addIssue({ code: 'custom', path: ['command'], message: 'command required for stdio type' });
      if (v.headers && Object.keys(v.headers).length > 0) {
        ctx.addIssue({ code: 'custom', path: ['headers'], message: 'headers apply to http/sse servers only' });
      }
    } else {
      if (!v.url) ctx.addIssue({ code: 'custom', path: ['url'], message: `url required for ${v.serverType} type` });
      if (v.env && Object.keys(v.env).length > 0) {
        ctx.addIssue({ code: 'custom', path: ['env'], message: 'env applies to stdio servers only' });
      }
    }
  });

export type McpServerBody = z.infer<typeof McpServerBodySchema>;

/** Body for the per-bundled-server preferences (`PUT /system/mcp-servers/system/:id`). */
export const SystemMcpPrefsBodySchema = z.object({
  enabled: z.boolean().optional(),
  inputs: z.record(z.string().min(1).max(100), z.string().max(4000)).optional(),
  env: credentialMap.optional(),
  headers: credentialMap.optional(),
});

export type SystemMcpPrefsBody = z.infer<typeof SystemMcpPrefsBodySchema>;
