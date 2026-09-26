// ────────────────────────────────────────────────────────────────
// Read-only queries for the attention feed (G-01) over tables it does not
// own. The automation tables belong to the Workflow Overhaul (07 §Running in
// parallel), so this lives in its own file instead of a new method on their
// repository; it only reads.
// ────────────────────────────────────────────────────────────────

import { inArray } from 'drizzle-orm';
import type { AutomationExecution } from '@generatorai/shared';
import { automationExecutions } from '../schema.js';
import type { AppDatabase } from '../index.js';

/**
 * Ids of the automation executions in `statuses`, in one indexed query
 * (`idx_automation_executions_status`). The attention feed's boot rebuild
 * used to read every automation's full execution history, one query per
 * automation, to find the handful that are live (P2-R16).
 */
export async function listAutomationExecutionIdsByStatus(
  db: AppDatabase,
  statuses: readonly AutomationExecution['status'][],
): Promise<string[]> {
  if (statuses.length === 0) return [];
  const rows = await db
    .select({ id: automationExecutions.id })
    .from(automationExecutions)
    .where(inArray(automationExecutions.status, [...statuses]));
  return rows.map((row) => row.id);
}
