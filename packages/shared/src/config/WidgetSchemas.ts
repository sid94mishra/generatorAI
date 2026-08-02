// ────────────────────────────────────────────────────────────────
// WidgetSchemas — Zod validators for widget REST + tool inputs.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { WidgetSurfaceSchema } from './ExtensionManifestSchema.js';

export { WidgetSurfaceSchema };

export const CreateWidgetInstanceSchema = z.object({
  descriptorId: z.string().min(1),
  sessionId: z.string().min(1),
  chatId: z.string().optional(),
  workflowRunId: z.string().optional(),
  stageRunId: z.string().optional(),
  messageId: z.string().optional(),
  surface: WidgetSurfaceSchema.optional(),
  props: z.record(z.unknown()).optional(),
  state: z.record(z.unknown()).optional(),
});

export const UpdateWidgetStateSchema = z.object({
  state: z.record(z.unknown()),
  patch: z.record(z.unknown()).optional(),
});

export const DispatchWidgetActionSchema = z.object({
  action: z.string().min(1),
  payload: z.unknown().optional(),
  from: z.enum(['agent', 'user']).default('user'),
});

/**
 * Body for `POST /api/widgets/:id/invoke-result` — the client bridge
 * posts the result of a `widget:invoke` round-trip back to the server so
 * the pending `widget_action` / `widget_exec` promise resolves.
 */
export const WidgetInvokeResultSchema = z.object({
  invokeId: z.string().min(1),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
