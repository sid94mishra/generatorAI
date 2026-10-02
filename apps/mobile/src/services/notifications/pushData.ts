import { z } from 'zod';
import { safeRoute } from './routeGuard';

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const PushDataV2Schema = z.object({
  v: z.literal(2), serverId: id,
  href: z.string().max(4096).refine((value) => safeRoute(value) !== null),
  route: z.string().optional(), category: z.string(), threadId: z.string(),
  chatId: id.optional(), interactionId: id.optional(),
  kind: z.enum(['permission', 'question', 'plan']).optional(),
  actions: z.array(z.string()).max(4).optional(),
  entity: z.enum(['chat', 'workflow_run', 'automation_execution']).optional(),
  entityId: id.optional(), workflowDefinitionId: id.optional(),
});

/** Malformed v2 never falls back to an old route or the currently open server. */
export function normalizePushData(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const data = input as Record<string, unknown>;
  if (data.v === undefined) return data;
  const result = PushDataV2Schema.safeParse(data);
  if (!result.success) return null;
  return { ...result.data, route: result.data.href };
}
