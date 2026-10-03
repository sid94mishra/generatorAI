// Push `data` v2 (MG-06 parts A + B, 06 §7.2): the zod schema every notification passes before the app acts on it.
// The payload crossed a third-party push service, so ids are path-safe, the route is allowlisted, and a malformed
// v2 envelope never falls back to an old route or the active server.
import { z } from 'zod';
import { NOTIFICATION_CATEGORY_IDS, NOTIFICATION_MAX_OPTIONS } from '@generatorai/shared/ui-contract';
import { safeRoute } from './routeGuard';

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const line = z.string().max(500);
export const PushDataV2Schema = z.object({
  v: z.literal(2), serverId: id,
  href: z.string().max(4096).refine((value) => safeRoute(value) !== null),
  route: z.string().optional(), category: z.enum(NOTIFICATION_CATEGORY_IDS), threadId: z.string(),
  chatId: id.optional(), interactionId: id.optional(),
  kind: z.enum(['permission', 'question', 'plan']).optional(),
  actions: z.array(z.string()).max(4).optional(),
  entity: z.enum(['chat', 'workflow_run', 'automation_execution']).optional(),
  entityId: id.optional(), workflowDefinitionId: id.optional(),
  risk: z.enum(['standard', 'risky']).optional(),
  runId: id.optional(), stageRunId: id.optional(),
  question: z.object({
    id: z.string().min(1).max(256),
    options: z.array(line).max(NOTIFICATION_MAX_OPTIONS),
    multiSelect: z.boolean(), freeText: z.boolean(), count: z.number().int().min(1),
  }).optional(),
  redacted: z.object({ title: line, body: line }).optional(),
  counts: z.object({ needsYou: z.number().int().min(0), running: z.number().int().min(0) }).optional(),
});
export type PushDataV2 = z.infer<typeof PushDataV2Schema>;

/** Malformed v2 never falls back to an old route or the currently open server. */
export function normalizePushData(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const data = input as Record<string, unknown>;
  if (data.v === undefined) return data;
  const result = PushDataV2Schema.safeParse(data);
  if (!result.success) return null;
  return { ...result.data, route: result.data.href };
}
