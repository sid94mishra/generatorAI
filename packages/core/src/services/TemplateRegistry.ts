// ────────────────────────────────────────────────────────────────
// TemplateRegistry — workflow templates (P01 WP-1.7).
//
// A template file (`templates/system/*-workflow.json`) is
// `{ id, category, graph }` with a canonical v2 `WorkflowGraph`. Every
// template is validated at boot with the same validator as a save; an
// invalid template FAILS the boot in development and test (a broken
// template is a bug in the repo), and is skipped with a warning in
// production.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ILogger } from '@generatorai/shared';
import {
  WorkflowTemplateSchema,
  validateWorkflow,
  type WorkflowTemplate,
} from '@generatorai/workflow-spec';

/** Workflow template files; other JSON files in the folder (catalogs) are not templates. */
export const TEMPLATE_FILE_SUFFIX = '-workflow.json';

export class TemplateLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateLoadError';
  }
}

export class TemplateRegistry {
  private workflowTemplates = new Map<string, WorkflowTemplate>();

  constructor(
    private readonly logger: ILogger,
    /** Throw on an invalid template (default: every environment but production). */
    private readonly strict: boolean = process.env['NODE_ENV'] !== 'production',
  ) {}

  /** Load and validate every `*-workflow.json` template in a directory. */
  async loadWorkflowTemplates(dir: string): Promise<void> {
    const files = await this.safeReadDir(dir);
    for (const file of files.filter((f) => f.endsWith(TEMPLATE_FILE_SUFFIX)).sort()) {
      const problem = await this.loadFile(path.join(dir, file));
      if (!problem) continue;
      if (this.strict) throw new TemplateLoadError(`Invalid workflow template ${file}: ${problem}`);
      this.logger.warn(`[TemplateRegistry] Skipped invalid workflow template ${file}: ${problem}`);
    }
  }

  /** Returns a problem description, or undefined when the template registered. */
  private async loadFile(filePath: string): Promise<string | undefined> {
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    } catch (err) {
      return `unreadable: ${err instanceof Error ? err.message : String(err)}`;
    }
    const parsed = WorkflowTemplateSchema.safeParse(raw);
    if (!parsed.success) {
      return parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
    }
    const result = validateWorkflow(parsed.data.graph);
    if (!result.valid) {
      return result.issues
        .filter((i) => i.severity === 'error')
        .slice(0, 3)
        .map((i) => `${i.path || '/'}: ${i.message}`)
        .join('; ');
    }
    this.registerWorkflowTemplate({ ...parsed.data, graph: result.graph! });
    this.logger.info(`[TemplateRegistry] Loaded workflow template: ${parsed.data.id}`);
    return undefined;
  }

  // ── Workflow Templates ─────────────────────────────────────────

  registerWorkflowTemplate(template: WorkflowTemplate): void {
    this.workflowTemplates.set(template.id, template);
  }

  getWorkflowTemplate(id: string): WorkflowTemplate | undefined {
    return this.workflowTemplates.get(id);
  }

  getAllWorkflowTemplates(): WorkflowTemplate[] {
    return [...this.workflowTemplates.values()];
  }

  hasWorkflowTemplate(id: string): boolean {
    return this.workflowTemplates.has(id);
  }

  /** Number of registered workflow templates */
  getTemplateCount(): number {
    return this.workflowTemplates.size;
  }

  // ── Private helpers ────────────────────────────────────────────

  private async safeReadDir(dir: string): Promise<string[]> {
    try {
      return await fs.readdir(dir);
    } catch {
      this.logger.warn(`[TemplateRegistry] Templates directory not found: ${dir}`);
      return [];
    }
  }
}
